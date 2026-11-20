/**
 * Migration 20261120150000 (nhóm "Mentee chưa có recap trong tháng" + CC) chạy THẬT trên PostgreSQL
 * (PGlite), sau đúng chuỗi migration đã dựng email_batches và email_batch_recipients. Điều phải đúng:
 *   - 'mentee_no_recap_month' được NỐI THÊM; mọi nhóm cũ vẫn mở được lô, nhóm lạ vẫn bị chặn;
 *   - lô nhóm mới BẮT BUỘC có tháng đúng dạng; nhóm khác không mang tháng;
 *   - lô nhóm mới có danh sách chốt, mỗi dòng mang CC đã chuẩn hoá; lô nhóm cố định khác vẫn không;
 *   - dòng chốt cũ còn nguyên (CC rỗng); quyền không nới; dán lại vô hại; thiếu migration trước thì dừng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { BULK_AUDIENCES } from "@/lib/bulk-mail-core";

const read = (file: string) => readFileSync(path.resolve("supabase/migrations", file), "utf8").replace(/\r/g, "");
const BASE = read("20261106120000_email_batch_recipients.sql");
const EXTERNAL = read("20261109210000_email_batch_recipients_external.sql");
const SQL = read("20261120150000_nhom_mentee_chua_recap.sql");

function widenBlock(file: string): string {
  const match = /do \$(\w+_widen)\$[\s\S]*?\$\1\$;/.exec(read(file));
  if (!match) throw new Error(`không thấy khối nới ràng buộc trong ${file}`);
  return match[0];
}

const SEASON = "00000000-0000-4000-8000-000000000001";
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

const customBatch = async () =>
  (
    await one<{ id: string }>(
      "insert into email_batches(season_id, kind, audience) values ($1, 'general_announcement', 'custom') returning id",
      [SEASON]
    )
  ).id;

const insertSql =
  "insert into email_batch_recipients(batch_id, position, relation_table, relation_id, email, full_name, role) values ($1, $2, $3, $4, $5, $6, $7)";

async function setup(withExternal = true) {
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
  await db.exec(BASE);
  await db.exec("reset role");
  if (withExternal) {
    await db.exec(EXTERNAL);
    await db.exec("reset role");
  }
  // Một dòng đã chốt TRƯỚC migration — phải còn nguyên sau đó.
  const before = await customBatch();
  await db.query(insertSql, [before, 0, "people", PERSON, "cu@x.org", "Người Cũ", "mentor"]);
}

const EVENT = "00000000-0000-4000-8000-000000000002";
const RECAP = "mentee_no_recap_month";

async function batchFor(audience: string, month: string | null = null): Promise<string> {
  return (
    await one<{ id: string }>(
      "insert into email_batches(season_id, kind, audience, audience_event_id, audience_month) values ($1, 'general_announcement', $2, $3, $4) returning id",
      [SEASON, audience, audience === "event" ? EVENT : null, month]
    )
  ).id;
}

const ccSql =
  "insert into email_batch_recipients(batch_id, position, relation_table, relation_id, email, full_name, role, cc_emails) values ($1, $2, 'people', $3, $4, $5, 'mentee', $6)";

describe("trước khi dán", () => {
  it("lô nhóm mới bị chặn", async () => {
    await setup();
    expect(
      await rejected("postgres", "insert into email_batches(season_id, kind, audience) values ($1, 'general_announcement', $2)", [SEASON, RECAP])
    ).toBe(true);
    await db.close();
  });

  it("thiếu migration 20261109210000: dừng ngay, không đụng gì", async () => {
    await setup(false);
    await expect(db.exec(SQL)).rejects.toThrow(/PREREQ_MISSING/);
    await db.exec("rollback").catch(() => undefined);
    const def = (await one<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'email_batches_audience_check'")).d;
    expect(def).not.toContain(RECAP);
    await db.close();
  });
});

describe("sau khi dán", () => {
  beforeAll(async () => {
    await setup();
    await db.exec(SQL);
    await db.exec("reset role");
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it("mọi nhóm TypeScript khai báo đều mở được lô (nhóm mới mang tháng); nhóm lạ vẫn bị chặn", async () => {
    for (const audience of BULK_AUDIENCES) {
      expect(await batchFor(audience, audience === RECAP ? "2026-11" : null), audience).toBeTruthy();
    }
    expect(
      await rejected("postgres", "insert into email_batches(season_id, kind, audience) values ($1, 'general_announcement', 'reviewer')", [SEASON])
    ).toBe(true);
  });

  it("nhóm mới phải có tháng đúng dạng; nhóm khác không được mang tháng", async () => {
    const sql = "insert into email_batches(season_id, kind, audience, audience_month) values ($1, 'general_announcement', $2, $3)";
    for (const bad of [null, "2026-13", "11/2026", "2026-11-01"]) {
      expect(await rejected("postgres", sql, [SEASON, RECAP, bad]), String(bad)).toBe(true);
    }
    expect(await rejected("postgres", sql, [SEASON, "mentee", "2026-11"])).toBe(true);
    expect(await rejected("postgres", sql, [SEASON, "custom", "2026-11"])).toBe(true);
  });

  it("lô nhóm mới có danh sách chốt kèm CC; service_role đọc, ghi được; anon thì không", async () => {
    const id = await batchFor(RECAP, "2026-11");
    await db.exec("set role service_role");
    await db.query(ccSql, [id, 0, PERSON, "binh@x.org", "Bình", ["mentor@x.org"]]);
    await db.query(
      "insert into email_batch_recipients(batch_id, position, relation_table, relation_id, email, full_name, role) values ($1, 1, 'people', $2, 'chi@x.org', 'Chi', 'mentee')",
      [id, PERSON]
    );
    await db.exec("reset role");
    expect((await db.query("select email, cc_emails from email_batch_recipients where batch_id = $1 order by position", [id])).rows).toEqual([
      { email: "binh@x.org", cc_emails: ["mentor@x.org"] },
      { email: "chi@x.org", cc_emails: [] }
    ]);
    expect(await rejected("anon", "select cc_emails from email_batch_recipients")).toBe(true);
    expect(await rejected("authenticated", ccSql, [id, 2, PERSON, "dung@x.org", "Dũng", []])).toBe(true);
  });

  it("lô nhóm cố định khác vẫn không có danh sách chốt", async () => {
    const id = await batchFor("mentee");
    expect(await rejected("postgres", ccSql, [id, 0, PERSON, "binh@x.org", "Bình", []])).toBe(true);
  });

  it("CC phải chuẩn hoá, không trùng người nhận, không null, tối đa 5", async () => {
    const id = await batchFor(RECAP, "2026-11");
    const many = ["a", "b", "c", "d", "e", "f"].map((n) => `${n}@x.org`);
    for (const cc of [["Mentor@X.org"], ["binh@x.org"], [" m@x.org"], [null], many]) {
      expect(await rejected("postgres", ccSql, [id, 0, PERSON, "binh@x.org", "Bình", cc]), JSON.stringify(cc)).toBe(true);
    }
    expect(await rejected("postgres", ccSql, [id, 0, PERSON, "binh@x.org", "Bình", many.slice(0, 5)])).toBe(false);
  });

  it("dòng chốt trước migration còn nguyên, CC rỗng", async () => {
    expect(await one("select email, role, cc_emails from email_batch_recipients where email = 'cu@x.org'")).toEqual({
      email: "cu@x.org",
      role: "mentor",
      cc_emails: []
    });
  });

  it("dán lần hai vẫn chạy, không nối trùng, không đụng dữ liệu", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from email_batch_recipients");
    await db.exec(SQL);
    await db.exec("reset role");
    const def = (await one<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'email_batches_audience_check'")).d;
    expect(def.split(`'${RECAP}'`).length - 1).toBe(1);
    expect(def).toContain("'custom'");
    expect(await one("select count(*)::int as n from email_batch_recipients")).toEqual(before);
  });
});
