-- Ban tổ chức sửa được nội dung bài chấm, kể cả bài đã nộp.
--
-- Chủ dự án chốt 18/09/2026: Core Team sửa được nội dung bài chấm (điểm, nhận xét,
-- đề xuất) của hồ sơ mentor và mentee; Support Team sửa được của hồ sơ mentee.
--
-- Hôm nay không ai sửa được: `vam084_submit_application_review` đòi người thao tác
-- CHÍNH LÀ người được giao chấm, và chỉ nhận bài chưa nộp. Đó là luật đúng cho ô
-- chấm của reviewer, nên không đụng vào nó — thêm một đường riêng cho ban tổ chức,
-- ghi rõ ai sửa và giá trị trước đó.
--
-- Cổng quyền dùng lại `vam096_decision_operator_for_application` (migration
-- 20260918150000): mentor cần Core Team trở lên, mentee thêm Support Team, và cả
-- hai vẫn cần quyền vận hành đúng mùa của hồ sơ.
--
-- Hoàn nguyên:
--   drop function if exists public.vam096_override_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text);
-- Ràng buộc nhật ký giữ nguyên giá trị đã nới; gỡ nó ra là làm hỏng các dòng đã ghi.

begin;

set local lock_timeout = '10s';

do $preflight$
declare
  v_missing text;
begin
  foreach v_missing in array array[
    'public.vam096_decision_operator_for_application(uuid, uuid)',
    'public.vam084_recompute_application_review_status(uuid, text)'
  ] loop
    if to_regprocedure(v_missing) is null then
      raise exception 'PRECONDITION: thiếu hàm %', v_missing;
    end if;
  end loop;

  if to_regclass('public.application_reviews') is null then
    raise exception 'PRECONDITION: thiếu bảng application_reviews';
  end if;
end
$preflight$;

-- ── Nới ràng buộc loại hành động của nhật ký, theo lối CỘNG THÊM ─────────────
-- Viết đè cả danh sách nghĩa là mỗi lần thêm phải chép đúng toàn bộ giá trị đã có,
-- và chép thiếu một cái thì những dòng loại đó lặng lẽ ngừng ghi được.
do $audit_widen$
declare
  v_new constant text := 'override_application_review';
  v_existing      text;
  v_before_values text[];
  v_quotes        integer;
  v_tail          text;
  v_rebuilt       text;
  v_after         text;
  v_after_values  text[];
  v_lost          text[];
  v_expected      text[];
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_existing not ilike '%= ANY (ARRAY[%' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check không ở dạng ANY (ARRAY[...]): %',
      v_existing;
  end if;

  if position(quote_literal(v_new) in v_existing) > 0 then
    raise notice 'AUDIT: ràng buộc đã nhận override_application_review; không làm gì.';
    return;
  end if;

  select array_agg(m[1] order by m[1])
    into v_before_values
  from regexp_matches(v_existing, '''([^'']*)''::text', 'g') as m;

  -- Mỗi giá trị đóng góp đúng hai dấu nháy. Lệch nghĩa là đọc hụt — và so
  -- trước/sau trên một tập đọc hụt thì không chứng minh được gì.
  v_quotes := length(v_existing) - length(replace(v_existing, '''', ''));
  if v_before_values is null or v_quotes <> cardinality(v_before_values) * 2 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đọc được % giá trị nhưng đếm được % dấu nháy trong admin_audit_log_action_type_check',
      coalesce(cardinality(v_before_values), 0), v_quotes;
  end if;

  v_tail := substring(v_existing from '[]][)]+$');
  if v_tail is null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào admin_audit_log_action_type_check: %',
      v_existing;
  end if;

  v_rebuilt := left(v_existing, length(v_existing) - length(v_tail))
            || format(', %L::text', v_new)
            || v_tail;

  execute 'alter table public.admin_audit_log drop constraint admin_audit_log_action_type_check';
  execute 'alter table public.admin_audit_log add constraint admin_audit_log_action_type_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');

  select pg_get_constraintdef(c.oid)
    into v_after
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  select array_agg(m[1] order by m[1])
    into v_after_values
  from regexp_matches(v_after, '''([^'']*)''::text', 'g') as m;

  select coalesce(array_agg(b order by b), '{}')
    into v_lost
  from unnest(v_before_values) as b
  where not (b = any (coalesce(v_after_values, '{}')));

  if cardinality(v_lost) > 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ: %',
      v_lost;
  end if;

  select array_agg(x order by x)
    into v_expected
  from (
    select unnest(v_before_values) as x
    union
    select v_new
  ) as s;

  if v_expected is distinct from v_after_values then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: tập giá trị sau khi nới không khớp tập mong đợi (trước % → sau %)',
      cardinality(v_before_values), cardinality(v_after_values);
  end if;

  raise notice 'AUDIT: nới từ % lên % giá trị.',
    cardinality(v_before_values), cardinality(v_after_values);
end;
$audit_widen$;

-- ── Đường sửa bài chấm của ban tổ chức ──────────────────────────────────────
create or replace function public.vam096_override_application_review(
  p_review_id uuid,
  p_actor uuid,
  p_score_motivation integer default null,
  p_score_goal_clarity integer default null,
  p_score_commitment integer default null,
  p_score_fit integer default null,
  p_score_communication integer default null,
  p_recommendation text default null,
  p_reviewer_note text default null
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_review public.application_reviews%rowtype;
  v_app public.applications%rowtype;
  v_total integer;
  v_note text;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if v_review.id is null then
    raise exception 'Review not found';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = v_review.application_id
  for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if v_app.status = 'withdrawn' then
    raise exception 'APPLICATION_WITHDRAWN';
  end if;

  -- Cùng phép chia mentor/mentee với việc đổi kết quả, kể cả điều kiện phạm vi mùa.
  if not public.vam096_decision_operator_for_application(p_actor, v_app.id) then
    raise exception 'Review override actor is not authorized for this application';
  end if;

  -- Bài đã nộp vẫn sửa được — đó là mục đích của đường này. Bài đã huỷ thì không:
  -- nó không còn là bài chấm của ai nữa.
  if v_review.status not in ('assigned', 'in_progress', 'returned_for_clarification', 'submitted') then
    raise exception 'Review is not editable';
  end if;

  if p_recommendation is null or p_recommendation not in (
    'pass_to_interview', 'approve_recommended', 'waitlist', 'reject', 'needs_admin_review'
  ) then
    raise exception 'Invalid recommendation';
  end if;

  if exists (
    select 1 from unnest(array[
      p_score_motivation, p_score_goal_clarity, p_score_commitment,
      p_score_fit, p_score_communication
    ]) as score(value)
    where value is not null and value not between 1 and 5
  ) then
    raise exception 'Review scores must be between 1 and 5';
  end if;

  v_total := coalesce(p_score_motivation, 0) + coalesce(p_score_goal_clarity, 0)
    + coalesce(p_score_commitment, 0) + coalesce(p_score_fit, 0)
    + coalesce(p_score_communication, 0);
  v_note := nullif(btrim(p_reviewer_note), '');

  -- Trạng thái giữ nguyên: sửa nội dung không phải là nộp thay người chấm, và một
  -- bài đang dở không được biến thành đã nộp chỉ vì ban tổ chức sửa một con điểm.
  update public.application_reviews
  set score_motivation = p_score_motivation,
      score_goal_clarity = p_score_goal_clarity,
      score_commitment = p_score_commitment,
      score_fit = p_score_fit,
      score_communication = p_score_communication,
      total_score = v_total,
      recommendation = p_recommendation,
      reviewer_note = v_note,
      updated_at = now()
  where id = p_review_id;

  insert into public.admin_audit_log (
    actor_admin_user_id, action_type, before_data, after_data, details
  ) values (
    p_actor,
    'override_application_review',
    jsonb_build_object(
      'score_motivation', v_review.score_motivation,
      'score_goal_clarity', v_review.score_goal_clarity,
      'score_commitment', v_review.score_commitment,
      'score_fit', v_review.score_fit,
      'score_communication', v_review.score_communication,
      'total_score', v_review.total_score,
      'recommendation', v_review.recommendation,
      'reviewer_note', v_review.reviewer_note
    ),
    jsonb_build_object(
      'score_motivation', p_score_motivation,
      'score_goal_clarity', p_score_goal_clarity,
      'score_commitment', p_score_commitment,
      'score_fit', p_score_fit,
      'score_communication', p_score_communication,
      'total_score', v_total,
      'recommendation', p_recommendation,
      'reviewer_note', v_note
    ),
    jsonb_build_object(
      'review_id', p_review_id,
      'application_id', v_app.id,
      'review_round', v_review.review_round,
      'review_status', v_review.status,
      'reviewer_admin_user_id', v_review.reviewer_admin_user_id
    )
  );

  -- Cùng phép tính lại mà đường nộp bài dùng: điểm đổi thì trạng thái vòng chấm
  -- của hồ sơ phải đổi theo, không để hai chỗ nói hai điều.
  perform public.vam084_recompute_application_review_status(v_review.application_id, v_review.review_round);

  return p_review_id;
end;
$function$;

revoke all on function public.vam096_override_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) from public;
revoke all on function public.vam096_override_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) from anon;
revoke all on function public.vam096_override_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) from authenticated;
grant execute on function public.vam096_override_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) to service_role;

do $self_check$
declare
  v_def text;
  v_acl text;
  v_secdef boolean;
begin
  select pg_get_functiondef(p.oid), coalesce(p.proacl::text, ''), p.prosecdef
    into v_def, v_acl, v_secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam096_override_application_review';

  if v_def is null then
    raise exception 'SELF_CHECK: hàm sửa bài chấm chưa được tạo';
  end if;
  if v_secdef then
    raise exception 'SELF_CHECK: hàm này phải chạy quyền người gọi, không SECURITY DEFINER';
  end if;
  if v_acl not like '%service_role=X%' or v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception 'SELF_CHECK: quyền chạy hàm sửa bài chấm không đúng';
  end if;
  if position('vam096_decision_operator_for_application' in v_def) = 0 then
    raise exception 'SELF_CHECK: hàm sửa bài chấm chưa kiểm quyền theo hồ sơ';
  end if;

  -- Đường nộp bài của reviewer không được đụng tới.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam084_submit_application_review';
  if position('v_review.reviewer_admin_user_id <> p_actor' in v_def) = 0 then
    raise exception 'SELF_CHECK: luật "chỉ người được giao mới nộp" đã biến mất khỏi vam084_submit_application_review';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.admin_audit_log'::regclass
      and c.conname = 'admin_audit_log_action_type_check'
      and pg_get_constraintdef(c.oid) like '%override_application_review%'
  ) then
    raise exception 'SELF_CHECK: nhật ký chưa nhận loại hành động mới';
  end if;
end
$self_check$;

commit;
