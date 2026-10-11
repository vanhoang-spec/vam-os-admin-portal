-- Chỉ mục tra người theo email đã chuẩn hoá — giảm tải màn hình phỏng vấn mentee.
--
-- 11/10/2026: database production tự khởi động lại 6 lần trong ngày phỏng vấn
-- (09:22, 09:52, 10:49, 11:09, 13:03, 13:22; mỗi lần 2–4 phút không ai thao tác
-- được). Truy vấn nặng nhất là vam104_offline_dashboard: màn hình
-- /interviews/mentee-offline gọi lại nó sau MỖI thao tác của mỗi người (hơn 30
-- người phỏng vấn + Support team), và sáng nay nó bị huỷ vì quá 8 giây 626 lần.
--
-- Trong hàm đó, phần "người phỏng vấn" tra public.people theo
--   lower(btrim(email_primary)) = lower(btrim(<email tài khoản>))
-- cho từng tài khoản (144 tài khoản), ở ba chỗ. Hai chỉ mục sẵn có trên đúng
-- biểu thức này đều là chỉ mục MỘT PHẦN (có WHERE ... <> ''). Planner không
-- chứng minh được điều kiện của truy vấn kéo theo điều kiện của chỉ mục, nên nó
-- đi theo khoá chính rồi lọc từng dòng: ~375.000 lượt chạm trang cho mỗi lần
-- tải màn hình.
--
-- Chỉ mục dưới đây là bản ĐẦY ĐỦ (không WHERE) của cùng biểu thức. Chỉ thêm:
-- không đổi dữ liệu, không đổi kết quả của bất kỳ truy vấn nào. Bảng khoảng
-- 2.000 dòng nên dựng xong trong vài mili-giây. Dán lại không sao.
create index if not exists people_email_canonical_lookup_idx
  on public.people (lower(btrim(email_primary::text)));

-- Thống kê cho biểu thức của chỉ mục chỉ có sau ANALYZE. Thiếu nó planner vẫn
-- đoán "10 dòng khớp" và có thể giữ kế hoạch cũ.
analyze public.people;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'people'
      and indexname = 'people_email_canonical_lookup_idx'
  ) then
    raise exception 'Thiếu chỉ mục people_email_canonical_lookup_idx';
  end if;
end $$;

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'people'
  and indexname = 'people_email_canonical_lookup_idx';
