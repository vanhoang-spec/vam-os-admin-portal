-- Ghép cặp Vòng 2 — thư NHẮC mentor chưa chọn mentee (BTC 16/10/2026).
--
-- BTC bấm "Gửi thư nhắc" ở Vòng 2 · Báo cáo: thư tới mentor đã nhận link mời mà chưa có cặp Vòng 2 nào,
-- kèm đúng đường dẫn đã gửi trước đó. Thư ghi vào outbound_emails theo link (related_table =
-- matching_round2_links) để biết ai đã được nhắc gần đây — không thêm cột hay bảng nào, nên KHÔNG đụng
-- tới matching_round2_links (bị khoá dòng ở mỗi lượt chọn trong lúc vòng đang mở).
--
-- Việc duy nhất: nối thêm loại thư 'matching_round2_reminder' vào outbound_emails_kind_check, theo lối
-- cộng thêm — đọc định nghĩa đang có bằng pg_get_constraintdef rồi nối vào; viết đè cả danh sách là để
-- sót loại cũ và lặng lẽ chặn thư loại đó (khuôn 20260910240000, 20261015200000).

do $kind$
declare
  v_existing text;
  v_rebuilt text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
    from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if v_existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không thấy outbound_emails_kind_check';
  end if;
  if position(quote_literal('matching_round2_reminder') in v_existing) > 0 then
    return;
  end if;
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''matching_round2_reminder''::text\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $check$
declare
  v_def text;
  k text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  -- Loại mới có mặt, và mọi loại đang dùng trước đó vẫn còn.
  foreach k in array array['matching_round2_reminder', 'matching_round2_invite', 'mentee_exemption_confirm', 'custom_form_receipt', 'general_announcement'] loop
    if position(quote_literal(k) in coalesce(v_def, '')) = 0 then
      raise exception 'SELF_CHECK: outbound_emails_kind_check thiếu loại thư %', k;
    end if;
  end loop;
  raise notice 'Vòng 2 — thư nhắc: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
