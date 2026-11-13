/**
 * Migration 20261109210000 (VAM00027) chạy THẬT trên PostgreSQL (PGlite), sau đúng chuỗi migration đã
 * dựng email_batches và email_batch_recipients (20261106120000). Điều phải đúng:
 *   - 'external' được NỐI THÊM vào nguồn và vai trò; mọi giá trị cũ vẫn ghi được, giá trị lạ vẫn bị chặn;
 *   - dòng ngoài: relation_id phải NULL, tên được rỗng, tên không có ký tự điều khiển, ≤ 120 ký tự;
 *   - dòng VAM: relation_id vẫn bắt buộc, tên vẫn không được rỗng;
 *   - dòng đã chốt trước migration vẫn nguyên; quyền, RLS, trigger không đổi; dán lại vô hại;
 *   - migration tự kiểm bắt được khi bị viết đè danh sách (mất giá trị cũ).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const read = (file: string) => readFileSync(path.resolve("supabase/migrations", file), "utf8").replace(/\r/g, "");
const BASE = read("20261106120000_email_batch_recipients.sql");
const SQL = read("20261109210000_email_batch_recipients_external.sql");

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

async function setup(migration: string) {
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
  await db.exec(`insert into seasons values ('${SEASON}', 'UEHM-S12');`);
  await db.exec(BASE);
  await db.exec("reset role");
  // Một dòng đã chốt TRƯỚC migration — phải còn nguyên sau đó.
  const before = await customBatch();
  await db.query(insertSql, [before, 0, "people", PERSON, "cu@x.org", "Người Cũ", "mentor"]);
  await db.exec(migration);
  await db.exec("reset role");
}

beforeAll(async () => {
  await setup(SQL);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("dòng ngoài VAM", () => {
  it("ghi được: relation_id NULL, role external, tên có hoặc rỗng", async () => {
    const id = await customBatch();
    await db.exec("set role service_role");
    await db.query(insertSql, [id, 0, "external", null, "khach@y.vn", "Khách Mời", "external"]);
    await db.query(insertSql, [id, 1, "external", null, "khong-ten@y.vn", "", "external"]);
    await db.exec("reset role");
    expect((await db.query("select relation_id, full_name from email_batch_recipients where batch_id = $1 order by position", [id])).rows).toEqual([
      { relation_id: null, full_name: "Khách Mời" },
      { relation_id: null, full_name: "" }
    ]);
  });

  it("dòng ngoài KHÔNG được trỏ vào một hồ sơ (relation_id phải NULL)", async () => {
    const id = await customBatch();
    expect(await rejected("postgres", insertSql, [id, 0, "external", PERSON, "khach@y.vn", "Khách", "external"])).toBe(true);
  });

  it("tên dòng ngoài: không ký tự điều khiển, không quá 120 ký tự", async () => {
    const id = await customBatch();
    expect(await rejected("postgres", insertSql, [id, 0, "external", null, "a@y.vn", "An\r\nBcc: x", "external"])).toBe(true);
    expect(await rejected("postgres", insertSql, [id, 0, "external", null, "a@y.vn", "x".repeat(121), "external"])).toBe(true);
    expect(await rejected("postgres", insertSql, [id, 0, "external", null, "a@y.vn", "x".repeat(120), "external"])).toBe(false);
  });

  it("email vẫn phải chuẩn hoá và không trùng trong lô — kể cả giữa dòng VAM và dòng ngoài", async () => {
    const id = await customBatch();
    await db.query(insertSql, [id, 0, "people", PERSON, "trung@x.org", "Người VAM", "mentor"]);
    expect(await rejected("postgres", insertSql, [id, 1, "external", null, "trung@x.org", "Khách", "external"])).toBe(true);
    expect(await rejected("postgres", insertSql, [id, 1, "external", null, "Hoa@Y.vn", "Hoa", "external"])).toBe(true);
  });
});

describe("dòng VAM và các giá trị cũ không đổi", () => {
  it("dòng chốt trước migration còn nguyên", async () => {
    expect(await one("select relation_table, relation_id, email, full_name, role from email_batch_recipients where email = 'cu@x.org'")).toEqual({
      relation_table: "people",
      relation_id: PERSON,
      email: "cu@x.org",
      full_name: "Người Cũ",
      role: "mentor"
    });
  });

  it("mọi nguồn và vai trò cũ vẫn ghi được; dòng VAM vẫn bắt buộc relation_id và họ tên", async () => {
    const id = await customBatch();
    const pairs: Array<[string, string]> = [
      ["people", "mentor"],
      ["admin_users", "staff"],
      ["event_registrations", "attendee"],
      ["applications", "mentee"]
    ];
    for (let index = 0; index < pairs.length; index++) {
      const [table, role] = pairs[index];
      await db.query(insertSql, [id, index, table, PERSON, `v${index}@x.org`, "Tên", role]);
    }
    expect(await rejected("postgres", insertSql, [id, 9, "people", null, "z@x.org", "Tên", "mentor"])).toBe(true);
    expect(await rejected("postgres", insertSql, [id, 9, "people", PERSON, "z@x.org", " ", "mentor"])).toBe(true);
  });

  it("nguồn và vai trò lạ vẫn bị chặn", async () => {
    const id = await customBatch();
    expect(await rejected("postgres", insertSql, [id, 0, "matches", PERSON, "a@x.org", "A", "mentor"])).toBe(true);
    expect(await rejected("postgres", insertSql, [id, 0, "external", null, "a@x.org", "A", "reviewer"])).toBe(true);
  });

  it("quyền không đổi: anon/authenticated không chạm được; service_role không sửa, không xoá; chỉ lô custom", async () => {
    const id = await customBatch();
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, insertSql, [id, 0, "external", null, "a@y.vn", "A", "external"])).toBe(true);
      expect(await rejected(role, "select * from email_batch_recipients")).toBe(true);
    }
    expect(await rejected("service_role", "update email_batch_recipients set full_name = 'X'")).toBe(true);
    expect(await rejected("service_role", "delete from email_batch_recipients")).toBe(true);
    const mentor = (
      await one<{ id: string }>("insert into email_batches(season_id, kind, audience) values ($1, 'general_announcement', 'mentor') returning id", [SEASON])
    ).id;
    expect(await rejected("postgres", insertSql, [mentor, 0, "external", null, "a@y.vn", "A", "external"])).toBe(true);
  });
});

describe("chạy lại và tự kiểm", () => {
  it("dán lần hai vô hại: external đúng một lần, dữ liệu không đổi", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from email_batch_recipients");
    await db.exec(SQL);
    await db.exec("reset role");
    for (const name of ["email_batch_recipients_relation_table_check", "email_batch_recipients_role_check", "email_batch_recipients_full_name_check"]) {
      const def = (await one<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1", [name])).d;
      expect(def.split("'external'").length - 1, name).toBe(1);
    }
    expect(await one("select count(*)::int as n from email_batch_recipients")).toEqual(before);
  });

  it("bản viết đè danh sách (mất 'applications') bị khối tự kiểm chặn", async () => {
    const overwrite = SQL.replace(
      "do $vam00027_relation$",
      `do $x$ begin
         alter table public.email_batch_recipients drop constraint email_batch_recipients_relation_table_check;
         alter table public.email_batch_recipients add constraint email_batch_recipients_relation_table_check
           check (relation_table in ('people', 'admin_users', 'event_registrations', 'external'));
       end $x$;
       do $vam00027_relation$`
    );
    const scratch = db;
    await setup(overwrite).then(
      () => {
        throw new Error("migration viết đè lẽ ra phải bị chặn");
      },
      (error: Error) => expect(error.message).toMatch(/relation_table_check thiếu applications/)
    );
    await db.close();
    db = scratch;
  }, 120_000);

  it("thiếu migration 20261106120000 thì dừng ngay", () => {
    expect(SQL).toContain("PREREQ_MISSING: cần public.email_batch_recipients");
    expect(SQL.indexOf("PREREQ_MISSING")).toBeLessThan(SQL.indexOf("alter table public.email_batch_recipients"));
  });

  it("không có lệnh nguy hiểm", () => {
    const lowered = SQL.toLowerCase();
    expect(lowered).not.toMatch(/drop table|truncate|delete from|disable row level security|grant [a-z, ]+ to anon|grant [a-z, ]+ to authenticated/);
    expect(lowered).not.toMatch(/update public\./);
  });
});
