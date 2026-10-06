import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

export const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
// session/sessionSun bị GÁN LẠI trong offlineDb(): giá trị thật do migration
// 20260929100000 sinh ra (gen_random_uuid()), không phải hai hằng số này.
export const ids={season:uuid(1),program:uuid(2),support:uuid(3),mentor:uuid(4),other:uuid(5),person:uuid(6),session:uuid(7),sessionSun:uuid(9),app:uuid(8),
  btc:uuid(10),seasonNext:uuid(11),rubric:""};
const read=(file:string)=>readFileSync(path.resolve(file),"utf8");
function table(file:string,name:string) {
  const text=read(file);
  const match=new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,"i").exec(text);
  if(!match) throw new Error(`No fixture DDL: ${name}`);
  return match[0];
}
export async function offlineDb() {
  const db=new PGlite();
  // Foundation tables predating migration history: only fields used by this flow.
  // Reviews, memberships, sessions and authorization functions are the REAL DDL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table programs(id uuid primary key);
    create table seasons(id uuid primary key,program_id uuid references programs,code text unique);
    create table intake_batches(id uuid primary key,season_id uuid references seasons);
    create table admin_users(id uuid primary key,auth_user_id uuid,email text,full_name text,status text,role text);
    create table admin_scope_access(user_id uuid,status text,season_id text,role text);
    create table people(id uuid primary key default gen_random_uuid(),full_name text not null,email_primary text,phone_primary text,source_sheets text);
    create table applications(id uuid primary key default gen_random_uuid(),season_id uuid references seasons,person_id uuid references people,
      intake_batch_id uuid references intake_batches,role_applied text,status text,source text,full_name text,email_primary text,phone_primary text,raw_payload jsonb);
    create table mentor_profiles(id uuid primary key default gen_random_uuid(),person_id uuid references people,capacity_target integer);
    create table mentee_profiles(id uuid primary key default gen_random_uuid(),person_id uuid references people,source_application_id uuid references applications,intake_batch_id uuid);
    create table matches(id uuid primary key default gen_random_uuid(),season_id uuid references seasons,mentor_person_id uuid references people,
      mentee_person_id uuid references people,status text check(status in ('active','dropped','completed')),match_source_raw text,match_type text,matched_at date,notes text);
  `);
  for(const [file,names] of [
    ["supabase_migrations/040_application_reviews.sql",["application_reviews"]],
    ["supabase_migrations/041_application_decision_workflow.sql",["application_decisions"]],
    ["supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql",["person_season_memberships","person_season_membership_log"]],
    ["supabase/migrations/20260924190000_mentee_interview_sessions.sql",["interview_sessions","mentee_interview_bookings","mentee_interview_invites"]]
  ] as const) for(const name of names) await db.exec(table(file,name));
  await db.exec(`create unique index active_review on application_reviews(application_id,reviewer_admin_user_id,review_round) where status<>'cancelled';`);
  const helpers=read("supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql");
  for(const name of ["vam084_operator_for_season","vam084_participant_for_stage","vam084_list_recruitment_participants"]) {
    const fn=new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`).exec(helpers);
    if(!fn) throw new Error(name);
    await db.exec(fn[0]);
  }
  await db.exec("grant usage on schema public to service_role; grant all on all tables in schema public to service_role;");
  await db.exec(read("supabase/migrations/20260927090000_mentee_offline_workflow.sql"));
  await db.exec(`
    insert into programs values('${ids.program}');
    insert into seasons values('${ids.season}','${ids.program}','UEHM-S12');
    insert into admin_users values
      ('${ids.support}','${ids.support}','support@example.test','Support','active','support_team'),
      ('${ids.mentor}','${ids.mentor}','mentor@example.test','Mentor','active','reviewer'),
      ('${ids.other}','${ids.other}','other@example.test','Other','active','reviewer');
    insert into admin_scope_access values
      ('${ids.support}','active','${ids.season}','operations'),('${ids.mentor}','active','${ids.season}','review');
    insert into people(id,full_name,email_primary) values('${ids.person}','Mentor','mentor@example.test');
    insert into mentor_profiles(person_id,capacity_target) values('${ids.person}',1);
    insert into applications(season_id,person_id,role_applied,status) values('${ids.season}','${ids.person}','mentor','approved_as_mentor');
    insert into person_season_memberships(person_id,program_id,season_id,role,status)
      values('${ids.person}','${ids.program}','${ids.season}','interviewer','active');
  `);
  // Mùa UEHM-S12 đã có: migration này tự seed 28 ca thật (14/ngày, 18 ghế
  // thứ Bảy, 28 ghế Chủ nhật) — KHÔNG insert tay interview_sessions nữa, để
  // bài test chạy trên đúng lưới ca migration sinh ra, không phải bản giả lập.
  await db.exec(read("supabase/migrations/20260929100000_dieu_chinh_lich_pv_mentee.sql"));
  const {rows:[satSession]}=await db.query<{id:string}>(
    `select id from interview_sessions where season_id=$1
       and (starts_at at time zone 'Asia/Ho_Chi_Minh')::date=date '2026-10-03'
       and (starts_at at time zone 'Asia/Ho_Chi_Minh')::time='08:00:00' limit 1`,
    [ids.season]
  );
  const {rows:[sunSession]}=await db.query<{id:string}>(
    `select id from interview_sessions where season_id=$1
       and (starts_at at time zone 'Asia/Ho_Chi_Minh')::date=date '2026-10-04'
       and (starts_at at time zone 'Asia/Ho_Chi_Minh')::time='08:00:00' limit 1`,
    [ids.season]
  );
  if(!satSession || !sunSession) throw new Error("migration 20260929100000 không sinh ra ca 08:00 của cả hai ngày");
  ids.session=satSession.id;
  ids.sessionSun=sunSession.id;
  await db.exec(read("supabase/migrations/20261002100000_mentee_phong_van_theo_mua.sql"));
  // Ô ghi chú bắt buộc, khoá mục C khi Không chọn, tối đa 2 lần "Có – Tôi muốn nhận";
  // phiếu S12 lên phiên bản 2 (BTC 02/10/2026).
  await db.exec(read("supabase/migrations/20261002150000_mentee_phieu_cham_bat_buoc_ghi_chu.sql"));
  // BTC/Support đổi ca cho mentee, kể cả sau hạn tự đổi (vam107).
  await db.exec(read("supabase/migrations/20261002200000_mentee_doi_ca_btc.sql"));
  // Cận phòng/bàn suy từ địa điểm + số chỗ của ca (07/10/2026), thay cho hai ngày ghi
  // cứng. Địa điểm dưới đây là đúng câu BTC đã điền cho đợt 1 trên production: thứ Bảy
  // 3 phòng (18 chỗ → 6 bàn), Chủ nhật 6 phòng (28 chỗ → 5 bàn).
  await db.exec(read("supabase/migrations/20261007090000_phong_ban_theo_dia_diem_ca.sql"));
  await db.query(
    `update interview_sessions set venue=$2 where season_id=$1 and (starts_at at time zone 'Asia/Ho_Chi_Minh')::date=date '2026-10-03'`,
    [ids.season, "Phòng H101, H104, H201 — Cơ sở H, 1A Hoàng Diệu, Phường Phú Nhuận, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/ydfX6wHU3eKVPgnp6"]
  );
  await db.query(
    `update interview_sessions set venue=$2 where season_id=$1 and (starts_at at time zone 'Asia/Ho_Chi_Minh')::date=date '2026-10-04'`,
    [ids.season, "Phòng B1.503, B1.504, B1.506, B1.803, B1.805, B1.808 — Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/Cne2WL3a6LfXNZ2fA"]
  );
  // BTC vận hành mùa (core_team + scope operations) để thử màn hình sửa phiếu,
  // và một mùa thứ hai CHƯA có phiếu riêng để thử luật kế thừa.
  await db.exec(`
    insert into admin_users values ('${ids.btc}','${ids.btc}','btc@example.test','BTC','active','core_team');
    insert into admin_scope_access values ('${ids.btc}','active','${ids.season}','operations'),('${ids.btc}','active','${ids.seasonNext}','operations');
    insert into seasons values('${ids.seasonNext}','${ids.program}','UEHM-S13');
  `);
  const {rows:[rubric]}=await db.query<{id:string;version:number}>("select id,version from mentee_interview_rubrics where season_id=$1",[ids.season]);
  if(!rubric) throw new Error("migration 20261002100000 không seed phiếu Mùa 12");
  ids.rubric=rubric.id;
  pass.rubricId=rubric.id;
  pass.rubricVersion=rubric.version;
  await addCandidate(db,ids.app);
  await db.exec("set role service_role;");
  return db;
}
export async function addCandidate(db:PGlite,id:string,session=ids.session) {
  await db.query(`insert into applications(id,season_id,role_applied,status,source,full_name,email_primary,phone_primary,raw_payload)
    values($1,$2,'mentee','interview_in_progress','vam_os_form','Mentee',$3,'0901234567','{"goal":"Học hỏi"}')`,[id,ids.season,`${id}@example.test`]);
  await db.query("insert into mentee_interview_invites(application_id) values($1)",[id]);
  await db.query("insert into mentee_interview_bookings(application_id,session_id,season_id,previous_application_status) values($1,$2,$3,'interview_ready')",[id,session,ids.season]);
}
export async function save(db:PGlite,action:string,revision:number,values:Record<string,unknown>={},actor=ids.support,app=ids.app) {
  return db.query("select vam104_save_offline_interview($1,$2,$3,$4,$5::jsonb) as result",[actor,app,action,revision,JSON.stringify(values)]);
}
export async function assigned(db:PGlite,app=ids.app,room=1,desk=1) {
  await save(db,"checkin",0,{},ids.support,app);
  await save(db,"assign",1,{room,desk,interviewerId:ids.mentor},ids.support,app);
}
export async function moveBooking(db:PGlite,session:string,reason:string,actor=ids.support,app=ids.app) {
  return db.query("select vam107_move_mentee_booking($1,$2,$3,$4) as result",[actor,app,session,reason]);
}
export async function cancelBooking(db:PGlite,reason:string,actor=ids.support,app=ids.app) {
  return db.query("select vam105_cancel_mentee_booking($1,$2,$3) as result",[actor,app,reason]);
}
export async function guide(db:PGlite,actor:string,season=ids.season,includeHandbook=false) {
  const {rows:[row]}=await db.query<{data:any}>("select vam106_interview_guide($1,$2,$3) as data",[actor,season,includeHandbook]);
  return row.data;
}
export async function saveRubric(db:PGlite,expected:number,criteria:unknown,guidance:unknown={},actor=ids.btc,season=ids.season) {
  return db.query("select vam106_save_interview_rubric($1,$2,$3,$4::jsonb,$5::jsonb) as result",[actor,season,expected,JSON.stringify(criteria),JSON.stringify(guidance)]);
}
export async function saveHandbook(db:PGlite,expected:number,html:string,fileName="Handbook.docx",actor=ids.btc,season=ids.season) {
  return db.query("select vam106_save_interview_handbook($1,$2,$3,$4,$5) as result",[actor,season,expected,html,fileName]);
}
/** Kết quả hợp lệ theo phiếu Mùa 12 (4 tiêu chí). rubricId/rubricVersion điền lúc dựng database. */
export const pass:Record<string,unknown>={
  outcome:"passed",rubricId:"",rubricVersion:0,
  criteria:{need:{score:5,note:"Có development need thật"},readiness:{score:3,note:"Nghe góp ý tốt"},ownership:{score:4,note:"Tự đặt lịch"},follow_through:{score:2,note:"Kế hoạch còn chung"}},
  rationale:"Có động lực",keyNeed:"Khám phá hướng nghề",alignment:"aligned",alignmentNote:"Đã thống nhất lịch gặp",
  takeChoice:"take",desiredMentor:"Thiên về coaching, từng chuyển ngành",additionalNote:""
};
