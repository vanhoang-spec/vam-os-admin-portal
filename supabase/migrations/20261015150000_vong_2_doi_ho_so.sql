-- Ghép cặp Vòng 2 — mentor đổi sang 15 hồ sơ khác (BTC 15/10/2026).
--
-- Mentor đã mở "Xem đầy đủ hồ sơ" ở HẾT các hồ sơ trong danh sách mà chưa ưng bạn nào thì được bấm
-- "Đổi 15 hồ sơ khác": danh sách nhảy tới 15 bạn còn trống kế tiếp trên vòng tròn của mentor đó
-- (lib/matching-round2-window-core.ts). Đổi tiếp thì đi tiếp vòng; hết vòng thì quay lại đầu.
--
-- Hai bảng mới, KHÔNG thêm cột vào matching_round2_links: bảng đó bị khoá dòng ở mỗi lượt chọn
-- (vam113_round2_pick … for update) trong lúc vòng đang mở, còn alter table cần khoá cả bảng.
--   matching_round2_views        — mentor (theo link) đã mở hồ sơ đầy đủ của bạn nào. Máy chủ ghi khi
--                                  trả hồ sơ đầy đủ, và tự đếm lại khi mentor bấm đổi: nút ẩn/hiện trên
--                                  trang không phải phép kiểm.
--   matching_round2_window_state — danh sách của mentor bắt đầu từ bạn nào (mã đơn) sau lần đổi gần
--                                  nhất, và đã đổi mấy lần. Không có dòng = danh sách mặc định, nên
--                                  danh sách của mọi mentor đang chọn giữ nguyên khi bản này lên.
-- Chỉ máy chủ (service_role) đọc/ghi; anon và authenticated không có quyền gì. Lượt chọn vẫn do
-- vam113_round2_pick phân xử như cũ — danh sách 15 bạn chỉ là phần hiển thị.

do $prereq$
begin
  if to_regclass('public.matching_round2_links') is null then
    raise exception 'PREREQ_MISSING: dán migration 20261008080000_vong_2_mentor_chon_mentee.sql trước';
  end if;
end
$prereq$;

create table if not exists public.matching_round2_views (
  link_id uuid not null references public.matching_round2_links(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (link_id, application_id)
);

comment on table public.matching_round2_views is
  'Vòng 2: mentor (link) đã mở "Xem đầy đủ hồ sơ" của mentee (đơn) nào — điều kiện để đổi sang 15 hồ sơ khác.';

create table if not exists public.matching_round2_window_state (
  link_id uuid primary key references public.matching_round2_links(id) on delete cascade,
  anchor_application_id uuid not null,
  swaps integer not null default 1 check (swaps >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.matching_round2_window_state is
  'Vòng 2: danh sách 15 hồ sơ của mentor bắt đầu từ mã đơn nào sau lần "Đổi 15 hồ sơ khác" gần nhất; không có dòng = danh sách mặc định.';

alter table public.matching_round2_views enable row level security;
alter table public.matching_round2_window_state enable row level security;
revoke all on public.matching_round2_views from public, anon, authenticated, service_role;
revoke all on public.matching_round2_window_state from public, anon, authenticated, service_role;
-- Lượt xem chỉ thêm, không sửa, không xoá: xoá được thì "đã xem hết" trở thành thứ máy chủ tự quên.
grant select, insert on public.matching_round2_views to service_role;
grant select, insert, update on public.matching_round2_window_state to service_role;

do $check$
declare
  t text;
begin
  foreach t in array array['matching_round2_views', 'matching_round2_window_state'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'SELF_CHECK: thiếu bảng %', t;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'SELF_CHECK: bảng % chưa bật RLS', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert') then
      raise exception 'SELF_CHECK: anon/authenticated còn đọc hoặc ghi được %', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') or not has_table_privilege('service_role', 'public.' || t, 'insert') then
      raise exception 'SELF_CHECK: máy chủ chưa đọc/ghi được %', t;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.matching_round2_window_state', 'update') then
    raise exception 'SELF_CHECK: máy chủ chưa sửa được matching_round2_window_state';
  end if;
  if has_table_privilege('service_role', 'public.matching_round2_views', 'update')
     or has_table_privilege('service_role', 'public.matching_round2_views', 'delete') then
    raise exception 'SELF_CHECK: lượt xem phải chỉ thêm, không sửa/xoá';
  end if;
  raise notice 'Vòng 2 — đổi 15 hồ sơ khác: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
