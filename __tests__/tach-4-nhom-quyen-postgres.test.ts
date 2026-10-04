/**
 * Bốn nhóm quyền tuyển sinh độc lập (migration 20261004170000, BTC 04/10/2026):
 * chấm hồ sơ mentee ('reviewer') · phỏng vấn mentee ('interviewer') · chấm hồ sơ mentor
 * ('mentor_reviewer') · phỏng vấn mentor ('mentor_interviewer').
 *
 * Chạy migration thật trên Postgres (PGlite), sau đúng chuỗi đã lên Production:
 * các hàm gốc trong repo → 20260911120000 (support được cấp quyền) → 20261004120000
 * (bảng host lịch PV mentor) → migration này. Soi chính các dòng nó ghi và các hàm
 * ghi thật từ chối / cho phép ai.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(file, "utf8");
const MIGRATION = read("supabase/migrations/20261004170000_tach_4_nhom_quyen_tuyen_sinh.sql");
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

// Người thật trong từng nhóm của dữ liệu S12:
const HOST = uuid(70);   // bật 22/09 để phỏng vấn MENTOR, chưa phỏng vấn mentee nào
const KIET = uuid(71);   // bật 22/09, CÓ phỏng vấn mentee (03–04/10)
const PEND = uuid(72);   // chỉ được cấp phỏng vấn mentee, nhưng đang giữ 1 phiếu chấm hồ sơ mentee dở
const [HOSTP, KIETP, PENDP, NEWP, SUPP] = [uuid(73), uuid(74), uuid(75), uuid(76), uuid(77)];
const [MENTEE_A, MENTEE_B, MENTOR_A, MENTEE_K] = [uuid(80), uuid(81), uuid(82), uuid(83)];
const SEPT = "2026-09-22T16:33:00Z";

let db: PGlite;
async function eligible(admin: string, stage: string, role: string) {
  const { rows } = await db.query<{ ok: boolean }>("select public.vam110_eligible_for($1,$2,$3,$4) as ok", [admin, ids.season, stage, role]);
  return rows[0].ok;
}
async function membership(person: string, role: string) {
  const { rows } = await db.query<{ status: string }>(
    "select status from person_season_memberships where person_id=$1 and season_id=$2 and role=$3", [person, ids.season, role]
  );
  return rows[0]?.status ?? null;
}
const grant = (actor: string, person: string, role: string, email: string, auth = uuid(90)) =>
  db.query("select public.vam084_grant_recruitment_participation($1,$2,$3,$4,$5,$6) as id", [actor, person, ids.season, role, auth, email]);
const revoke = (actor: string, person: string, role: string) =>
  db.query("select public.vam084_revoke_recruitment_participation($1,$2,$3,$4)", [actor, person, ids.season, role]);
const assign = (app: string, reviewer: string, round: string) =>
  db.query("select public.vam095_assign_application_review($1,$2,$3,null,$4) as id", [app, reviewer, round, ids.btc]);

beforeEach(async () => {
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
  await db.exec(`
    insert into admin_users(id, auth_user_id, email, full_name, status, role) values
      ('${HOST}','${HOST}','host@example.test','Host 22/09','active','reviewer'),
      ('${KIET}','${KIET}','kiet@example.test','Kiệt','active','reviewer'),
      ('${PEND}','${PEND}','pend@example.test','Pend','active','reviewer');
    insert into admin_scope_access(user_id, status, season_id, role) values
      ('${HOST}','active','${ids.season}','review'),('${KIET}','active','${ids.season}','review'),('${PEND}','active','${ids.season}','review');
    insert into people(id, full_name, email_primary) values
      ('${HOSTP}','Host 22/09','host@example.test'),('${KIETP}','Kiệt','kiet@example.test'),('${PENDP}','Pend','pend@example.test'),
      ('${NEWP}','Mentor mới','new@example.test'),('${SUPP}','Support','support@example.test');
    insert into person_season_memberships(person_id, program_id, season_id, role, status, created_at) values
      ('${HOSTP}','${ids.program}','${ids.season}','interviewer','active','${SEPT}'),
      ('${KIETP}','${ids.program}','${ids.season}','interviewer','active','${SEPT}'),
      ('${PENDP}','${ids.program}','${ids.season}','interviewer','active', now());
    insert into applications(id, season_id, role_applied, status, source, full_name) values
      ('${MENTEE_A}','${ids.season}','mentee','submitted','vam_os_form','Mentee A'),
      ('${MENTEE_B}','${ids.season}','mentee','submitted','vam_os_form','Mentee B'),
      ('${MENTOR_A}','${ids.season}','mentor','submitted','vam_os_form','Mentor A'),
      ('${MENTEE_K}','${ids.season}','mentee','interview_in_progress','vam_os_form','Mentee K');
    insert into application_reviews(application_id, reviewer_admin_user_id, review_round, status) values
      ('${MENTEE_K}','${KIET}','interview','submitted'),
      ('${MENTEE_A}','${PEND}','profile_screening','assigned');
  `);
  await db.exec(HOSTS);
  await db.exec("revoke execute on all functions in schema public from public; grant execute on all functions in schema public to service_role;");
  await db.exec(MIGRATION);
  await db.exec("set role service_role;");
}, 120000);

describe("ma trận quyền theo (vòng, hồ sơ mentor|mentee)", () => {
  it("bốn nhóm độc lập; core team có cả bốn; support không có nhóm nào", async () => {
    const matrix = async (admin: string) => ({
      csMentee: await eligible(admin, "profile_screening", "mentee"),
      pvMentee: await eligible(admin, "interview", "mentee"),
      csMentor: await eligible(admin, "profile_screening", "mentor"),
      pvMentor: await eligible(admin, "interview", "mentor")
    });
    // ids.mentor: chỉ được cấp phỏng vấn mentee — trước đây chấm được mọi hồ sơ nhờ scope 'review'.
    expect(await matrix(ids.mentor)).toEqual({ csMentee: false, pvMentee: true, csMentor: false, pvMentor: false });
    expect(await matrix(ids.btc)).toEqual({ csMentee: true, pvMentee: true, csMentor: true, pvMentor: true });
    expect(await matrix(ids.support)).toEqual({ csMentee: false, pvMentee: false, csMentor: false, pvMentor: false });
    expect(await matrix(HOST)).toEqual({ csMentee: false, pvMentee: false, csMentor: false, pvMentor: true });
    expect(await matrix(KIET)).toEqual({ csMentee: false, pvMentee: true, csMentor: false, pvMentor: true });
    expect(await matrix(PEND)).toEqual({ csMentee: true, pvMentee: true, csMentor: false, pvMentor: false });
  });

  it("danh sách cho ô chọn chỉ gồm đúng nhóm, gắn nhãn nhóm", async () => {
    const { rows } = await db.query<{ id: string; participation_role: string }>(
      "select id, participation_role from public.vam110_list_recruitment_participants($1,'interview','mentor')", [ids.season]
    );
    expect(rows.map((r) => r.id).sort()).toEqual([ids.btc, HOST, KIET].sort());
    expect(new Set(rows.map((r) => r.participation_role))).toEqual(new Set(["mentor_interviewer"]));
  });
});

describe("chuyển dữ liệu", () => {
  it("host 22/09 → phỏng vấn mentor; ai chưa phỏng vấn mentee thì mất phỏng vấn mentee; bảng host cũ đã gộp", async () => {
    expect(await membership(HOSTP, "mentor_interviewer")).toBe("active");
    expect(await membership(HOSTP, "interviewer")).toBe("cancelled");
    expect(await membership(KIETP, "mentor_interviewer")).toBe("active");
    expect(await membership(KIETP, "interviewer")).toBe("active");
    const { rows } = await db.query<{ t: string | null }>("select to_regclass('public.mentor_interview_hosts')::text as t");
    expect(rows[0].t).toBeNull();
    const { rows: log } = await db.query<{ role: string; new_status: string; reason: string }>(
      "select role, new_status, reason from person_season_membership_log where person_id=$1 order by role", [HOSTP]
    );
    expect(log).toEqual([
      { role: "interviewer", new_status: "cancelled", reason: expect.stringContaining("chưa từng phỏng vấn mentee") },
      { role: "mentor_interviewer", new_status: "active", reason: expect.stringContaining("phỏng vấn mentor") }
    ]);
  });

  it("phiếu chấm hồ sơ đang dở không bị kẹt: người giữ được cấp đúng quyền chấm hồ sơ mentee", async () => {
    expect(await membership(PENDP, "reviewer")).toBe("active");
    const { rows } = await db.query<{ reason: string }>(
      "select reason from person_season_membership_log where person_id=$1 and role='reviewer'", [PENDP]
    );
    expect(rows[0].reason).toContain("phiếu đang chấm dở");
  });
});

describe("hàm ghi thật dùng đúng nhóm", () => {
  it("giao chấm hồ sơ: người chấm mentee nhận hồ sơ mentee, KHÔNG nhận hồ sơ mentor; người chỉ phỏng vấn thì không nhận hồ sơ nào", async () => {
    await assign(MENTEE_B, PEND, "profile_screening");
    await expect(assign(MENTOR_A, PEND, "profile_screening")).rejects.toThrow(/not an active participant/);
    await expect(assign(MENTEE_B, ids.mentor, "profile_screening")).rejects.toThrow(/not an active participant/);
    await assign(MENTOR_A, ids.btc, "profile_screening");
  });

  it("phỏng vấn mentee trực tiếp: người chỉ phỏng vấn mentor không vào được, không nằm trong ô chọn người phỏng vấn", async () => {
    const access = async (admin: string) =>
      (await db.query<{ ok: boolean }>("select public.vam104_offline_access($1,$2) as ok", [admin, ids.season])).rows[0].ok;
    expect(await access(HOST)).toBe(false);
    expect(await access(ids.mentor)).toBe(true);
    const { rows } = await db.query<{ d: { participants: Array<{ id: string }> } }>(
      "select public.vam104_offline_dashboard($1,$2) as d", [ids.btc, ids.season]
    );
    const people = rows[0].d.participants.map((p) => p.id);
    expect(people).toContain(ids.mentor);
    expect(people).not.toContain(HOST);
  });

  it("lịch phỏng vấn mentor: chỉ người có 'phỏng vấn mentor'", async () => {
    const host = async (admin: string) =>
      (await db.query<{ ok: boolean }>("select public.vam109_mentor_interview_host($1,$2) as ok", [admin, ids.season])).rows[0].ok;
    expect(await host(HOST)).toBe(true);
    expect(await host(ids.mentor)).toBe(false);
    expect(await host(ids.btc)).toBe(true);
  });
});

describe("cấp / thu quyền", () => {
  it("support cấp được 2 nhóm mentee, KHÔNG cấp được 2 nhóm mentor; ban điều hành cấp được", async () => {
    await grant(ids.support, NEWP, "interviewer", "new@example.test");
    await expect(grant(ids.support, NEWP, "mentor_reviewer", "new@example.test")).rejects.toThrow(/requires core team/);
    await expect(grant(ids.support, NEWP, "mentor_interviewer", "new@example.test")).rejects.toThrow(/requires core team/);
    const { rows: [{ id }] } = await grant(ids.btc, NEWP, "mentor_reviewer", "new@example.test") as { rows: Array<{ id: string }> };
    // Độc lập: cấp chấm hồ sơ MENTOR không kéo theo chấm hồ sơ mentee.
    expect(await eligible(id, "profile_screening", "mentor")).toBe(true);
    expect(await eligible(id, "profile_screening", "mentee")).toBe(false);
    expect(await eligible(id, "interview", "mentee")).toBe(true);
  });

  it("thu quyền nhóm mentor: support bị từ chối, ban điều hành thu được — nhóm còn lại giữ nguyên", async () => {
    const { rows: [{ id }] } = await grant(ids.btc, NEWP, "mentor_interviewer", "new@example.test") as { rows: Array<{ id: string }> };
    await grant(ids.btc, NEWP, "interviewer", "new@example.test");
    await expect(revoke(ids.support, NEWP, "mentor_interviewer")).rejects.toThrow(/revoke rejected/);
    await revoke(ids.btc, NEWP, "mentor_interviewer");
    expect(await eligible(id, "interview", "mentor")).toBe(false);
    expect(await eligible(id, "interview", "mentee")).toBe(true);
  });

  it("không hạ tài khoản Support thành người đánh giá — từ chối", async () => {
    await expect(grant(ids.btc, SUPP, "interviewer", "support@example.test", ids.support)).rejects.toThrow(/Support team account cannot join/);
    const { rows } = await db.query<{ role: string }>("select role from admin_users where id=$1", [ids.support]);
    expect(rows[0].role).toBe("support_team");
  });

  it("vai trò lạ vẫn bị từ chối", async () => {
    await expect(grant(ids.btc, NEWP, "mentor", "new@example.test")).rejects.toThrow(/Unsupported recruitment participation role/);
  });
});

describe("tự kiểm của migration", () => {
  it("báo lỗi khi còn phiếu dở mà người giữ không đủ quyền", async () => {
    await db.exec("reset role;");
    await db.query("insert into application_reviews(application_id, reviewer_admin_user_id, review_round, status) values($1,$2,'profile_screening','assigned')", [MENTOR_A, ids.mentor]);
    const check = MIGRATION.slice(MIGRATION.indexOf("do $tach_4_nhom_self_check$"), MIGRATION.lastIndexOf("commit;"));
    await expect(db.exec(check)).rejects.toThrow(/phiếu đang dở/);
  });

  it("chạy lại lần hai không đổi gì, không lỗi", async () => {
    await db.exec("reset role;");
    const before = (await db.query<{ n: number }>("select count(*)::int as n from person_season_membership_log")).rows[0].n;
    await db.exec(MIGRATION);
    const after = (await db.query<{ n: number }>("select count(*)::int as n from person_season_membership_log")).rows[0].n;
    expect(after).toBe(before);
  });
});
