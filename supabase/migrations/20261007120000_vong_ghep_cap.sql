-- Vòng ghép cặp (BTC 07/10/2026).
--
-- Vòng 1 = mentee được chính người phỏng vấn nhận ("Có – Tôi muốn nhận") ngay tại buổi
-- phỏng vấn, ở MỌI đợt: đợt 03–04/10 (47 cặp) và đợt 10–11/10 đều là vòng 1.
--
-- Mọi cặp như vậy sinh ra từ đúng một chỗ: vam104_save_offline_interview tạo match rồi
-- ghi match_id vào mentee_interview_operations. Vì thế dấu vòng 1 bám theo chính liên kết
-- đó chứ không theo ngày ghép. Bám theo ngày thì đợt 3 lại phải sửa migration, và một
-- phiếu nộp muộn sẽ rơi khỏi vòng của nó: một cặp chọn ở ca 04/10 mang ngày ghép 06/10
-- vì người phỏng vấn nộp phiếu hôm đó.
--
-- Gắn bằng trigger trên mentee_interview_operations, không viết lại vam104: hàm đó dài
-- gần 19.000 ký tự và đã bị viết lại tại chỗ nhiều lần; thêm một lần chỉ để đặt một cột
-- là rủi ro không đáng.
--
-- Cặp BTC ghép tay ở trang Ghép cặp để trống (chưa gắn vòng): cách ghép vòng 2 BTC
-- chưa chốt.

alter table public.matches add column if not exists matching_round smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matches_matching_round_check') then
    alter table public.matches
      add constraint matches_matching_round_check check (matching_round is null or matching_round >= 1);
  end if;
end $$;

comment on column public.matches.matching_round is
  'Vòng ghép cặp. 1 = người phỏng vấn nhận mentee ngay tại buổi phỏng vấn (mọi đợt), gắn tự động bởi trigger vam111. Trống = chưa gắn vòng.';

-- Không SECURITY DEFINER: trigger chạy với quyền của lệnh gây ra nó (service_role trong
-- vam104), không cần nới thêm quyền nào.
create or replace function public.vam111_interview_take_round()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- "is null": cặp đã mang vòng khác (BTC gắn tay sau này) không bị kéo về vòng 1
  -- chỉ vì một lần lưu lại phiếu.
  update public.matches
     set matching_round = 1
   where id = new.match_id
     and matching_round is null;
  return null;
end;
$$;

revoke all on function public.vam111_interview_take_round() from public, anon, authenticated;

drop trigger if exists vam111_interview_take_round on public.mentee_interview_operations;
create trigger vam111_interview_take_round
  after insert or update of match_id on public.mentee_interview_operations
  for each row
  when (new.match_id is not null)
  execute function public.vam111_interview_take_round();

-- Gắn cho các cặp đã có (đợt 03–04/10). Chỉ cặp đang đồng hành: cặp đã huỷ vì bấm nhầm
-- không còn là một cặp, và hai trong ba cặp đó đã mất liên kết khi người phỏng vấn
-- sửa phiếu — gắn một nửa số đó thì sai lệch hơn là không gắn.
update public.matches m
   set matching_round = 1
 where m.matching_round is null
   and m.status = 'active'
   and exists (select 1 from public.mentee_interview_operations o where o.match_id = m.id);

do $$
declare
  v_missing integer;
  v_round1 integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'matches' and column_name = 'matching_round'
  ) then
    raise exception 'Thiếu cột matches.matching_round';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname = 'vam111_interview_take_round' and c.relname = 'mentee_interview_operations' and not t.tgisinternal
  ) then
    raise exception 'Thiếu trigger vam111_interview_take_round';
  end if;
  select count(*) into v_missing
    from public.matches m
   where m.status = 'active' and m.matching_round is null
     and exists (select 1 from public.mentee_interview_operations o where o.match_id = m.id);
  if v_missing > 0 then
    raise exception '% cặp nhận tại buổi phỏng vấn chưa được gắn vòng 1', v_missing;
  end if;
  select count(*) into v_round1 from public.matches where matching_round = 1 and status = 'active';
  raise notice 'Vòng 1: % cặp đang đồng hành', v_round1;
end $$;
