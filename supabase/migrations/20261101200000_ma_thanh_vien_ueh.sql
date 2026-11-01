-- Mã thành viên UEH: UEH + R/E/S/C + 4 số, một người một mã (quy tắc chốt 26-28/10/2026).
--
-- Mã mới nằm ở people.member_code vì Core và Support không có hồ sơ mentor/mentee riêng. mentor_code và
-- mentee_code giữ nguyên làm mã cũ: luồng gia hạn tra mentor_code để nhận ra người cũ, ghi đè là hỏng luồng đó.
--
-- Migration này KHÔNG cấp mã cho ai. Danh sách ban đầu xếp theo năm bắt đầu rồi tên, và cấp bằng một đợt riêng
-- sau khi BTC duyệt. Vì vậy bộ đếm có mốc opened_at: nếu trigger chạy trước đợt đó, người mới duyệt sẽ nhận
-- số 0001 và đẩy cả danh sách đã duyệt lệch đi. Trigger chỉ cấp khi nhóm đã mở.
--
-- Trigger nuốt lỗi: việc cấp mã hỏng không được chặn việc duyệt người. Người bị bỏ sót hiện ra ở chỗ thiếu mã
-- và được cấp lại, còn duyệt hỏng giữa chừng thì BTC không biết phải làm gì.

begin;

do $prereq$
begin
  if to_regclass('public.people') is null
     or to_regclass('public.mentor_profiles') is null
     or to_regclass('public.person_season_memberships') is null
     or to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: thiếu bảng nền cho mã thành viên';
  end if;
end
$prereq$;

alter table public.people add column if not exists member_code text;

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.people'::regclass and conname = 'people_member_code_format_check') then
    alter table public.people add constraint people_member_code_format_check check (member_code ~ '^UEH[RESC][0-9]{4}$');
  end if;
end
$constraint$;

create unique index if not exists people_member_code_key on public.people (member_code) where member_code is not null;

-- Mỗi nhóm một dãy số; số đã phát không quay lại dù mã bị đổi tay.
create table if not exists public.member_code_counters (
  group_code text primary key check (group_code in ('R', 'E', 'S', 'C')),
  last_number integer not null default 0 check (last_number between 0 and 9999),
  opened_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.member_code_counters (group_code) values ('R'), ('E'), ('S'), ('C')
on conflict (group_code) do nothing;

-- Mã đã cấp không đổi trừ khi admin chỉnh, nên mọi lần đổi đều phải tra lại được.
create table if not exists public.member_code_log (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people(id) on delete set null,
  old_code text,
  new_code text not null,
  source text not null check (source in ('initial', 'auto', 'admin_assign', 'admin_edit')),
  actor_admin_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists member_code_log_person_idx on public.member_code_log (person_id, created_at desc);

alter table public.member_code_counters enable row level security;
alter table public.member_code_log enable row level security;
revoke all on public.member_code_counters from public, anon, authenticated;
revoke all on public.member_code_log from public, anon, authenticated;
revoke all on public.member_code_counters from service_role;
revoke all on public.member_code_log from service_role;
grant select on public.member_code_counters to service_role;
grant select on public.member_code_log to service_role;

-- Người đã có mã thì trả lại đúng mã đó: cấp lại không được đổi mã, kể cả khi người ấy sang nhóm khác.
create or replace function public.vam124_assign_member_code(
  p_person_id uuid,
  p_group text,
  p_source text default 'admin_assign',
  p_actor_admin_user_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
  v_number integer;
  v_opened timestamptz;
  v_code text;
begin
  if p_group is null or p_group not in ('R', 'E', 'S', 'C') then
    raise exception 'MEMBER_CODE_BAD_GROUP';
  end if;

  select p.member_code into v_existing from public.people p where p.id = p_person_id for update;
  if not found then
    raise exception 'MEMBER_CODE_PERSON_NOT_FOUND';
  end if;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Khoá dòng đếm để hai lượt duyệt cùng lúc không lấy cùng một số.
  select c.last_number, c.opened_at into v_number, v_opened
    from public.member_code_counters c where c.group_code = p_group for update;
  if v_opened is null and p_source <> 'initial' then
    raise exception 'MEMBER_CODE_GROUP_NOT_OPEN';
  end if;

  -- Admin có thể đã đặt tay một số phía trên bộ đếm, nên phải bỏ qua số đang có người giữ.
  loop
    v_number := v_number + 1;
    if v_number > 9999 then
      raise exception 'MEMBER_CODE_RANGE_EXHAUSTED';
    end if;
    v_code := 'UEH' || p_group || lpad(v_number::text, 4, '0');
    exit when not exists (select 1 from public.people p where p.member_code = v_code);
  end loop;

  update public.member_code_counters set last_number = v_number, updated_at = now() where group_code = p_group;
  update public.people set member_code = v_code where id = p_person_id;
  insert into public.member_code_log (person_id, old_code, new_code, source, actor_admin_user_id)
    values (p_person_id, null, v_code, p_source, p_actor_admin_user_id);
  return v_code;
end;
$$;

create or replace function public.vam124_set_member_code(
  p_person_id uuid,
  p_code text,
  p_actor_admin_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_actor_admin_user_id is null then
    raise exception 'MEMBER_CODE_ACTOR_REQUIRED';
  end if;
  if p_code is null or p_code !~ '^UEH[RESC][0-9]{4}$' or right(p_code, 4) = '0000' then
    raise exception 'MEMBER_CODE_BAD_FORMAT';
  end if;

  select p.member_code into v_old from public.people p where p.id = p_person_id for update;
  if not found then
    raise exception 'MEMBER_CODE_PERSON_NOT_FOUND';
  end if;
  if v_old is not distinct from p_code then
    return p_code;
  end if;
  if exists (select 1 from public.people p where p.member_code = p_code) then
    raise exception 'MEMBER_CODE_TAKEN';
  end if;

  update public.people set member_code = p_code where id = p_person_id;
  insert into public.member_code_log (person_id, old_code, new_code, source, actor_admin_user_id)
    values (p_person_id, v_old, p_code, 'admin_edit', p_actor_admin_user_id);
  return p_code;
end;
$$;

create or replace function public.vam124_auto_member_code(p_person_id uuid, p_group text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_person_id is null
     or not exists (select 1 from public.member_code_counters c where c.group_code = p_group and c.opened_at is not null) then
    return;
  end if;
  perform public.vam124_assign_member_code(p_person_id, p_group, 'auto', null);
exception when others then
  raise warning 'Không cấp được mã % cho người %: %', p_group, p_person_id, sqlerrm;
end;
$$;

create or replace function public.vam124_mentor_profile_member_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.vam124_auto_member_code(new.person_id, 'R');
  return new;
end;
$$;

-- Mentee chỉ đánh mã từ mùa 12, không hồi tố. Mùa lấy từ mã mùa; đọc không ra thì bỏ qua thay vì cấp nhầm.
create or replace function public.vam124_membership_member_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season integer;
begin
  if new.role = 'mentee' then
    select substring(s.code from 'S([0-9]+)$')::integer into v_season from public.seasons s where s.id = new.season_id;
    if v_season >= 12 then
      perform public.vam124_auto_member_code(new.person_id, 'E');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.vam124_assign_member_code(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.vam124_set_member_code(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.vam124_auto_member_code(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.vam124_mentor_profile_member_code() from public, anon, authenticated, service_role;
revoke all on function public.vam124_membership_member_code() from public, anon, authenticated, service_role;
grant execute on function public.vam124_assign_member_code(uuid, text, text, uuid) to service_role;
grant execute on function public.vam124_set_member_code(uuid, text, uuid) to service_role;

create or replace trigger vam124_mentor_profile_member_code
  after insert or update of person_id on public.mentor_profiles
  for each row execute function public.vam124_mentor_profile_member_code();

create or replace trigger vam124_membership_member_code
  after insert or update of role, person_id on public.person_season_memberships
  for each row execute function public.vam124_membership_member_code();

do $self_check$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'people' and column_name = 'member_code') then
    raise exception 'SELF_CHECK: thiếu cột people.member_code';
  end if;
  if (select count(*) from public.member_code_counters) <> 4 then
    raise exception 'SELF_CHECK: bộ đếm phải đủ 4 nhóm';
  end if;
  if (select count(*) from pg_trigger where tgname in ('vam124_mentor_profile_member_code', 'vam124_membership_member_code') and not tgisinternal) <> 2 then
    raise exception 'SELF_CHECK: thiếu trigger cấp mã';
  end if;
  if not (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.member_code_counters'::regclass, 'public.member_code_log'::regclass)) then
    raise exception 'SELF_CHECK: bảng mã chưa bật RLS';
  end if;
  raise notice 'Mã thành viên UEH: sẵn sàng';
end
$self_check$;

commit;

notify pgrst, 'reload schema';
