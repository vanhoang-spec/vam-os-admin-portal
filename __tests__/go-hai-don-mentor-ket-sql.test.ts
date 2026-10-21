/**
 * SQL dữ liệu 20261021090000 — gỡ hai đơn mentor kẹt ở interview_passed (BTC 21/10/2026).
 * Chạy THẬT trên PostgreSQL (PGlite), bảng dựng tối thiểu.
 *
 * Tình huống dựng lại đúng production ngày 21/10: hai đơn mentor bị "không phù hợp" ở
 * vòng hồ sơ, rồi bị đổi thẳng sang interview_passed bằng một lệnh SQL (dấu
 * DOI_TRANG_THAI_MENTOR_2026_10_21) trong khi chưa có phiếu phỏng vấn nào. Ở trạng thái
 * đó màn hình không còn nút nào đi tiếp, và cũng không phân công phỏng vấn được nữa.
 *
 * Điều phải đúng: hai đơn về "Mời phỏng vấn"; mentor lên interview_passed bằng đường thật
 * không bị chạm; chạy lại không ghi thêm gì; và mọi tình trạng khác với lúc kẹt thì dừng
 * trước khi ghi, không để lại dấu vết nào.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(
  path.resolve("supabase/migrations/20261021090000_go_hai_don_mentor_ket.sql"),
  "utf8"
);

const MARKER = "MOI_PV_LAI_MENTOR_2026_10_21";
const PREV_MARKER = "DOI_TRANG_THAI_MENTOR_2026_10_21";
const CHANGED_AT = "2026-10-20T17:42:51.315171+00:00";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PROGRAM = uuid(1);
const S12 = uuid(12);
const SUPER = uuid(21);
const REVIEWER = uuid(22);
/** Hai người đang kẹt, và một mentor lên interview_passed bằng đường thật. */
const TAN = { person: uuid(101), app: uuid(201), name: "Nguyễn Hoàng Tân" };
const BACH = { person: uuid(102), app: uuid(202), name: "Trần Thanh Bạch" };
const THAT = { person: uuid(103), app: uuid(203), name: "Mentor Phỏng Vấn Thật" };

let db: PGlite;

const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

const statuses = () =>
  all<{ full_name: string; status: string }>(
    "select full_name, status from applications order by full_name"
  );

const decisionsOf = (appId: string) =>
  all<{
    decided_by: string | null;
    decided_by_name: string | null;
    decision: string;
    previous_status: string | null;
    new_status: string;
    decision_note: string | null;
  }>(
    "select decided_by, decided_by_name, decision, previous_status, new_status, decision_note from application_decisions where application_id = $1 order by created_at, id",
    [appId]
  );

const audits = () =>
  all<{
    actor_admin_user_id: string | null;
    action_type: string;
    before_data: Record<string, any>;
    after_data: Record<string, any>;
    details: Record<string, any>;
  }>(
    "select actor_admin_user_id, action_type, before_data, after_data, details from admin_audit_log order by created_at, id"
  );

/** Chạy cả file; trả các dòng tình hình của câu select cuối. */
async function run(): Promise<Array<Record<string, unknown>>> {
  const results = await db.exec(SQL);
  return results[results.length - 1].rows as Array<Record<string, unknown>>;
}

async function snapshot() {
  return {
    apps: await all("select id, status from applications order by id"),
    decisions: await all("select id, new_status from application_decisions order by id"),
    audits: await all("select id from admin_audit_log order by id")
  };
}

/** File phải dừng với đúng lý do, và sau khi huỷ giao dịch thì không còn dấu vết nào. */
async function expectRefused(reason: RegExp) {
  const before = await snapshot();
  await expect(db.exec(SQL)).rejects.toThrow(reason);
  await db.exec("rollback").catch(() => undefined);
  expect(await snapshot()).toEqual(before);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table seasons(id uuid primary key, program_id uuid not null, code text not null unique);
    create table people(id uuid primary key, full_name text not null);
    create table admin_users(id uuid primary key, full_name text, email text, role text not null, status text not null);
    create table applications(id uuid primary key default gen_random_uuid(), season_id uuid, person_id uuid references people,
      role_applied text, status text, full_name text);
    create table application_decisions(id uuid primary key default gen_random_uuid(), application_id uuid not null references applications,
      decided_by uuid, decided_by_name text, decision text not null, previous_status text, new_status text not null,
      decision_note text, created_at timestamptz default now());
    create table application_reviews(id uuid primary key default gen_random_uuid(), application_id uuid not null references applications,
      review_round text not null, reviewer_admin_user_id uuid, status text not null, submitted_at timestamptz);
    create table person_season_memberships(id uuid primary key default gen_random_uuid(), person_id uuid not null references people,
      program_id uuid not null, season_id uuid not null, role text not null, status text not null, source text not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (person_id, season_id, role));
    create table matches(id uuid primary key default gen_random_uuid(), season_id uuid, mentor_person_id uuid references people,
      mentee_person_id uuid references people);
    create table matching_round2_links(id uuid primary key default gen_random_uuid(), mentor_person_id uuid not null references people);
    -- Danh sách action_type rút gọn: đủ để chứng minh file chọn được một giá trị đang
    -- được chấp nhận thay vì đoán một giá trị rồi vỡ cả giao dịch vì 23514.
    create table admin_audit_log(id uuid primary key default gen_random_uuid(), actor_admin_user_id uuid, target_admin_user_id uuid,
      action_type text not null, details jsonb default '{}'::jsonb, before_data jsonb default '{}'::jsonb, after_data jsonb default '{}'::jsonb,
      created_at timestamptz default now(),
      constraint admin_audit_log_action_type_check check (action_type = any (array['approve_application_as_mentor','cancel_membership','update_mentor_profile','unknown'])));
  `);
}, 60000);

afterAll(async () => {
  await db?.close();
});

/** Hai đơn kẹt + một mentor lên interview_passed bằng đường thật (có phiếu phỏng vấn). */
async function seedStuck() {
  await db.query("insert into people(id, full_name) values ($1,$2),($3,$4),($5,$6)", [
    TAN.person, TAN.name, BACH.person, BACH.name, THAT.person, THAT.name
  ]);
  await db.query(
    `insert into applications(id, season_id, person_id, role_applied, status, full_name) values
       ($1,$2,$3,'mentor','interview_passed',$4),
       ($5,$2,$6,'mentor','interview_passed',$7),
       ($8,$2,$9,'mentor','interview_passed',$10)`,
    [TAN.app, S12, TAN.person, TAN.name, BACH.app, BACH.person, BACH.name, THAT.app, THAT.person, THAT.name]
  );
  // Phiếu hồ sơ đã nộp cho cả ba; phiếu phỏng vấn CHỈ mentor đi đường thật mới có.
  await db.query(
    `insert into application_reviews(application_id, review_round, reviewer_admin_user_id, status, submitted_at) values
       ($1,'profile_screening',$4,'submitted', timestamptz '2026-10-05T15:55:15+00:00'),
       ($2,'profile_screening',$4,'submitted', timestamptz '2026-10-01T12:14:41+00:00'),
       ($3,'profile_screening',$4,'submitted', timestamptz '2026-10-02T03:00:00+00:00'),
       ($3,'interview',$4,'submitted', timestamptz '2026-10-09T03:00:00+00:00')`,
    [TAN.app, BACH.app, THAT.app, REVIEWER]
  );
  for (const who of [TAN, BACH]) {
    await db.query(
      `insert into application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note, created_at) values
         ($1,$2,'Lương Quốc Vĩ','rejected_or_not_fit','screening_completed','rejected_or_not_fit','Chưa đáp ứng tiêu chí từ cấp quản lý trở lên.', timestamptz '2026-10-05T15:55:24+00:00'),
         ($1,$2,'Hoàng Nguyễn (test reviewer)','interview_passed','rejected_or_not_fit','interview_passed',$3, timestamptz '${CHANGED_AT}')`,
      [who.app, REVIEWER, `${PREV_MARKER}: theo đề nghị của team Tuyển Mentor ngày 21/10/2026.`]
    );
  }
  await db.query(
    `insert into application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, created_at) values
       ($1,$2,'Core Team','interview_passed','ready_for_final_decision','interview_passed', timestamptz '2026-10-09T04:00:00+00:00')`,
    [THAT.app, REVIEWER]
  );
}

beforeEach(async () => {
  await db.exec("rollback").catch(() => undefined);
  await db.exec(
    "truncate admin_audit_log, matching_round2_links, matches, person_season_memberships, application_reviews, application_decisions, applications, admin_users, people, seasons cascade"
  );
  await db.query("insert into seasons values ($1,$2,'UEHM-S12')", [S12, PROGRAM]);
  await db.query(
    "insert into admin_users values ($1,'Nguyễn Văn Hoàng','hoang@example.test','super_admin','active'), ($2,'Lương Quốc Vĩ','vi@example.test','reviewer','active')",
    [SUPER, REVIEWER]
  );
  await seedStuck();
});

describe("gỡ hai đơn mentor kẹt", () => {
  it("đưa đúng hai đơn về Mời phỏng vấn và không chạm mentor đi đường thật", async () => {
    const summary = await run();

    expect(await statuses()).toEqual([
      { full_name: "Mentor Phỏng Vấn Thật", status: "interview_passed" },
      { full_name: "Nguyễn Hoàng Tân", status: "invited_to_interview" },
      { full_name: "Trần Thanh Bạch", status: "invited_to_interview" }
    ]);

    for (const who of [TAN, BACH]) {
      const history = await decisionsOf(who.app);
      // Thêm một dòng, không xoá dấu vết nào của lịch sử cũ.
      expect(history).toHaveLength(3);
      expect(history.map((d) => d.new_status)).toEqual([
        "rejected_or_not_fit",
        "interview_passed",
        "invited_to_interview"
      ]);
      expect(history[2]).toMatchObject({
        decided_by: SUPER,
        decided_by_name: "Nguyễn Văn Hoàng",
        decision: "invited_to_interview",
        previous_status: "interview_passed",
        new_status: "invited_to_interview"
      });
      expect(history[2].decision_note).toContain(MARKER);
    }
    // Mentor đi đường thật: không thêm dòng quyết định nào.
    expect(await decisionsOf(THAT.app)).toHaveLength(1);

    const log = await audits();
    expect(log).toHaveLength(2);
    for (const row of log) {
      expect(row.actor_admin_user_id).toBe(SUPER);
      // Giá trị phải nằm trong từ vựng đang được chấp nhận, nếu không insert đã vỡ 23514.
      expect(["approve_application_as_mentor", "cancel_membership", "update_mentor_profile", "unknown"]).toContain(
        row.action_type
      );
      expect(row.before_data).toMatchObject({ application_status: "interview_passed" });
      expect(row.after_data).toMatchObject({ application_status: "invited_to_interview" });
      expect(row.details).toMatchObject({ marker: MARKER, season_id: S12 });
    }
    expect(log.map((r) => r.details.full_name).sort()).toEqual([TAN.name, BACH.name].sort());

    // Câu đọc cuối file nói đúng tình hình cho BTC.
    expect(summary).toHaveLength(2);
    for (const row of summary) {
      expect(row.trang_thai).toBe("invited_to_interview");
      expect(Number(row.so_phieu_pv_da_nop)).toBe(0);
      expect(row.dat_lich_duoc).toBe(true);
    }
  });

  it("chạy lại không ghi thêm gì, kể cả khi BTC đã xử lý tiếp", async () => {
    await run();
    const after = await snapshot();

    // BTC phỏng vấn và duyệt một người sau khi gỡ: lần chạy thứ hai không được kéo ngược.
    await db.query("update applications set status = 'approved_as_mentor' where id = $1", [TAN.app]);
    await run();

    expect(await one("select status from applications where id = $1", [TAN.app])).toEqual({
      status: "approved_as_mentor"
    });
    expect((await snapshot()).decisions).toHaveLength(after.decisions.length);
    expect((await snapshot()).audits).toHaveLength(after.audits.length);
  });
});

describe("dừng trước khi ghi khi tình trạng đã khác", () => {
  it("đơn đã có phiếu phỏng vấn đã nộp", async () => {
    await db.query(
      "insert into application_reviews(application_id, review_round, reviewer_admin_user_id, status, submitted_at) values ($1,'interview',$2,'submitted', now())",
      [TAN.app, REVIEWER]
    );
    await expectRefused(/đã có phiếu phỏng vấn đã nộp/);
  });

  it("phiếu phỏng vấn đang dở thì vẫn coi là kẹt — chỉ phiếu ĐÃ NỘP mới tính", async () => {
    await db.query(
      "insert into application_reviews(application_id, review_round, reviewer_admin_user_id, status) values ($1,'interview',$2,'in_progress')",
      [TAN.app, REVIEWER]
    );
    await run();
    expect(await one("select status from applications where id = $1", [TAN.app])).toEqual({
      status: "invited_to_interview"
    });
  });

  it("đơn không còn ở interview_passed", async () => {
    await db.query("update applications set status = 'waitlisted' where id = $1", [BACH.app]);
    await expectRefused(/không phải interview_passed/);
  });

  it("quyết định mới nhất không phải lần đổi 21/10", async () => {
    await db.query(
      `insert into application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, created_at)
       values ($1,$2,'Core Team','interview_passed','ready_for_final_decision','interview_passed', now())`,
      [BACH.app, REVIEWER]
    );
    await expectRefused(/không phải lần đổi/);
  });

  it("người đó đã có tư cách mentor của mùa", async () => {
    await db.query(
      "insert into person_season_memberships(person_id, program_id, season_id, role, status, source) values ($1,$2,$3,'mentor','active','application')",
      [TAN.person, PROGRAM, S12]
    );
    await expectRefused(/đã có tư cách mentor mùa này/);
  });

  it("người đó đã có cặp ghép hoặc link Vòng 2", async () => {
    await db.query("insert into matches(season_id, mentor_person_id) values ($1,$2)", [S12, TAN.person]);
    await expectRefused(/đã có cặp ghép/);

    await db.exec("delete from matches");
    await db.query("insert into matching_round2_links(mentor_person_id) values ($1)", [TAN.person]);
    await expectRefused(/link chọn mentee Vòng 2/);
  });

  it("tên không khớp đúng một đơn mentor của mùa", async () => {
    await db.query(
      "insert into applications(id, season_id, person_id, role_applied, status, full_name) values ($1,$2,$3,'mentor','submitted',$4)",
      [uuid(299), S12, THAT.person, TAN.name]
    );
    await expectRefused(/cần đúng 1/);
  });

  it("không có hoặc có nhiều super admin thì đòi điền tay, không tự chọn hộ", async () => {
    await db.query("update admin_users set status = 'disabled' where id = $1", [SUPER]);
    await expectRefused(/tài khoản super admin đang hoạt động/);

    await db.query("update admin_users set status = 'active' where id = $1", [SUPER]);
    await db.query(
      "insert into admin_users values ($1,'Super Hai','hai@example.test','super_admin','active')",
      [uuid(23)]
    );
    await expectRefused(/tài khoản super admin đang hoạt động/);
  });

  it("không thấy mùa thì dừng", async () => {
    await db.exec("update seasons set code = 'UEHM-S13'");
    await expectRefused(/không thấy mùa/);
  });
});
