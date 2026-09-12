-- ═══════════════════════════════════════════════════════════════════════════
-- Thư mời nhân sự đi qua Brevo và được ghi sổ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tới trước migration này, tạo một tài khoản nhân sự ở /admin/users gọi
-- `auth.admin.inviteUserByEmail`. Lệnh đó làm hai việc trong một: tạo tài khoản
-- Auth, và bảo Supabase tự gửi thư.
--
-- Chữ "tự" là chỗ hỏng. Không có `redirectTo`, Supabase dựng đường dẫn về Site
-- URL kèm mã ở phần `#`. Mà chỉ ba đường trong sản phẩm được phép dựng phiên từ
-- mảnh đó — /login, /reset-password, /auth/callback. Site URL trỏ về gốc, nên
-- người nhận bấm vào rơi thẳng ra trang đăng nhập, không có gì đọc mã, và họ
-- thì chưa có mật khẩu. Người mời cũng kẹt theo: nút Kích hoạt đòi
-- `email_confirmed_at`, mà cột đó chỉ được đặt khi người kia xác nhận được.
--
-- Thư ấy cũng không đi qua `outbound_emails`, nên Nhật ký gửi không có dấu vết
-- nào: không tra được đã gửi cho ai, lúc nào, có tới không.
--
-- Migration này chỉ làm một việc: cho `outbound_emails.kind` nhận thêm
-- 'staff_invite'. Phần còn lại nằm ở mã.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO KHÔNG DÙNG TẠM 'reviewer_invite'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dùng lại loại thư của reviewer thì không cần migration nào — và sinh ra một
-- lỗi chéo có thật. `lib/enable-reviewer.ts` chống gửi trùng bằng cách tra
-- những thư `kind = 'reviewer_invite'` đã gửi cho địa chỉ đó trong 60 phút gần
-- nhất. Mời một người vào ban tổ chức sẽ ghi một dòng mang đúng loại ấy, và
-- thư mời reviewer của chính người đó bị chặn im lặng trong một tiếng.
--
-- Một giá trị riêng vừa tránh chuyện đó, vừa làm Nhật ký gửi lọc được đúng
-- nhóm thư khi cần tra.
-- ═══════════════════════════════════════════════════════════════════════════

do $preflight$
begin
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREFLIGHT_FAILED: chưa có bảng public.outbound_emails';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.outbound_emails'::regclass
      and c.conname = 'outbound_emails_kind_check'
  ) then
    raise exception 'PREFLIGHT_FAILED: chưa có ràng buộc outbound_emails_kind_check';
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- Nới theo lối cộng thêm
-- ───────────────────────────────────────────────────────────────────────────
--
-- Đọc lại định nghĩa đang chạy rồi nối vào đuôi, thay vì viết đè cả danh sách.
-- Viết đè nghĩa là mỗi lần thêm một loại thư lại phải chép đúng toàn bộ 11 giá
-- trị đã có; chép thiếu một cái thì những thư loại đó lặng lẽ ngừng ghi được sổ,
-- và chỉ lộ ra vào lần cần tra lại.
do $widen_kind$
declare
  existing text;
  rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  -- Chạy lại lần hai không nhân đôi giá trị.
  if position('''staff_invite''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(
    existing,
    '\]\)\)\)$',
    ', ''staff_invite''::text])))'
  );

  if rebuilt = existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check có dạng lạ, không nới được: %',
      existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$widen_kind$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Câu thứ hai quan trọng hơn câu thứ nhất: một migration nới ràng buộc mà đánh
-- rơi một giá trị cũ chỉ lộ ra vào lần ai đó gửi đúng loại thư bị mất.
do $self_check$
declare
  def text;
  v   text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position('''staff_invite''' in coalesce(def, '')) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận staff_invite';
  end if;

  foreach v in array array[
    'mentor_confirmation_link', 'mentee_application_confirmation',
    'mentor_application_confirmation', 'review_batch_assigned',
    'interview_scheduled', 'reviewer_invite', 'interview_round_invite',
    'general_announcement', 'event_registration_confirmation',
    'event_schedule_change', 'participant_invite'
  ] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: đã MẤT loại thư cũ %', v;
    end if;
  end loop;
end;
$self_check$;
