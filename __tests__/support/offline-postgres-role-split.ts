/**
 * Database thử cho luồng phỏng vấn mentee SAU migration tách 4 nhóm quyền (20261004170000)
 * — tức đúng trạng thái production từ 04/10/2026: hàm phỏng vấn đọc người phỏng vấn qua
 * vam110. offlineDb() dừng ở 20261007090000 nhưng KHÔNG chạy chuỗi tách quyền, nên các
 * hàm viết sau đó (vam118, vam119) không chạy được trên nó.
 *
 * Lần thứ ba cần đúng chuỗi dựng này (sau tach-4-nhom-quyen và man-hinh-pv-nhe) → gom về đây.
 * Trả về database ở vai superuser; bài test tự chạy migration của mình rồi `set role service_role`.
 */
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./offline-postgres";

const read = (file: string) => readFileSync(file, "utf8");
const ROLE_SPLIT = "supabase/migrations/20261004170000_tach_4_nhom_quyen_tuyen_sinh.sql";
const HOSTS = "supabase/migrations/20261004120000_lich_pv_mentor_tach_quyen.sql";
const STAFFING = "supabase/migrations/20260911120000_support_team_recruitment_staffing.sql";
const Q = "supabase/migrations/20260905140900_s12_withdrawn_application_quarantine_restore.sql";
const P0 = "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql";
const GRANT = "supabase/migrations/20260904140000_grant_participation_scope_reuse.sql";
// Migration 20261004170000 viết lại các hàm này tại chỗ nên chúng phải có mặt trước.
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

function slotsDdl(): string {
  const m = /create table if not exists public\.interview_slots \([\s\S]*?\n\);/i.exec(read("supabase/migrations/20260922100000_interview_slot_booking.sql"));
  if (!m) throw new Error("thiếu DDL interview_slots");
  return m[0];
}
function fnDef(file: string, name: string): string {
  const m = new RegExp(`create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$(fn|function)\\$;`, "i").exec(read(file));
  if (!m) throw new Error(`thiếu định nghĩa ${name} trong ${file}`);
  return m[0];
}

/** Người mẫu mà hai migration quyền cần để tự kiểm: được bật phỏng vấn từ 22/09. */
export const roleSplitIds = {
  host: uuid(70),   // bật 22/09 để phỏng vấn MENTOR, chưa phỏng vấn mentee nào
  kiet: uuid(71),   // bật 22/09, CÓ phỏng vấn mentee
  hostPerson: uuid(73),
  kietPerson: uuid(74),
  menteeK: uuid(83)
};
const SEPT = "2026-09-22T16:33:00Z";

export async function offlineDbRoleSplit(): Promise<PGlite> {
  const db = await offlineDb();
  const r = roleSplitIds;
  await db.exec("reset role;");
  // Production đã bỏ khoá bàn / người phỏng vấn từ 04/10 (một mentor giữ nhiều bạn chưa chấm).
  await db.exec(read("supabase/migrations/20261004110000_mentee_bo_khoa_ban_pv.sql"));
  await db.exec(slotsDdl());
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
  await db.exec(read(STAFFING));
  await db.exec(`
    insert into admin_users(id, auth_user_id, email, full_name, status, role) values
      ('${r.host}','${r.host}','host@example.test','Host 22/09','active','reviewer'),
      ('${r.kiet}','${r.kiet}','kiet@example.test','Kiệt','active','reviewer');
    insert into admin_scope_access(user_id, status, season_id, role) values
      ('${r.host}','active','${ids.season}','review'),('${r.kiet}','active','${ids.season}','review');
    insert into people(id, full_name, email_primary) values
      ('${r.hostPerson}','Host 22/09','host@example.test'),('${r.kietPerson}','Kiệt','kiet@example.test');
    insert into person_season_memberships(person_id, program_id, season_id, role, status, created_at) values
      ('${r.hostPerson}','${ids.program}','${ids.season}','interviewer','active','${SEPT}'),
      ('${r.kietPerson}','${ids.program}','${ids.season}','interviewer','active','${SEPT}');
    insert into applications(id, season_id, role_applied, status, source, full_name) values
      ('${r.menteeK}','${ids.season}','mentee','interview_in_progress','vam_os_form','Mentee K');
    insert into application_reviews(application_id, reviewer_admin_user_id, review_round, status) values
      ('${r.menteeK}','${r.kiet}','interview','submitted');
  `);
  await db.exec(read(HOSTS));
  await db.exec("revoke execute on all functions in schema public from public; grant execute on all functions in schema public to service_role;");
  await db.exec(read(ROLE_SPLIT));
  return db;
}
