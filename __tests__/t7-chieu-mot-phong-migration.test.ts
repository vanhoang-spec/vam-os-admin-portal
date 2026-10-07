/**
 * Chiều Thứ Bảy 10/10 chỉ còn 1 phòng (BTC 07/10/2026) — chạy THẬT trên PostgreSQL (PGlite).
 *
 * File chạm chỗ của người thật: phải huỷ đúng người ở các ca từ 15:00, không chạm ca sáng
 * hay ca 13:30–14:30, đưa đúng người vào hàng chờ thư mở lại (kể cả người từng nhận thư
 * trước khi bị huỷ), và chạy lại không làm ai nhận thư hai lần.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const MIGRATION = "supabase/migrations/20261007170000_t7_10_10_chieu_mot_phong.sql";
const NOTE = "Chiều Thứ Bảy 10/10 chỉ còn 1 phòng — đóng các ca từ 15:00, mở lại chọn ca";
const ACTOR = "a3f45586-8747-49d9-860a-4b903cfdc7bc";

let db: PGlite;
const S: Record<string, string> = {};
const P = { morning: uuid(801), early: uuid(802), late1: uuid(803), late2: uuid(804), last: uuid(805) };
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const bookingStatus = async (app: string) =>
  (await db.query<{ status: string }>("select status from mentee_interview_bookings where application_id = $1 order by status", [app])).rows.map((r) => r.status);

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
  await db.exec(
    "alter table mentee_interview_invites add column if not exists booking_open_until timestamptz, add column if not exists reopen_notified_at timestamptz"
  );
  await db.query("insert into admin_users values ($1, $1, 'hoang@example.test', 'Hoàng', 'active', 'super_admin')", [ACTOR]);
  for (const hhmm of ["08:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]) {
    const { rows } = await db.query<{ id: string }>(
      `insert into interview_sessions(season_id, starts_at, ends_at, seat_limit, booking_closes_at, status)
       values ($1, ('2026-10-10 ' || $2 || ':00+07')::timestamptz, ('2026-10-10 ' || $2 || ':00+07')::timestamptz + interval '30 minutes', 18,
               '2026-10-09 17:00:00+07', $3)
       returning id`,
      [ids.season, hhmm, hhmm >= "15:00" ? "closed" : "open"]
    );
    S[hhmm] = rows[0].id;
  }
  await addCandidate(db, P.morning, S["08:00"]);
  await addCandidate(db, P.early, S["13:30"]);
  await addCandidate(db, P.late1, S["15:00"]);
  await addCandidate(db, P.late2, S["15:00"]);
  await addCandidate(db, P.last, S["16:30"]);
  // late2 từng nhận thư mở lại đợt 2 (trước khi bị huỷ chỗ hôm nay).
  await db.query(
    "update mentee_interview_invites set booking_open_until = '2026-10-09 17:00:00+07', reopen_notified_at = now() - interval '1 day' where application_id = $1",
    [P.late2]
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("chiều Thứ Bảy 10/10 một phòng", () => {
  it("13:30–14:30 còn 10 chỗ; từ 15:00 đóng; chỉ người ở ca từ 15:00 bị huỷ, có nhật ký", () =>
    isolated(async () => {
      await db.exec(read(MIGRATION));
      const seats = await db.query<{ hhmm: string; seat_limit: number; status: string }>(
        "select to_char(starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') as hhmm, seat_limit, status from interview_sessions where id = any($1) order by starts_at",
        [Object.values(S)]
      );
      expect(seats.rows).toEqual([
        { hhmm: "08:00", seat_limit: 18, status: "open" },
        { hhmm: "13:30", seat_limit: 10, status: "open" },
        { hhmm: "14:00", seat_limit: 10, status: "open" },
        { hhmm: "14:30", seat_limit: 10, status: "open" },
        { hhmm: "15:00", seat_limit: 18, status: "closed" },
        { hhmm: "15:30", seat_limit: 18, status: "closed" },
        { hhmm: "16:00", seat_limit: 18, status: "closed" },
        { hhmm: "16:30", seat_limit: 18, status: "closed" }
      ]);
      expect(await bookingStatus(P.morning)).toEqual(["booked"]);
      expect(await bookingStatus(P.early)).toEqual(["booked"]);
      for (const app of [P.late1, P.late2, P.last]) expect(await bookingStatus(app)).toEqual(["cancelled"]);
      expect(await one("select cancel_note, cancelled_by from mentee_interview_bookings where application_id = $1", [P.late1])).toEqual({
        cancel_note: NOTE,
        cancelled_by: ACTOR
      });
      const log = await db.query<{ application_id: string }>("select application_id from mentee_interview_operation_log where reason = $1 order by application_id", [NOTE]);
      expect(log.rows.map((r) => r.application_id)).toEqual([P.late1, P.late2, P.last].sort());
    }));

  it("người bị huỷ vào hàng chờ thư mở lại — kể cả người từng nhận thư trước đó; người khác không bị chạm", () =>
    isolated(async () => {
      await db.exec(read(MIGRATION));
      const invites = await db.query<{ application_id: string; open_until: string | null; notified: boolean }>(
        `select application_id, to_char(booking_open_until at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') as open_until,
                reopen_notified_at is not null as notified
           from mentee_interview_invites where application_id = any($1) order by application_id`,
        [Object.values(P)]
      );
      const byApp = new Map(invites.rows.map((r) => [r.application_id, r]));
      for (const app of [P.late1, P.late2, P.last]) expect(byApp.get(app)).toMatchObject({ open_until: "09/10 17:00", notified: false });
      for (const app of [P.morning, P.early]) expect(byApp.get(app)).toMatchObject({ open_until: null, notified: false });
    }));

  it("chạy lại sau khi BTC đã gửi thư: không huỷ thêm, không ghi thêm nhật ký, không xoá dấu đã gửi", () =>
    isolated(async () => {
      await db.exec(read(MIGRATION));
      await db.query("update mentee_interview_invites set reopen_notified_at = now() + interval '5 minutes' where application_id = any($1)", [[P.late1, P.late2, P.last]]);
      const logsBefore = (await one<{ n: number }>("select count(*)::int as n from mentee_interview_operation_log")).n;
      await db.exec(read(MIGRATION));
      expect((await one<{ n: number }>("select count(*)::int as n from mentee_interview_operation_log")).n).toBe(logsBefore);
      const notified = await db.query<{ n: number }>("select count(*)::int as n from mentee_interview_invites where reopen_notified_at is not null and application_id = any($1)", [[P.late1, P.late2, P.last]]);
      expect(notified.rows[0].n).toBe(3);
    }));

  it("ca 13:30–14:30 đã quá 10 người thì DỪNG, không ghi gì", () =>
    isolated(async () => {
      for (let n = 0; n < 10; n++) await addCandidate(db, uuid(900 + n), S["14:00"]);
      await addCandidate(db, uuid(950), S["14:00"]);
      await db.exec("savepoint s");
      await expect(db.exec(read(MIGRATION))).rejects.toThrow("DỪNG");
      await db.exec("rollback to savepoint s");
      expect(await bookingStatus(P.late1)).toEqual(["booked"]);
      expect((await one<{ seat_limit: number }>("select seat_limit from interview_sessions where id = $1", [S["13:30"]])).seat_limit).toBe(18);
    }));
});
