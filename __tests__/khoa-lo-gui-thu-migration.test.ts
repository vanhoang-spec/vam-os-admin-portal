/**
 * Migration 20261120190000 (khoá lô gửi thư) chạy THẬT trên PostgreSQL (PGlite), sau đủ chuỗi migration
 * của email_batches. Điều phải đúng:
 *   - xin khoá chỉ thành công khi lô đang running và không có khoá còn hạn; lần xin thứ hai bị từ chối;
 *   - khoá hết hạn thì lần chạy khác xin được; chỉ đúng token mới nhả được;
 *   - lô đã xong không xin được; tham số lạ bị từ chối;
 *   - chỉ service_role gọi được hai hàm; hàm không SECURITY DEFINER; dán lại vô hại.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { BULK_AUDIENCES } from "@/lib/bulk-mail-core";

const read = (file: string) => readFileSync(path.resolve("supabase/migrations", file), "utf8").replace(/\r/g, "");
const BASE = read("20261106120000_email_batch_recipients.sql");
const EXTERNAL = read("20261109210000_email_batch_recipients_external.sql");
const RECAP = read("20261120150000_nhom_mentee_chua_recap.sql");
const SQL = read("20261120190000_khoa_lo_gui_thu.sql");

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
const TOKEN_A = "00000000-0000-4000-8000-0000000000a1";
const TOKEN_B = "00000000-0000-4000-8000-0000000000b2";

const claim = async (id: string, token: string, seconds = 75) =>
  (await one<{ ok: boolean }>("select public.email_batch_claim_run($1, $2, $3) as ok", [id, token, seconds])).ok;
const release = async (id: string, token: string) =>
  (await one<{ ok: boolean }>("select public.email_batch_release_run($1, $2) as ok", [id, token])).ok;

beforeAll(async () => {
  await setup();
  await db.exec(RECAP);
  await db.exec("reset role");
  await db.exec(SQL);
  await db.exec("reset role");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("xin / nhả khoá lô", () => {
  it("lần xin đầu được, lần xin thứ hai (lần chạy khác) bị từ chối khi khoá còn hạn", async () => {
    const id = await customBatch();
    expect(await claim(id, TOKEN_A)).toBe(true);
    expect(await claim(id, TOKEN_B)).toBe(false);
    // Chính token đang giữ cũng không xin chồng được: mỗi lần chạy một token mới.
    expect(await claim(id, TOKEN_A)).toBe(false);
  });

  it("chỉ đúng token mới nhả được; nhả xong thì lần chạy sau xin được", async () => {
    const id = await customBatch();
    expect(await claim(id, TOKEN_A)).toBe(true);
    expect(await release(id, TOKEN_B)).toBe(false);
    expect(await claim(id, TOKEN_B)).toBe(false);
    expect(await release(id, TOKEN_A)).toBe(true);
    expect(await one("select run_lease_until, run_lease_token from email_batches where id = $1", [id])).toEqual({
      run_lease_until: null,
      run_lease_token: null
    });
    expect(await claim(id, TOKEN_B)).toBe(true);
  });

  it("khoá hết hạn (lần chạy bị cắt, không kịp nhả): lần chạy khác xin được; lần cũ không nhả được khoá mới", async () => {
    const id = await customBatch();
    expect(await claim(id, TOKEN_A)).toBe(true);
    await db.query("update email_batches set run_lease_until = now() - interval '1 second' where id = $1", [id]);
    expect(await claim(id, TOKEN_B)).toBe(true);
    expect(await release(id, TOKEN_A)).toBe(false);
    expect(await claim(id, TOKEN_A)).toBe(false);
  });

  it("khoá có hạn đúng số giây xin, tính theo giờ database", async () => {
    const id = await customBatch();
    await claim(id, TOKEN_A, 75);
    const row = await one<{ s: number }>("select extract(epoch from run_lease_until - now())::int as s from email_batches where id = $1", [id]);
    expect(row.s).toBeGreaterThanOrEqual(74);
    expect(row.s).toBeLessThanOrEqual(75);
  });

  it("lô đã kết thúc hoặc không tồn tại: không xin được", async () => {
    const id = await customBatch();
    await db.query("update email_batches set status = 'completed', completed_at = now() where id = $1", [id]);
    expect(await claim(id, TOKEN_A)).toBe(false);
    expect(await claim("00000000-0000-4000-8000-00000000ffff", TOKEN_A)).toBe(false);
  });

  it("tham số lạ bị từ chối (token rỗng, hạn 0 hoặc quá 10 phút)", async () => {
    const id = await customBatch();
    for (const [token, seconds] of [[null, 75], [TOKEN_A, 0], [TOKEN_A, 601]] as const) {
      expect(await rejected("postgres", "select public.email_batch_claim_run($1, $2, $3)", [id, token, seconds]), `${token} ${seconds}`).toBe(true);
    }
  });
});

describe("quyền và chạy lại", () => {
  it("chỉ service_role gọi được; anon / authenticated thì không", async () => {
    const id = await customBatch();
    expect(await rejected("anon", "select public.email_batch_claim_run($1, $2, 75)", [id, TOKEN_A])).toBe(true);
    expect(await rejected("authenticated", "select public.email_batch_release_run($1, $2)", [id, TOKEN_A])).toBe(true);
    await db.exec("grant select, update on public.email_batches to service_role");
    expect(await rejected("service_role", "select public.email_batch_claim_run($1, $2, 75)", [id, TOKEN_A])).toBe(false);
  });

  it("hai hàm không SECURITY DEFINER và giữ search_path", async () => {
    const rows = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      "select proname, prosecdef, proconfig from pg_proc where proname in ('email_batch_claim_run', 'email_batch_release_run') order by proname"
    )).rows;
    expect(rows.map((row) => [row.proname, row.prosecdef])).toEqual([
      ["email_batch_claim_run", false],
      ["email_batch_release_run", false]
    ]);
    for (const row of rows) expect(String(row.proconfig)).toContain("search_path=public, pg_temp");
  });

  it("dán lần hai vô hại, khoá đang giữ không bị xoá", async () => {
    const id = await customBatch();
    await claim(id, TOKEN_A);
    await db.exec(SQL);
    await db.exec("reset role");
    expect(await claim(id, TOKEN_B)).toBe(false);
  });
});
