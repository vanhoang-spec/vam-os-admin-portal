-- Cận phòng/bàn của màn hình phỏng vấn mentee suy từ CHÍNH CA (BTC 07/10/2026),
-- thay cho hai ngày ghi cứng 03/10 và 04/10 — mọi ngày khác đang bị chặn ở 0 phòng,
-- nên đợt 2 (10–11/10) không phân được bàn nào. Dán TRƯỚC
-- 20261007100000_mentee_phong_van_dot_2.sql, rồi mới merge.

begin;
set local lock_timeout = '10s';

-- ------------------------------------------------------------
-- Cận phòng/bàn suy từ chính ca
-- ------------------------------------------------------------
-- Cùng luật với roomDeskBounds() ở lib/mentee-offline-core.ts (màn hình dùng để vẽ ô
-- chọn): số phòng = số tên trong "Phòng a, b, c — …" của địa điểm; bàn mỗi phòng =
-- số chỗ của ca chia đều, làm tròn lên. Đợt 1 ra đúng như cũ: 03/10 3 phòng × 6 bàn
-- (18 chỗ), 04/10 6 phòng × 5 bàn (28 chỗ). Chưa có địa điểm → 6 phòng; chưa có số
-- chỗ → 6 bàn. Đổi phòng của một ngày chỉ cần sửa địa điểm ca, không cần migration.
create or replace function public.vam104_room_desk_bounds_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_venue text;
  v_seats integer;
  v_head text;
  v_rooms integer := 0;
  v_long integer := 0;
  v_max_desk integer;
begin
  if new.room is null then return new; end if;
  select s.venue, s.seat_limit into v_venue, v_seats
    from public.interview_sessions s where s.id = new.session_id;
  v_head := (regexp_split_to_array(normalize(coalesce(v_venue, ''), NFC), '[[:space:]][—–-][[:space:]]'))[1];
  if v_head ~* '^[[:space:]]*phòng[[:space:]]+' then
    select count(*) filter (where btrim(x) <> ''), count(*) filter (where length(btrim(x)) > 20)
      into v_rooms, v_long
      from unnest(string_to_array(regexp_replace(v_head, '^[[:space:]]*[Pp]hòng[[:space:]]+', ''), ',')) as t(x);
  end if;
  if v_long > 0 or v_rooms = 0 then v_rooms := 6; end if;
  v_max_desk := case when v_seats is null or v_seats < 1 then 6
                     else greatest(1, ceil(v_seats::numeric / v_rooms)::integer) end;
  if new.room not between 1 and v_rooms or new.desk not between 1 and v_max_desk then
    raise exception 'ROOM_DESK_OUT_OF_RANGE: phòng % bàn % không hợp lệ cho ca này (% phòng, % bàn mỗi phòng)',
      new.room, new.desk, v_rooms, v_max_desk;
  end if;
  return new;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.vam104_room_desk_bounds_guard()'::regprocedure) into v_def;
  if v_def like '%2026-10-03%' or v_def not like '%string_to_array%' then
    raise exception 'SELF_CHECK: vam104_room_desk_bounds_guard chưa được thay';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam104_room_desk_bounds' and not tgisinternal) then
    raise exception 'SELF_CHECK: mất trigger vam104_room_desk_bounds';
  end if;
end $$;

commit;
