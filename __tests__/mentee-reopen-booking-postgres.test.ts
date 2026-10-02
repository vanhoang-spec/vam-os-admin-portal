/**
 * Mở lại chọn ca theo hạn riêng (migration 20261002230000) — chạy thật trên PGlite.
 *
 * BTC 02/10/2026: 72 mentee chưa chọn ca trước 17:00 02/10 được mở lại tới 20:00
 * 03/10. Hai điều không được sai:
 *   - CHỈ đúng những người đó đặt được — 404 bạn đã chọn ca không được tự đổi
 *     qua đêm trước ngày phỏng vấn (nên không nới booking_closes_at của ca);
 *   - hạn riêng chỉ NỚI, không bao giờ siết hạn chung.
 */
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { ids, offlineDb } from "./support/offline-postgres";

const MIGRATION = readFileSync("supabase/migrations/20261002230000_mentee_mo_lai_chon_ca.sql", "utf8");
const REAL_SEASON = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const NEW_DEADLINE = "2026-10-03T13:00:00.000Z"; // 20:00 03/10 giờ Việt Nam

let n = 500;
const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function baseDb() {
  const db = await offlineDb();
  await db.exec("reset role;");
  // vam101/vam102 hỏi vam063 xem có đang ở ngữ cảnh máy chủ không; bản thật đọc JWT.
  await db.exec("create or replace function public.vam063_trusted_api_role() returns table(api_role text) language sql as $$ select 'service_role'::text $$;");
  return db;
}

async function session(db: PGlite, season: string, opts: { daysAhead: number; closesIn: string; seats?: number }) {
  const { rows } = await db.query<{ id: string }>(
    `insert into interview_sessions(season_id, starts_at, ends_at, seat_limit, venue, booking_closes_at, status)
     values ($1, now() + ($2 || ' days')::interval, now() + ($2 || ' days')::interval + interval '30 minutes', $3, 'Phòng thử',
             now() + $4::interval, 'open') returning id`,
    [season, String(opts.daysAhead), opts.seats ?? 2, opts.closesIn]
  );
  return rows[0].id;
}

async function applicant(db: PGlite, season: string, opts: { status?: string; sent?: boolean; openUntil?: string | null } = {}) {
  const app = nextId();
  const token = nextId();
  await db.query(
    `insert into applications(id, season_id, role_applied, status, source, full_name, email_primary)
     values ($1, $2, 'mentee', $3, 'vam_os_form', 'Mentee thử', $4)`,
    [app, season, opts.status ?? "invited_to_interview", `${app}@example.test`]
  );
  await db.query(
    "insert into mentee_interview_invites(application_id, token, first_sent_at) values ($1, $2, $3)",
    [app, token, opts.sent === false ? null : new Date().toISOString()]
  );
  if (opts.openUntil !== undefined) {
    await db.query("update mentee_interview_invites set booking_open_until = $2 where application_id = $1", [app, opts.openUntil]);
  }
  return { app, token };
}

const book = async (db: PGlite, token: string, sessionId: string) =>
  (await db.query<{ r: any }>("select vam101_book_mentee_session($1, $2) as r", [token, sessionId])).rows[0].r;
const change = async (db: PGlite, token: string, sessionId: string) =>
  (await db.query<{ r: any }>("select vam102_change_mentee_session($1, $2) as r", [token, sessionId])).rows[0].r;
const activeBookings = async (db: PGlite, app: string) =>
  (await db.query<{ session_id: string }>("select session_id from mentee_interview_bookings where application_id = $1 and status = 'booked'", [app])).rows;
const openUntil = async (db: PGlite, app: string) =>
  (await db.query<{ t: string | null }>("select booking_open_until::text as t from mentee_interview_invites where application_id = $1", [app])).rows[0].t;

describe("phần chọn người của migration", () => {
  let db: PGlite;
  const who: Record<string, string> = {};

  beforeAll(async () => {
    db = await baseDb();
    await db.query("insert into seasons values ($1, $2, 'UEHM-S12-THAT')", [REAL_SEASON, ids.program]);
    const realSession = await session(db, REAL_SEASON, { daysAhead: 20, closesIn: "-1 hour", seats: 5 });
    who.chuaChon = (await applicant(db, REAL_SEASON)).app;
    who.daChon = (await applicant(db, REAL_SEASON)).app;
    await db.query("insert into mentee_interview_bookings(application_id, session_id, season_id) values ($1, $2, $3)", [who.daChon, realSession, REAL_SEASON]);
    who.chuaNhanThu = (await applicant(db, REAL_SEASON, { sent: false })).app;
    who.rutHoSo = (await applicant(db, REAL_SEASON, { status: "withdrawn" })).app;
    who.muaKhac = (await applicant(db, ids.season)).app;
    await db.exec(MIGRATION);
  }, 60000);

  it("mở lại đúng người đã nhận thư mời, đủ điều kiện, CHƯA có ca, đúng Mùa 12 — hạn 20:00 03/10", async () => {
    expect(new Date(String(await openUntil(db, who.chuaChon))).toISOString()).toBe(NEW_DEADLINE);
    for (const key of ["daChon", "chuaNhanThu", "rutHoSo", "muaKhac"]) {
      expect(await openUntil(db, who[key]), key).toBeNull();
    }
  });

  it("thêm đủ hai cột, hai hàm vẫn security definer và anon/authenticated không gọi được", async () => {
    const { rows } = await db.query<{ proname: string; prosecdef: boolean; anon: boolean; auth: boolean }>(
      `select proname, prosecdef,
              has_function_privilege('anon', oid, 'execute') anon,
              has_function_privilege('authenticated', oid, 'execute') auth
         from pg_proc where proname in ('vam101_book_mentee_session', 'vam102_change_mentee_session') order by proname`
    );
    expect(rows).toEqual([
      { proname: "vam101_book_mentee_session", prosecdef: true, anon: false, auth: false },
      { proname: "vam102_change_mentee_session", prosecdef: true, anon: false, auth: false }
    ]);
  });

  it("khối tự kiểm dừng cả migration nếu Mùa 12 có mà không mở lại được cho ai", async () => {
    const empty = await baseDb();
    await empty.query("insert into seasons values ($1, $2, 'UEHM-S12-THAT')", [REAL_SEASON, ids.program]);
    await expect(empty.exec(MIGRATION)).rejects.toThrow(/không mở lại cho ai/);
    // SQL Editor tự cuộn lại khi lỗi; PGlite giữ giao dịch đang hỏng tới khi được bảo.
    await empty.exec("rollback;");
    const { rows } = await empty.query<{ n: number }>(
      "select count(*)::int n from information_schema.columns where table_name = 'mentee_interview_invites' and column_name = 'booking_open_until'"
    );
    expect(rows[0].n).toBe(0);
  }, 60000);
});

describe("đặt ca / tự đổi ca theo hạn riêng", () => {
  let db: PGlite;
  let closed: string;
  let closed2: string;
  let stillOpen: string;
  const future = () => new Date(Date.now() + 24 * 3600_000).toISOString();
  const past = () => new Date(Date.now() - 60_000).toISOString();

  beforeAll(async () => {
    db = await baseDb();
    await db.exec(MIGRATION);
    closed = await session(db, ids.season, { daysAhead: 30, closesIn: "-1 hour" });
    closed2 = await session(db, ids.season, { daysAhead: 31, closesIn: "-1 hour", seats: 5 });
    stillOpen = await session(db, ids.season, { daysAhead: 32, closesIn: "1 day" });
  }, 60000);

  it("không có hạn riêng: hạn chung đã qua thì KHÔNG đặt được, không ghi gì", async () => {
    const p = await applicant(db, ids.season);
    expect(await book(db, p.token, closed)).toMatchObject({ ok: false, code: "deadline_passed" });
    expect(await activeBookings(db, p.app)).toEqual([]);
  });

  it("có hạn riêng còn hiệu lực: đặt được dù hạn chung đã qua, hồ sơ sang interview_scheduled", async () => {
    const p = await applicant(db, ids.season, { openUntil: future() });
    expect(await book(db, p.token, closed)).toMatchObject({ ok: true, session_id: closed });
    expect(await activeBookings(db, p.app)).toEqual([{ session_id: closed }]);
    const { rows } = await db.query<{ status: string }>("select status from applications where id = $1", [p.app]);
    expect(rows[0].status).toBe("interview_scheduled");
  });

  it("hạn riêng đã qua: không đặt được", async () => {
    const p = await applicant(db, ids.season, { openUntil: past() });
    expect(await book(db, p.token, closed)).toMatchObject({ ok: false, code: "deadline_passed" });
  });

  it("hạn riêng chỉ NỚI, không siết: hạn riêng đã qua nhưng hạn chung còn thì vẫn đặt được", async () => {
    const p = await applicant(db, ids.season, { openUntil: past() });
    expect(await book(db, p.token, stillOpen)).toMatchObject({ ok: true });
  });

  it("hạn riêng không vượt qua các chặn khác: ca kín vẫn là kín", async () => {
    const full = await session(db, ids.season, { daysAhead: 33, closesIn: "-1 hour", seats: 1 });
    const first = await applicant(db, ids.season, { openUntil: future() });
    const second = await applicant(db, ids.season, { openUntil: future() });
    expect(await book(db, first.token, full)).toMatchObject({ ok: true });
    expect(await book(db, second.token, full)).toMatchObject({ ok: false, code: "session_full" });
    expect(await activeBookings(db, second.app)).toEqual([]);
  });

  it("tự đổi ca: người được mở lại đổi được; người đã chọn từ trước (không hạn riêng) thì không", async () => {
    const reopened = await applicant(db, ids.season, { openUntil: future() });
    expect(await book(db, reopened.token, closed2)).toMatchObject({ ok: true });
    expect(await change(db, reopened.token, closed)).toMatchObject({ ok: true, session_id: closed });
    expect(await activeBookings(db, reopened.app)).toEqual([{ session_id: closed }]);

    const earlier = await applicant(db, ids.season);
    await db.query("insert into mentee_interview_bookings(application_id, session_id, season_id) values ($1, $2, $3)", [earlier.app, closed2, ids.season]);
    expect(await change(db, earlier.token, closed)).toMatchObject({ ok: false, code: "deadline_passed" });
    expect(await activeBookings(db, earlier.app)).toEqual([{ session_id: closed2 }]);
  });
});
