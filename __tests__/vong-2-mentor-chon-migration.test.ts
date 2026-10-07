/**
 * Vòng 2 — mentor chọn / bỏ chọn mentee qua link riêng, chạy THẬT trên PostgreSQL (PGlite).
 *
 * Đây là đường ghi do người NGOÀI hệ thống (mentor không có tài khoản) bấm, nên mọi luật
 * phải nằm trong hàm: cửa sổ mở/đóng, cùng nhóm, mentee còn trống, trần min(2, đăng ký),
 * người bấm trước được, bỏ chọn chỉ trong 30 phút và chỉ cặp của chính mình.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const MIGRATIONS = [
  "supabase/migrations/20261007120000_vong_ghep_cap.sql",
  "supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql",
  "supabase/migrations/20261008080000_vong_2_mentor_chon_mentee.sql"
];
const THIS = MIGRATIONS[2];

const MENTOR_B = uuid(501);
const mentee = (n: number) => ({ person: uuid(600 + n), app: uuid(700 + n) });
const M1 = mentee(1);
const M2 = mentee(2);
const M3 = mentee(3); // nhóm khác
const M4 = mentee(4);
const M5 = mentee(5);
const M6 = mentee(6); // đã có cặp vòng 1
let tokenA = "";
let tokenB = "";

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const pick = async (token: string, app: string) =>
  (await one<{ r: { ok: boolean; code?: string; matchId?: string; remaining?: number } }>("select vam113_round2_pick($1,$2) as r", [token, app])).r;
const unpick = async (token: string, match: string) =>
  (await one<{ r: { ok: boolean; code?: string } }>("select vam113_round2_unpick($1,$2) as r", [token, match])).r;
const openWindow = async (opens = "now() - interval '1 hour'", closes = "now() + interval '3 days'") => {
  await db.exec("reset role");
  await db.exec(`insert into matching_round2_settings(season_id, opens_at, closes_at) values ('${ids.season}', ${opens}, ${closes})
                 on conflict (season_id) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at`);
  await db.exec("set role service_role");
};

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Thứ production có mà bộ dựng chung không có: hàm vai trò API tin cậy (bản thay thế
  // giống scripts/pg-harness/overrides.sql), bảng thư, và hai cột kết thúc cặp.
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

  await db.exec(`update mentor_profiles set capacity_target = 3 where person_id = '${ids.person}'`);
  await db.query("insert into people(id, full_name) values ($1, 'Mentor B')", [MENTOR_B]);
  await db.query("insert into mentor_profiles(person_id, capacity_target) values ($1, 1)", [MENTOR_B]);
  await db.query("insert into applications(season_id, person_id, role_applied, status) values ($1, $2, 'mentor', 'approved_as_mentor')", [ids.season, MENTOR_B]);
  for (const [m, group] of [[M1, 4], [M2, 4], [M3, 6], [M4, 4], [M5, 4], [M6, 4]] as const) {
    await db.query("insert into people(id, full_name) values ($1, 'Mentee')", [m.person]);
    await db.query("insert into applications(id, season_id, person_id, role_applied, status) values ($1, $2, $3, 'mentee', 'approved_as_mentee')", [m.app, ids.season, m.person]);
    await db.query(
      "insert into matching_industry_assignments(season_id, person_id, role, application_id, group_code, confidence, rule_version) values ($1, $2, 'mentee', $3, $4, 'cao', 't')",
      [ids.season, m.person, m.app, group]
    );
  }
  for (const person of [ids.person, MENTOR_B]) {
    const app = await one<{ id: string }>("select id from applications where person_id = $1 and role_applied = 'mentor'", [person]);
    await db.query(
      "insert into matching_industry_assignments(season_id, person_id, role, application_id, group_code, confidence, rule_version) values ($1, $2, 'mentor', $3, 4, 'cao', 't')",
      [ids.season, person, app.id]
    );
  }
  await db.query("insert into matches(season_id, mentor_person_id, mentee_person_id, status, matching_round) values ($1, $2, $3, 'active', 1)", [ids.season, MENTOR_B, M6.person]);
  await db.exec(`update mentor_profiles set capacity_target = 2 where person_id = '${MENTOR_B}'`);
  tokenA = (await one<{ token: string }>("insert into matching_round2_links(season_id, mentor_person_id) values ($1, $2) returning token", [ids.season, ids.person])).token;
  tokenB = (await one<{ token: string }>("insert into matching_round2_links(season_id, mentor_person_id) values ($1, $2) returning token", [ids.season, MENTOR_B])).token;
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("cửa sổ mở/đóng", () => {
  it("chưa đặt giờ = chưa mở; quá hạn = đã đóng; mọi lượt đều được ghi log", () =>
    isolated(async () => {
      expect(await pick(tokenA, M1.app)).toEqual({ ok: false, code: "window_not_open" });
      await openWindow("now() + interval '1 hour'", "null");
      expect(await pick(tokenA, M1.app)).toEqual({ ok: false, code: "window_not_open" });
      await openWindow("now() - interval '2 days'", "now() - interval '1 hour'");
      expect(await pick(tokenA, M1.app)).toEqual({ ok: false, code: "window_closed" });
      const log = await db.query<{ outcome: string }>("select outcome from matching_round2_picks order by id");
      expect(log.rows.map((r) => r.outcome)).toEqual(["window_not_open", "window_not_open", "window_closed"]);
    }));

  it("BTC đặt giờ qua vam113_set_round2_window; người khác không đặt được; đóng phải sau mở", () =>
    isolated(async () => {
      await db.query("select vam113_set_round2_window($1, $2, now() - interval '1 hour', null, 1::smallint)", [ids.btc, ids.season]);
      expect(await pick(tokenA, M1.app)).toMatchObject({ ok: true });
      await db.exec("savepoint s");
      await expect(db.query("select vam113_set_round2_window($1, $2, now(), null, 1::smallint)", [ids.support, ids.season])).rejects.toThrow("ACCESS_DENIED");
      await db.exec("rollback to savepoint s");
      await expect(db.query("select vam113_set_round2_window($1, $2, now(), now() - interval '1 minute', 1::smallint)", [ids.btc, ids.season])).rejects.toThrow("WINDOW_ORDER");
    }));
});

describe("vam113_round2_pick", () => {
  it("chọn được mentee cùng nhóm → cặp vòng 2 đang hoạt động", () =>
    isolated(async () => {
      await openWindow();
      const r = await pick(tokenA, M1.app);
      expect(r).toMatchObject({ ok: true, remaining: 1 });
      expect(await one("select status, matching_round, mentee_person_id from matches where id = $1", [r.matchId])).toEqual({
        status: "active",
        matching_round: 2,
        mentee_person_id: M1.person
      });
    }));

  it("khác nhóm, mentee đã có cặp (kể cả vòng 1), mã đơn lạ → từ chối", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(tokenA, M3.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(tokenA, M6.app)).toEqual({ ok: false, code: "mentee_taken" });
      expect(await pick(tokenA, uuid(9999))).toEqual({ ok: false, code: "mentee_not_found" });
      expect(await pick(uuid(8888), M1.app)).toEqual({ ok: false, code: "invalid_token" });
      expect((await one<{ n: number }>("select count(*)::int as n from matches where matching_round = 2")).n).toBe(0);
    }));

  it("hai mentor cùng chọn một mentee: người trước được, người sau nhận mentee_taken, cả hai có log", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(tokenA, M1.app)).toMatchObject({ ok: true });
      expect(await pick(tokenB, M1.app)).toEqual({ ok: false, code: "mentee_taken" });
      const log = await db.query<{ outcome: string }>("select outcome from matching_round2_picks where mentee_person_id = $1 order by id", [M1.person]);
      expect(log.rows.map((r) => r.outcome)).toEqual(["ok", "mentee_taken"]);
    }));

  it("trần min(2, đăng ký), tính cả cặp vòng 1", () =>
    isolated(async () => {
      await openWindow();
      // A đăng ký 3 → tối đa 2 ở vòng 2.
      expect(await pick(tokenA, M1.app)).toMatchObject({ ok: true, remaining: 1 });
      expect(await pick(tokenA, M2.app)).toMatchObject({ ok: true, remaining: 0 });
      expect(await pick(tokenA, M4.app)).toEqual({ ok: false, code: "mentor_full" });
      // B đăng ký 2, đã có 1 cặp vòng 1 → còn đúng 1.
      expect(await pick(tokenB, M4.app)).toMatchObject({ ok: true, remaining: 0 });
      expect(await pick(tokenB, M5.app)).toEqual({ ok: false, code: "mentor_full" });
    }));

  it("link bị thu hồi, mentor có hai hồ sơ, mentor đã rút → từ chối", () =>
    isolated(async () => {
      await openWindow();
      await db.exec("reset role");
      await db.query("update matching_round2_links set revoked_at = now() where token = $1", [tokenB]);
      await db.query("insert into mentor_profiles(person_id, capacity_target) values ($1, 2)", [ids.person]);
      await db.exec("set role service_role");
      expect(await pick(tokenB, M1.app)).toEqual({ ok: false, code: "link_revoked" });
      expect(await pick(tokenA, M1.app)).toEqual({ ok: false, code: "mentor_identity_ambiguous" });
      await db.exec("reset role");
      await db.query("delete from mentor_profiles where person_id = $1 and capacity_target = 2", [ids.person]);
      await db.query(
        "insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, 'mentor', 'withdrawn')",
        [ids.person, ids.program, ids.season]
      );
      await db.exec("set role service_role");
      expect(await pick(tokenA, M1.app)).toEqual({ ok: false, code: "mentor_not_eligible" });
    }));

  it("chỉ máy chủ tin cậy gọi được; anon/authenticated không có quyền gọi", () =>
    isolated(async () => {
      await db.exec("reset role");
      await db.exec("update vam063_trusted_api_role_result set api_role = 'anon'");
      await db.exec("set role service_role");
      await db.exec("savepoint s");
      await expect(pick(tokenA, M1.app)).rejects.toThrow("Trusted server context required");
      await db.exec("rollback to savepoint s");
      await db.exec("reset role");
      const can = async (role: string, fn: string) =>
        (await one<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok;
      expect(await can("anon", "public.vam113_round2_pick(uuid, uuid)")).toBe(false);
      expect(await can("authenticated", "public.vam113_round2_unpick(uuid, uuid)")).toBe(false);
      expect(await can("service_role", "public.vam113_round2_pick(uuid, uuid)")).toBe(true);
    }));
});

describe("vam113_round2_unpick", () => {
  it("bỏ chọn trong 30 phút: cặp dừng, mentee trống lại và mentor khác chọn được", () =>
    isolated(async () => {
      await openWindow();
      const r = await pick(tokenA, M1.app);
      expect(await unpick(tokenA, r.matchId!)).toEqual({ ok: true });
      expect(await one("select status, end_reason from matches where id = $1", [r.matchId])).toEqual({
        status: "dropped",
        end_reason: "Mentor bỏ chọn trong 30 phút (Vòng 2)"
      });
      expect(await pick(tokenB, M1.app)).toMatchObject({ ok: true });
    }));

  it("quá 30 phút → undo_expired; cặp của link khác hay cặp vòng 1 → match_not_found", () =>
    isolated(async () => {
      await openWindow();
      const r = await pick(tokenA, M1.app);
      expect(await unpick(tokenB, r.matchId!)).toEqual({ ok: false, code: "match_not_found" });
      const r1 = await one<{ id: string }>("select id from matches where mentee_person_id = $1", [M6.person]);
      expect(await unpick(tokenB, r1.id)).toEqual({ ok: false, code: "match_not_found" });
      await db.exec("reset role");
      await db.query("update matching_round2_picks set created_at = now() - interval '31 minutes' where match_id = $1", [r.matchId]);
      await db.exec("set role service_role");
      expect(await unpick(tokenA, r.matchId!)).toEqual({ ok: false, code: "undo_expired" });
      expect((await one<{ status: string }>("select status from matches where id = $1", [r.matchId])).status).toBe("active");
    }));

  it("cặp vòng 2 do BTC ghép tay (không qua link) thì mentor không tự bỏ được", () =>
    isolated(async () => {
      await openWindow();
      await db.exec("reset role");
      const m = await one<{ id: string }>(
        "insert into matches(season_id, mentor_person_id, mentee_person_id, status, matching_round) values ($1, $2, $3, 'active', 2) returning id",
        [ids.season, ids.person, M2.person]
      );
      await db.exec("set role service_role");
      expect(await unpick(tokenA, m.id)).toEqual({ ok: false, code: "match_not_found" });
    }));

  it("29 phút vẫn bỏ được", () =>
    isolated(async () => {
      await openWindow();
      const r = await pick(tokenA, M1.app);
      await db.exec("reset role");
      await db.query("update matching_round2_picks set created_at = now() - interval '29 minutes' where match_id = $1", [r.matchId]);
      await db.exec("set role service_role");
      expect(await unpick(tokenA, r.matchId!)).toEqual({ ok: true });
    }));
});

describe("bảng, quyền, loại thư", () => {
  it("máy chủ không tự ghi log chọn; anon không đọc được link (token)", () =>
    isolated(async () => {
      await db.exec("reset role");
      const priv = async (role: string, table: string, p: string) =>
        (await one<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${table}', '${p}') as ok`)).ok;
      expect(await priv("service_role", "matching_round2_picks", "insert")).toBe(false);
      expect(await priv("anon", "matching_round2_links", "select")).toBe(false);
      expect(await priv("authenticated", "matching_round2_settings", "select")).toBe(false);
    }));

  it("loại thư mới được nhận, loại cũ vẫn nhận, loại lạ bị chặn; chạy lại migration không đổi gì", () =>
    isolated(async () => {
      await db.exec("reset role");
      await db.exec("insert into outbound_emails(kind) values ('matching_round2_invite'), ('mentee_session_invite'), ('general_announcement')");
      await db.exec("savepoint s");
      await expect(db.exec("insert into outbound_emails(kind) values ('bogus')")).rejects.toThrow("outbound_emails_kind_check");
      await db.exec("rollback to savepoint s");
      const before = await one<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'outbound_emails_kind_check'");
      await db.exec(read(THIS));
      const after = await one<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'outbound_emails_kind_check'");
      expect(after.def).toBe(before.def);
    }));
});
