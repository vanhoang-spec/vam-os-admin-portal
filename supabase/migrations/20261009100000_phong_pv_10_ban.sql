-- BTC 09/10/2026: mỗi phòng phân công có 10 bàn cho mentor.
-- Dán trên Production TRƯỚC khi merge. Không đổi địa điểm, số chỗ mentee hay lịch.
begin;
set local lock_timeout = '10s';

do $preflight$
begin
  if to_regclass('public.mentee_interview_operations') is null
     or to_regclass('public.interview_sessions') is null
     or to_regprocedure('public.vam104_room_desk_bounds_guard()') is null
     or to_regprocedure('public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)') is null then
    raise exception 'PREREQ_MISSING: cần bảng vận hành, ca, trigger cận phòng/bàn và RPC lưu phiếu vam104';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.mentee_interview_operations'::regclass
      and tgname = 'vam104_room_desk_bounds' and not tgisinternal
      and tgenabled = 'O'
      and tgfoid = 'public.vam104_room_desk_bounds_guard()'::regprocedure
  ) then
    raise exception 'PREREQ_MISSING: trigger vam104_room_desk_bounds không hoạt động đúng';
  end if;
end $preflight$;

alter table public.mentee_interview_operations
  drop constraint if exists mentee_interview_operations_desk_check;
alter table public.mentee_interview_operations
  add constraint mentee_interview_operations_desk_check check (desk between 1 and 10);

-- Chỉ nới cận bàn trên THÂN HÀM HIỆN CÓ để giữ các luật quyền và chấm phiếu trên prod.
-- Mẫu không khớp thì dừng và rollback; không ghi đè bằng bản hàm cũ trong repo.
do $rpc$
declare
  v_def text;
  v_old text := 'v_desk not between 1 and 6';
  v_new text := 'v_desk not between 1 and 10';
begin
  v_def := pg_get_functiondef('public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)'::regprocedure);
  if strpos(v_def, v_old) > 0 then
    if array_length(string_to_array(v_def, v_old), 1) <> 2 then
      raise exception 'RPC_PATCH_MISMATCH: cận bàn 1..6 xuất hiện nhiều hơn một lần';
    end if;
    execute replace(v_def, v_old, v_new);
  elsif strpos(v_def, v_new) = 0 then
    raise exception 'RPC_PATCH_MISMATCH: không tìm thấy cận bàn dự kiến; cần kiểm lại thân hàm production';
  end if;
end $rpc$;

-- Cùng luật với roomDeskBounds: giữ cách suy số phòng theo địa điểm của ca.
-- Bàn dành cho mentor, nên không suy số bàn từ số chỗ mentee nữa.
create or replace function public.vam104_room_desk_bounds_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_venue text;
  v_head text;
  v_rooms integer := 0;
  v_long integer := 0;
  v_max_desk integer := 10;
begin
  if new.room is null then return new; end if;
  select s.venue into v_venue
    from public.interview_sessions s where s.id = new.session_id;
  v_head := (regexp_split_to_array(normalize(coalesce(v_venue, ''), NFC), '[[:space:]][—–-][[:space:]]'))[1];
  if v_head ~* '^[[:space:]]*phòng[[:space:]]+' then
    select count(*) filter (where btrim(x) <> ''), count(*) filter (where length(btrim(x)) > 20)
      into v_rooms, v_long
      from unnest(string_to_array(regexp_replace(v_head, '^[[:space:]]*[Pp]hòng[[:space:]]+', ''), ',')) as t(x);
  end if;
  if v_long > 0 or v_rooms = 0 then v_rooms := 6; end if;
  if new.room not between 1 and v_rooms or new.desk not between 1 and v_max_desk then
    raise exception 'ROOM_DESK_OUT_OF_RANGE: phòng % bàn % không hợp lệ cho ca này (% phòng, % bàn mỗi phòng)',
      new.room, new.desk, v_rooms, v_max_desk;
  end if;
  return new;
end;
$function$;

do $self_check$
declare
  v_constraint text;
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_constraint
    from pg_constraint
    where conrelid = 'public.mentee_interview_operations'::regclass
      and conname = 'mentee_interview_operations_desk_check' and convalidated;
  if v_constraint is distinct from 'CHECK (((desk >= 1) AND (desk <= 10)))' then
    raise exception 'SELF_CHECK: CHECK bàn chưa đúng 1..10: %', v_constraint;
  end if;
  v_def := pg_get_functiondef('public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)'::regprocedure);
  if strpos(v_def, 'v_desk not between 1 and 10') = 0
     or strpos(v_def, 'v_desk not between 1 and 6') > 0 then
    raise exception 'SELF_CHECK: RPC lưu phiếu chưa có cận bàn 1..10';
  end if;
  v_def := pg_get_functiondef('public.vam104_room_desk_bounds_guard()'::regprocedure);
  if strpos(v_def, 'v_max_desk integer := 10') = 0
     or strpos(v_def, 'seat_limit') > 0 then
    raise exception 'SELF_CHECK: trigger chưa có 10 bàn độc lập số chỗ mentee';
  end if;
  if has_function_privilege('anon', 'public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)', 'execute') then
    raise exception 'SELF_CHECK: RPC lưu phiếu đang mở cho anon/authenticated';
  end if;
end $self_check$;

commit;

select 'Mỗi phòng có 10 bàn; giữ số phòng theo địa điểm ca' as ket_qua,
       pg_get_constraintdef(oid) as rang_buoc_ban
from pg_constraint
where conrelid = 'public.mentee_interview_operations'::regclass
  and conname = 'mentee_interview_operations_desk_check';
