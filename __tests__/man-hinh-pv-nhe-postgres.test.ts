/**
 * Màn hình phỏng vấn mentee bản gọn (migration 20261011190000, sự cố 11/10/2026:
 * database sập 6 lần vì vam104_offline_dashboard chở ~11 MB mỗi lần gọi).
 *
 * Chạy migration thật trên Postgres (PGlite), sau đúng chuỗi đã lên Production tới
 * 20261004170000 (hàm cũ đã đọc người phỏng vấn qua vam110). Hàm cũ là chuẩn đối
 * chiếu: bảng gọn phải nói ĐÚNG những điều hàm cũ nói, chỉ bớt đơn đăng ký và phiếu.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, assigned, cancelBooking, ids, offlineDb, pass, save, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(file, "utf8");
const LIGHT = read("supabase/migrations/20261011190000_man_hinh_pv_nhe.sql");
const INDEX = read("supabase/migrations/20261011160000_people_email_lookup_index.sql");
const ROLE_SPLIT = read("supabase/migrations/20261004170000_tach_4_nhom_quyen_tuyen_sinh.sql");
const HOSTS = read("supabase/migrations/20261004120000_lich_pv_mentor_tach_quyen.sql");
const STAFFING = read("supabase/migrations/20260911120000_support_team_recruitment_staffing.sql");
const SLOTS_DDL = (() => {
  const m = /create table if not exists public\.interview_slots \([\s\S]*?\n\);/i.exec(read("supabase/migrations/20260922100000_interview_slot_booking.sql"));
  if (!m) throw new Error("thiếu DDL interview_slots");
  return m[0];
})();
function fnDef(file: string, name: string) {
  const m = new RegExp(`create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$(fn|function)\\$;`, "i").exec(read(file));
  if (!m) throw new Error(`thiếu định nghĩa ${name} trong ${file}`);
  return m[0];
}
const Q = "supabase/migrations/20260905140900_s12_withdrawn_application_quarantine_restore.sql";
const P0 = "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql";
const GRANT = "supabase/migrations/20260904140000_grant_participation_scope_reuse.sql";
// Cùng chuỗi hàm nguồn với tach-4-nhom-quyen-postgres.test.ts — migration 20261004170000
// viết lại các hàm này tại chỗ nên chúng phải có mặt trước.
const SOURCE_FUNCTIONS: Array<[string, string]> = [
  [Q, "vam095_application_review_assignability"],
  [Q, "vam095_assign_application_review"],
  [Q, "vam095_save_application_review_draft"],
  [Q, "vam084_submit_application_review"],
  [Q, "vam084_change_review_assignment"],
  [Q, "vam094_assign_selected_application_reviews"],
  [P0, "vam090_bulk_assign_application_reviews"],
  [GRANT, "vam084_grant_recruitment_participation"],
  [P0, "vam084_revoke_recruitment_participation"]
];

const SUN = uuid(21); // ứng viên thứ hai, ca Chủ nhật
const HOST = uuid(70);  // bật 22/09 để phỏng vấn MENTOR, chưa phỏng vấn mentee nào
const KIET = uuid(71);  // bật 22/09, CÓ phỏng vấn mentee
const [HOSTP, KIETP, MENTEE_K] = [uuid(73), uuid(74), uuid(83)];
const SEPT = "2026-09-22T16:33:00Z";
const BOARD = "public.vam118_offline_board(uuid,uuid,uuid[],boolean)";
const DETAIL = "public.vam118_offline_candidate_detail(uuid,uuid,uuid)";

type Candidate = { id: string; name: string; sessionId: string; operation: Record<string, unknown> | null; takeSubmitted: boolean } & Record<string, unknown>;
type Board = { canOperate: boolean; sessions: unknown[]; participants: Array<Record<string, unknown>>; candidates: Candidate[]; logs: Array<Record<string, unknown>> };

let db: PGlite;

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role;");
  await db.exec(SLOTS_DDL);
  await db.exec(`
    alter table admin_users add column if not exists updated_at timestamptz;
    alter table admin_users alter column id set default gen_random_uuid();
    alter table admin_scope_access add column if not exists program_id text;
    alter table admin_scope_access add column if not exists updated_at timestamptz;
    create table admin_audit_log(id uuid primary key default gen_random_uuid(), actor_admin_user_id uuid, target_admin_user_id uuid,
      action_type text, details jsonb, created_at timestamptz default now());
    grant all on admin_audit_log to service_role;
    create or replace function public.vam084_recompute_application_review_status(uuid, text) returns void language plpgsql as $$ begin end $$;
  `);
  for (const [file, name] of SOURCE_FUNCTIONS) await db.exec(fnDef(file, name));
  await db.exec("revoke execute on all functions in schema public from public; grant execute on all functions in schema public to service_role;");
  await db.exec(STAFFING);
  // Hai migration quyền tự kiểm trên dữ liệu thật của S12: phải có người được bật
  // phỏng vấn từ 22/09 thì chúng mới chạy qua (cùng dữ liệu mẫu với bài test tách quyền).
  await db.exec(`
    insert into admin_users(id, auth_user_id, email, full_name, status, role) values
      ('${HOST}','${HOST}','host@example.test','Host 22/09','active','reviewer'),
      ('${KIET}','${KIET}','kiet@example.test','Kiệt','active','reviewer');
    insert into admin_scope_access(user_id, status, season_id, role) values
      ('${HOST}','active','${ids.season}','review'),('${KIET}','active','${ids.season}','review');
    insert into people(id, full_name, email_primary) values
      ('${HOSTP}','Host 22/09','host@example.test'),('${KIETP}','Kiệt','kiet@example.test');
    insert into person_season_memberships(person_id, program_id, season_id, role, status, created_at) values
      ('${HOSTP}','${ids.program}','${ids.season}','interviewer','active','${SEPT}'),
      ('${KIETP}','${ids.program}','${ids.season}','interviewer','active','${SEPT}');
    insert into applications(id, season_id, role_applied, status, source, full_name) values
      ('${MENTEE_K}','${ids.season}','mentee','interview_in_progress','vam_os_form','Mentee K');
    insert into application_reviews(application_id, reviewer_admin_user_id, review_round, status) values
      ('${MENTEE_K}','${KIET}','interview','submitted');
  `);
  await db.exec(HOSTS);
  await db.exec("revoke execute on all functions in schema public from public; grant execute on all functions in schema public to service_role;");
  await db.exec(ROLE_SPLIT);
  await db.exec(INDEX);
  await db.exec(LIGHT);
  await db.exec("set role service_role;");
}, 180000);
afterAll(async () => { await db?.close(); });

/** Mỗi ca chạy trong một transaction, luôn rollback — kể cả khi một câu lệnh hỏng. */
async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try { await run(); } finally { await db.exec("rollback"); }
}
async function rejects(run: () => Promise<unknown>, error: string | RegExp) {
  await db.exec("savepoint expected_failure");
  await expect(run()).rejects.toThrow(error);
  await db.exec("rollback to savepoint expected_failure");
}
async function board(actor: string, sessions: string[] | null = null, withLogs = true, season = ids.season): Promise<Board> {
  const { rows } = await db.query<{ d: Board }>("select public.vam118_offline_board($1,$2,$3::uuid[],$4) as d", [actor, season, sessions, withLogs]);
  return rows[0].d;
}
async function legacy(actor: string): Promise<Board & { candidates: Array<Candidate & { rawPayload: unknown; reviews: unknown[] }> }> {
  const { rows } = await db.query<{ d: any }>("select public.vam104_offline_dashboard($1,$2) as d", [actor, ids.season]);
  return rows[0].d;
}
async function detail(actor: string, application: string, season = ids.season) {
  const { rows } = await db.query<{ d: { id: string; rawPayload: Record<string, unknown>; reviews: Array<Record<string, unknown>> } }>(
    "select public.vam118_offline_candidate_detail($1,$2,$3) as d", [actor, season, application]
  );
  return rows[0].d;
}

describe("bảng gọn nói đúng những điều hàm cũ nói", () => {
  it("ca, người phỏng vấn, quyền vận hành, nhật ký y hệt; ứng viên chỉ bớt đơn đăng ký và phiếu chấm", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    await assigned(db);
    await save(db, "result", 2, pass, ids.mentor);
    for (const actor of [ids.support, ids.mentor, ids.btc]) {
      const before = await legacy(actor);
      const after = await board(actor);
      expect(after.canOperate).toBe(before.canOperate);
      expect(after.sessions).toEqual(before.sessions);
      expect(after.participants).toEqual(before.participants);
      expect(after.logs).toEqual(before.logs);
      expect(after.candidates.map(({ takeSubmitted: _t, ...rest }) => rest))
        .toEqual(before.candidates.map(({ rawPayload: _r, reviews: _v, ...rest }) => rest));
    }
    // Bài đối chiếu phải có nội dung thật để so, không phải hai danh sách rỗng.
    const b = await board(ids.support);
    expect(b.sessions.length).toBeGreaterThan(20);
    expect(b.participants.map((p) => p.id)).toContain(ids.mentor);
    expect(b.candidates.map((c) => c.id).sort()).toEqual([ids.app, SUN].sort());
    expect(b.logs.map((l) => l.action).sort()).toEqual(["assign", "checkin", "result"]);
  }));

  it("ứng viên KHÔNG mang đơn đăng ký hay phiếu chấm — kể cả sau khi đã có kết quả", () => isolated(async () => {
    await assigned(db);
    await save(db, "result", 2, pass, ids.mentor);
    const { candidates } = await board(ids.support);
    expect(Object.keys(candidates[0]).sort()).toEqual(
      ["bookedAt", "email", "id", "name", "operation", "phone", "sessionId", "status", "takeSubmitted"]
    );
    const text = JSON.stringify(candidates);
    expect(text).not.toContain("Học hỏi");          // raw_payload.goal
    // operation.outcome_reason (lý do chốt) vẫn đi theo dòng — màn hình cần nó; còn nội dung PHIẾU thì không.
    expect(text).not.toContain("Khám phá hướng nghề"); // nhu cầu phát triển trong phiếu
    expect(text).not.toContain("Tự đặt lịch");          // ghi chú một tiêu chí
    expect(text).not.toContain("Thiên về coaching");    // chân dung mentor trong phiếu
    // Hàm cũ thì có — nếu câu trên xanh chỉ vì dữ liệu mẫu không chứa các chuỗi này thì bài test vô nghĩa.
    const old = JSON.stringify((await legacy(ids.support)).candidates);
    expect(old).toContain("Học hỏi");
    expect(old).toContain("Khám phá hướng nghề");
    expect(old).toContain("Tự đặt lịch");
  }));
});

describe("lọc theo ca và nhật ký", () => {
  it("p_sessions: chỉ ứng viên đang giữ đúng các ca đó; null = cả mùa; mảng rỗng = không ai", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    const who = async (sessions: string[] | null) => (await board(ids.support, sessions)).candidates.map((c) => c.id).sort();
    expect(await who([ids.session])).toEqual([ids.app]);
    expect(await who([ids.sessionSun])).toEqual([SUN]);
    expect(await who([ids.session, ids.sessionSun])).toEqual([ids.app, SUN].sort());
    expect(await who(null)).toEqual([ids.app, SUN].sort());
    expect(await who([])).toEqual([]);
    // Lọc ứng viên không lọc danh sách ca: form "Đổi ca" vẫn cần mọi ca của mùa.
    expect((await board(ids.support, [ids.session])).sessions).toEqual((await board(ids.support)).sessions);
  }));

  it("lịch đã huỷ không còn trong danh sách", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    await cancelBooking(db, "Bận đột xuất", ids.support, SUN);
    expect((await board(ids.support)).candidates.map((c) => c.id)).toEqual([ids.app]);
  }));

  it("p_with_logs = false: không nhật ký (trang Tiến độ); true: có", () => isolated(async () => {
    await save(db, "checkin", 0);
    expect((await board(ids.support, null, true)).logs.map((l) => l.action)).toEqual(["checkin"]);
    const lean = await board(ids.support, null, false);
    expect(lean.logs).toEqual([]);
    // Bỏ nhật ký không được bỏ theo thứ khác.
    expect(lean.candidates.map((c) => c.id)).toEqual([ids.app]);
    expect(lean.candidates[0].operation?.checked_in_at).toBeTruthy();
  }));
});

describe("takeSubmitted — thay cho việc gửi cả phiếu chỉ để đếm", () => {
  it("chỉ true khi phiếu của lượt phỏng vấn ĐÃ NỘP và chọn “Có – Tôi muốn nhận”", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    const flag = async () => Object.fromEntries((await board(ids.mentor)).candidates.map((c) => [c.id, c.takeSubmitted]));
    expect(await flag()).toEqual({ [ids.app]: false, [SUN]: false });
    await assigned(db);
    // Đã phân người phỏng vấn, phiếu mới ở trạng thái 'assigned' — chưa nộp thì chưa tính.
    expect(await flag()).toEqual({ [ids.app]: false, [SUN]: false });
    await save(db, "result", 2, pass, ids.mentor);
    expect(await flag()).toEqual({ [ids.app]: true, [SUN]: false });
    // Đạt nhưng giới thiệu cho mentor khác: không tính.
    await assigned(db, SUN);
    await save(db, "result", 2, { ...pass, takeChoice: "recommend_other" }, ids.mentor, SUN);
    expect(await flag()).toEqual({ [ids.app]: true, [SUN]: false });
    // Sửa kết quả thành không chọn: lựa chọn nhận mất theo.
    await save(db, "result", 3, { ...pass, outcome: "rejected", takeChoice: null, reason: "Chọn nhầm" }, ids.mentor);
    expect(await flag()).toEqual({ [ids.app]: false, [SUN]: false });
  }));

  it("phiếu chọn nhận nhưng CHƯA nộp, hoặc đã nộp nhưng không phải phiếu của lượt phỏng vấn này: không tính", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    await assigned(db);
    await assigned(db, SUN);
    // Trigger của luồng phỏng vấn trực tiếp chặn sửa tay các phiếu này (OFFLINE_REVIEW_USE_WORKFLOW)
    // — đường ghi thật không tạo ra hai trạng thái dưới đây. Tắt trigger để dựng chúng: hàm đọc
    // vẫn phải đúng nếu dữ liệu từng lệch (nhập tay, luồng cũ).
    await db.exec("reset role; set session_replication_role = replica;");
    // ids.app: đúng phiếu của lượt, có lựa chọn nhận, nhưng còn ở trạng thái 'assigned'.
    await db.query("update application_reviews set take_choice='take' where id=(select review_id from mentee_interview_operations where id=$1)", [ids.app]);
    // SUN: một phiếu ĐÃ NỘP chọn nhận của người khác, không phải phiếu mà lượt phỏng vấn đang trỏ tới.
    await db.query(
      "insert into application_reviews(application_id, reviewer_admin_user_id, review_round, status, take_choice) values ($1,$2,'interview','submitted','take')",
      [SUN, ids.btc]
    );
    await db.exec("set session_replication_role = origin; set role service_role;");
    const flags = Object.fromEntries((await board(ids.mentor)).candidates.map((c) => [c.id, c.takeSubmitted]));
    expect(flags).toEqual({ [ids.app]: false, [SUN]: false });
    // Dữ liệu dựng tay ở trên phải đúng là thứ đang soi, không phải hai dòng vô can.
    await db.exec("reset role;");
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from application_reviews where take_choice='take' and application_id = any($1::uuid[])", [[ids.app, SUN]]
    );
    await db.exec("set role service_role;");
    expect(rows[0].n).toBe(2);
  }));

  it("khớp cách đếm cũ trên từng ứng viên (phiếu của lượt, đã nộp, chọn nhận)", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    await assigned(db);
    await save(db, "result", 2, pass, ids.mentor);
    await assigned(db, SUN);
    await save(db, "result", 2, { ...pass, takeChoice: "undecided" }, ids.mentor, SUN);
    const old = await legacy(ids.mentor);
    const expected = Object.fromEntries(old.candidates.map((c: any) => [
      c.id,
      c.reviews.some((r: any) => r.id === c.operation?.review_id && r.status === "submitted" && r.take_choice === "take")
    ]));
    expect(expected).toEqual({ [ids.app]: true, [SUN]: false });
    expect(Object.fromEntries((await board(ids.mentor)).candidates.map((c) => [c.id, c.takeSubmitted]))).toEqual(expected);
  }));
});

describe("hồ sơ chi tiết của một ứng viên", () => {
  it("trả đúng đơn đăng ký và phiếu chấm mà hàm cũ từng gửi kèm cho bạn đó", () => isolated(async () => {
    await assigned(db);
    await save(db, "result", 2, pass, ids.mentor);
    const old = (await legacy(ids.mentor)).candidates.find((c) => c.id === ids.app)!;
    const d = await detail(ids.mentor, ids.app);
    expect(d.id).toBe(ids.app);
    expect(d.rawPayload).toEqual({ goal: "Học hỏi" });
    expect(d.rawPayload).toEqual(old.rawPayload);
    expect(d.reviews).toEqual(old.reviews);
    expect(d.reviews).toHaveLength(1);
    expect(d.reviews[0]).toMatchObject({ review_round: "interview", status: "submitted", take_choice: "take", reviewer_note: "Có động lực", reviewerName: "Mentor" });
  }));

  it("phiếu đã huỷ không đi kèm; chưa có phiếu nào thì mảng rỗng", () => isolated(async () => {
    expect((await detail(ids.support, ids.app)).reviews).toEqual([]);
    await db.exec("reset role;");
    await db.query(
      "insert into application_reviews(application_id, reviewer_admin_user_id, review_round, status, reviewer_note) values ($1,$2,'profile_screening','cancelled','Phiếu đã huỷ'), ($1,$3,'profile_screening','submitted','Phiếu còn hiệu lực')",
      [ids.app, ids.other, ids.btc]
    );
    await db.exec("set role service_role;");
    const notes = (await detail(ids.support, ids.app)).reviews.map((r) => r.reviewer_note);
    expect(notes).toEqual(["Phiếu còn hiệu lực"]);
  }));

  it("chỉ mở được hồ sơ đang giữ ca trong mùa: đã huỷ lịch, hồ sơ không tồn tại, hỏi nhầm mùa → NO_BOOKING", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    expect((await detail(ids.support, SUN)).id).toBe(SUN);
    await cancelBooking(db, "Bận đột xuất", ids.support, SUN);
    await rejects(() => detail(ids.support, SUN), "NO_BOOKING");
    await rejects(() => detail(ids.support, uuid(999)), "NO_BOOKING");
    // ids.btc vận hành cả mùa kế, nhưng hồ sơ này giữ ca của Mùa 12.
    await rejects(() => detail(ids.btc, ids.app, ids.seasonNext), "NO_BOOKING");
    expect((await detail(ids.btc, ids.app)).id).toBe(ids.app);
  }));
});

describe("cổng quyền", () => {
  it("cùng cổng với hàm cũ: Support và người phỏng vấn mentee vào được, người ngoài bị chặn ở CẢ hai hàm", () => isolated(async () => {
    expect((await board(ids.support)).canOperate).toBe(true);
    expect((await board(ids.mentor)).canOperate).toBe(false);
    expect((await detail(ids.mentor, ids.app)).id).toBe(ids.app);
    await rejects(() => board(ids.other), "ACCESS_DENIED");
    await rejects(() => detail(ids.other, ids.app), "ACCESS_DENIED");
    // Người có quyền ở mùa này không vì thế mà đọc được mùa khác.
    await rejects(() => board(ids.support, null, true, ids.seasonNext), "ACCESS_DENIED");
    await rejects(() => detail(ids.support, ids.app, ids.seasonNext), "ACCESS_DENIED");
    // Hàm cũ chặn đúng những người đó — nếu không, hai dòng trên chỉ đang kiểm dữ liệu mẫu.
    await rejects(() => db.query("select public.vam104_offline_dashboard($1,$2)", [ids.other, ids.season]), "ACCESS_DENIED");
  }));

  it("chỉ máy chủ gọi được: anon và authenticated không có quyền EXECUTE, hàm chạy bằng quyền người gọi", () => isolated(async () => {
    await db.exec("reset role;");
    const { rows } = await db.query<{ fn: string; anon: boolean; auth: boolean; service: boolean; definer: boolean }>(
      `select f as fn, has_function_privilege('anon', f, 'execute') as anon, has_function_privilege('authenticated', f, 'execute') as auth,
              has_function_privilege('service_role', f, 'execute') as service,
              (select prosecdef from pg_proc where oid = to_regprocedure(f)) as definer
         from unnest($1::text[]) f`, [[BOARD, DETAIL]]
    );
    expect(rows).toEqual([
      { fn: BOARD, anon: false, auth: false, service: true, definer: false },
      { fn: DETAIL, anon: false, auth: false, service: true, definer: false }
    ]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role};`);
      await rejects(() => db.query("select public.vam118_offline_board($1,$2)", [ids.support, ids.season]), /permission denied/);
      await rejects(() => db.query("select public.vam118_offline_candidate_detail($1,$2,$3)", [ids.support, ids.season, ids.app]), /permission denied/);
      await db.exec("reset role;");
    }
  }));
});

describe("migration", () => {
  it("dán lại không sao, và không đụng tới hàm cũ", () => isolated(async () => {
    await db.exec("reset role;");
    const def = async () => (await db.query<{ d: string }>("select pg_get_functiondef('public.vam104_offline_dashboard(uuid,uuid)'::regprocedure) as d")).rows[0].d;
    const before = await def();
    await db.exec(LIGHT);
    await db.exec(LIGHT);
    expect(await def()).toBe(before);
    await db.exec("set role service_role;");
    expect((await board(ids.support)).candidates.map((c) => c.id)).toEqual([ids.app]);
  }));

  it("khối tự kiểm báo lỗi nếu hàm cũ đã bị gỡ — báo cáo phỏng vấn vẫn đọc nó", () => isolated(async () => {
    await db.exec("reset role;");
    await db.exec("drop function public.vam104_offline_dashboard(uuid,uuid);");
    await rejects(() => db.exec(LIGHT), /vam104_offline_dashboard đã bị gỡ/);
  }));

  it("chỉ mục tra người theo email: đầy đủ (không WHERE) trên đúng biểu thức hàm dùng; dán lại không sao", () => isolated(async () => {
    await db.exec("reset role;");
    await db.exec(INDEX);
    const { rows } = await db.query<{ indexdef: string; partial: boolean }>(
      `select pg_get_indexdef(i.indexrelid) as indexdef, i.indpred is not null as partial
         from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'people_email_canonical_lookup_idx'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].partial).toBe(false);
    expect(rows[0].indexdef.replace(/\s+/g, " ")).toContain("ON public.people USING btree (lower(btrim(email_primary)))");
  }));
});
