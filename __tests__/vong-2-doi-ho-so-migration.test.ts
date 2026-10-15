/**
 * Vòng 2 — "Đổi 15 hồ sơ khác", chạy THẬT trên PostgreSQL (PGlite). BTC 15/10/2026.
 *
 * Migration 20261015150000 thêm hai bảng; điều phải đúng:
 *   - cả hai bật RLS; anon và authenticated không đọc, không ghi được gì;
 *   - máy chủ (service_role) thêm được lượt xem nhưng KHÔNG sửa, không xoá được — "đã xem hết" là
 *     điều kiện để đổi, xoá được thì máy chủ tự quên;
 *   - mỗi link một lượt xem cho mỗi đơn (thêm lại là bỏ qua, không lỗi); mỗi link một dòng điểm neo;
 *   - không đụng tới bảng link (đang bị khoá dòng ở mỗi lượt chọn): không cột mới nào;
 *   - dán lại lần hai vẫn chạy (khối tự kiểm vẫn qua).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8").replace(/\r/g, "");
const THIS = "supabase/migrations/20261015150000_vong_2_doi_ho_so.sql";
const MIGRATIONS = [
  "supabase/migrations/20261007120000_vong_ghep_cap.sql",
  "supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql",
  "supabase/migrations/20261008080000_vong_2_mentor_chon_mentee.sql",
  "supabase/migrations/20261014190000_vong_2_cum_chon.sql",
  "supabase/migrations/20261015003000_vong_2_nhom_nhan_bu.sql"
];

let db: PGlite;
let linkColumnsBefore: string[] = [];
let link = "";
let app = "";
let otherApp = "";
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const columnsOf = async (table: string) =>
  (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name", [table])).rows.map(
    (r) => r.column_name
  );

async function as<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
/** Lệnh bị database từ chối (thiếu quyền, vi phạm ràng buộc)? Chạy trong giao dịch rồi bỏ, không để lại gì. */
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

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  await db.exec("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
  await db.exec(`
    create table vam063_trusted_api_role_result(api_role text);
    insert into vam063_trusted_api_role_result values ('service_role');
    create function vam063_trusted_api_role() returns table(api_role text) language sql stable as
      'select api_role from public.vam063_trusted_api_role_result limit 1';
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'general_announcement'::text])));
    alter table matches add column ended_at timestamptz, add column end_reason text;
    grant all on vam063_trusted_api_role_result, outbound_emails to service_role;
  `);
  for (const file of MIGRATIONS) await db.exec(read(file));
  await db.exec("reset role");
  linkColumnsBefore = await columnsOf("matching_round2_links");
  await db.exec(read(THIS));
  await db.exec("reset role");

  const mentor = uuid(7001);
  const mentee = uuid(7002);
  const mentee2 = uuid(7003);
  await db.query("insert into people(id, full_name) values ($1, 'Mentor'), ($2, 'Mentee'), ($3, 'Mentee hai')", [mentor, mentee, mentee2]);
  app = (await one<{ id: string }>("insert into applications(season_id, person_id, role_applied, status) values ($1, $2, 'mentee', 'approved_as_mentee') returning id", [ids.season, mentee])).id;
  otherApp = (await one<{ id: string }>("insert into applications(season_id, person_id, role_applied, status) values ($1, $2, 'mentee', 'approved_as_mentee') returning id", [ids.season, mentee2])).id;
  link = (await one<{ id: string }>("insert into matching_round2_links(season_id, mentor_person_id) values ($1, $2) returning id", [ids.season, mentor])).id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 20261015150000 — đổi 15 hồ sơ khác", () => {
  it("hai bảng bật RLS; không thêm cột nào vào bảng link", async () => {
    for (const table of ["matching_round2_views", "matching_round2_window_state"]) {
      expect((await one<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${table}`])).rls).toBe(true);
    }
    expect(await columnsOf("matching_round2_links")).toEqual(linkColumnsBefore);
    expect(await columnsOf("matching_round2_views")).toEqual(["application_id", "link_id", "viewed_at"]);
    expect(await columnsOf("matching_round2_window_state")).toEqual(["anchor_application_id", "link_id", "swaps", "updated_at"]);
  });

  it("anon và authenticated: không đọc, không ghi được bảng nào", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select * from matching_round2_views")).toBe(true);
      expect(await rejected(role, "select * from matching_round2_window_state")).toBe(true);
      expect(await rejected(role, "insert into matching_round2_views(link_id, application_id) values ($1, $2)", [link, app])).toBe(true);
      expect(await rejected(role, "insert into matching_round2_window_state(link_id, anchor_application_id) values ($1, $2)", [link, app])).toBe(true);
    }
  });

  it("máy chủ: thêm lượt xem được (thêm lại thì bỏ qua), nhưng không sửa, không xoá được", async () => {
    await as("service_role", () =>
      db.query("insert into matching_round2_views(link_id, application_id) values ($1, $2) on conflict (link_id, application_id) do nothing", [link, app])
    );
    await as("service_role", () =>
      db.query("insert into matching_round2_views(link_id, application_id) values ($1, $2) on conflict (link_id, application_id) do nothing", [link, app])
    );
    expect((await one<{ n: number }>("select count(*)::int as n from matching_round2_views where link_id = $1", [link])).n).toBe(1);
    expect(await rejected("service_role", "insert into matching_round2_views(link_id, application_id) values ($1, $2)", [link, app])).toBe(true);
    expect(await rejected("service_role", "update matching_round2_views set viewed_at = now() where link_id = $1", [link])).toBe(true);
    expect(await rejected("service_role", "delete from matching_round2_views where link_id = $1", [link])).toBe(true);
  });

  it("máy chủ: một dòng điểm neo mỗi link; sửa có điều kiện theo điểm neo cũ; số lần đổi phải từ 1", async () => {
    await as("service_role", () => db.query("insert into matching_round2_window_state(link_id, anchor_application_id) values ($1, $2)", [link, app]));
    expect(await rejected("service_role", "insert into matching_round2_window_state(link_id, anchor_application_id) values ($1, $2)", [link, otherApp])).toBe(true);
    const moved = await as("service_role", () =>
      db.query("update matching_round2_window_state set anchor_application_id = $3, swaps = 2 where link_id = $1 and anchor_application_id = $2 returning link_id", [link, app, otherApp])
    );
    expect(moved.rows).toHaveLength(1);
    const stale = await as("service_role", () =>
      db.query("update matching_round2_window_state set anchor_application_id = $3, swaps = 3 where link_id = $1 and anchor_application_id = $2 returning link_id", [link, app, otherApp])
    );
    expect(stale.rows).toHaveLength(0);
    expect(await one("select anchor_application_id, swaps from matching_round2_window_state where link_id = $1", [link])).toEqual({ anchor_application_id: otherApp, swaps: 2 });
    expect(await rejected("service_role", "update matching_round2_window_state set swaps = 0 where link_id = $1", [link])).toBe(true);
    expect(await rejected("service_role", "delete from matching_round2_window_state where link_id = $1", [link])).toBe(true);
  });

  it("dán lại lần hai vẫn chạy, không mất dữ liệu", async () => {
    await db.exec(read(THIS));
    await db.exec("reset role");
    expect((await one<{ n: number }>("select count(*)::int as n from matching_round2_views")).n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from matching_round2_window_state")).n).toBe(1);
  }, 120_000);

  it("xoá link thì lượt xem và điểm neo của link đó đi theo", async () => {
    await db.query("delete from matching_round2_links where id = $1", [link]);
    expect((await one<{ n: number }>("select count(*)::int as n from matching_round2_views where link_id = $1", [link])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from matching_round2_window_state where link_id = $1", [link])).n).toBe(0);
  });
});
