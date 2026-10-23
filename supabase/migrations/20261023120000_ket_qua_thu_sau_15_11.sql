-- Thư kết quả ghép cặp — thư riêng cho nhóm mentor còn phải dự Training 15/11 (BTC 23/10/2026).
--
-- Nhóm này (danh sách giữ lại, 18 mentor) và mentee của họ nhận mẫu "MATCHING SAU 15/11" ngay bây giờ;
-- sau 15/11, khi BTC kết nối chính thức, họ nhận thêm thư thường có link hồ sơ. Hai lá thư khác nhau
-- nên mỗi người cần MỘT DÒNG THÔNG BÁO CHO MỖI LOẠI THƯ: trước đây bảng chỉ cho một dòng mỗi người
-- (season, person, role), nên thư sau 15/11 đã gửi sẽ khiến hệ thống tưởng người đó đã nhận thư thường.
--
-- Đổi ràng buộc duy nhất thành (season, person, role, variant). Chưa có thư nào được gửi, nên không
-- có dòng nào phải chuyển. Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge. Dán lại lần hai
-- không sao.

do $prereq$
begin
  if to_regclass('public.match_result_notices') is null then
    raise exception 'PREREQ_MISSING: chưa có match_result_notices — chạy migration 20261022120000 trước';
  end if;
end
$prereq$;

alter table public.match_result_notices drop constraint if exists match_result_notices_person_uniq;

do $uniq$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.match_result_notices'::regclass
                    and conname = 'match_result_notices_person_variant_uniq') then
    alter table public.match_result_notices
      add constraint match_result_notices_person_variant_uniq unique (season_id, person_id, role, variant);
  end if;
end
$uniq$;

do $check$
declare
  v_def text;
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.match_result_notices'::regclass and conname = 'match_result_notices_person_uniq') then
    raise exception 'SELF_CHECK: ràng buộc cũ (một dòng mỗi người) vẫn còn';
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.match_result_notices'::regclass and conname = 'match_result_notices_person_variant_uniq';
  if v_def is null or v_def not like '%variant%' then
    raise exception 'SELF_CHECK: thiếu ràng buộc duy nhất theo loại thư';
  end if;
  if has_table_privilege('anon', 'public.match_result_notices', 'select')
     or has_table_privilege('authenticated', 'public.match_result_notices', 'select') then
    raise exception 'SELF_CHECK: anon/authenticated đọc được match_result_notices';
  end if;
  raise notice 'Thư kết quả: mỗi người một dòng thông báo cho mỗi loại thư — sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
