-- ═══════════════════════════════════════════════════════════════════════════
-- Đổi người chấm KÈM hạn mới
-- ═══════════════════════════════════════════════════════════════════════════
--
-- vam084_change_review_assignment chép nguyên due_at của bài chấm cũ sang bài
-- mới. Người chấm cũ trễ hạn — lý do hay gặp nhất để đổi người — thì người mới
-- nhận việc với một hạn ĐÃ QUA: bị tính trễ ngay phút đầu, và ban tổ chức không
-- có chỗ nào trên màn hình để sửa hạn đó.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO LÀ HÀM BỌC, KHÔNG ĐỊNH NGHĨA LẠI vam084_change_review_assignment
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Migration 20260911120000 đổi phép kiểm quyền trong hàm đó sang
-- vam084_staffing_operator_for_season bằng cách đọc định nghĩa ĐANG CHẠY rồi
-- thay một lời gọi. Bản trong repo vì thế cũ hơn bản trên production. Định
-- nghĩa lại hàm ở đây là chép tay thân hàm; chép từ repo thì lời gọi cũ quay
-- lại và Support team mất quyền trả hồ sơ về hàng chờ mà không ai biết.
-- __tests__/migration-support-team-staffing.test.ts canh đúng điều đó.
--
-- Hàm bọc gọi NGUYÊN hàm cũ, nên mọi phép kiểm của nó — ai được gọi, phạm vi
-- mùa, hồ sơ đã rút, người thay có đủ điều kiện, sổ sự kiện phân công — vẫn chỉ
-- có một chỗ.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ĐỔI NGƯỜI VÀ ĐẶT HẠN TRONG CÙNG MỘT TRANSACTION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Đổi người rồi sửa hạn bằng một lệnh riêng từ ứng dụng là hai transaction:
-- lệnh thứ hai hỏng thì người mới đã nhận việc với hạn cũ đã qua, còn màn hình
-- báo lỗi cho một việc đã xảy ra một nửa. Ở đây hạn không đặt được thì cả lần
-- đổi người cuộn lại.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- HẠN CŨ ĐÃ QUA MÀ KHÔNG GỬI HẠN MỚI: TỪ CHỐI
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Giữ hạn cũ là giao cho người mới một việc đã trễ — ai bấm như vậy là quên ô
-- hạn, không phải muốn thế. Từ chối để họ điền, thay vì lặng lẽ xoá hạn (người
-- vận hành tưởng vẫn còn hạn) hay giữ nguyên hạn đã qua.
--
-- Hạn cũ còn hiệu lực, hoặc không có hạn, mà không gửi hạn mới: giữ như cũ —
-- đúng hành vi trước đây.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DÁN TRƯỚC KHI MERGE LÀ AN TOÀN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Chỉ THÊM một hàm. vam084_change_review_assignment không bị đụng tới, nên mã
-- đang chạy trên production vẫn gọi nó y như cũ. Không đụng dòng dữ liệu nào.
-- Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $reassign_due_prereq$
begin
  if to_regprocedure('public.vam084_change_review_assignment(uuid,uuid,text,uuid)') is null then
    raise exception 'PREREQ_MISSING: chưa có vam084_change_review_assignment(uuid,uuid,text,uuid)';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'application_reviews'
                    and column_name = 'due_at' and data_type = 'timestamp with time zone') then
    raise exception 'PREREQ_MISSING: application_reviews.due_at không phải timestamptz';
  end if;
end
$reassign_due_prereq$;

-- ------------------------------------------------------------
-- 1. Đổi người chấm, đặt hạn mới
-- ------------------------------------------------------------
create or replace function public.vam103_reassign_review_with_due(
  p_review_id uuid,
  p_actor uuid,
  p_reason text,
  p_new_reviewer uuid,
  p_new_due_at timestamptz default null
)
returns uuid
language plpgsql
-- security invoker, KHÔNG definer: hàm được bọc kiểm current_user = 'service_role'.
-- Definer đổi current_user thành chủ hàm, và mọi lời gọi sẽ bị từ chối.
security invoker
set search_path to ''
as $function$
declare
  v_replacement uuid;
  v_kept_due    timestamptz;
begin
  -- Hàm này chỉ ĐỔI người. Trả hồ sơ về hàng chờ đi thẳng vam084.
  if current_user <> 'service_role' or p_new_reviewer is null then
    raise exception 'Assignment change rejected';
  end if;
  if p_new_due_at is not null and p_new_due_at <= now() then
    raise exception 'NEW_DUE_IN_PAST';
  end if;

  v_replacement := public.vam084_change_review_assignment(
    p_review_id, p_actor, p_reason, p_new_reviewer
  );

  if p_new_due_at is not null then
    update public.application_reviews
       set due_at = p_new_due_at,
           updated_at = now()
     where id = v_replacement
       and status = 'assigned';
    if not found then
      raise exception 'Replacement review missing';
    end if;
  else
    select ar.due_at into v_kept_due
      from public.application_reviews ar
     where ar.id = v_replacement;
    if v_kept_due is not null and v_kept_due < now() then
      raise exception 'NEW_DUE_REQUIRED';
    end if;
  end if;

  return v_replacement;
end;
$function$;

comment on function public.vam103_reassign_review_with_due(uuid, uuid, text, uuid, timestamptz) is
  'Đổi người chấm qua vam084_change_review_assignment rồi đặt hạn mới, cùng một transaction. Hạn cũ đã qua mà không gửi hạn mới thì từ chối (NEW_DUE_REQUIRED).';

revoke all on function public.vam103_reassign_review_with_due(uuid, uuid, text, uuid, timestamptz) from public;
revoke all on function public.vam103_reassign_review_with_due(uuid, uuid, text, uuid, timestamptz) from anon, authenticated;
grant execute on function public.vam103_reassign_review_with_due(uuid, uuid, text, uuid, timestamptz) to service_role;

-- ------------------------------------------------------------
-- 2. Tự kiểm
-- ------------------------------------------------------------
do $reassign_due_self_check$
declare
  v_sig constant text := 'public.vam103_reassign_review_with_due(uuid,uuid,text,uuid,timestamptz)';
  v_fn  text;
  v_old text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không thấy %', v_sig;
  end if;

  if exists (select 1 from pg_proc where oid = to_regprocedure(v_sig) and prosecdef) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam103 phải là security invoker — definer làm vam084 từ chối mọi lời gọi';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure(v_sig)
                    and proconfig @> array['search_path=""']) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam103 thiếu search_path rỗng';
  end if;

  v_fn := pg_get_functiondef(to_regprocedure(v_sig));
  if position('public.vam084_change_review_assignment(' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam103 không đi qua vam084_change_review_assignment';
  end if;
  if position('NEW_DUE_REQUIRED' in v_fn) = 0 or position('NEW_DUE_IN_PAST' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam103 thiếu phép chặn hạn đã qua';
  end if;

  if has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam103 còn gọi được từ trình duyệt';
  end if;
  if not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: máy chủ không gọi được vam103';
  end if;

  -- Hàm được bọc không bị đụng tới: vẫn là bản đã mở cho Support team trả hồ sơ.
  v_old := pg_get_functiondef('public.vam084_change_review_assignment(uuid,uuid,text,uuid)'::regprocedure);
  if position('public.vam084_staffing_operator_for_season(' in v_old) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam084_change_review_assignment không còn gọi vam084_staffing_operator_for_season';
  end if;
end
$reassign_due_self_check$;

notify pgrst, 'reload schema';

commit;
