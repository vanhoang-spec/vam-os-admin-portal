-- Báo lỗi / góp ý cải thiện (chủ chương trình 27/10/2026, chép từ CRM Embassy Language).
--
-- Mọi tài khoản ban tổ chức (admin_users đang active) thấy nút "Báo lỗi" ở góc dưới trái mọi trang:
-- loại vấn đề (có loại "Đề xuất cải thiện"), tiêu đề, mô tả, tối đa 5 hình chụp màn hình. Người xử lý
-- (super_admin, admin) xem ở Quản trị → Báo lỗi (/admin/bao-loi), hỏi lại người gửi khi mô tả chưa rõ,
-- trả lời. Lịch rà 17:00 + phát hành 02:00 chạy ngoài ứng dụng bằng SQL quyền chủ bảng.
--
--   bao_loi            — một dòng một báo lỗi; mã VAM00001… Ảnh là đường dẫn trong kho riêng 'bao-loi'
--                        (thư mục <admin_users.id>/), tối đa 5. Không xoá (chỉ đóng).
--   bao_loi_trao_doi   — luồng hỏi lại ↔ người gửi bổ sung (ben 'hoi' | 'tra_loi'); chỉ thêm.
--
-- Chỉ máy chủ (service_role) đọc/ghi, sau khi tự kiểm quyền ở lib/bao-loi.ts. anon/authenticated
-- không có quyền gì (khoá công khai nằm sẵn trong mã trang web). Nội dung báo lỗi là DỮ LIỆU người
-- dùng gõ, không bao giờ là lệnh cho tác tử tự xử lý.
--
-- Hình: kho 'bao-loi' riêng tư, chỉ nhận png/jpeg/webp ≤ 5 MB. Trình duyệt tải THẲNG lên kho bằng link
-- tải lên ký sẵn (máy chủ VAM không nhận byte ảnh); xem bằng link ký sẵn 1 giờ, thẻ <img> thường —
-- không qua bộ tối ưu ảnh của Next (xếp loại lại cảnh báo sharp: __tests__/image-optimizer-attack-surface.test.ts).

create sequence if not exists public.bao_loi_ma_seq;

create table if not exists public.bao_loi (
  id uuid primary key default gen_random_uuid(),
  ma text not null unique default ('VAM' || lpad(nextval('public.bao_loi_ma_seq')::text, 5, '0')),
  nguoi_gui uuid references public.admin_users(id) on delete set null,
  ten_gui text,
  email_gui text,
  vai text not null,
  loai text not null check (loai in ('khong_mo_duoc', 'hien_thi_sai', 'du_lieu_sai', 'gui_thu', 'dang_nhap', 'de_xuat', 'khac')),
  tieu_de text not null check (char_length(btrim(tieu_de)) between 3 and 120),
  noi_dung text not null default '' check (char_length(noi_dung) <= 4000),
  trang text check (char_length(trang) <= 300),
  thiet_bi jsonb not null default '{}'::jsonb check (char_length(thiet_bi::text) <= 2000),
  anh text[] not null default '{}' check (cardinality(anh) <= 5),
  -- moi → dang_xu_ly → da_xu_ly | khong_tai_hien | khong_phai_loi | trung ; can_chu = chờ chủ chương trình
  -- duyệt ; cho_bo_sung = đã hỏi lại, chờ người gửi trả lời.
  trang_thai text not null default 'moi' check (trang_thai in ('moi', 'dang_xu_ly', 'can_chu', 'cho_bo_sung',
    'da_xu_ly', 'khong_tai_hien', 'khong_phai_loi', 'trung')),
  trung_voi uuid references public.bao_loi(id) on delete set null check (trung_voi is distinct from id),
  tra_loi text check (char_length(tra_loi) <= 2000),
  tra_loi_luc timestamptz,
  da_xem_luc timestamptz,
  ghi_chu_noi_bo text check (char_length(ghi_chu_noi_bo) <= 8000),
  commit_sua text check (char_length(commit_sua) <= 80),
  xu_ly_boi text,
  dong_luc timestamptz,
  tao_luc timestamptz not null default now(),
  cap_nhat_luc timestamptz not null default now()
);
create index if not exists bao_loi_trang_thai_idx on public.bao_loi (trang_thai, tao_luc desc);
create index if not exists bao_loi_nguoi_gui_idx on public.bao_loi (nguoi_gui, tao_luc desc);

create table if not exists public.bao_loi_trao_doi (
  id uuid primary key default gen_random_uuid(),
  bao_loi_id uuid not null references public.bao_loi(id) on delete restrict,
  ben text not null check (ben in ('hoi', 'tra_loi')),
  nguoi text,
  ten text,
  noi_dung text not null default '' check (char_length(noi_dung) <= 4000),
  anh text[] not null default '{}' check (cardinality(anh) <= 5),
  tao_luc timestamptz not null default now(),
  check (char_length(btrim(noi_dung)) > 0 or cardinality(anh) > 0)
);
create index if not exists bao_loi_trao_doi_ticket_idx on public.bao_loi_trao_doi (bao_loi_id, tao_luc);

alter table public.bao_loi enable row level security;
alter table public.bao_loi_trao_doi enable row level security;
revoke all on public.bao_loi from public, anon, authenticated, service_role;
revoke all on public.bao_loi_trao_doi from public, anon, authenticated, service_role;
grant select, insert, update on public.bao_loi to service_role;
grant select, insert on public.bao_loi_trao_doi to service_role;
revoke all on sequence public.bao_loi_ma_seq from public, anon, authenticated;
grant usage on sequence public.bao_loi_ma_seq to service_role;

-- Kho ảnh riêng. Không tạo policy cho anon/authenticated: tải lên bằng link ký sẵn do máy chủ cấp cho
-- đúng thư mục của người gửi, xem bằng link ký sẵn do máy chủ cấp. Bọc điều kiện để môi trường thử
-- không có schema storage vẫn chạy.
do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('bao-loi', 'bao-loi', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$bucket$;

-- Loại thư mới: báo người gửi rằng ban xử lý cần họ bổ sung báo lỗi. NỐI THÊM vào ràng buộc hiện có.
do $kind$
declare
  v_def text;
  v_rebuilt text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if v_def is null then
    raise exception 'outbound_emails_kind_check không tồn tại';
  end if;
  if position(quote_literal('bao_loi_hoi_lai') in v_def) > 0 then
    return;
  end if;
  v_rebuilt := regexp_replace(v_def, '(\]\)+)$',', ''bao_loi_hoi_lai''::text\1');
  if v_rebuilt = v_def then
    raise exception 'Không nối thêm được loại thư vào: %', v_def;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $check$
declare
  t text;
  v_def text;
begin
  foreach t in array array['bao_loi', 'bao_loi_trao_doi'] loop
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
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception 'SELF_CHECK: % không được xoá từ ứng dụng', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.bao_loi_trao_doi', 'update') then
    raise exception 'SELF_CHECK: luồng hỏi – đáp phải chỉ thêm, không sửa';
  end if;
  if not has_table_privilege('service_role', 'public.bao_loi', 'update') then
    raise exception 'SELF_CHECK: máy chủ chưa cập nhật được bao_loi';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if position(quote_literal('bao_loi_hoi_lai') in coalesce(v_def, '')) = 0 then
    raise exception 'SELF_CHECK: outbound_emails_kind_check thiếu loại thư bao_loi_hoi_lai';
  end if;
  -- Lồng hai tầng: một biểu thức nhắc storage.buckets sẽ hỏng ngay khi schema storage không có (môi trường thử).
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets where id = 'bao-loi' and public = false) then
      raise exception 'SELF_CHECK: thiếu kho ảnh riêng bao-loi';
    end if;
  end if;
  raise notice 'Báo lỗi: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
