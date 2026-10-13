/**
 * SQL dữ liệu 20261011100000 — hoàn một lần duyệt nhầm đơn mentor mùa 12 (BTC 11/10/2026).
 * Chạy THẬT trên PostgreSQL (PGlite). Bảng dựng tối thiểu; trigger vam108 và ba ràng buộc
 * của person_season_memberships / admin_audit_log chép từ production (đọc 11/10/2026), vì
 * lý do chọn XOÁ dòng tư cách thay vì đổi trạng thái nằm đúng ở "on conflict do nothing"
 * của trigger đó.
 *
 * Điều phải đúng: đơn về chờ BTC chốt; dòng tư cách do lần duyệt nhầm tạo biến mất còn
 * hồ sơ người, mentor profile, nhóm ngành ở lại; duyệt lại sau đó tạo được tư cách mới;
 * chạy lại không gỡ lần duyệt thật; tình trạng khác với lúc duyệt nhầm thì không ghi gì.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(path.resolve("supabase/migrations/20261011100000_hoan_duyet_nham_mentor_chua_du_orientation.sql"), "utf8");
const APP = "1f05fe24-4858-4526-aa5b-7adf573cd9cd";
const PERSON = "8d94e96e-3d7b-4138-848f-547c93c481a0";
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const WRONG = "40913783-7da7-4bed-9c0a-9a27fe9a1603";
const ACTOR = "a3f45586-8747-49d9-860a-4b903cfdc7bc";
const APPROVER = "0cbe980a-6027-4645-828d-d994a1a38869";
const PROGRAM = "61701ee8-64a6-4673-b261-ba12ce9a3ee3";
const S11 = "00000000-0000-4000-8000-000000000011";
const MARKER = "HOAN_DUYET_NHAM_2026_10_11";
const WRONG_AT = "2026-10-10T06:03:54.494019+00:00";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OTHER_PERSON = uuid(2);
const OTHER_APP = uuid(102);

let db: PGlite;

type Decision = { id: string; decided_by: string | null; decided_by_name: string | null; decision: string; previous_status: string | null; new_status: string; decision_note: string | null };
type Membership = { id: string; person_id: string; season_id: string; role: string; status: string; source: string };
type Audit = { actor_admin_user_id: string | null; action_type: string; before_data: Record<string, any>; after_data: Record<string, any>; details: Record<string, any> };

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const appStatus = async (id = APP) => (await one<{ status: string; person_id: string | null }>("select status, person_id from applications where id = $1", [id]));
const decisions = () => all<Decision>("select id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note from application_decisions where application_id = $1 order by created_at, id", [APP]);
const memberships = (personId = PERSON) => all<Membership>("select id, person_id, season_id, role, status, source from person_season_memberships where person_id = $1 order by season_id, role", [personId]);
const audits = () => all<Audit>("select actor_admin_user_id, action_type, before_data, after_data, details from admin_audit_log order by created_at, id");

/** Chạy cả file; trả dòng tình hình của câu select cuối. */
async function run() {
  const results = await db.exec(SQL);
  return results[results.length - 1].rows[0] as Record<string, unknown>;
}

/** File phải dừng với đúng lý do, và sau khi huỷ giao dịch thì không còn dấu vết nào. */
async function expectRefused(reason: RegExp) {
  const before = await snapshot();
  await expect(db.exec(SQL)).rejects.toThrow(reason);
  await db.exec("rollback");
  expect(await snapshot()).toEqual(before);
}

async function snapshot() {
  return {
    apps: await all("select id, status, person_id from applications order by id"),
    decisions: await all("select id, new_status from application_decisions order by id"),
    memberships: await all("select id, status, role, season_id from person_season_memberships order by id"),
    audits: await all("select id from admin_audit_log order by id")
  };
}

/** Đúng tình trạng production lúc 09:43 11/10/2026, cộng một mentor khác để soi "không chạm ai khác". */
async function seedWrongApproval() {
  await db.query("insert into people(id, full_name) values ($1, 'Mentor Duyệt Nhầm'), ($2, 'Mentor Khác')", [PERSON, OTHER_PERSON]);
  await db.query("insert into mentor_profiles(id, person_id) values ($1, $2), ($3, $4)", [uuid(201), PERSON, uuid(202), OTHER_PERSON]);
  // Chèn thẳng ở trạng thái đã duyệt: trigger vam108 chỉ chạy khi UPDATE, nên dòng tư cách
  // được dựng tay bên dưới với đúng mốc giờ của giao dịch duyệt nhầm.
  await db.query(
    "insert into applications(id, season_id, person_id, role_applied, status, full_name) values ($1, $2, $3, 'mentor', 'approved_as_mentor', 'Mentor Duyệt Nhầm'), ($4, $2, $5, 'mentor', 'approved_as_mentor', 'Mentor Khác')",
    [APP, S12, PERSON, OTHER_APP, OTHER_PERSON]
  );
  await db.query(
    `insert into application_decisions(id, application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note, created_at) values
       ($1, $2, null, 'Hệ thống đặt lịch phỏng vấn', 'interview_scheduled', 'invited_to_interview', 'interview_scheduled', null, timestamptz '2026-09-25T06:47:46+00:00'),
       ($3, $2, $4, 'UEH Mentoring Admin', 'interview_passed', 'ready_for_final_decision', 'interview_passed', null, timestamptz '2026-10-10T06:03:47.519532+00:00'),
       ($5, $2, $4, 'UEH Mentoring Admin', 'approved_as_mentor', 'interview_passed', 'approved_as_mentor', 'Approved as mentor.', timestamptz '${WRONG_AT}')`,
    [uuid(301), APP, uuid(302), APPROVER, WRONG]
  );
  await db.query(
    `insert into person_season_memberships(id, person_id, program_id, season_id, role, status, source, notes, created_at, updated_at) values
       ($1, $2, $3, $4, 'mentor', 'active', 'application', 'Tự tạo khi duyệt chính thức đơn mentor', timestamptz '${WRONG_AT}', timestamptz '${WRONG_AT}'),
       ($5, $6, $3, $4, 'mentor', 'active', 'application', 'Tự tạo khi duyệt chính thức đơn mentor', timestamptz '2026-10-03T02:00:00+00:00', timestamptz '2026-10-03T02:00:00+00:00')`,
    [uuid(401), PERSON, PROGRAM, S12, uuid(402), OTHER_PERSON]
  );
  await db.query("insert into matching_industry_assignments(season_id, person_id, role, group_code) values ($1, $2, 'mentor', 5), ($1, $3, 'mentor', 4)", [S12, PERSON, OTHER_PERSON]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table seasons(id uuid primary key, program_id uuid not null);
    create table people(id uuid primary key, full_name text not null);
    create table admin_users(id uuid primary key, full_name text, email text, status text not null);
    create table applications(id uuid primary key default gen_random_uuid(), season_id uuid, person_id uuid references people,
      role_applied text, status text, full_name text);
    create table application_decisions(id uuid primary key default gen_random_uuid(), application_id uuid not null references applications,
      decided_by uuid, decided_by_name text, decision text not null, previous_status text, new_status text not null,
      decision_note text, created_at timestamptz default now());
    create table person_season_memberships(id uuid primary key default gen_random_uuid(), person_id uuid not null references people,
      program_id uuid not null, season_id uuid not null, role text not null, status text not null, source text not null, notes text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (person_id, season_id, role),
      check (role = any (array['mentee','mentor','supporter','reviewer','interviewer','coreteam','advisor','alumni_mentee','guest','trainer','speaker','mentor_reviewer','mentor_interviewer'])),
      check (source = any (array['manual','application','profile','match','event','backfill','rollover','system'])),
      check (status = any (array['invited','active','paused','withdrawn','completed','graduated','opted_out','cancelled'])));
    create table mentor_profiles(id uuid primary key, person_id uuid not null references people);
    create table matches(id uuid primary key default gen_random_uuid(), season_id uuid, mentor_person_id uuid references people,
      mentee_person_id uuid references people, status text);
    create table matching_round2_links(id uuid primary key default gen_random_uuid(), mentor_person_id uuid not null references people);
    create table matching_industry_assignments(season_id uuid not null, person_id uuid not null references people, role text not null,
      group_code integer not null, unique (season_id, person_id, role));
    -- Danh sách action_type rút gọn: chỉ cần chứng minh giá trị file dùng được chấp nhận
    -- và một giá trị bịa thì không.
    create table admin_audit_log(id uuid primary key default gen_random_uuid(), actor_admin_user_id uuid, target_admin_user_id uuid,
      action_type text not null, details jsonb default '{}'::jsonb, before_data jsonb default '{}'::jsonb, after_data jsonb default '{}'::jsonb,
      created_at timestamptz default now(),
      constraint admin_audit_log_action_type_check check (action_type = any (array['approve_application_as_mentor','cancel_membership','update_mentor_profile','unknown'])));

    -- Chép nguyên từ production (pg_get_functiondef, 11/10/2026).
    create function vam108_mentor_approval_membership() returns trigger language plpgsql security definer set search_path to '' as $function$
    declare
      v_program uuid;
    begin
      if new.status = 'approved_as_mentor'
         and lower(coalesce(new.role_applied::text, '')) = 'mentor'
         and new.person_id is not null
         and new.season_id is not null
         and (old.status is distinct from new.status or old.person_id is distinct from new.person_id) then
        select s.program_id into v_program from public.seasons s where s.id = new.season_id;
        insert into public.person_season_memberships (
          person_id, program_id, season_id, role, status, source, notes
        ) values (
          new.person_id, v_program, new.season_id, 'mentor', 'active', 'application',
          'Tự tạo khi duyệt chính thức đơn mentor'
        )
        on conflict (person_id, season_id, role) do nothing;
      end if;
      return new;
    end;
    $function$;
    create trigger vam108_mentor_approval_membership after update of status, person_id on applications
      for each row execute function vam108_mentor_approval_membership();
  `);
}, 60000);
afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Một ca hỏng giữa giao dịch không được kéo theo ca sau.
  await db.exec("rollback").catch(() => undefined);
  await db.exec("truncate admin_audit_log, matching_industry_assignments, matching_round2_links, matches, mentor_profiles, person_season_memberships, application_decisions, applications, admin_users, people, seasons cascade");
  await db.query("insert into seasons values ($1, $2), ($3, $2)", [S12, PROGRAM, S11]);
  await db.query("insert into admin_users values ($1, 'Hoàng Nguyễn', 'hoang@example.test', 'active'), ($2, 'UEH Mentoring Admin', 'admin@example.test', 'active')", [ACTOR, APPROVER]);
  await seedWrongApproval();
});

describe("hoàn lần duyệt nhầm đơn mentor", () => {
  it("đưa đơn về chờ BTC chốt, xoá đúng dòng tư cách tự tạo, giữ hồ sơ để duyệt lại", async () => {
    const summary = await run();

    expect(await appStatus()).toEqual({ status: "ready_for_final_decision", person_id: PERSON });
    expect(await memberships()).toEqual([]);
    expect(await one<{ n: number }>("select count(*)::int as n from people where id = $1", [PERSON])).toEqual({ n: 1 });
    expect(await all("select id from mentor_profiles where person_id = $1", [PERSON])).toEqual([{ id: uuid(201) }]);
    expect(await all("select group_code from matching_industry_assignments where person_id = $1", [PERSON])).toEqual([{ group_code: 5 }]);

    const history = await decisions();
    expect(history).toHaveLength(4);
    expect(history[3]).toMatchObject({
      decided_by: ACTOR, decided_by_name: "Hoàng Nguyễn", decision: "ready_for_final_decision",
      previous_status: "approved_as_mentor", new_status: "ready_for_final_decision"
    });
    expect(history[3].decision_note).toContain(MARKER);
    // Lịch sử cũ còn nguyên: hoàn duyệt là thêm một dòng, không xoá dấu vết lần duyệt nhầm.
    expect(history.slice(0, 3).map((d) => d.new_status)).toEqual(["interview_scheduled", "interview_passed", "approved_as_mentor"]);

    const log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_admin_user_id: ACTOR, action_type: "cancel_membership" });
    // Dòng bị xoá nằm nguyên trong log — đủ để dựng lại nếu cần.
    expect(log[0].before_data.membership).toMatchObject({ id: uuid(401), person_id: PERSON, season_id: S12, role: "mentor", status: "active", source: "application" });
    expect(log[0].before_data.application_status).toBe("approved_as_mentor");
    expect(log[0].after_data).toEqual({ application_status: "ready_for_final_decision", membership: null });
    expect(log[0].details).toMatchObject({ marker: MARKER, application_id: APP, person_id: PERSON, season_id: S12, reverted_decision_id: WRONG });

    expect(summary).toMatchObject({
      mentor: "Mentor Duyệt Nhầm", trang_thai_don: "ready_for_final_decision", nhom_nganh_giu_lai: 5
    });
    expect(Number(summary.so_tu_cach_mentor_mua)).toBe(0);
    expect(Number(summary.so_mentor_profile)).toBe(1);
    // Còn đúng một đơn mentor đã duyệt trong mùa: mentor kia.
    expect(Number(summary.tong_don_mentor_da_duyet)).toBe(1);
  });

  it("không chạm mentor khác, cũng không chạm tư cách khác của chính người này", async () => {
    await db.query(
      `insert into person_season_memberships(id, person_id, program_id, season_id, role, status, source) values
         ($1, $2, $3, $4, 'mentor_interviewer', 'active', 'manual'),
         ($5, $2, $3, $6, 'mentor', 'completed', 'backfill')`,
      [uuid(411), PERSON, PROGRAM, S12, uuid(412), S11]
    );

    await run();

    expect(await appStatus(OTHER_APP)).toEqual({ status: "approved_as_mentor", person_id: OTHER_PERSON });
    expect(await memberships(OTHER_PERSON)).toEqual([{ id: uuid(402), person_id: OTHER_PERSON, season_id: S12, role: "mentor", status: "active", source: "application" }]);
    expect((await memberships()).map((m) => m.id).sort()).toEqual([uuid(411), uuid(412)]);
    expect(await all("select group_code from matching_industry_assignments where person_id = $1", [OTHER_PERSON])).toEqual([{ group_code: 4 }]);
  });

  it("sau khi hoàn, BTC duyệt lại thì trigger vam108 tạo được tư cách mới đang hoạt động", async () => {
    await run();

    await db.query("update applications set status = 'interview_passed' where id = $1", [APP]);
    await db.query("update applications set status = 'approved_as_mentor' where id = $1", [APP]);

    const rows = await memberships();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ person_id: PERSON, season_id: S12, role: "mentor", status: "active", source: "application" });
    // Dòng mới, không phải dòng cũ sống lại.
    expect(rows[0].id).not.toBe(uuid(401));
  });

  it("chạy lại lần hai: không thêm quyết định, không thêm log, tình trạng giữ nguyên", async () => {
    await run();
    const summary = await run();

    expect(await appStatus()).toEqual({ status: "ready_for_final_decision", person_id: PERSON });
    expect(await decisions()).toHaveLength(4);
    expect(await audits()).toHaveLength(1);
    expect(summary).toMatchObject({ trang_thai_don: "ready_for_final_decision" });
  });

  it("chạy lại SAU KHI BTC đã duyệt lại đàng hoàng: không gỡ lần duyệt thật", async () => {
    await run();
    await db.query("update applications set status = 'interview_passed' where id = $1", [APP]);
    await db.query("update applications set status = 'approved_as_mentor' where id = $1", [APP]);
    await db.query(
      "insert into application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status) values ($1, $2, 'UEH Mentoring Admin', 'approved_as_mentor', 'interview_passed', 'approved_as_mentor')",
      [APP, APPROVER]
    );

    const summary = await run();

    expect(await appStatus()).toEqual({ status: "approved_as_mentor", person_id: PERSON });
    expect((await memberships()).map((m) => m.status)).toEqual(["active"]);
    expect(await decisions()).toHaveLength(5);
    expect(await audits()).toHaveLength(1);
    expect(Number(summary.so_tu_cach_mentor_mua)).toBe(1);
  });

  it("dòng tư cách đã bị ai đó gỡ trước: vẫn hoàn đơn, log ghi rõ không có dòng nào bị xoá", async () => {
    await db.query("delete from person_season_memberships where id = $1", [uuid(401)]);

    await run();

    expect(await appStatus()).toEqual({ status: "ready_for_final_decision", person_id: PERSON });
    const log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0].before_data.membership).toBeNull();
  });
});

describe("tình trạng khác với lúc duyệt nhầm: dừng, không ghi gì", () => {
  it("đơn không còn ở trạng thái đã duyệt", async () => {
    await db.query("update applications set status = 'rejected_or_not_fit' where id = $1", [APP]);
    await expectRefused(/PRECHECK: đơn không còn ở đúng tình trạng/);
  });

  it("đơn thuộc mùa khác", async () => {
    await db.query("update applications set season_id = $2 where id = $1", [APP, S11]);
    await expectRefused(/PRECHECK: đơn không còn ở đúng tình trạng/);
  });

  it("đơn không phải đơn mentor", async () => {
    await db.query("update applications set role_applied = 'mentee' where id = $1", [APP]);
    await expectRefused(/PRECHECK: đơn không còn ở đúng tình trạng/);
  });

  it("đơn đã được nối sang hồ sơ người khác", async () => {
    await db.query("update applications set person_id = $2 where id = $1", [APP, OTHER_PERSON]);
    await expectRefused(/PRECHECK: đơn không còn ở đúng tình trạng/);
  });

  it("không tìm thấy đơn", async () => {
    await db.query("delete from application_decisions where application_id = $1", [APP]);
    await db.query("delete from applications where id = $1", [APP]);
    await expectRefused(/PRECHECK: không tìm thấy đơn/);
  });

  it("đã có quyết định khác sau lần duyệt nhầm", async () => {
    // Một lần duyệt khác, cùng nội dung nhưng KHÔNG phải dòng đã ghim: vẫn phải dừng.
    await db.query(
      "insert into application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status) values ($1, $2, 'UEH Mentoring Admin', 'approved_as_mentor', 'interview_passed', 'approved_as_mentor')",
      [APP, APPROVER]
    );
    await expectRefused(/PRECHECK: quyết định mới nhất của đơn không phải lần duyệt nhầm/);
  });

  it("trước lần duyệt nhầm không phải bước từ chờ BTC chốt", async () => {
    await db.query("update application_decisions set previous_status = 'needs_more_review' where id = $1", [uuid(302)]);
    await expectRefused(/PRECHECK: không thấy bước "ready_for_final_decision"/);
  });

  it("bước 'qua phỏng vấn' có từ nhiều ngày trước, không thuộc phiên bấm nhầm", async () => {
    await db.query("update application_decisions set created_at = timestamptz '2026-10-01T06:00:00+00:00' where id = $1", [uuid(302)]);
    await expectRefused(/PRECHECK: không thấy bước "ready_for_final_decision"/);
  });

  it("mentor đã có cặp ghép trong mùa — kể cả cặp đã kết thúc", async () => {
    await db.query("insert into matches(season_id, mentor_person_id, mentee_person_id, status) values ($1, $2, $3, 'dropped')", [S12, PERSON, OTHER_PERSON]);
    await expectRefused(/PRECHECK: mentor này đã có cặp ghép/);
  });

  it("cặp ghép của mùa khác hay của mentor khác không cản", async () => {
    await db.query("insert into matches(season_id, mentor_person_id, mentee_person_id, status) values ($1, $2, $3, 'active'), ($4, $3, $2, 'active')", [S11, PERSON, OTHER_PERSON, S12]);
    await run();
    expect(await appStatus()).toMatchObject({ status: "ready_for_final_decision" });
  });

  it("mentor đã được tạo link Vòng 2", async () => {
    await db.query("insert into matching_round2_links(mentor_person_id) values ($1)", [PERSON]);
    await expectRefused(/PRECHECK: mentor này đã được tạo link chọn mentee Vòng 2/);
  });

  it("tài khoản đứng tên không còn hoạt động", async () => {
    await db.query("update admin_users set status = 'inactive' where id = $1", [ACTOR]);
    await expectRefused(/PRECHECK: không thấy tài khoản super admin/);
  });

  it.each([
    ["nguồn không phải do duyệt đơn", "source = 'manual'"],
    ["đã bị tạm dừng", "status = 'paused'"],
    ["tạo vào lúc khác với lần duyệt nhầm", "created_at = timestamptz '2026-10-03T02:00:00+00:00', updated_at = timestamptz '2026-10-03T02:00:00+00:00'"],
    ["đã có người sửa sau khi tạo", "updated_at = created_at + interval '1 hour'"]
  ])("dòng tư cách mentor %s", async (_label, change) => {
    await db.exec(`update person_season_memberships set ${change} where id = '${uuid(401)}'`);
    await expectRefused(/PRECHECK: dòng tư cách mentor mùa này không phải dòng do lần duyệt nhầm tạo/);
  });
});
