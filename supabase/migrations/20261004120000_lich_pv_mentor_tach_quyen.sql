-- ============================================================
-- 20261004120000_lich_pv_mentor_tach_quyen.sql
-- ============================================================
--
-- BTC 04/10/2026: hai mentor (chỉ được cấp quyền CHẤM MENTEE 02/10) lại mở được
-- "Lịch phỏng vấn mentor" và tick giờ rảnh để phỏng vấn mentor mới.
--
-- Vì sao: một quyền cho hai việc. Lịch phỏng vấn mentor 1:1 (/interviews/lich) cho
-- tài khoản reviewer vào nếu vam084_participant_for_stage(…,'interview') = true —
-- tức có tư cách mùa role='interviewer'. Đúng tư cách đó cũng là quyền chấm phỏng
-- vấn mentee (vam104_offline_access). 22/09 BTC bật cho 5 mentor để phỏng vấn
-- mentor mới; 02–04/10 cấp thêm 86 mentor để chấm mentee → cả 86 đều vào được lịch.
-- Gỡ tư cách 'interviewer' thì mất luôn màn hình chấm mentee — không được.
--
-- Sửa: quyền "tạo lịch phỏng vấn mentor" tách riêng.
--   * Bảng mentor_interview_hosts (mùa × tài khoản) — danh sách mentor được BTC bật.
--   * vam109_mentor_interview_host(admin, mùa): core_team/admin/super_admin như cũ;
--     reviewer phải có tư cách 'interviewer' CỘNG dòng trong bảng trên.
--   * Trigger trên interview_slots: mở giờ (open) hoặc đặt (booked) cho người không
--     có quyền → NOT_MENTOR_INTERVIEW_HOST. Có hiệu lực ngay khi dán, trước cả khi
--     mã ứng dụng mới lên — trang cũ cho vào lưới nhưng không lưu được giờ.
--   * Cấp sẵn cho các reviewer được bật 'interviewer' TRƯỚC 01/10/2026 (đợt 22/09,
--     5 người) — đúng nhóm BTC chủ ý cho phỏng vấn mentor.
--   * Giờ còn trống trong tương lai của người không có quyền → 'removed'.
--
-- Quyền chấm mentee KHÔNG đổi. Không xoá buổi đã đặt/đã diễn ra.
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge mã ứng dụng.

begin;

create table if not exists public.mentor_interview_hosts (
  season_id uuid not null references public.seasons(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.admin_users(id) on delete set null,
  note text,
  primary key (season_id, admin_user_id)
);
alter table public.mentor_interview_hosts enable row level security;
revoke all on public.mentor_interview_hosts from public, anon, authenticated;
revoke all on public.mentor_interview_hosts from service_role;
grant select, insert, delete on public.mentor_interview_hosts to service_role;

create or replace function public.vam109_mentor_interview_host(p_admin uuid, p_season uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.admin_users au
    where au.id = p_admin
      and au.status = 'active'
      and (
        au.role in ('core_team', 'admin', 'super_admin')
        or (
          au.role = 'reviewer'
          and public.vam084_participant_for_stage(p_admin, p_season, 'interview')
          and exists (
            select 1 from public.mentor_interview_hosts h
            where h.season_id = p_season and h.admin_user_id = p_admin
          )
        )
      )
  );
$function$;
revoke all on function public.vam109_mentor_interview_host(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam109_mentor_interview_host(uuid, uuid) to service_role;

-- Chốt ở database: ô giờ chỉ mở / được đặt cho người có quyền. Gỡ giờ (removed)
-- thì luôn cho — người mất quyền vẫn tự dọn được giờ của mình.
create or replace function public.vam109_slot_host_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  -- Mentor / BTC huỷ một buổi đã đặt (booked → open) với người không còn quyền: KHÔNG
  -- chặn — chặn là làm hỏng việc huỷ của người khác. Ô giờ đóng lại (removed) thay vì
  -- mở ra cho mentor mới đặt.
  if tg_op = 'UPDATE' and old.status = 'booked' and new.status = 'open'
     and not public.vam109_mentor_interview_host(new.admin_user_id, new.season_id) then
    new.status := 'removed';
    new.removed_at := now();
    return new;
  end if;
  if new.status in ('open', 'booked')
     and (tg_op = 'INSERT'
          or old.status is distinct from new.status
          or old.admin_user_id is distinct from new.admin_user_id)
     and not public.vam109_mentor_interview_host(new.admin_user_id, new.season_id) then
    raise exception 'NOT_MENTOR_INTERVIEW_HOST' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.vam109_slot_host_guard() from public, anon, authenticated;

drop trigger if exists vam109_slot_host_guard on public.interview_slots;
create trigger vam109_slot_host_guard
  before insert or update on public.interview_slots
  for each row execute function public.vam109_slot_host_guard();

-- Cấp sẵn: reviewer có tư cách 'interviewer' ĐANG HIỆU LỰC từ trước 01/10/2026
-- (giờ Việt Nam) — đợt BTC bật để phỏng vấn mentor mới, trước khi cấp quyền chấm mentee.
insert into public.mentor_interview_hosts (season_id, admin_user_id, granted_at, note)
select distinct psm.season_id, au.id, psm.created_at, 'Cấp sẵn 04/10/2026: được bật phỏng vấn trước 01/10 (đợt 22/09)'
from public.person_season_memberships psm
join public.people p on p.id = psm.person_id
join public.admin_users au on lower(btrim(au.email)) = lower(btrim(p.email_primary))
where psm.role = 'interviewer'
  and psm.status = 'active'
  and psm.created_at < timestamptz '2026-10-01 00:00:00+07'
  and au.role = 'reviewer'
  and au.status = 'active'
on conflict do nothing;

-- Giờ trống sắp tới của người không còn quyền: gỡ để mentor mới không đặt vào.
update public.interview_slots s
   set status = 'removed', removed_at = now()
 where s.status = 'open'
   and s.slot_starts_at > now()
   and not public.vam109_mentor_interview_host(s.admin_user_id, s.season_id);

do $tach_quyen_self_check$
declare
  v_hosts integer;
  v_late integer;
  v_open integer;
begin
  if to_regclass('public.mentor_interview_hosts') is null then
    raise exception 'Tự kiểm: thiếu bảng mentor_interview_hosts';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.mentor_interview_hosts'::regclass) then
    raise exception 'Tự kiểm: mentor_interview_hosts chưa bật RLS';
  end if;
  if has_table_privilege('anon', 'public.mentor_interview_hosts', 'select')
     or has_table_privilege('authenticated', 'public.mentor_interview_hosts', 'select') then
    raise exception 'Tự kiểm: anon/authenticated vẫn đọc được mentor_interview_hosts';
  end if;
  if has_function_privilege('anon', 'public.vam109_mentor_interview_host(uuid, uuid)', 'execute') then
    raise exception 'Tự kiểm: anon gọi được vam109_mentor_interview_host';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam109_slot_host_guard'
                 and tgrelid = 'public.interview_slots'::regclass) then
    raise exception 'Tự kiểm: thiếu trigger vam109_slot_host_guard';
  end if;
  select count(*) into v_hosts from public.mentor_interview_hosts;
  if v_hosts = 0 then
    raise exception 'Tự kiểm: chưa cấp sẵn cho mentor nào — kiểm lại điều kiện cấp';
  end if;
  -- Không ai chỉ được cấp quyền chấm mentee (từ 01/10) lọt vào danh sách cấp sẵn.
  select count(*) into v_late
  from public.mentor_interview_hosts h
  join public.admin_users au on au.id = h.admin_user_id
  join public.people p on lower(btrim(p.email_primary)) = lower(btrim(au.email))
  where not exists (
    select 1 from public.person_season_memberships psm
    where psm.person_id = p.id and psm.season_id = h.season_id and psm.role = 'interviewer'
      and psm.status = 'active' and psm.created_at < timestamptz '2026-10-01 00:00:00+07'
  );
  if v_late > 0 then
    raise exception 'Tự kiểm: % người trong danh sách không thuộc đợt trước 01/10', v_late;
  end if;
  select count(*) into v_open
  from public.interview_slots s
  where s.status = 'open' and s.slot_starts_at > now()
    and not public.vam109_mentor_interview_host(s.admin_user_id, s.season_id);
  if v_open > 0 then
    raise exception 'Tự kiểm: còn % giờ trống của người không có quyền', v_open;
  end if;
  raise notice 'Đã tách quyền tạo lịch phỏng vấn mentor — % mentor được cấp sẵn', v_hosts;
end
$tach_quyen_self_check$;

commit;
