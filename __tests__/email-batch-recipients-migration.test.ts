/**
 * Migration 20261106120000 (VAM00026) chạy THẬT trên PostgreSQL (PGlite), sau đúng chuỗi migration đã
 * dựng email_batches và ràng buộc nhóm trên production. Điều phải đúng: 'custom' được NỐI THÊM, mọi
 * nhóm cũ vẫn mở được lô, nhóm lạ vẫn bị chặn; bảng danh sách chốt bật RLS, anon/authenticated không
 * chạm được, service_role chỉ đọc và thêm; chỉ lô custom có danh sách; dán lại vẫn chạy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { BULK_AUDIENCES } from "@/lib/bulk-mail-core";

const read = (file: string) => readFileSync(path.resolve("supabase/migrations", file), "utf8").replace(/\r/g, "");
const SQL = read("20261106120000_email_batch_recipients.sql");

/** Ba migration nhóm thư rớt còn seed mẫu thư; ở đây chỉ cần đúng khối nới ràng buộc của chúng. */
function widenBlock(file: string): string {
  const match = /do \$(\w+_widen)\$[\s\S]*?\$\1\$;/.exec(read(file));
  if (!match) throw new Error(`không thấy khối nới ràng buộc trong ${file}`);
  return match[0];
}

const SEASON = "00000000-0000-4000-8000-000000000001";
const EVENT = "00000000-0000-4000-8000-000000000002";
const PERSON = "00000000-0000-4000-8000-000000000003";

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

async function rejected(role: string, sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  } finally {
    await db.exec("rollback");
    await db.exec("reset role");
  }
}

async function batch(audience: string): Promise<string> {
  const eventId = audience === "event" ? EVENT : null;
  return (
    await one<{ id: string }>(
      "insert into email_batches(season_id, kind, audience, audience_event_id) values ($1, 'general_announcement', $2, $3) returning id",
      [SEASON, audience, eventId]
    )
  ).id;
}

const recipientSql =
  "insert into email_batch_recipients(batch_id, position, relation_table, relation_id, email, full_name, role) values ($1, $2, $3, $4, $5, $6, $7)";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table seasons(id uuid primary key, code text);
    create table admin_users(id uuid primary key, email text);
    create table events(id uuid primary key);
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentor_confirmation_link'::text, 'mentee_application_confirmation'::text,
        'mentor_application_confirmation'::text, 'review_batch_assigned'::text, 'interview_scheduled'::text,
        'reviewer_invite'::text, 'interview_round_invite'::text])));
    create function set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at = now(); return new; end $f$;
    grant usage on schema public to service_role;
  `);
  await db.exec(read("20260909150000_email_templates_and_batches.sql"));
  await db.exec(read("20260910090000_email_batches_audience.sql"));
  await db.exec(read("20260913210000_email_batches_audience_groups.sql"));
  for (const file of [
    "20261007234500_nhom_nhan_thu_mentee_rot_ho_so.sql",
    "20261008180000_thu_rut_loi_moi_pv.sql",
    "20261024120000_nhom_thu_mentee_rot_phong_van.sql"
  ]) {
    await db.exec(widenBlock(file));
  }
  await db.exec(`insert into seasons values ('${SEASON}', 'UEHM-S12'); insert into events values ('${EVENT}');`);
  await db.exec(SQL);
  await db.exec("reset role");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("nhóm nhận thư", () => {
  it("mọi nhóm TypeScript khai báo — cả nhóm cũ lẫn custom — đều mở được lô", async () => {
    for (const audience of BULK_AUDIENCES) {
      const id = await batch(audience);
      expect(id, audience).toBeTruthy();
    }
  });

  it("nhóm lạ vẫn bị chặn", async () => {
    expect(
      await rejected("postgres", "insert into email_batches(season_id, kind, audience) values ($1, 'general_announcement', 'reviewer')", [SEASON])
    ).toBe(true);
  });

  it("lô custom không mang sự kiện (ràng buộc hình dạng cũ vẫn giữ)", async () => {
    expect(
      await rejected(
        "postgres",
        "insert into email_batches(season_id, kind, audience, audience_event_id) values ($1, 'general_announcement', 'custom', $2)",
        [SEASON, EVENT]
      )
    ).toBe(true);
  });
});

describe("bảng email_batch_recipients", () => {
  it("RLS bật, không policy; anon/authenticated không đọc, thêm, sửa, xoá được", async () => {
    expect(await one("select relrowsecurity from pg_class where relname = 'email_batch_recipients'")).toEqual({ relrowsecurity: true });
    expect(await one("select count(*)::int as n from pg_policies where tablename = 'email_batch_recipients'")).toEqual({ n: 0 });
    const id = await batch("custom");
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select * from email_batch_recipients")).toBe(true);
      expect(await rejected(role, recipientSql, [id, 0, "people", PERSON, "a@x.org", "A", "mentor"])).toBe(true);
      expect(await rejected(role, "update email_batch_recipients set full_name = 'B'")).toBe(true);
      expect(await rejected(role, "delete from email_batch_recipients")).toBe(true);
    }
  });

  it("service_role đọc và thêm được; không sửa, không xoá danh sách đã chốt", async () => {
    const id = await batch("custom");
    await db.exec("set role service_role");
    await db.query(recipientSql, [id, 0, "people", PERSON, "chot@x.org", "Người Chốt", "mentee"]);
    await db.exec("reset role");
    expect(await rejected("service_role", "select * from email_batch_recipients where batch_id = $1", [id])).toBe(false);
    expect(await rejected("service_role", "update email_batch_recipients set full_name = 'Khác' where batch_id = $1", [id])).toBe(true);
    expect(await rejected("service_role", "delete from email_batch_recipients where batch_id = $1", [id])).toBe(true);
    expect(await one("select email, full_name, role from email_batch_recipients where batch_id = $1", [id])).toEqual({
      email: "chot@x.org",
      full_name: "Người Chốt",
      role: "mentee"
    });
  });

  it("chỉ lô custom có danh sách chốt", async () => {
    const mentor = await batch("mentor");
    expect(await rejected("service_role", recipientSql, [mentor, 0, "people", PERSON, "a@x.org", "A", "mentor"])).toBe(true);
  });

  it("mỗi email một dòng trong một lô; email phải đã chuẩn hoá; vai trò và nguồn lạ bị chặn", async () => {
    const id = await batch("custom");
    await db.query(recipientSql, [id, 0, "people", PERSON, "mot@x.org", "Một", "mentor"]);
    expect(await rejected("postgres", recipientSql, [id, 1, "event_registrations", EVENT, "mot@x.org", "Một", "attendee"])).toBe(true);
    expect(await rejected("postgres", recipientSql, [id, 1, "people", PERSON, "Hoa@X.org", "Hoa", "mentor"])).toBe(true);
    expect(await rejected("postgres", recipientSql, [id, 1, "people", PERSON, "hai@x.org", "Hai", "reviewer"])).toBe(true);
    expect(await rejected("postgres", recipientSql, [id, 1, "matches", PERSON, "hai@x.org", "Hai", "mentor"])).toBe(true);
    expect(await rejected("postgres", recipientSql, [id, 0, "people", PERSON, "hai@x.org", "Hai", "mentor"])).toBe(true);
    expect(await rejected("postgres", recipientSql, [id, 1, "people", PERSON, "hai@x.org", "  ", "mentor"])).toBe(true);
  });
});

describe("chạy lại", () => {
  it("dán lần hai vẫn chạy, không nhân đôi custom, không đụng dữ liệu", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from email_batch_recipients");
    await db.exec(SQL);
    await db.exec("reset role");
    const def = (await one<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'email_batches_audience_check'")).d;
    expect(def.split("'custom'").length - 1).toBe(1);
    expect(await one("select count(*)::int as n from email_batch_recipients")).toEqual(before);
    // Quyền sau lần dán thứ hai vẫn hẹp như lần đầu.
    expect(await rejected("anon", "select * from email_batch_recipients")).toBe(true);
  });

  it("thiếu migration nhóm thư rớt phỏng vấn thì dừng ngay, trước khi tạo gì", () => {
    expect(SQL).toContain("PREREQ_MISSING: cần migration 20261024120000");
    expect(SQL.indexOf("PREREQ_MISSING")).toBeLessThan(SQL.indexOf("create table if not exists public.email_batch_recipients"));
  });
});
