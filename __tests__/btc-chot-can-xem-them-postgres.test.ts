/**
 * BTC chốt kết quả cho hồ sơ mentee "Cần BTC xem xét thêm" (migration 20261012230000).
 *
 * 12/10/2026: 103 hồ sơ kẹt ở "cần xem thêm" — Core team có quyền quyết định nhưng mọi lối
 * trong luật trạng thái đều bị chặn, chỉ người đã phỏng vấn sửa được. Bộ test chạy migration
 * thật trên Postgres (PGlite), sau đúng chuỗi đã lên production, và soi CHÍNH các dòng hàm
 * ghi ra: hồ sơ, người, mentee profile, tư cách mùa, quyết định, nhật ký — và phiếu của
 * người phỏng vấn không bị đụng tới.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, assigned, ids, pass, save, uuid } from "./support/offline-postgres";
import { offlineDbRoleSplit } from "./support/offline-postgres-role-split";

const read = (file: string) => readFileSync(file, "utf8");
const INDEX = read("supabase/migrations/20261011160000_people_email_lookup_index.sql");
const LIGHT = read("supabase/migrations/20261011190000_man_hinh_pv_nhe.sql");
const MIGRATION = read("supabase/migrations/20261012230000_btc_chot_ho_so_can_xem_them.sql");
const FN = "public.vam119_btc_decide_needs_review(uuid,uuid,integer,text,text)";

const SUN = uuid(21);        // ứng viên thứ hai, ca Chủ nhật
const CORE_NO_SCOPE = uuid(60); // Core team nhưng không có quyền vận hành mùa này
// Hàm chứ không phải hằng: id + phiên bản phiếu trong `pass` chỉ có sau khi database dựng xong.
const needsReview = () => ({ ...pass, outcome: "needs_review", takeChoice: "undecided" });
const REASON = "Đọc lại phiếu: mục tiêu rõ, đủ cam kết";

let db: PGlite;

beforeAll(async () => {
  db = await offlineDbRoleSplit();
  await db.exec(INDEX);
  await db.exec(LIGHT);
  await db.exec(MIGRATION);
  await db.exec(`insert into admin_users(id, auth_user_id, email, full_name, status, role)
    values ('${CORE_NO_SCOPE}','${CORE_NO_SCOPE}','core2@example.test','Core không scope','active','core_team');`);
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
/** Chạy một đoạn bằng quyền superuser (dựng dữ liệu mà đường ghi thật không tạo ra), rồi trả về service_role. */
async function asOwner(run: () => Promise<void>) {
  await db.exec("reset role;");
  try { await run(); } finally { await db.exec("set role service_role;"); }
}
/** Đưa một ứng viên tới đúng trạng thái của 103 hồ sơ: người phỏng vấn nộp phiếu "Cần BTC xem xét thêm". Phiên bản sau đó là 3. */
async function toNeedsReview(app = ids.app) {
  await assigned(db, app);
  await save(db, "result", 2, needsReview(), ids.mentor, app);
}
const decide = (actor: string, outcome: string | null, reason: string | null = REASON, revision = 3, app = ids.app) =>
  db.query<{ r: { ok: boolean; message: string; revision: number } }>(
    "select public.vam119_btc_decide_needs_review($1,$2,$3,$4,$5) as r", [actor, app, revision, outcome, reason]
  );
async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const appRow = (app = ids.app) => one<{ status: string; person_id: string | null }>("select status, person_id from applications where id=$1", [app]);
const opRow = (app = ids.app) => one<Record<string, any>>("select * from mentee_interview_operations where id=$1", [app]);
const reviewRow = (app = ids.app) => one<Record<string, any>>(
  "select to_jsonb(r) as j from application_reviews r where r.id=(select review_id from mentee_interview_operations where id=$1)", [app]
).then((r) => (r as any).j as Record<string, any>);
const count = (sql: string, params: unknown[] = []) => one<{ n: number }>(`select count(*)::int as n from ${sql}`, params).then((r) => r.n);
/** Ảnh chụp mọi thứ hàm có thể ghi — để ca "không được ghi gì" so trước/sau. */
async function snapshot(app = ids.app) {
  return {
    app: await appRow(app),
    op: await opRow(app),
    review: await reviewRow(app),
    decisions: await count("application_decisions where application_id=$1", [app]),
    people: await count("people"),
    profiles: await count("mentee_profiles"),
    memberships: await count("person_season_memberships where role='mentee'"),
    membershipLog: await count("person_season_membership_log"),
    logs: await count("mentee_interview_operation_log where application_id=$1", [app]),
    matches: await count("matches")
  };
}

describe("BTC chốt “Đạt” — bạn đó thành mentee của mùa", () => {
  it("ghi đủ: hồ sơ đã duyệt, người, mentee profile, tư cách mùa, quyết định, nhật ký; KHÔNG tạo cặp ghép", () => isolated(async () => {
    await toNeedsReview();
    expect(await appRow()).toEqual({ status: "needs_more_review", person_id: null });
    const before = await snapshot();
    const { rows } = await decide(ids.btc, "passed");
    expect(rows[0].r).toMatchObject({ ok: true, revision: 4 });

    const app = await appRow();
    expect(app.status).toBe("approved_as_mentee");
    expect(app.person_id).toBeTruthy();
    const person = await one<{ full_name: string; email_primary: string }>("select full_name, email_primary from people where id=$1", [app.person_id]);
    expect(person).toEqual({ full_name: "Mentee", email_primary: `${ids.app}@example.test` });
    expect(await count("mentee_profiles where person_id=$1 and source_application_id=$2", [app.person_id, ids.app])).toBe(1);

    const membership = await one<Record<string, any>>("select * from person_season_memberships where person_id=$1 and role='mentee'", [app.person_id]);
    expect(membership).toMatchObject({ season_id: ids.season, program_id: ids.program, status: "active", source: "manual", created_by: ids.btc });
    const created = await one<Record<string, any>>("select * from person_season_membership_log where membership_id=$1", [membership.id]);
    expect(created).toMatchObject({ old_status: null, new_status: "active", transition_type: "created", changed_by: ids.btc });

    const op = await opRow();
    expect(op).toMatchObject({ outcome: "passed", outcome_reason: REASON, btc_decided_by: ids.btc, membership_id: membership.id, owns_membership: true, match_id: null, revision: 4 });
    expect(op.btc_decided_at).toBeTruthy();
    // Bàn, người phỏng vấn, phiếu của lượt phỏng vấn giữ nguyên.
    expect(op).toMatchObject({ room: before.op.room, desk: before.op.desk, interviewer_id: ids.mentor, review_id: before.op.review_id });

    const decision = await one<Record<string, any>>("select * from application_decisions where application_id=$1 and new_status='approved_as_mentee'", [ids.app]);
    expect(decision).toMatchObject({ decided_by: ids.btc, decided_by_name: "BTC", previous_status: "needs_more_review", new_status: "approved_as_mentee", decision: "approved_as_mentee", decision_note: REASON });
    expect(await count("application_decisions where application_id=$1", [ids.app])).toBe(before.decisions + 1);

    const log = await one<Record<string, any>>("select * from mentee_interview_operation_log where application_id=$1 and action='btc_decision'", [ids.app]);
    expect(log).toMatchObject({ actor_id: ids.btc, reason: REASON });
    expect(log.before_data.operation.outcome).toBe("needs_review");
    expect(log.before_data.review.recommendation).toBe("needs_admin_review");
    expect(log.after_data.operation).toMatchObject({ outcome: "passed", btc_decided_by: ids.btc });
    expect(log.after_data.values).toEqual({ outcome: "passed", reason: REASON });

    // Không cặp ghép: bạn này chờ mentor chọn ở Vòng 2.
    expect(await count("matches")).toBe(before.matches);
  }));

  it("phiếu của người phỏng vấn giữ nguyên từng trường — quyết định của BTC ghi riêng", () => isolated(async () => {
    await toNeedsReview();
    const before = await reviewRow();
    expect(before).toMatchObject({ status: "submitted", recommendation: "needs_admin_review", reviewer_admin_user_id: ids.mentor, take_choice: "undecided" });
    await decide(ids.btc, "passed");
    expect(await reviewRow()).toEqual(before);
  }));

  it("đã có người trùng email: dùng lại người đó, không tạo người thứ hai", () => isolated(async () => {
    await toNeedsReview();
    const existing = uuid(40);
    await asOwner(async () => {
      await db.query("insert into people(id, full_name, email_primary) values ($1,'Đã có sẵn',$2)", [existing, `  ${ids.app.toUpperCase()}@EXAMPLE.test `]);
    });
    const people = await count("people");
    await decide(ids.btc, "passed");
    expect((await appRow()).person_id).toBe(existing);
    expect(await count("people")).toBe(people);
  }));
});

describe("BTC chốt “Không chọn”", () => {
  it("hồ sơ sang không được chọn; không tạo người, mentee profile hay tư cách", () => isolated(async () => {
    await toNeedsReview();
    const before = await snapshot();
    const { rows } = await decide(ids.btc, "rejected", "Chưa có nhu cầu mentoring rõ");
    expect(rows[0].r).toMatchObject({ ok: true, revision: 4 });
    expect(await appRow()).toEqual({ status: "rejected_or_not_fit", person_id: null });
    expect(await opRow()).toMatchObject({ outcome: "rejected", outcome_reason: "Chưa có nhu cầu mentoring rõ", btc_decided_by: ids.btc, membership_id: null, owns_membership: false, revision: 4 });
    const after = await snapshot();
    expect({ people: after.people, profiles: after.profiles, memberships: after.memberships, membershipLog: after.membershipLog, matches: after.matches })
      .toEqual({ people: before.people, profiles: before.profiles, memberships: before.memberships, membershipLog: before.membershipLog, matches: before.matches });
    const decision = await one<Record<string, any>>("select * from application_decisions where application_id=$1 and new_status='rejected_or_not_fit'", [ids.app]);
    expect(decision).toMatchObject({ decided_by: ids.btc, previous_status: "needs_more_review", new_status: "rejected_or_not_fit", decision_note: "Chưa có nhu cầu mentoring rõ" });
    expect(await count("mentee_interview_operation_log where application_id=$1 and action='btc_decision'", [ids.app])).toBe(1);
    expect(after.review).toEqual(before.review);
  }));
});

describe("cổng quyền — Core team trở lên có quyền vận hành mùa", () => {
  it("Support team, người phỏng vấn, Core team không có quyền mùa này, người ngoài: bị chặn và KHÔNG ghi gì", () => isolated(async () => {
    await toNeedsReview();
    const before = await snapshot();
    // ids.support CÓ quyền vận hành (check-in, phân bàn) nhưng không được chốt kết quả.
    for (const actor of [ids.support, ids.mentor, CORE_NO_SCOPE, ids.other, uuid(998)]) {
      await rejects(() => decide(actor, "passed"), "ACCESS_DENIED");
      await rejects(() => decide(actor, "rejected"), "ACCESS_DENIED");
    }
    expect(await snapshot()).toEqual(before);
    // Cùng dữ liệu, đúng người: chốt được — các dòng trên không xanh nhờ dữ liệu mẫu hỏng.
    expect((await decide(ids.btc, "rejected")).rows[0].r.ok).toBe(true);
  }));

  it("chỉ máy chủ gọi được: anon / authenticated không có EXECUTE; hàm chạy bằng quyền người gọi; gọi ngoài service_role bị từ chối", () => isolated(async () => {
    await toNeedsReview();
    await asOwner(async () => {
      const priv = await one<{ anon: boolean; auth: boolean; service: boolean; definer: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as service, (select prosecdef from pg_proc where oid = to_regprocedure($1)) as definer`, [FN]
      );
      expect(priv).toEqual({ anon: false, auth: false, service: true, definer: false });
      // Superuser cũng không qua: hàm đòi đúng vai service_role.
      await rejects(() => decide(ids.btc, "passed"), "ACCESS_DENIED");
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role};`);
        await rejects(() => decide(ids.btc, "passed"), /permission denied/);
        await db.exec("reset role;");
      }
    });
    expect((await appRow()).status).toBe("needs_more_review");
  }));
});

describe("chỉ hồ sơ đang “cần xem thêm”", () => {
  it("kết quả do người phỏng vấn chốt (Đạt / Không chọn), hồ sơ chưa chấm, chưa check-in: không thuộc đường này", () => isolated(async () => {
    const REJ = uuid(22), WAIT = uuid(23), NEW = uuid(24);
    for (const id of [SUN, REJ, WAIT, NEW]) await addCandidate(db, id, ids.sessionSun);
    await assigned(db, SUN, 1, 1);
    await save(db, "result", 2, { ...pass, takeChoice: "recommend_other" }, ids.mentor, SUN);
    await assigned(db, REJ, 1, 2);
    await save(db, "result", 2, { ...pass, outcome: "rejected", takeChoice: null }, ids.mentor, REJ);
    await assigned(db, WAIT, 1, 3);
    const before = { sun: await snapshot(SUN), rej: await snapshot(REJ), wait: await snapshot(WAIT) };
    await rejects(() => decide(ids.btc, "rejected", REASON, 3, SUN), "NOT_NEEDS_REVIEW");
    await rejects(() => decide(ids.btc, "passed", REASON, 3, REJ), "NOT_NEEDS_REVIEW");
    await rejects(() => decide(ids.btc, "passed", REASON, 2, WAIT), "NOT_NEEDS_REVIEW");
    await rejects(() => decide(ids.btc, "passed", REASON, 0, NEW), "NOT_NEEDS_REVIEW");
    expect({ sun: await snapshot(SUN), rej: await snapshot(REJ), wait: await snapshot(WAIT) }).toEqual(before);
    expect(await appRow(SUN)).toMatchObject({ status: "approved_as_mentee" });
  }));

  it("phiên bản cũ, kết quả lạ, thiếu lý do, lý do quá dài: từ chối và không ghi gì", () => isolated(async () => {
    await toNeedsReview();
    const before = await snapshot();
    await rejects(() => decide(ids.btc, "passed", REASON, 2), "STALE_REVISION");
    await rejects(() => decide(ids.btc, "passed", REASON, 4), "STALE_REVISION");
    for (const outcome of ["needs_review", "approved", "", null]) await rejects(() => decide(ids.btc, outcome), "INVALID_RESULT");
    for (const reason of ["", "   ", null]) await rejects(() => decide(ids.btc, "passed", reason), "REASON_REQUIRED");
    await rejects(() => decide(ids.btc, "passed", "x".repeat(4001)), "TEXT_TOO_LONG");
    expect(await snapshot()).toEqual(before);
    // Đúng 4.000 ký tự thì được.
    expect((await decide(ids.btc, "passed", "x".repeat(4000))).rows[0].r.ok).toBe(true);
  }));

  it("hồ sơ đã rút, hoặc trạng thái đã bị đổi ở luồng khác: không chốt chồng lên", () => isolated(async () => {
    await toNeedsReview();
    await asOwner(async () => { await db.query("update applications set status='interview_passed' where id=$1", [ids.app]); });
    await rejects(() => decide(ids.btc, "passed"), "STATUS_CHANGED");
    await asOwner(async () => { await db.query("update applications set status='withdrawn' where id=$1", [ids.app]); });
    await rejects(() => decide(ids.btc, "passed"), "APPLICATION_WITHDRAWN");
    expect(await opRow()).toMatchObject({ outcome: "needs_review", btc_decided_by: null, btc_decided_at: null, revision: 3 });
  }));

  it("đơn mentor không đi đường này", () => isolated(async () => {
    const mentorApp = await one<{ id: string }>("select id from applications where role_applied='mentor' and season_id=$1 limit 1", [ids.season]);
    await rejects(() => decide(ids.btc, "passed", REASON, 0, mentorApp.id), "ACCESS_DENIED");
  }));
});

describe("sau khi BTC chốt", () => {
  it("người phỏng vấn bấm “Sửa kết quả”: BTC_DECIDED, và cả lần lưu được hoàn lại — phiếu không bị ghi đè", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "passed");
    const before = await snapshot();
    await rejects(() => save(db, "result", 4, { ...pass, outcome: "rejected", takeChoice: null, reason: "Tôi đổi ý" }, ids.mentor), "BTC_DECIDED");
    await rejects(() => save(db, "result", 4, { ...needsReview(), reason: "Xem lại" }, ids.mentor), "BTC_DECIDED");
    expect(await snapshot()).toEqual(before);
  }));

  it("không ai sửa tay được dòng đã chốt, và không ai tự gắn dấu “BTC đã chốt” ngoài hàm", () => isolated(async () => {
    await addCandidate(db, SUN, ids.sessionSun);
    await toNeedsReview();
    await toNeedsReview(SUN);
    await decide(ids.btc, "passed");
    await asOwner(async () => {
      await rejects(() => db.query("update mentee_interview_operations set outcome='rejected' where id=$1", [ids.app]), "BTC_DECIDED");
      await rejects(() => db.query("update mentee_interview_operations set revision=revision+1 where id=$1", [ids.app]), "BTC_DECIDED");
      await rejects(() => db.query("update mentee_interview_operations set btc_decided_by=$2, btc_decided_at=now() where id=$1", [SUN, ids.support]), "BTC_DECISION_USE_WORKFLOW");
      // Dòng chưa chốt vẫn sửa được như cũ — trigger không khoá nhầm cả bảng.
      await db.query("update mentee_interview_operations set online_note='ghi chú' where id=$1", [SUN]);
    });
    expect(await opRow(SUN)).toMatchObject({ online_note: "ghi chú", btc_decided_by: null });
  }));

  it("BTC bấm nhầm “Đạt”: đổi lại “Không chọn” — tư cách do lần chốt tạo được ngừng, có nhật ký", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "passed");
    const membershipId = (await opRow()).membership_id;
    const { rows } = await decide(ids.btc, "rejected", "Bấm nhầm", 4);
    expect(rows[0].r).toMatchObject({ ok: true, revision: 5 });
    expect((await appRow()).status).toBe("rejected_or_not_fit");
    expect(await opRow()).toMatchObject({ outcome: "rejected", outcome_reason: "Bấm nhầm", membership_id: membershipId, owns_membership: true, revision: 5 });
    expect(await one("select status from person_season_memberships where id=$1", [membershipId])).toEqual({ status: "withdrawn" });
    const log = await one<Record<string, any>>("select * from person_season_membership_log where membership_id=$1 and new_status='withdrawn'", [membershipId]);
    expect(log).toMatchObject({ old_status: "active", new_status: "withdrawn", transition_type: "status_change", reason: "Bấm nhầm", changed_by: ids.btc });
    const decision = await one<Record<string, any>>("select * from application_decisions where application_id=$1 and new_status='rejected_or_not_fit'", [ids.app]);
    expect(decision).toMatchObject({ decided_by: ids.btc, previous_status: "approved_as_mentee", new_status: "rejected_or_not_fit", decision_note: "Bấm nhầm" });
    // Rồi đổi lại lần nữa: bật lại ĐÚNG tư cách đó, không tạo cái thứ hai.
    await decide(ids.btc, "passed", "Chốt lại sau khi họp", 5);
    expect(await one("select status from person_season_memberships where id=$1", [membershipId])).toEqual({ status: "active" });
    expect(await count("person_season_membership_log where membership_id=$1 and old_status='withdrawn' and new_status='active' and reason='Chốt lại sau khi họp'", [membershipId])).toBe(1);
    expect(await count("person_season_memberships where role='mentee' and person_id=$1", [(await appRow()).person_id])).toBe(1);
    expect(await count("mentee_interview_operation_log where application_id=$1 and action='btc_decision'", [ids.app])).toBe(3);
  }));

  it("BTC bấm nhầm “Không chọn”: đổi lại “Đạt” thì tạo người và tư cách như một lần chốt Đạt", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "rejected");
    await decide(ids.btc, "passed", "Bấm nhầm", 4);
    const app = await appRow();
    expect(app.status).toBe("approved_as_mentee");
    expect(await count("person_season_memberships where role='mentee' and status='active' and person_id=$1", [app.person_id])).toBe(1);
    expect(await opRow()).toMatchObject({ outcome: "passed", owns_membership: true, revision: 5 });
  }));

  it("mentee đã được mentor chọn (có cặp ghép): không đổi sang “Không chọn” được, và không gì bị gỡ", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "passed");
    const personId = (await appRow()).person_id;
    await asOwner(async () => {
      await db.query("insert into matches(season_id, mentor_person_id, mentee_person_id, status) values ($1,$2,$3,'active')", [ids.season, ids.person, personId]);
    });
    const before = await snapshot();
    await rejects(() => decide(ids.btc, "rejected", "Bấm nhầm", 4), "OTHER_MATCH_REQUIRES_BTC");
    expect(await snapshot()).toEqual(before);
    expect(await count("matches where status='active' and mentee_person_id=$1", [personId])).toBe(1);
  }));

  it("chốt lại đúng kết quả đang có: SAME_RESULT, không thêm quyết định hay nhật ký", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "passed");
    const before = await snapshot();
    await rejects(() => decide(ids.btc, "passed", "Lần nữa", 4), "SAME_RESULT");
    expect(await snapshot()).toEqual(before);
  }));
});

describe("danh tính và tư cách có sẵn — cùng các chặn với nhánh “Đạt” của người phỏng vấn", () => {
  it("email trùng hai người, hoặc đơn không có email: cần BTC gỡ trước, không ghi gì", () => isolated(async () => {
    await toNeedsReview();
    await asOwner(async () => {
      await db.query("insert into people(full_name, email_primary) values ('Một',$1),('Hai',$2)", [`${ids.app}@example.test`, `${ids.app}@EXAMPLE.TEST`]);
    });
    const before = await snapshot();
    await rejects(() => decide(ids.btc, "passed"), "IDENTITY_REQUIRES_BTC");
    await asOwner(async () => { await db.query("delete from people where full_name in ('Một','Hai')"); await db.query("update applications set email_primary=null where id=$1", [ids.app]); });
    await rejects(() => decide(ids.btc, "passed"), "IDENTITY_REQUIRES_BTC");
    expect((await snapshot()).op).toEqual(before.op);
    expect((await appRow()).status).toBe("needs_more_review");
  }));

  it("đã là mentee của mùa qua luồng khác: chốt “Đạt” không tạo tư cách thứ hai và không nhận vơ; chốt “Không chọn” thì bị chặn", () => isolated(async () => {
    await toNeedsReview();
    const person = uuid(41), membership = uuid(42);
    await asOwner(async () => {
      await db.query("insert into people(id, full_name, email_primary) values ($1,'Đã là mentee',$2)", [person, `${ids.app}@example.test`]);
      await db.query("insert into person_season_memberships(id, person_id, program_id, season_id, role, status) values ($1,$2,$3,$4,'mentee','active')", [membership, person, ids.program, ids.season]);
      await db.query("update applications set person_id=$2 where id=$1", [ids.app, person]);
    });
    const before = await snapshot();
    await rejects(() => decide(ids.btc, "rejected"), "MEMBERSHIP_REQUIRES_BTC");
    expect(await snapshot()).toEqual(before);
    await decide(ids.btc, "passed");
    expect(await count("person_season_memberships where role='mentee' and person_id=$1", [person])).toBe(1);
    expect(await opRow()).toMatchObject({ outcome: "passed", membership_id: null, owns_membership: false });
    expect(await count("person_season_membership_log where membership_id=$1", [membership])).toBe(0);
  }));

  it("tư cách mentee đã NGỪNG do luồng khác: không tự bật lại", () => isolated(async () => {
    await toNeedsReview();
    const person = uuid(43);
    await asOwner(async () => {
      await db.query("insert into people(id, full_name, email_primary) values ($1,'Đã rút',$2)", [person, `${ids.app}@example.test`]);
      await db.query("insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1,$2,$3,'mentee','withdrawn')", [person, ids.program, ids.season]);
    });
    const before = await snapshot();
    await rejects(() => decide(ids.btc, "passed"), "MEMBERSHIP_REQUIRES_BTC");
    expect(await snapshot()).toEqual(before);
  }));
});

describe("bảng của màn hình phỏng vấn", () => {
  const board = (actor: string) => one<{ d: Record<string, any> }>("select public.vam118_offline_board($1,$2) as d", [actor, ids.season]).then((r) => r.d);

  it("khoá canDecide: đúng luật của hàm ghi — Core team có quyền mùa thì true; Support và người phỏng vấn thì false", () => isolated(async () => {
    expect((await board(ids.btc)).canDecide).toBe(true);
    expect((await board(ids.support)).canDecide).toBe(false);
    expect((await board(ids.mentor)).canDecide).toBe(false);
    // Support vẫn vận hành được như cũ — thêm khoá mới không đổi khoá cũ.
    expect((await board(ids.support)).canOperate).toBe(true);
    expect((await board(ids.mentor)).canOperate).toBe(false);
    expect(Object.keys(await board(ids.btc)).sort()).toEqual(["canDecide", "canOperate", "candidates", "logs", "participants", "sessions"]);
  }));

  it("sau khi chốt: dòng ứng viên mang dấu BTC, nhật ký có dòng “btc_decision”; hồ sơ chi tiết vẫn đọc được", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "passed");
    const b = await board(ids.support);
    const row = b.candidates.find((c: any) => c.id === ids.app);
    expect(row).toMatchObject({ status: "approved_as_mentee", takeSubmitted: false });
    expect(row.operation).toMatchObject({ outcome: "passed", btc_decided_by: ids.btc, outcome_reason: REASON });
    // Cùng transaction nên mọi dòng nhật ký cùng giờ — tìm theo loại, không theo vị trí.
    expect(b.logs.filter((l: any) => l.action === "btc_decision")).toHaveLength(1);
    expect(b.logs.find((l: any) => l.action === "btc_decision")).toMatchObject({ actor_name: "BTC", application_id: ids.app, reason: REASON });
    const detail = await one<{ d: Record<string, any> }>("select public.vam118_offline_candidate_detail($1,$2,$3) as d", [ids.btc, ids.season, ids.app]);
    expect(detail.d.reviews[0]).toMatchObject({ recommendation: "needs_admin_review", status: "submitted" });
  }));
});

describe("migration", () => {
  it("dán lại không sao: cột, ràng buộc, trigger, hàm vẫn nguyên và dữ liệu đã chốt không đổi", () => isolated(async () => {
    await toNeedsReview();
    await decide(ids.btc, "passed");
    const before = await snapshot();
    await asOwner(async () => { await db.exec(MIGRATION); await db.exec(MIGRATION); });
    expect(await snapshot()).toEqual(before);
    await rejects(() => save(db, "result", 4, { ...needsReview(), reason: "Xem lại" }, ids.mentor), "BTC_DECIDED");
    await asOwner(async () => {
      expect(await count("pg_trigger where tgrelid='public.mentee_interview_operations'::regclass and tgname='vam119_btc_decision_guard' and not tgisinternal")).toBe(1);
      expect(await count("pg_constraint where conrelid='public.mentee_interview_operations'::regclass and conname='mentee_interview_operations_btc_pair'")).toBe(1);
    });
  }));

  it("ràng buộc: người chốt và giờ chốt phải cùng có hoặc cùng không", () => isolated(async () => {
    await toNeedsReview();
    await asOwner(async () => {
      // Tắt trigger để soi riêng ràng buộc CHECK.
      await db.exec("set session_replication_role = replica;");
      await rejects(() => db.query("update mentee_interview_operations set btc_decided_by=$2 where id=$1", [ids.app, ids.btc]), /mentee_interview_operations_btc_pair/);
      await rejects(() => db.query("update mentee_interview_operations set btc_decided_at=now() where id=$1", [ids.app]), /mentee_interview_operations_btc_pair/);
      await db.exec("set session_replication_role = origin;");
    });
  }));
});
