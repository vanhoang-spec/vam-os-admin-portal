import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

export const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const ids={season:uuid(1),program:uuid(2),support:uuid(3),mentor:uuid(4),other:uuid(5),person:uuid(6),session:uuid(7),app:uuid(8)};
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
    insert into interview_sessions(id,season_id,starts_at,ends_at,seat_limit,booking_closes_at)
      values('${ids.session}','${ids.season}','2026-10-03 01:00Z','2026-10-03 01:30Z',25,'2026-10-02 16:59Z');
  `);
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
export const pass={outcome:"passed",scores:[4,4,5,4,5],note:"Có động lực",takeMentee:true};
