/**
 * SQL dữ liệu 20261010120000 — ghi bù tham dự Mentor Orientation 09/10/2026 cho người
 * được duyệt làm mentor SAU buổi. Chạy THẬT trên PostgreSQL (PGlite); bảng dựng tối
 * thiểu nhưng ba ràng buộc CHECK của event_participations chép nguyên từ production
 * (đọc 10/10/2026) để giá trị file ghi ra bị kiểm như trên máy thật.
 *
 * Điều phải đúng: chỉ đăng ký ĐÃ check-in, CHƯA nối hồ sơ, email khớp đúng một người có
 * đơn mentor S12 đã duyệt mới được ghi; người chưa duyệt, trùng SĐT, đơn mentee, mùa
 * khác, đăng ký đã huỷ không bị chạm; chạy lại không thêm dòng thứ hai; tự kiểm hỏng thì
 * không có gì được lưu.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(path.resolve("supabase/migrations/20261010120000_orientation_ghi_nhan_tham_du_sau_duyet.sql"), "utf8");
const EVENT = "b42c52e6-8db0-422f-9616-0bd1998bc975";
const OTHER_EVENT = "00000000-0000-4000-8000-0000000000e2";
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const S11 = "00000000-0000-4000-8000-000000000011";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: PGlite;

type Reg = { id: string; linked_person_id: string | null; match_method: string | null; match_review_status: string | null; matched: boolean };
type Part = { person_id: string; role_at_event: string; registration_status: string; attendance_status: string; date: string | null; captured_by: string | null; walk_in: boolean };

const reg = async (id: string) =>
  (await db.query<Reg>("select id, linked_person_id, match_method, match_review_status, matched_at is not null as matched from event_registrations where id = $1", [id])).rows[0];
const parts = async (personId?: string) =>
  (await db.query<Part>(
    `select person_id, role_at_event, registration_status, attendance_status, attendance_date::text as date, captured_by, walk_in
     from event_participations where event_id = $1 ${personId ? "and person_id = $2" : ""} order by person_id`,
    personId ? [EVENT, personId] : [EVENT]
  )).rows;

/** Chạy cả file; trả dòng tổng kết của câu select cuối. */
async function run() {
  const results = await db.exec(SQL);
  return results[results.length - 1].rows[0] as Record<string, unknown>;
}

async function person(n: number, name: string, email: string | null) {
  await db.query("insert into people(id, full_name, email_primary) values ($1, $2, $3)", [uuid(n), name, email]);
  return uuid(n);
}
async function application(email: string, status: string, personId: string | null, over: { role?: string; season?: string; phone?: string } = {}) {
  await db.query(
    "insert into applications(season_id, person_id, role_applied, status, email_primary, phone_primary) values ($1, $2, $3, $4, $5, $6)",
    [over.season ?? S12, personId, over.role ?? "mentor", status, email, over.phone ?? null]
  );
}
async function registration(n: number, name: string, email: string, over: Partial<{ attendance: string; status: string; linked: string | null; walkIn: boolean; phone: string; event: string }> = {}) {
  await db.query(
    `insert into event_registrations(id, event_id, full_name, email, phone, linked_person_id, registration_status, attendance_status, is_walk_in, match_method, match_review_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [uuid(n), over.event ?? EVENT, name, email, over.phone ?? null, over.linked ?? null, over.status ?? "registered", over.attendance ?? "checked_in",
      over.walkIn ?? false, over.linked ? "exact_email" : "unlinked", over.linked ? "auto_linked" : "pending_review"]
  );
  return uuid(n);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table events(id uuid primary key, event_name text, season_id uuid, starts_at timestamptz);
    create table people(id uuid primary key, full_name text not null, email_primary text);
    create table applications(id uuid primary key default gen_random_uuid(), season_id uuid, person_id uuid references people,
      role_applied text, status text, email_primary text, phone_primary text);
    create table event_registrations(id uuid primary key, event_id uuid references events, full_name text, email text, phone text,
      linked_person_id uuid references people, registration_status text, attendance_status text, is_walk_in boolean,
      match_method text, match_review_status text, matched_at timestamptz);
    create table event_participations(id uuid primary key default gen_random_uuid(), event_id uuid references events, season_id uuid,
      person_id uuid references people, role_at_event text, registration_status text not null default 'registered',
      attendance_status text not null default 'registered_absent', attendance_date date, captured_by text, walk_in boolean not null default false,
      constraint event_participations_attendance_status_check check (attendance_status is null or attendance_status = any (array['attended','absent_excused','absent_unexcused','registered_no_response','walk_in','unknown','registered_absent'])),
      constraint event_participations_registration_status_check check (registration_status is null or registration_status = any (array['registered','confirmed','declined','no_response','cancelled','unknown'])),
      constraint event_participations_role_at_event_check check (role_at_event is null or role_at_event = any (array['mentor','mentee','core_team','speaker','trainer','guest','unknown'])));
  `);
}, 60000);
afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Một ca hỏng giữa giao dịch không được kéo theo ca sau.
  await db.exec("rollback").catch(() => undefined);
  await db.exec("truncate event_participations, event_registrations, applications, people, events cascade");
  await db.query("insert into events values ($1, 'Mentor Orientation', $2, timestamptz '2026-10-09 19:30+07')", [EVENT, S12]);
  await db.query("insert into events values ($1, 'Sự kiện khác', $2, timestamptz '2026-10-09 19:30+07')", [OTHER_EVENT, S12]);
});

describe("ghi bù tham dự Mentor Orientation sau khi BTC duyệt", () => {
  it("chưa duyệt thêm ai: không ghi gì, chỉ in bảng tình hình", async () => {
    const official = await person(1, "Mentor Chính Thức", "official@example.test");
    await application("official@example.test", "approved_as_mentor", official);
    await registration(101, "Mentor Chính Thức", "official@example.test", { linked: official });
    await db.query("insert into event_participations(event_id, season_id, person_id, role_at_event, attendance_status, attendance_date, captured_by) values ($1, $2, $3, 'unknown', 'attended', date '2026-10-09', 'self_qr')", [EVENT, S12, official]);
    await application("waiting@example.test", "ready_for_final_decision", null, { phone: "0909 000 111" });
    // Khớp cả email lẫn SĐT với đơn của chính mình: là "chờ duyệt", không đếm thêm vào "chỉ trùng SĐT".
    const waiting = await registration(102, "Người Chờ Chốt", "waiting@example.test", { phone: "0909000111" });
    await application("other-mail@example.test", "approved_as_mentor", null, { phone: "+84 912 345 678" });
    const phoneOnly = await registration(103, "Trùng Số Điện Thoại", "khac@example.test", { phone: "0912345678" });
    const stranger = await registration(104, "Người Lạ", "la@example.test");

    const summary = await run();

    expect(summary).toMatchObject({
      tong_check_in: 4, da_ghi_nhan_tham_du: 1, con_cho_duyet: 1, chi_trung_sdt_can_xac_minh: 1, khong_khop: 1,
      ten_nguoi_con_cho_duyet: "Người Chờ Chốt"
    });
    for (const id of [waiting, phoneOnly, stranger]) {
      expect(await reg(id)).toMatchObject({ linked_person_id: null, match_method: "unlinked", match_review_status: "pending_review", matched: false });
    }
    expect(await parts()).toHaveLength(1);
  });

  it("BTC duyệt xong: nối đăng ký với hồ sơ và ghi attended 09/10 — đúng người đó, không ai khác", async () => {
    await application("moi@example.test", "ready_for_final_decision", null);
    await application("chua@example.test", "ready_for_final_decision", null);
    // Người gõ email hoa/thừa khoảng trắng lúc check-in, và là khách vãng lai.
    const approvedReg = await registration(201, "Mentor Mới", "  Moi@Example.TEST ", { walkIn: true });
    const stillWaitingReg = await registration(202, "Chưa Duyệt", "chua@example.test");
    expect((await run()).con_cho_duyet).toBe(2);
    expect(await parts()).toHaveLength(0);

    // BTC duyệt một người: hệ thống tạo hồ sơ người và gắn vào đơn.
    const approved = await person(2, "Mentor Mới", "moi@example.test");
    await db.query("update applications set status = 'approved_as_mentor', person_id = $1 where email_primary = 'moi@example.test'", [approved]);

    const summary = await run();

    expect(summary).toMatchObject({ tong_check_in: 2, da_ghi_nhan_tham_du: 1, con_cho_duyet: 1, ten_nguoi_con_cho_duyet: "Chưa Duyệt" });
    expect(await reg(approvedReg)).toEqual({ id: approvedReg, linked_person_id: approved, match_method: "exact_email", match_review_status: "auto_linked", matched: true });
    expect(await reg(stillWaitingReg)).toMatchObject({ linked_person_id: null, matched: false });
    expect(await parts()).toEqual([
      { person_id: approved, role_at_event: "mentor", registration_status: "registered", attendance_status: "attended", date: "2026-10-09", captured_by: "self_qr", walk_in: true }
    ]);
  });

  it("chạy lại không thêm dòng thứ hai và không đổi dòng đã ghi", async () => {
    const approved = await person(3, "Mentor Mới", "moi@example.test");
    await application("moi@example.test", "approved_as_mentor", approved);
    await registration(301, "Mentor Mới", "moi@example.test");
    await run();
    const first = await parts();
    const firstReg = await db.query("select matched_at from event_registrations where id = $1", [uuid(301)]);

    const summary = await run();

    expect(await parts()).toEqual(first);
    expect(first).toHaveLength(1);
    expect((await db.query("select matched_at from event_registrations where id = $1", [uuid(301)])).rows).toEqual(firstReg.rows);
    expect(summary).toMatchObject({ da_ghi_nhan_tham_du: 1, con_cho_duyet: 0 });
  });

  it("đã có dòng tham dự do BTC thêm tay: sửa dòng đó thành attended, không thêm dòng mới", async () => {
    const approved = await person(4, "Mentor Có Sẵn", "cosan@example.test");
    await application("cosan@example.test", "approved_as_mentor", approved);
    await registration(401, "Mentor Có Sẵn", "cosan@example.test");
    await db.query("insert into event_participations(event_id, season_id, person_id, role_at_event, registration_status, attendance_status, captured_by) values ($1, $2, $3, 'guest', 'confirmed', 'registered_absent', 'admin')", [EVENT, S12, approved]);

    await run();

    // Vai và nguồn do BTC ghi được giữ; chỉ trạng thái tham dự và ngày đổi.
    expect(await parts(approved)).toEqual([
      { person_id: approved, role_at_event: "guest", registration_status: "confirmed", attendance_status: "attended", date: "2026-10-09", captured_by: "admin", walk_in: false }
    ]);
  });

  it("không ghi cho: đơn bị từ chối, đơn mentee, đơn mùa khác, đăng ký đã huỷ, đăng ký chưa check-in, sự kiện khác", async () => {
    const rejected = await person(5, "Bị Từ Chối", "rot@example.test");
    await application("rot@example.test", "rejected_or_not_fit", rejected);
    const mentee = await person(6, "Là Mentee", "mentee@example.test");
    await application("mentee@example.test", "approved_as_mentor", mentee, { role: "mentee" });
    const lastSeason = await person(7, "Mentor Mùa Trước", "s11@example.test");
    await application("s11@example.test", "approved_as_mentor", lastSeason, { season: S11 });
    const ok = await person(8, "Mentor Đã Duyệt", "ok@example.test");
    await application("ok@example.test", "approved_as_mentor", ok);
    const ids = [
      await registration(501, "Bị Từ Chối", "rot@example.test"),
      await registration(502, "Là Mentee", "mentee@example.test"),
      await registration(503, "Mentor Mùa Trước", "s11@example.test"),
      await registration(504, "Mentor Đã Duyệt", "ok@example.test", { status: "cancelled" }),
      await registration(505, "Mentor Đã Duyệt", "ok@example.test", { attendance: "registered" }),
      await registration(506, "Mentor Đã Duyệt", "ok@example.test", { event: OTHER_EVENT })
    ];

    await run();

    for (const id of ids) expect(await reg(id)).toMatchObject({ linked_person_id: null, matched: false });
    expect((await db.query("select count(*)::int as n from event_participations")).rows[0]).toEqual({ n: 0 });
  });

  it("đăng ký đã nối với một người thì giữ nguyên — dù email đó nay khớp đơn đã duyệt của người khác", async () => {
    // Lúc đăng ký, hệ thống đã nối email này với hồ sơ X. Sau đó có đơn mentor đã duyệt
    // mang cùng email nhưng gắn hồ sơ Y. File không được ghi tham dự cho Y.
    const x = await person(15, "Người X", "trung@example.test");
    const y = await person(16, "Người Y", null);
    await application("trung@example.test", "approved_as_mentor", y);
    const id = await registration(1001, "Người X", "trung@example.test", { linked: x });
    await db.query("insert into event_participations(event_id, season_id, person_id, role_at_event, attendance_status, attendance_date, captured_by) values ($1, $2, $3, 'unknown', 'attended', date '2026-10-09', 'self_qr')", [EVENT, S12, x]);

    await run();

    expect(await reg(id)).toMatchObject({ linked_person_id: x, match_method: "exact_email", matched: false });
    expect(await parts(y)).toHaveLength(0);
    expect(await parts()).toHaveLength(1);
  });

  it("một email dẫn tới hai hồ sơ người khác nhau thì không đoán — để nguyên cho BTC xem", async () => {
    const a = await person(9, "Người A", "chung@example.test");
    const b = await person(10, "Người B", "chung@example.test");
    await application("chung@example.test", "approved_as_mentor", a);
    await application("chung@example.test", "approved_as_mentor", b);
    const id = await registration(601, "Email Dùng Chung", "chung@example.test");

    await run();

    expect(await reg(id)).toMatchObject({ linked_person_id: null, matched: false });
    expect(await parts()).toHaveLength(0);
  });

  it("hai đơn đã duyệt của CÙNG một người vẫn là một người: ghi một dòng", async () => {
    const p = await person(11, "Hai Đơn", "haidon@example.test");
    await application("haidon@example.test", "approved_as_mentor", p);
    await application("haidon@example.test", "approved_as_mentor", p);
    const id = await registration(701, "Hai Đơn", "haidon@example.test");

    await run();

    expect(await reg(id)).toMatchObject({ linked_person_id: p, match_method: "exact_email" });
    expect(await parts(p)).toHaveLength(1);
  });

  it("không đúng sự kiện (đổi tên / đổi mùa / đổi ngày) thì dừng trước khi ghi", async () => {
    const approved = await person(12, "Mentor Mới", "moi@example.test");
    await application("moi@example.test", "approved_as_mentor", approved);
    const id = await registration(801, "Mentor Mới", "moi@example.test");
    for (const breakIt of [
      "update events set event_name = 'Mentee Orientation' where id = $1",
      "update events set season_id = '00000000-0000-4000-8000-000000000011' where id = $1",
      "update events set starts_at = timestamptz '2026-10-10 19:30+07' where id = $1"
    ]) {
      await db.query("update events set event_name = 'Mentor Orientation', season_id = $2, starts_at = timestamptz '2026-10-09 19:30+07' where id = $1", [EVENT, S12]);
      await db.query(breakIt, [EVENT]);
      await expect(db.exec(SQL)).rejects.toThrow(/PRECHECK/);
      await db.exec("rollback");
      expect(await reg(id)).toMatchObject({ linked_person_id: null, matched: false });
      expect(await parts()).toHaveLength(0);
    }
  });

  it("tự kiểm hỏng thì không có gì được lưu — kể cả phần đã nối trong cùng lần chạy", async () => {
    const dup = await person(13, "Trùng Dòng", "dup@example.test");
    await registration(901, "Trùng Dòng", "dup@example.test", { linked: dup });
    // Dữ liệu sẵn có đã sai: một người hai dòng tham dự cho cùng buổi.
    for (let i = 0; i < 2; i += 1) {
      await db.query("insert into event_participations(event_id, season_id, person_id, role_at_event, attendance_status) values ($1, $2, $3, 'mentor', 'attended')", [EVENT, S12, dup]);
    }
    const approved = await person(14, "Mentor Mới", "moi@example.test");
    await application("moi@example.test", "approved_as_mentor", approved);
    const id = await registration(902, "Mentor Mới", "moi@example.test");

    await expect(db.exec(SQL)).rejects.toThrow(/SELF_CHECK/);
    await db.exec("rollback");

    expect(await reg(id)).toMatchObject({ linked_person_id: null, matched: false });
    expect(await parts(approved)).toHaveLength(0);
  });
});
