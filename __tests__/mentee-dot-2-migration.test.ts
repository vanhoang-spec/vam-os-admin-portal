/**
 * Migration đợt 2 phỏng vấn mentee (10–11/10/2026) — chạy THẬT trên PostgreSQL (PGlite).
 *
 * File này chạm hồ sơ của hàng trăm người thật: huỷ chỗ cũ của người vắng, mở lại
 * chọn ca, chuyển hồ sơ mới sang "Mời phỏng vấn". Mỗi nhóm có một người đại diện, và
 * mỗi nhóm KHÔNG được chạm cũng có một người đại diện — một điều kiện lỏng tay là
 * chuyển nhầm trạng thái của người không liên quan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, save, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const ACTOR = "a3f45586-8747-49d9-860a-4b903cfdc7bc";
const DATA = "supabase/migrations/20261007100000_mentee_phong_van_dot_2.sql";

const P = {
  noShow: uuid(201),
  noShowWithOp: uuid(202),
  attended: uuid(203),
  notChosen: uuid(204),
  newPass: uuid(205),
  newScore: uuid(206),
  newLow: uuid(207),
  oldPass: uuid(208),
  newNotReviewed: uuid(209)
};

let db: PGlite;

async function app(id: string, status: string, createdAt = "2026-09-20 10:00:00+07") {
  await db.query(
    `insert into applications(id,season_id,role_applied,status,source,full_name,email_primary,created_at)
     values($1,$2,'mentee',$3,'vam_os_form','Mentee',$4,$5)`,
    [id, ids.season, status, `${id}@example.test`, createdAt]
  );
}
async function review(appId: string, recommendation: string, total: number, status = "submitted") {
  await db.query(
    `insert into application_reviews(application_id,reviewer_admin_user_id,review_round,status,recommendation,total_score)
     values($1,$2,'profile_screening',$3,$4,$5)`,
    [appId, ids.mentor, status, recommendation, total]
  );
}
async function sessionOn(day: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from interview_sessions where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date=$1::date order by starts_at limit 1`,
    [day]
  );
  return rows[0].id;
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Thứ hai migration này cần mà bộ dựng chung không có: ngày nộp đơn, yêu cầu số phiếu
  // theo vòng, và đúng cổng điều kiện của nút "Mời phỏng vấn hàng loạt".
  await db.exec("alter table applications add column created_at timestamptz not null default now()");
  // Hai cột của tính năng "mở lại chọn ca" (migration sau bộ dựng chung).
  await db.exec(
    "alter table mentee_interview_invites add column if not exists booking_open_until timestamptz, add column if not exists reopen_notified_at timestamptz"
  );
  const stage = /create table if not exists public\.recruitment_stage_requirements \([\s\S]*?\n\);/i.exec(
    read("supabase/migrations/20260830070430_s12_recruitment_operational_remediation.sql")
  );
  if (!stage) throw new Error("không thấy DDL recruitment_stage_requirements");
  await db.exec(stage[0]);
  const gate = /CREATE OR REPLACE FUNCTION public\.vam084_application_decision_eligibility\([\s\S]*?\$function\$;/i.exec(
    read("supabase/migrations/20260906090000_s12_direct_interview_invite.sql")
  );
  if (!gate) throw new Error("không thấy vam084_application_decision_eligibility");
  await db.exec(gate[0]);
  await db.query(
    `insert into recruitment_stage_requirements(season_id,review_stage,minimum_submitted_reviews) values($1,'profile_screening',1),($1,'interview',1)`,
    [ids.season]
  );
  await db.query(`insert into admin_users values($1,$1,'hoang@example.test','Hoàng','active','super_admin')`, [ACTOR]);

  const sat = await sessionOn("2026-10-03");
  const sun = await sessionOn("2026-10-04");
  const book = (appId: string, session: string) =>
    db.query(
      "insert into mentee_interview_bookings(application_id,session_id,season_id,previous_application_status) values($1,$2,$3,'invited_to_interview')",
      [appId, session, ids.season]
    );
  const invite = (appId: string) => db.query("insert into mentee_interview_invites(application_id) values($1)", [appId]);

  // Vắng: đặt ca thứ Bảy, không có dòng điều phối.
  await app(P.noShow, "interview_scheduled");
  await invite(P.noShow);
  await book(P.noShow, sat);
  // Vắng nhưng có dòng điều phối trống (tạo rồi chưa check-in).
  await app(P.noShowWithOp, "interview_scheduled");
  await invite(P.noShowWithOp);
  await book(P.noShowWithOp, sun);
  await db.query("insert into mentee_interview_operations(id,session_id) values($1,$2)", [P.noShowWithOp, sun]);
  // Đã đến, đã check-in, chưa có kết quả: KHÔNG được huỷ.
  await app(P.attended, "interview_scheduled");
  await invite(P.attended);
  await book(P.attended, sat);
  await db.exec("set role service_role");
  await save(db, "checkin", 0, {}, ids.support, P.attended);
  await db.exec("reset role");
  // Có thư mời, chưa từng chọn ca.
  await app(P.notChosen, "invited_to_interview");
  await invite(P.notChosen);
  // Hồ sơ mới (nộp từ 27/09).
  await app(P.newPass, "screening_completed", "2026-09-28 09:00:00+07");
  await review(P.newPass, "pass_to_interview", 10);
  await app(P.newScore, "screening_completed", "2026-10-01 09:00:00+07");
  await review(P.newScore, "reject", 13);
  await app(P.newLow, "screening_completed", "2026-10-02 09:00:00+07");
  await review(P.newLow, "waitlist", 12);
  await app(P.newNotReviewed, "screening_assigned", "2026-09-29 09:00:00+07");
  await review(P.newNotReviewed, "pass_to_interview", 20, "assigned");
  // Nộp TRƯỚC mốc chốt (23:59 26/09) dù đạt: không thuộc đợt này.
  await app(P.oldPass, "screening_completed", "2026-09-26 23:59:00+07");
  await review(P.oldPass, "pass_to_interview", 20);

  await db.exec(read(DATA));
}, 60000);

afterAll(async () => {
  await db?.close();
});

describe("migration đợt 2", () => {
  it("28 ca 30 phút 10–11/10, hạn 17:00 09/10; Chủ nhật Cơ sở B 28 chỗ, Thứ Bảy chưa có địa điểm 18 chỗ", async () => {
    const rows = (
      await db.query<{ d: string; n: number; seats: number; venues: number; closes: string; minutes: number }>(
        `select to_char((starts_at at time zone 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') d, count(*)::int n, max(seat_limit) seats,
                count(venue)::int venues, to_char(max(booking_closes_at) at time zone 'Asia/Ho_Chi_Minh','DD/MM HH24:MI') closes,
                max(extract(epoch from ends_at-starts_at)/60)::int minutes
           from interview_sessions where starts_at >= '2026-10-10 00:00+07' group by 1 order by 1`
      )
    ).rows;
    expect(rows).toEqual([
      { d: "2026-10-10", n: 14, seats: 18, venues: 0, closes: "09/10 17:00", minutes: 30 },
      { d: "2026-10-11", n: 14, seats: 28, venues: 14, closes: "09/10 17:00", minutes: 30 }
    ]);
    const first = await one<{ t: string }>(
      `select to_char(min(starts_at) at time zone 'Asia/Ho_Chi_Minh','HH24:MI')||'–'||to_char(max(starts_at) at time zone 'Asia/Ho_Chi_Minh','HH24:MI') t
         from interview_sessions where starts_at >= '2026-10-11 00:00+07'`
    );
    expect(first.t).toBe("08:00–16:30");
  });

  it("người vắng (chưa check-in): huỷ chỗ cũ, ghi nhật ký; dòng điều phối trống bị bỏ", async () => {
    const booked = (
      await db.query<{ application_id: string; status: string; cancelled_by: string | null }>(
        "select application_id,status,cancelled_by from mentee_interview_bookings where application_id = any($1) order by application_id",
        [[P.noShow, P.noShowWithOp, P.attended]]
      )
    ).rows;
    expect(booked).toEqual([
      { application_id: P.noShow, status: "cancelled", cancelled_by: ACTOR },
      { application_id: P.noShowWithOp, status: "cancelled", cancelled_by: ACTOR },
      { application_id: P.attended, status: "booked", cancelled_by: null }
    ]);
    expect((await db.query("select id from mentee_interview_operations where id=$1", [P.noShowWithOp])).rows).toEqual([]);
    expect((await db.query("select id from mentee_interview_operations where id=$1", [P.attended])).rows).toHaveLength(1);
    const log = await one<{ n: number }>(
      "select count(*)::int n from mentee_interview_operation_log where action='cancel_booking' and actor_id=$1",
      [ACTOR]
    );
    expect(log.n).toBeGreaterThanOrEqual(2);
  });

  it("mở lại chọn ca đến 17:00 09/10 cho người có thư mời mà chưa giữ ca — không cho người đã check-in", async () => {
    const rows = (
      await db.query<{ application_id: string; until: string | null; notified: string | null }>(
        `select application_id, to_char(booking_open_until at time zone 'Asia/Ho_Chi_Minh','DD/MM HH24:MI') until, reopen_notified_at notified
           from mentee_interview_invites where application_id = any($1) order by application_id`,
        [[P.noShow, P.noShowWithOp, P.attended, P.notChosen]]
      )
    ).rows;
    expect(rows).toEqual([
      { application_id: P.noShow, until: "09/10 17:00", notified: null },
      { application_id: P.noShowWithOp, until: "09/10 17:00", notified: null },
      { application_id: P.attended, until: null, notified: null },
      { application_id: P.notChosen, until: "09/10 17:00", notified: null }
    ]);
  });

  it("hồ sơ nộp từ 27/09: Pass to interview hoặc điểm >= 13 → Mời phỏng vấn; dưới 13, chưa chấm, nộp trước mốc → giữ nguyên", async () => {
    const rows = (
      await db.query<{ id: string; status: string }>("select id,status from applications where id = any($1) order by id", [
        [P.newPass, P.newScore, P.newLow, P.oldPass, P.newNotReviewed]
      ])
    ).rows;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [P.newPass]: "invited_to_interview",
      [P.newScore]: "invited_to_interview",
      [P.newLow]: "screening_completed",
      [P.oldPass]: "screening_completed",
      [P.newNotReviewed]: "screening_assigned"
    });
    const decisions = (
      await db.query<{ application_id: string; decided_by: string; previous_status: string }>(
        "select application_id,decided_by,previous_status from application_decisions where new_status='invited_to_interview' order by application_id"
      )
    ).rows;
    expect(decisions).toEqual([
      { application_id: P.newPass, decided_by: ACTOR, previous_status: "screening_completed" },
      { application_id: P.newScore, decided_by: ACTOR, previous_status: "screening_completed" }
    ]);
  });

  it("chạy lại lần hai không sinh trùng ca, không ghi quyết định lần hai, không xoá dấu “đã gửi thư báo”", async () => {
    // BTC đã gửi thư mở lại cho một người, rồi file bị chạy lại (07/10/2026: SQL Editor
    // chạy lại sau lần đầu đã xong) — người đó không được nhận thư lần hai.
    await db.query("update mentee_interview_invites set reopen_notified_at=now() where application_id=$1", [P.notChosen]);
    const cancelLogs = () => one<{ n: number }>("select count(*)::int n from mentee_interview_operation_log where action='cancel_booking'");
    const logsBefore = (await cancelLogs()).n;
    await db.exec(read(DATA));
    expect((await one<{ n: number }>("select count(*)::int n from interview_sessions where starts_at >= '2026-10-10 00:00+07'")).n).toBe(28);
    expect((await one<{ n: number }>("select count(*)::int n from application_decisions where new_status='invited_to_interview'")).n).toBe(2);
    expect((await cancelLogs()).n).toBe(logsBefore);
    const notified = await one<{ at: string | null }>("select reopen_notified_at at from mentee_interview_invites where application_id=$1", [P.notChosen]);
    expect(notified.at).not.toBeNull();
  });

  it("tạm khoá Thứ Bảy 10/10: bỏ số chỗ 14 ca, Chủ nhật giữ nguyên; có người giữ chỗ Thứ Bảy thì dừng", async () => {
    const LOCK = "supabase/migrations/20261007110000_tam_khoa_ca_thu_bay_dot_2.sql";
    // Có người giữ chỗ Thứ Bảy → file phải dừng, không bỏ số chỗ dưới chân người đó.
    const sat = await sessionOn("2026-10-10");
    await db.exec("begin");
    try {
      await db.query(
        "insert into mentee_interview_bookings(application_id,session_id,season_id,previous_application_status) values($1,$2,$3,'invited_to_interview')",
        [P.newLow, sat, ids.season]
      );
      await db.exec("savepoint lock_attempt");
      await expect(db.exec(read(LOCK).replace(/^begin;$/m, "").replace(/^commit;$/m, ""))).rejects.toThrow("Đã có người giữ chỗ ca Thứ Bảy");
      await db.exec("rollback to savepoint lock_attempt");
    } finally {
      await db.exec("rollback");
    }
    await db.exec(read(LOCK));
    await db.exec(read(LOCK));
    const days = (
      await db.query<{ d: string; with_seats: number; total: number }>(
        `select to_char((starts_at at time zone 'Asia/Ho_Chi_Minh')::date,'DD/MM') d, count(seat_limit)::int with_seats, count(*)::int total
           from interview_sessions where starts_at >= '2026-10-10 00:00+07' group by 1 order by 1`
      )
    ).rows;
    expect(days).toEqual([
      { d: "10/10", with_seats: 0, total: 14 },
      { d: "11/10", with_seats: 14, total: 14 }
    ]);
    // Ca đợt 1 không bị chạm.
    expect((await one<{ n: number }>("select count(*)::int n from interview_sessions where starts_at < '2026-10-05 00:00+07' and seat_limit is null")).n).toBe(0);
  });

  it("mỗi bước chạy riêng được — không dựa vào bảng tạm của câu lệnh trước", () => {
    // 07/10/2026: chạy lại một đoạn file trên SQL Editor báo "relation dot2_vang does not
    // exist" vì bảng tạm chỉ sống trong lần chạy đã tạo nó.
    expect(read(DATA)).not.toMatch(/create\s+temp/i);
  });

  it("đợt 2 phân được bàn: Chủ nhật 6 phòng × 5 bàn theo địa điểm; Thứ Bảy theo địa điểm BTC điền sau", async () => {
    const sun = await sessionOn("2026-10-11");
    const sat = await sessionOn("2026-10-10");
    // Dòng điều phối trỏ vào hồ sơ có thật (khoá ngoại); mọi thứ rollback sau đó.
    const assign = (appId: string, session: string, room: number, desk: number) =>
      db.query("insert into mentee_interview_operations(id,session_id,room,desk) values($1,$2,$3,$4)", [appId, session, room, desk]);
    await db.exec("begin");
    try {
      await assign(P.newLow, sun, 6, 5);
      await expect(assign(P.oldPass, sun, 1, 6)).rejects.toThrow("ROOM_DESK_OUT_OF_RANGE");
    } finally {
      await db.exec("rollback");
    }
    // Thứ Bảy đang tạm khoá (chưa địa điểm, chưa số chỗ) → tạm 6 phòng × 6 bàn. BTC điền
    // địa điểm 3 phòng + 18 chỗ ở trang Ca → cận đổi theo ngay, không cần migration.
    await db.exec("begin");
    try {
      await assign(P.newLow, sat, 6, 6);
      await db.query("update interview_sessions set venue=$2, seat_limit=18 where id=$1", [sat, "Phòng H101, H104, H201 — Cơ sở H, 1A Hoàng Diệu"]);
      await assign(P.newPass, sat, 3, 6);
      await expect(assign(P.oldPass, sat, 4, 1)).rejects.toThrow("ROOM_DESK_OUT_OF_RANGE");
    } finally {
      await db.exec("rollback");
    }
  });
});
