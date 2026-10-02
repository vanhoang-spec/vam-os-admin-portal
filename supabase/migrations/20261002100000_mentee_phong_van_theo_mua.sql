-- ═══════════════════════════════════════════════════════════════════════════
-- Module phỏng vấn mentee THEO MÙA (02/10/2026) — phiếu chấm + Handbook
-- của từng mùa, kế thừa cài đặt gần nhất. Gộp luôn phần chưa dán của PR #190
-- (cờ phỏng vấn ONLINE, Support/BTC huỷ lịch đăng ký) để anh Hoàng dán MỘT lần.
-- Dán TRƯỚC khi merge code phụ thuộc.
--
-- THAY migration 20261001120000_mentee_offline_ghi_chu_online_huy_dat_ca.sql:
-- file đó chưa từng lên database nào. 5 cột note_* của nó bị BỎ — ghi chú
-- theo tiêu chí giờ nằm trong ảnh chụp điểm interview_scores bên dưới, gắn với
-- đúng tiêu chí của mùa thay vì 5 tiêu chí cố định.
--
-- VÌ SAO PHIẾU LÀ DỮ LIỆU THEO MÙA: phiếu S12 (4 tiêu chí có trọng số, không
-- cộng tổng) khác hẳn phiếu 5 tiêu chí/25 điểm đang mã cứng. Mỗi mùa team đổi
-- phiếu thì không phải sửa code và migration nữa — chỉ sửa trên màn hình.
--
-- "CÀI ĐẶT GẦN NHẤT": mùa chưa có phiếu riêng dùng phiếu được LƯU GẦN NHẤT của
-- bất kỳ mùa nào (updated_at). Bảng seasons không có cột thứ tự, nên không suy
-- "mùa trước" từ mã mùa — dùng đúng nghĩa "lần cài đặt gần nhất".
--
-- VÌ SAO LƯU ẢNH CHỤP ĐIỂM (interview_scores) THAY VÌ CHỈ ĐIỂM THEO KEY: phiếu
-- sửa giữa mùa (đổi nhãn, đổi trọng số, bỏ tiêu chí) thì điểm đã nộp vẫn đọc
-- được đúng như lúc chấm, không phụ thuộc phiếu hiện hành.
--
-- KHÔNG ĐỤNG vòng hồ sơ: profile_screening vẫn dùng 5 cột score_*. Vòng phỏng
-- vấn theo phiếu ghi score_*/total_score = null, và vẫn ghi recommendation +
-- reviewer_note vì nhiều màn hình và vam084_recompute_application_review_status
-- đọc hai cột đó.
--
-- vam104_save_offline_interview CHÉP NGUYÊN VĂN từ 20260929100000 (dòng
-- 159–335) bằng script, không gõ tay; chỉ chèn: isOnline/onlineNote ở nhánh
-- assign và phần chấm theo phiếu ở nhánh result. vam105_cancel_mentee_booking
-- chép nguyên văn từ bản #190 đã kiểm.
-- ═══════════════════════════════════════════════════════════════════════════

begin;
set local lock_timeout = '10s';

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $mpv_prereq$
begin
  if to_regclass('public.mentee_interview_operations') is null then
    raise exception 'PREREQ_MISSING: cần bảng mentee_interview_operations — dán 20260927090000 trước';
  end if;
  if to_regclass('public.mentee_interview_bookings') is null then
    raise exception 'PREREQ_MISSING: cần bảng mentee_interview_bookings — dán 20260924190000 trước';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam104_room_desk_bounds') then
    raise exception 'PREREQ_MISSING: cần trigger vam104_room_desk_bounds — dán 20260929100000 trước';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam104_booking_guard') then
    raise exception 'PREREQ_MISSING: cần trigger vam104_booking_guard — dán 20260927090000 trước';
  end if;
  if to_regprocedure('public.vam104_offline_access(uuid,uuid,boolean)') is null
    or to_regprocedure('public.vam084_operator_for_season(uuid,uuid)') is null then
    raise exception 'PREREQ_MISSING: cần vam104_offline_access và vam084_operator_for_season';
  end if;
end;
$mpv_prereq$;

-- ------------------------------------------------------------
-- 1. Cờ phỏng vấn ONLINE (từ #190)
-- ------------------------------------------------------------
alter table public.mentee_interview_operations
  add column if not exists is_online boolean not null default false,
  add column if not exists online_note text;

-- ------------------------------------------------------------
-- 2. Huỷ lịch đăng ký có lý do (từ #190) — cùng tên cột với interview_bookings
-- ------------------------------------------------------------
alter table public.mentee_interview_bookings
  add column if not exists cancelled_by uuid references public.admin_users(id),
  add column if not exists cancel_note text;

-- ------------------------------------------------------------
-- 3. Phiếu chấm + Handbook của từng mùa
-- ------------------------------------------------------------
-- version: tăng khi sửa TIÊU CHÍ/HƯỚNG DẪN — form chấm đang mở so với số này.
-- handbook_version: tăng khi tải Handbook mới — tách riêng để tải Handbook giữa
-- buổi phỏng vấn không làm hỏng các form chấm mentor đang điền dở.
create table if not exists public.mentee_interview_rubrics (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null unique references public.seasons(id),
  version               integer not null default 1 check (version >= 1),
  criteria              jsonb not null check (jsonb_typeof(criteria) = 'array'),
  guidance              jsonb not null default '{}'::jsonb check (jsonb_typeof(guidance) = 'object'),
  handbook_version      integer not null default 0 check (handbook_version >= 0),
  handbook_html         text,
  handbook_file_name    text,
  handbook_updated_at   timestamptz,
  handbook_updated_by   uuid references public.admin_users(id),
  copied_from_season_id uuid references public.seasons(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.admin_users(id)
);

create table if not exists public.mentee_interview_rubric_log (
  id          uuid primary key default gen_random_uuid(),
  rubric_id   uuid not null references public.mentee_interview_rubrics(id),
  season_id   uuid not null references public.seasons(id),
  actor_id    uuid not null references public.admin_users(id),
  action      text not null check (action in ('create', 'save_rubric', 'save_handbook')),
  before_data jsonb,
  after_data  jsonb not null,
  created_at  timestamptz not null default now()
);

-- Khoá công khai nằm sẵn trong mã trang web; Supabase mặc định cấp bảng mới cho
-- anon. Bật RLS + thu hồi ngay trong migration tạo bảng (CLAUDE.md, 16/09/2026).
alter table public.mentee_interview_rubrics enable row level security;
alter table public.mentee_interview_rubric_log enable row level security;
revoke all on public.mentee_interview_rubrics, public.mentee_interview_rubric_log
  from public, anon, authenticated, service_role;
grant select, insert, update on public.mentee_interview_rubrics to service_role;
grant select, insert on public.mentee_interview_rubric_log to service_role;

-- ------------------------------------------------------------
-- 4. Kết quả phỏng vấn theo phiếu trên application_reviews
-- ------------------------------------------------------------
alter table public.application_reviews
  add column if not exists interview_scores jsonb,
  add column if not exists rubric_version integer,
  add column if not exists weighted_score numeric(3,2),
  add column if not exists key_development_need text,
  add column if not exists expectation_alignment text,
  add column if not exists alignment_note text,
  add column if not exists take_choice text,
  add column if not exists desired_mentor_profile text,
  add column if not exists additional_note text;

do $mpv_review_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'application_reviews_interview_scores_check') then
    alter table public.application_reviews add constraint application_reviews_interview_scores_check
      check (interview_scores is null or jsonb_typeof(interview_scores) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_reviews_weighted_score_check') then
    alter table public.application_reviews add constraint application_reviews_weighted_score_check
      check (weighted_score is null or weighted_score between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_reviews_expectation_alignment_check') then
    alter table public.application_reviews add constraint application_reviews_expectation_alignment_check
      check (expectation_alignment is null or expectation_alignment in ('aligned', 'needs_clarification', 'concern'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_reviews_take_choice_check') then
    alter table public.application_reviews add constraint application_reviews_take_choice_check
      check (take_choice is null or take_choice in ('take', 'recommend_other', 'undecided'));
  end if;
end;
$mpv_review_checks$;

-- ------------------------------------------------------------
-- 5. Kiểm hình dạng phiếu — một cửa cho cả lúc lưu lẫn tự kiểm seed
-- ------------------------------------------------------------
create or replace function public.vam106_valid_criteria(p_criteria jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  c jsonb; v_keys text[] := '{}'; v_key text; v_weight numeric; v_sum numeric := 0;
begin
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then return false; end if;
  if jsonb_array_length(p_criteria) not between 1 and 8 then return false; end if;
  for c in select value from jsonb_array_elements(p_criteria) loop
    if jsonb_typeof(c) <> 'object' then return false; end if;
    v_key := c->>'key';
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,39}$' or v_key = any(v_keys) then return false; end if;
    v_keys := v_keys || v_key;
    if jsonb_typeof(c->'weight') is distinct from 'number' then return false; end if;
    v_weight := (c->>'weight')::numeric;
    if v_weight <> trunc(v_weight) or v_weight not between 1 and 100 then return false; end if;
    v_sum := v_sum + v_weight;
    if jsonb_typeof(c->'label') is distinct from 'string' or length(btrim(c->>'label')) not between 1 and 120 then return false; end if;
    if coalesce(jsonb_typeof(c->'label_en'), 'string') <> 'string' or length(coalesce(c->>'label_en', '')) > 120 then return false; end if;
    if coalesce(jsonb_typeof(c->'question'), 'string') <> 'string' or length(coalesce(c->>'question', '')) > 500 then return false; end if;
    if coalesce(jsonb_typeof(c->'descriptors'), 'object') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_each(coalesce(c->'descriptors', '{}'::jsonb)) d
               where d.key not in ('1', '3', '5') or jsonb_typeof(d.value) <> 'string' or length(d.value #>> '{}') > 500) then
      return false;
    end if;
    if coalesce(jsonb_typeof(c->'interview_questions'), 'array') <> 'array'
      or jsonb_array_length(coalesce(c->'interview_questions', '[]'::jsonb)) > 6 then return false; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(c->'interview_questions', '[]'::jsonb)) q
               where jsonb_typeof(q.value) <> 'string' or length(q.value #>> '{}') > 500) then
      return false;
    end if;
  end loop;
  -- Trọng số phải đủ 100: thiếu/thừa là phiếu gõ nhầm, không phải lựa chọn.
  return v_sum = 100;
end;
$$;

create or replace function public.vam106_valid_guidance(p_guidance jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_guidance is not null and jsonb_typeof(p_guidance) = 'object'
    and not exists (
      select 1 from jsonb_each(p_guidance) e
      where e.key not in ('motto', 'note', 'reminder')
         or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 1000
    );
$$;

-- Phiếu hiệu lực của một mùa: dòng riêng của mùa, không có thì dòng được lưu
-- gần nhất của bất kỳ mùa nào. Không có dòng nào thì trả về bản ghi rỗng
-- (id null) — người gọi tự quyết lỗi gì.
create or replace function public.vam106_effective_rubric(p_season uuid)
returns public.mentee_interview_rubrics language sql stable set search_path = '' as $$
  select r.* from public.mentee_interview_rubrics r
  order by (r.season_id = p_season) desc, r.updated_at desc, r.id
  limit 1;
$$;

-- ------------------------------------------------------------
-- 6. Seed phiếu Mùa 12 — từ VAM_Mentee_Evaluation_Season12_Final.xlsx; câu hỏi
--    phỏng vấn lấy từ VAM_Handbook_S12.docx mục 6. lib/mentee-interview-rubric-s12.ts
--    là bản TS của đúng nội dung này; test đối chiếu hai bên.
-- ------------------------------------------------------------
insert into public.mentee_interview_rubrics (season_id, criteria, guidance)
select s.id,
$s12_criteria$[
  {
    "key": "need",
    "label": "Nhu cầu Mentoring & Giá trị phát triển",
    "label_en": "Development Need & Mentoring Value",
    "weight": 30,
    "question": "Mentoring có thể tạo ra giá trị thực sự cho bạn này không?",
    "descriptors": {
      "1": "Chưa thấy nhu cầu mentoring rõ; tham gia chủ yếu vì networking/CV/cơ hội chung.",
      "3": "Có nhu cầu thật nhưng còn chung; cần probing thêm để làm rõ.",
      "5": "Có development need thật; hiểu mình đang cần khám phá/phát triển gì và mentoring phù hợp."
    },
    "interview_questions": [
      "Hiện tại điều gì trong học tập, nghề nghiệp hoặc phát triển bản thân khiến em băn khoăn nhất?",
      "Em đã thử tự tìm hiểu hoặc giải quyết vấn đề đó như thế nào rồi?",
      "Nếu không có Mentor đồng hành, điều gì em nghĩ mình sẽ khó tự nhìn ra hoặc tự giải quyết nhất?",
      "Tình huống: Nếu Mentor chỉ có thể giúp em làm rõ một điều trong 9 tháng, em muốn đó là điều gì? Vì sao?"
    ]
  },
  {
    "key": "readiness",
    "label": "Sẵn sàng học hỏi",
    "label_en": "Learning Readiness / Coachability",
    "weight": 20,
    "question": "Bạn này có chịu học, reflect và thử cách mới không?",
    "descriptors": {
      "1": "Muốn Mentor cho đáp án; defensive trước feedback; ít reflection.",
      "3": "Sẵn sàng nghe và học nhưng evidence chuyển thành hành động còn hạn chế.",
      "5": "Biết lắng nghe, reflect, thử cách khác và điều chỉnh; sẵn sàng bị challenge."
    },
    "interview_questions": [
      "Behavioral: Hãy kể một feedback em từng nhận mà lúc đầu em thấy khó nghe hoặc chưa đồng ý. Sau đó em đã làm gì?",
      "Sau feedback đó, em có thay đổi điều gì không? Kết quả ra sao?",
      "Có điều gì về bản thân mà em biết mình cần thay đổi/phát triển không? Nếu Mentor chỉ ra một điểm em chưa từng nghĩ tới, em sẽ phản ứng thế nào?",
      "Tình huống: Nếu Mentor đưa ra góc nhìn hoàn toàn khác với điều em tin và hai bên vẫn khác quan điểm, em sẽ làm gì?"
    ]
  },
  {
    "key": "ownership",
    "label": "Chủ động & Chịu trách nhiệm",
    "label_en": "Ownership & Initiative",
    "weight": 25,
    "question": "Bạn này có tự làm phần của mình hay chờ Mentor dẫn dắt?",
    "descriptors": {
      "1": "Kỳ vọng Mentor lên lịch, nhắc nhở, xây roadmap hoặc tìm cơ hội giúp.",
      "3": "Hiểu mình phải chủ động nhưng vẫn cần khá nhiều hướng dẫn.",
      "5": "Chủ động chuẩn bị, đặt lịch, follow-up và thực hiện action sau mentoring."
    },
    "interview_questions": [
      "Theo em, trong một mối quan hệ mentoring, phần việc nào thuộc trách nhiệm của Mentee?",
      "Behavioral: Kể một lần em gặp vấn đề chưa biết giải quyết. Trước khi nhờ người khác, em đã chủ động làm gì?",
      "Tình huống: Nếu gần đến tháng mới nhưng Mentor chưa chủ động nhắn để đặt lịch, em sẽ làm gì?",
      "Trước mỗi buổi mentoring em sẽ chuẩn bị gì, và sau buổi em sẽ làm gì để biến trao đổi thành hành động?"
    ]
  },
  {
    "key": "follow_through",
    "label": "Cam kết & Theo đến cùng",
    "label_en": "Commitment & Follow-through",
    "weight": 25,
    "question": "Bạn này có khả năng duy trì hành trình 9 tháng không?",
    "descriptors": {
      "1": "Chưa hiểu workload; chỉ nói “em sẽ cố gắng”; chưa có cách xử lý khi bận.",
      "3": "Hiểu commitment nhưng kế hoạch duy trì còn khá chung.",
      "5": "Có evidence về follow-through; biết ưu tiên, báo sớm và xử lý conflict thay vì ghost/drop."
    },
    "interview_questions": [
      "Tình huống: 9 tháng khá dài và chắc chắn sẽ có lúc em thi, đi làm hoặc rất bận. Khi đó em sẽ xử lý hành trình mentoring thế nào?",
      "Behavioral: Hãy kể một cam kết kéo dài mà có lúc em rất muốn bỏ. Cuối cùng em xử lý ra sao?",
      "Khi nhận ra mình có nguy cơ không thực hiện được điều đã cam kết, em thường làm gì và sẽ chủ động báo với ai?",
      "Tình huống: Nếu cùng tuần có kỳ thi, deadline internship và lịch mentoring/recap, em sẽ sắp xếp và trao đổi thế nào?"
    ]
  }
]$s12_criteria$::jsonb,
$s12_guidance${
  "motto": "Có cần không? • Có chịu học không? • Có tự làm phần của mình không? • Có đi đến cùng không?",
  "note": "Điểm số chỉ hỗ trợ Mentor đánh giá có cấu trúc – KHÔNG dùng làm điểm sàn quyết định Đạt/Không chọn. Không cộng điểm thành tổng. Mentor dùng 4 tiêu chí để hỗ trợ judgment, không dùng công thức để quyết định Đạt/Không chọn.",
  "reminder": "Chưa có định hướng, chưa nhiều kỹ năng hoặc chưa tự tin KHÔNG phải lý do để loại. Hãy đánh giá liệu mentoring có tạo giá trị cho bạn ấy và bạn ấy có sẵn sàng học, chủ động và đi đến cùng hay không."
}$s12_guidance$::jsonb
from public.seasons s
where s.code = 'UEHM-S12'
on conflict (season_id) do nothing;

-- ------------------------------------------------------------
-- 7. vam104_save_offline_interview — sinh bằng script từ 20260929100000
-- ------------------------------------------------------------
create or replace function public.vam104_save_offline_interview(
  p_actor uuid, p_application uuid, p_action text, p_revision integer, p_values jsonb default '{}'
) returns jsonb language plpgsql set search_path = '' as $$
declare
  a public.applications%rowtype; b public.mentee_interview_bookings%rowtype;
  o public.mentee_interview_operations%rowtype; v_before jsonb; v_review_before jsonb;
  v_operate boolean; v_reviewer uuid; v_person uuid; v_mentor uuid; v_profile uuid;
  v_count integer; v_status text; v_outcome text; v_reason text; v_scores integer[];
  v_name text; v_email text; v_program uuid; v_membership uuid; v_old_member_status text;
  v_match uuid; v_take boolean; v_room integer; v_desk integer;
  v_is_online boolean; v_online_note text;
  v_rubric public.mentee_interview_rubrics%rowtype; v_snapshot jsonb; v_weighted numeric;
  v_rationale text; v_key_need text; v_alignment text; v_take_choice text; v_desired text;
begin
  if current_user <> 'service_role' then raise exception 'ACCESS_DENIED'; end if;
  select * into a from public.applications where id=p_application;
  if a.id is null or a.role_applied::text<>'mentee' or not public.vam104_offline_access(p_actor,a.season_id)
    then raise exception 'ACCESS_DENIED'; end if;
  -- Cùng khóa trước mọi bản ghi để luồng cũ và mới không tranh sức chứa.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || a.season_id::text,0));
  select * into a from public.applications where id=p_application for update;
  if a.status='withdrawn' then raise exception 'APPLICATION_WITHDRAWN'; end if;
  select * into b from public.mentee_interview_bookings where application_id=a.id and status='booked' for update;
  if b.id is null then raise exception 'NO_BOOKING'; end if;
  insert into public.mentee_interview_operations(id,session_id) values(a.id,b.session_id) on conflict(id) do nothing;
  select * into o from public.mentee_interview_operations where id=a.id for update;
  if o.revision is distinct from p_revision then raise exception 'STALE_REVISION'; end if;
  if o.session_id<>b.session_id and o.checked_in_at is not null then raise exception 'SESSION_CHANGED'; end if;
  v_before:=to_jsonb(o);
  v_operate:=public.vam104_offline_access(p_actor,a.season_id,true);
  v_reason:=nullif(btrim(p_values->>'reason'),'');
  perform set_config('vam.offline_application',a.id::text,true);
  select coalesce(full_name,email) into v_name from public.admin_users where id=p_actor;

  if p_action='checkin' then
    if not v_operate then raise exception 'ACCESS_DENIED'; end if;
    if o.checked_in_at is not null then return jsonb_build_object('ok',true,'message','Bạn này đã check-in.'); end if;
    update public.mentee_interview_operations set session_id=b.session_id,checked_in_at=now(),checked_in_by=p_actor where id=a.id;
  elsif p_action='assign' then
    if not v_operate then raise exception 'ACCESS_DENIED'; end if;
    if o.checked_in_at is null then raise exception 'CHECKIN_REQUIRED'; end if;
    if o.outcome is not null then raise exception 'ALREADY_SCORED'; end if;
    v_room:=(p_values->>'room')::integer; v_desk:=(p_values->>'desk')::integer;
    v_reviewer:=(p_values->>'interviewerId')::uuid;
    -- Online là THÊM, không thay room/desk/interviewer: mentee online vẫn có
    -- bàn/mentor cố định, chỉ đổi cách gặp — không nới required ở ba ô cũ.
    v_is_online:=coalesce((p_values->>'isOnline')::boolean,false);
    v_online_note:=nullif(btrim(p_values->>'onlineNote'),'');
    if v_room is null or v_room not between 1 and 6 or v_desk is null or v_desk not between 1 and 6
      or v_reviewer is null or not public.vam084_participant_for_stage(v_reviewer,a.season_id,'interview')
      then raise exception 'INVALID_ASSIGNMENT'; end if;
    if o.interviewer_id is not null and o.interviewer_id<>v_reviewer and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
    -- Giữ phiếu nếu chỉ đổi bàn; nhận lại phiếu cũ chưa nộp để tránh trùng.
    if o.review_id is not null and o.interviewer_id=v_reviewer then
      v_profile:=o.review_id;
    else
    if o.review_id is not null then
      update public.application_reviews set status='cancelled',updated_at=now() where id=o.review_id;
    end if;
    select id into v_profile from public.application_reviews where application_id=a.id and review_round='interview'
      and reviewer_admin_user_id=v_reviewer and status<>'cancelled' for update;
    if v_profile is not null then
      if exists(select 1 from public.application_reviews where id=v_profile and status='submitted') then raise exception 'EXISTING_SUBMITTED_REVIEW'; end if;
      update public.application_reviews set offline_managed=true where id=v_profile;
    else
      insert into public.application_reviews(application_id,review_round,reviewer_admin_user_id,assigned_by,status,offline_managed)
        values(a.id,'interview',v_reviewer,p_actor,'assigned',true) returning id into v_profile;
    end if;
    end if;
    update public.mentee_interview_operations
      set room=v_room,desk=v_desk,interviewer_id=v_reviewer,review_id=v_profile,is_online=v_is_online,online_note=v_online_note
      where id=a.id;
  elsif p_action='result' then
    if o.interviewer_id is distinct from p_actor then raise exception 'NOT_ASSIGNED'; end if;
    if o.checked_in_at is null or o.review_id is null then raise exception 'CHECKIN_REQUIRED'; end if;
    v_outcome:=p_values->>'outcome';
    if v_outcome is null or v_outcome not in ('passed','rejected','needs_review') then raise exception 'INVALID_RESULT'; end if;
    -- Kết quả lần đầu đã có ô "Lý do chọn/không chọn" bắt buộc riêng; lý do
    -- SỬA chỉ còn bắt buộc khi đổi một kết quả đã chốt.
    if o.outcome is not null and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
    -- Phiếu chấm của mùa: dòng riêng của mùa, không có thì phiếu lưu gần nhất.
    -- Form đang mở gửi kèm id + phiên bản phiếu; BTC sửa phiếu giữa chừng thì
    -- từ chối thay vì ghi điểm theo bộ tiêu chí mentor không nhìn thấy.
    v_rubric:=public.vam106_effective_rubric(a.season_id);
    if v_rubric.id is null then raise exception 'RUBRIC_MISSING'; end if;
    if (p_values->>'rubricId') is distinct from v_rubric.id::text
      or (p_values->>'rubricVersion') is distinct from v_rubric.version::text
      then raise exception 'RUBRIC_CHANGED'; end if;
    if jsonb_typeof(p_values->'criteria') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_values->'criteria') k
                where k not in (select c->>'key' from jsonb_array_elements(v_rubric.criteria) c))
      or exists(select 1 from jsonb_array_elements(v_rubric.criteria) c
                where coalesce(p_values->'criteria'->(c->>'key')->>'score','') !~ '^[1-5]$')
      then raise exception 'INVALID_SCORES'; end if;
    if exists(select 1 from jsonb_array_elements(v_rubric.criteria) c
              where length(coalesce(p_values->'criteria'->(c->>'key')->>'note',''))>2000)
      then raise exception 'TEXT_TOO_LONG'; end if;
    select jsonb_agg(jsonb_build_object(
             'key',c->>'key','label',c->>'label','weight',(c->>'weight')::integer,
             'score',(p_values->'criteria'->(c->>'key')->>'score')::integer,
             'note',nullif(btrim(p_values->'criteria'->(c->>'key')->>'note'),'')) order by ord)
      into v_snapshot from jsonb_array_elements(v_rubric.criteria) with ordinality t(c,ord);
    -- Điểm quy đổi (thang 1–5) chỉ để BTC tham khảo — phiếu ghi rõ không cộng
    -- tổng và không có điểm sàn; không dùng để tự quyết Đạt/Không chọn.
    select round(sum((x->>'score')::numeric*(x->>'weight')::numeric)/sum((x->>'weight')::numeric),2)
      into v_weighted from jsonb_array_elements(v_snapshot) x;
    v_rationale:=nullif(btrim(p_values->>'rationale'),'');
    v_key_need:=nullif(btrim(p_values->>'keyNeed'),'');
    v_alignment:=p_values->>'alignment';
    v_take_choice:=p_values->>'takeChoice';
    v_desired:=nullif(btrim(p_values->>'desiredMentor'),'');
    if v_rationale is null then raise exception 'RATIONALE_REQUIRED'; end if;
    if v_key_need is null then raise exception 'KEY_NEED_REQUIRED'; end if;
    if v_alignment is null or v_alignment not in ('aligned','needs_clarification','concern') then raise exception 'INVALID_ALIGNMENT'; end if;
    if v_take_choice is null or v_take_choice not in ('take','recommend_other','undecided') then raise exception 'INVALID_TAKE_CHOICE'; end if;
    if v_desired is null then raise exception 'DESIRED_MENTOR_REQUIRED'; end if;
    if length(v_rationale)>4000 or length(v_key_need)>2000 or length(v_desired)>2000
      or length(coalesce(p_values->>'alignmentNote',''))>2000 or length(coalesce(p_values->>'additionalNote',''))>4000
      then raise exception 'TEXT_TOO_LONG'; end if;
    -- Từ đây xuống, v_reason là lý do của quyết định (lý do sửa nếu có, không
    -- thì lý do chọn/không chọn) — các chỗ ghi lịch sử bên dưới giữ nguyên văn.
    v_reason:=coalesce(v_reason,v_rationale);
    v_take:=(v_take_choice='take');
    if v_take and v_outcome<>'passed' then raise exception 'INVALID_RESULT'; end if;
    select to_jsonb(r) into v_review_before from public.application_reviews r where r.id=o.review_id;
    update public.application_reviews set
      score_motivation=null,score_goal_clarity=null,score_commitment=null,score_fit=null,score_communication=null,total_score=null,
      interview_scores=v_snapshot,rubric_version=v_rubric.version,weighted_score=v_weighted,
      key_development_need=v_key_need,expectation_alignment=v_alignment,alignment_note=nullif(btrim(p_values->>'alignmentNote'),''),
      take_choice=v_take_choice,desired_mentor_profile=v_desired,additional_note=nullif(btrim(p_values->>'additionalNote'),''),
      recommendation=case v_outcome when 'passed' then 'approve_recommended' when 'rejected' then 'reject' else 'needs_admin_review' end,
      reviewer_note=v_rationale,status='submitted',submitted_at=now(),updated_at=now()
      where id=o.review_id;

    v_person:=a.person_id;
    if v_outcome='passed' then
      v_email:=lower(btrim(a.email_primary));
      if nullif(v_email,'') is null then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      perform pg_advisory_xact_lock(hashtext('VAM092_PERSON_EMAIL|' || v_email));
      if v_person is null then
        select count(*),(array_agg(id))[1] into v_count,v_person from public.people where lower(btrim(email_primary))=v_email;
        if v_count>1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
        if v_count=0 then
          if nullif(btrim(a.full_name),'') is null then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
          insert into public.people(full_name,email_primary,phone_primary,source_sheets)
            values(a.full_name,v_email,a.phone_primary,'s12_native_application') returning id into v_person;
        end if;
      elsif not exists(select 1 from public.people where id=v_person and lower(btrim(email_primary))=v_email) then
        raise exception 'IDENTITY_REQUIRES_BTC';
      end if;
      perform pg_advisory_xact_lock(hashtext('VAM092_PERSON|' || v_person::text));
      select count(*) into v_count from public.mentee_profiles where person_id=v_person;
      if v_count>1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      if v_count=0 then insert into public.mentee_profiles(person_id,source_application_id,intake_batch_id)
        values(v_person,a.id,a.intake_batch_id); end if;
      select program_id into v_program from public.seasons where id=a.season_id;
      select count(*),(array_agg(id))[1] into v_count,v_membership from public.person_season_memberships
        where person_id=v_person and season_id=a.season_id and role='mentee';
      if v_count>1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      if v_membership is null then
        insert into public.person_season_memberships(person_id,program_id,season_id,role,status,source,created_by)
          values(v_person,v_program,a.season_id,'mentee','active','manual',p_actor) returning id into v_membership;
        update public.mentee_interview_operations set membership_id=v_membership,owns_membership=true where id=a.id;
        insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
          values(v_membership,v_person,v_program,a.season_id,'mentee',null,'active','created','Đạt phỏng vấn trực tiếp',p_actor);
      else
        select status into v_old_member_status from public.person_season_memberships where id=v_membership for update;
        if v_old_member_status<>'active' then
          if not o.owns_membership or o.membership_id is distinct from v_membership then raise exception 'MEMBERSHIP_REQUIRES_BTC'; end if;
          update public.person_season_memberships set status='active',end_date=null,updated_at=now() where id=v_membership;
          insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
            values(v_membership,v_person,v_program,a.season_id,'mentee',v_old_member_status,'active','status_change',v_reason,p_actor);
        end if;
      end if;
    end if;

    -- Sửa nhầm chỉ được hủy match do CHÍNH lượt phỏng vấn này tạo.
    v_match:=o.match_id;
    if v_match is not null and (not v_take or v_outcome<>'passed') then
      if exists(select 1 from public.matches m join public.people p on p.id=m.mentor_person_id
        join public.admin_users u on u.id=p_actor where m.id=v_match and m.status='active'
        and (m.season_id<>a.season_id or m.mentee_person_id<>v_person or lower(btrim(p.email_primary)) is distinct from lower(btrim(u.email))))
        then raise exception 'OTHER_MATCH_REQUIRES_BTC'; end if;
      update public.matches set status='dropped',notes=coalesce(v_reason,'Sửa lựa chọn nhận mentee')
        where id=v_match and status='active';
      v_match:=null;
    end if;
    if v_outcome<>'passed' and v_person is not null then
      if exists(select 1 from public.matches where mentee_person_id=v_person and season_id=a.season_id and status='active')
        then raise exception 'OTHER_MATCH_REQUIRES_BTC'; end if;
      if o.owns_membership and o.membership_id is not null then
        select status,program_id into v_old_member_status,v_program from public.person_season_memberships where id=o.membership_id for update;
        update public.person_season_memberships set status='withdrawn',end_date=(now() at time zone 'Asia/Ho_Chi_Minh')::date,updated_at=now() where id=o.membership_id;
        insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
          values(o.membership_id,v_person,v_program,a.season_id,'mentee',v_old_member_status,'withdrawn','status_change',v_reason,p_actor);
      elsif exists(select 1 from public.person_season_memberships where person_id=v_person and season_id=a.season_id and role='mentee' and status='active') then
        raise exception 'MEMBERSHIP_REQUIRES_BTC';
      end if;
    end if;
    if v_take then
      -- Cùng quy tắc nhận diện tài khoản interviewer hiện hành: email chuẩn,
      -- nhưng từ chối nhập nhằng, không lấy tùy tiện dòng đầu tiên.
      select count(*),(array_agg(p.id))[1] into v_count,v_mentor from public.people p join public.admin_users u
        on lower(btrim(u.email))=lower(btrim(p.email_primary)) where u.id=p_actor;
      if v_count<>1 or not exists(select 1 from public.applications where person_id=v_mentor and season_id=a.season_id and status='approved_as_mentor')
        then raise exception 'MENTOR_NOT_APPROVED'; end if;
      if v_match is not null and not exists(select 1 from public.matches where id=v_match and status='active' and mentor_person_id=v_mentor) then v_match:=null; end if;
      if v_match is null then
        insert into public.matches(season_id,mentor_person_id,mentee_person_id,status,match_source_raw,match_type,matched_at,notes)
          values(a.season_id,v_mentor,v_person,'active','manual','primary',(now() at time zone 'Asia/Ho_Chi_Minh')::date,'Mentor nhận tại buổi phỏng vấn') returning id into v_match;
      end if;
    end if;
    v_status:=case v_outcome when 'passed' then 'approved_as_mentee' when 'rejected' then 'rejected_or_not_fit' else 'needs_more_review' end;
    update public.applications set status=v_status,person_id=v_person where id=a.id;
    insert into public.application_decisions(application_id,decided_by,decided_by_name,decision,previous_status,new_status,decision_note)
      values(a.id,p_actor,v_name,v_status,a.status,v_status,coalesce(v_reason,nullif(btrim(p_values->>'note'),'')));
    update public.mentee_interview_operations set outcome=v_outcome,outcome_reason=v_reason,match_id=v_match where id=a.id;
  else raise exception 'INVALID_ACTION'; end if;

  update public.mentee_interview_operations set revision=revision+1,updated_at=now() where id=a.id returning * into o;
  insert into public.mentee_interview_operation_log(application_id,actor_id,action,reason,before_data,after_data)
    values(a.id,p_actor,p_action,v_reason,jsonb_build_object('operation',v_before,'review',v_review_before),
      jsonb_build_object('operation',to_jsonb(o),'values',p_values));
  perform set_config('vam.offline_application','',true);
  return jsonb_build_object('ok',true,'message','Đã lưu.','revision',o.revision);
end;
$$;
revoke all on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) to service_role;

-- ------------------------------------------------------------
-- 8. vam105_cancel_mentee_booking — nguyên văn từ #190
-- ------------------------------------------------------------
create or replace function public.vam105_cancel_mentee_booking(
  p_actor uuid, p_application uuid, p_reason text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  a public.applications%rowtype;
  b public.mentee_interview_bookings%rowtype;
  v_reason text;
begin
  if current_user <> 'service_role' then raise exception 'ACCESS_DENIED'; end if;
  select * into a from public.applications where id=p_application for update;
  if a.id is null or a.role_applied::text<>'mentee' or not public.vam104_offline_access(p_actor,a.season_id,true)
    then raise exception 'ACCESS_DENIED'; end if;
  v_reason:=nullif(btrim(p_reason),'');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  select * into b from public.mentee_interview_bookings where application_id=a.id and status='booked' for update;
  if b.id is null then raise exception 'NO_BOOKING'; end if;
  -- vam104_booking_guard (trigger có sẵn trên chính bảng này) tự raise
  -- ALREADY_CHECKED_IN nếu mentee đã check-in — không lặp lại phép kiểm đó ở đây.
  update public.mentee_interview_bookings
    set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancel_note=v_reason
    where id=b.id;
  insert into public.mentee_interview_operation_log(application_id,actor_id,action,reason,before_data,after_data)
    values(a.id,p_actor,'cancel_booking',v_reason,
      jsonb_build_object('booking',to_jsonb(b)),
      jsonb_build_object('booking',jsonb_build_object('id',b.id,'status','cancelled','cancelled_by',p_actor)));
  return jsonb_build_object('ok',true,'message','Đã huỷ lịch đăng ký của '||coalesce(a.full_name,'ứng viên')||' — chỗ đã mở lại.');
end;
$$;
revoke all on function public.vam105_cancel_mentee_booking(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.vam105_cancel_mentee_booking(uuid,uuid,text) to service_role;

-- ------------------------------------------------------------
-- 9. Đọc phiếu + Handbook (mentor, Support, BTC)
-- ------------------------------------------------------------
create or replace function public.vam106_interview_guide(
  p_actor uuid, p_season uuid, p_include_handbook boolean default false
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  r public.mentee_interview_rubrics%rowtype;
begin
  -- Cổng xem màn hình phỏng vấn: BTC vận hành mùa, Support có scope, và người
  -- được cấp vai trò phỏng vấn của mùa. Không đọc được bảng quyền → false.
  if not public.vam104_offline_access(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  r := public.vam106_effective_rubric(p_season);
  return jsonb_build_object(
    'rubric', case when r.id is null then null else jsonb_build_object(
      'id', r.id,
      'seasonId', r.season_id,
      'seasonCode', (select s.code from public.seasons s where s.id = r.season_id),
      'own', r.season_id = p_season,
      'version', r.version,
      'handbookVersion', r.handbook_version,
      'criteria', r.criteria,
      'guidance', r.guidance,
      'copiedFromSeasonCode', (select s.code from public.seasons s where s.id = r.copied_from_season_id),
      'updatedAt', r.updated_at,
      'updatedByName', (select coalesce(u.full_name, u.email) from public.admin_users u where u.id = r.updated_by),
      'hasHandbook', r.handbook_html is not null,
      'handbookHtml', case when p_include_handbook then r.handbook_html end,
      'handbookFileName', r.handbook_file_name,
      'handbookUpdatedAt', r.handbook_updated_at,
      'handbookUpdatedByName', (select coalesce(u.full_name, u.email) from public.admin_users u where u.id = r.handbook_updated_by)
    ) end,
    'submittedCount', (
      select count(*) from public.application_reviews ar
      join public.applications a on a.id = ar.application_id
      where a.season_id = p_season and ar.review_round = 'interview'
        and ar.status = 'submitted' and ar.interview_scores is not null
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 10. Lưu phiếu (tiêu chí + hướng dẫn) của một mùa
-- ------------------------------------------------------------
create or replace function public.vam106_save_interview_rubric(
  p_actor uuid, p_season uuid, p_expected_version integer, p_criteria jsonb, p_guidance jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare
  r public.mentee_interview_rubrics%rowtype;
  src public.mentee_interview_rubrics%rowtype;
  v_before jsonb; v_action text;
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'ACCESS_DENIED'; end if;
  if not public.vam106_valid_criteria(p_criteria) or not public.vam106_valid_guidance(p_guidance) then
    raise exception 'INVALID_RUBRIC';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('VAM106_RUBRIC|' || p_season::text, 0));
  select * into r from public.mentee_interview_rubrics where season_id = p_season for update;
  if r.id is not null then
    if p_expected_version is distinct from r.version then raise exception 'STALE_VERSION'; end if;
    v_before := jsonb_build_object('version', r.version, 'criteria', r.criteria, 'guidance', r.guidance);
    update public.mentee_interview_rubrics
      set criteria = p_criteria, guidance = p_guidance, version = version + 1,
          updated_at = now(), updated_by = p_actor
      where id = r.id returning * into r;
    v_action := 'save_rubric';
  else
    -- Mùa chưa có phiếu riêng: lần lưu đầu tạo phiếu riêng, mang theo Handbook
    -- của phiếu đang dùng để mùa này sở hữu trọn bộ cài đặt.
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'STALE_VERSION'; end if;
    src := public.vam106_effective_rubric(p_season);
    insert into public.mentee_interview_rubrics (
      season_id, criteria, guidance, handbook_version, handbook_html, handbook_file_name,
      handbook_updated_at, handbook_updated_by, copied_from_season_id, updated_by
    ) values (
      p_season, p_criteria, p_guidance, case when src.handbook_html is null then 0 else 1 end,
      src.handbook_html, src.handbook_file_name, src.handbook_updated_at, src.handbook_updated_by,
      src.season_id, p_actor
    ) returning * into r;
    v_before := case when src.id is null then null else
      jsonb_build_object('copiedFromSeason', src.season_id, 'version', src.version,
                         'criteria', src.criteria, 'guidance', src.guidance) end;
    v_action := 'create';
  end if;
  insert into public.mentee_interview_rubric_log (rubric_id, season_id, actor_id, action, before_data, after_data)
  values (r.id, p_season, p_actor, v_action, v_before,
          jsonb_build_object('version', r.version, 'criteria', r.criteria, 'guidance', r.guidance));
  return jsonb_build_object('ok', true, 'message', 'Đã lưu phiếu chấm.', 'version', r.version);
end;
$$;

-- ------------------------------------------------------------
-- 11. Lưu Handbook (HTML đã lọc ở tầng ứng dụng) của một mùa
-- ------------------------------------------------------------
create or replace function public.vam106_save_interview_handbook(
  p_actor uuid, p_season uuid, p_expected_handbook_version integer, p_html text, p_file_name text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  r public.mentee_interview_rubrics%rowtype;
  src public.mentee_interview_rubrics%rowtype;
  v_before jsonb; v_action text;
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'ACCESS_DENIED'; end if;
  if nullif(btrim(p_html), '') is null or length(p_html) > 500000
    or nullif(btrim(p_file_name), '') is null or length(p_file_name) > 200 then
    raise exception 'INVALID_HANDBOOK';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('VAM106_RUBRIC|' || p_season::text, 0));
  select * into r from public.mentee_interview_rubrics where season_id = p_season for update;
  if r.id is not null then
    if p_expected_handbook_version is distinct from r.handbook_version then raise exception 'STALE_VERSION'; end if;
    v_before := jsonb_build_object('handbookVersion', r.handbook_version,
                                   'handbookFileName', r.handbook_file_name, 'handbookHtml', r.handbook_html);
    update public.mentee_interview_rubrics
      set handbook_html = p_html, handbook_file_name = btrim(p_file_name),
          handbook_version = handbook_version + 1, handbook_updated_at = now(), handbook_updated_by = p_actor,
          updated_at = now(), updated_by = p_actor
      where id = r.id returning * into r;
    v_action := 'save_handbook';
  else
    if coalesce(p_expected_handbook_version, 0) <> 0 then raise exception 'STALE_VERSION'; end if;
    src := public.vam106_effective_rubric(p_season);
    if src.id is null then raise exception 'RUBRIC_MISSING'; end if;
    insert into public.mentee_interview_rubrics (
      season_id, criteria, guidance, handbook_version, handbook_html, handbook_file_name,
      handbook_updated_at, handbook_updated_by, copied_from_season_id, updated_by
    ) values (
      p_season, src.criteria, src.guidance, 1, p_html, btrim(p_file_name),
      now(), p_actor, src.season_id, p_actor
    ) returning * into r;
    v_before := jsonb_build_object('copiedFromSeason', src.season_id, 'version', src.version,
                                   'criteria', src.criteria, 'guidance', src.guidance);
    v_action := 'create';
  end if;
  insert into public.mentee_interview_rubric_log (rubric_id, season_id, actor_id, action, before_data, after_data)
  values (r.id, p_season, p_actor, v_action, v_before,
          jsonb_build_object('handbookVersion', r.handbook_version,
                             'handbookFileName', r.handbook_file_name, 'handbookHtml', r.handbook_html));
  return jsonb_build_object('ok', true, 'message', 'Đã lưu Handbook.', 'handbookVersion', r.handbook_version);
end;
$$;

revoke all on function public.vam106_valid_criteria(jsonb) from public, anon, authenticated;
revoke all on function public.vam106_valid_guidance(jsonb) from public, anon, authenticated;
revoke all on function public.vam106_effective_rubric(uuid) from public, anon, authenticated;
revoke all on function public.vam106_interview_guide(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.vam106_save_interview_rubric(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.vam106_save_interview_handbook(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.vam106_valid_criteria(jsonb) to service_role;
grant execute on function public.vam106_valid_guidance(jsonb) to service_role;
grant execute on function public.vam106_effective_rubric(uuid) to service_role;
grant execute on function public.vam106_interview_guide(uuid, uuid, boolean) to service_role;
grant execute on function public.vam106_save_interview_rubric(uuid, uuid, integer, jsonb, jsonb) to service_role;
grant execute on function public.vam106_save_interview_handbook(uuid, uuid, integer, text, text) to service_role;

-- ------------------------------------------------------------
-- 12. Tự kiểm
-- ------------------------------------------------------------
do $mpv_selfcheck$
declare
  v_col text; v_fn text; v_table text; v_s12 public.mentee_interview_rubrics%rowtype; v_legacy integer;
begin
  foreach v_col in array array[
    'mentee_interview_operations.is_online', 'mentee_interview_operations.online_note',
    'mentee_interview_bookings.cancelled_by', 'mentee_interview_bookings.cancel_note',
    'application_reviews.interview_scores', 'application_reviews.rubric_version',
    'application_reviews.weighted_score', 'application_reviews.key_development_need',
    'application_reviews.expectation_alignment', 'application_reviews.alignment_note',
    'application_reviews.take_choice', 'application_reviews.desired_mentor_profile',
    'application_reviews.additional_note'
  ] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = split_part(v_col, '.', 1)
                     and column_name = split_part(v_col, '.', 2)) then
      raise exception 'SELF_CHECK column: %', v_col;
    end if;
  end loop;

  foreach v_table in array array['mentee_interview_rubrics', 'mentee_interview_rubric_log'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity) then
      raise exception 'SELF_CHECK RLS off: %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      or has_table_privilege('anon', 'public.' || v_table, 'INSERT') then
      raise exception 'SELF_CHECK anon/authenticated reach: %', v_table;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)',
    'public.vam105_cancel_mentee_booking(uuid,uuid,text)',
    'public.vam106_interview_guide(uuid,uuid,boolean)',
    'public.vam106_save_interview_rubric(uuid,uuid,integer,jsonb,jsonb)',
    'public.vam106_save_interview_handbook(uuid,uuid,integer,text,text)',
    'public.vam106_effective_rubric(uuid)'
  ] loop
    if to_regprocedure(v_fn) is null
      or has_function_privilege('anon', v_fn, 'EXECUTE')
      or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'SELF_CHECK function missing or exposed: %', v_fn;
    end if;
  end loop;

  select prosrc into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam104_save_offline_interview';
  if v_fn is null or position('vam106_effective_rubric' in v_fn) = 0 or position('RUBRIC_CHANGED' in v_fn) = 0
    or position('isOnline' in v_fn) = 0 or position('weighted_score' in v_fn) = 0
    or position('score_motivation=v_scores' in v_fn) > 0 then
    raise exception 'SELF_CHECK vam104_save_offline_interview chưa theo phiếu của mùa';
  end if;

  if exists (select 1 from public.seasons where code = 'UEHM-S12') then
    select r.* into v_s12 from public.mentee_interview_rubrics r
      join public.seasons s on s.id = r.season_id where s.code = 'UEHM-S12';
    if v_s12.id is null or jsonb_array_length(v_s12.criteria) <> 4
      or not public.vam106_valid_criteria(v_s12.criteria) or not public.vam106_valid_guidance(v_s12.guidance) then
      raise exception 'SELF_CHECK seed phiếu Mùa 12 thiếu hoặc sai hình dạng';
    end if;
  end if;

  -- Chỉ báo, không chặn: phiếu phỏng vấn trực tiếp đã nộp theo 5 tiêu chí cũ vẫn
  -- giữ nguyên score_*; màn hình hiện chúng theo 5 nhãn cũ.
  select count(*) into v_legacy from public.application_reviews
    where review_round = 'interview' and offline_managed and status = 'submitted' and interview_scores is null;
  raise notice 'Phiếu phỏng vấn trực tiếp đã nộp theo 5 tiêu chí cũ: %', v_legacy;
end;
$mpv_selfcheck$;

commit;
