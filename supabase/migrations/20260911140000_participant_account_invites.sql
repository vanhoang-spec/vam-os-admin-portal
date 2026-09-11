-- ═══════════════════════════════════════════════════════════════════════════
-- Lời mời lập tài khoản cho mentor/mentee
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Thư mời đi qua Brevo như mọi thư khác của hệ thống, chứ không qua thư của
-- Supabase Auth. Link trong thư là link của chính VAM OS, dựng từ mã băm mà
-- `auth.admin.generateLink` trả về — Supabase không gửi thư nào.
--
-- Vì sao không để Supabase tự gửi:
--   * Link của Supabase bị tiêu ngay lúc được mở. Máy quét thư của công ty
--     (Outlook Safe Links) mở thử mọi link trước người nhận, nên người nhận
--     bấm vào là gặp "link đã hết hạn". Link của VAM OS phải bấm "Tiếp tục"
--     rồi mới dùng tới mã.
--   * Thư của Supabase không vào sổ `outbound_emails`, nên không ai trả lời
--     được "đã mời ai, lúc nào, thư có đi không", và không đếm được hạn mức.
--   * Supabase giới hạn số thư Auth mỗi giờ, kể cả khi đã dùng SMTP riêng.
--
-- Ba thứ được thêm. Không bảng mới, không hàm mới, nên không có quyền nào phải
-- thu hồi hay cấp lại — index kế thừa hợp đồng quyền sẵn có của outbound_emails.
--
--   1. `outbound_emails.kind` nhận thêm 'participant_invite'.
--   2. `admin_audit_log.action_type` nhận thêm 'participant_account_invite'.
--   3. Một index unique GIỮ CHỖ: mỗi người chỉ có một lượt gửi `queued` tại một
--      thời điểm. Hai người vận hành bấm cùng lúc thì lượt thứ hai bị chặn ngay
--      lúc giữ chỗ — trước khi kịp tạo link hay gửi thư.
--
-- Index CHỈ phủ `queued`, không phủ `sent`. Phủ cả `sent` thì sau lá thư đầu
-- tiên không bao giờ gửi lại được nữa — kể cả khi người nhận làm mất thư.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Dò trước: thiếu gì thì báo đủ một lần, trước khi đổi bất cứ thứ gì
-- ───────────────────────────────────────────────────────────────────────────
do $preflight$
declare
  missing text;
begin
  select string_agg(needed.tbl || '.' || needed.col, ', ' order by needed.tbl, needed.col)
    into missing
  from (values
    ('outbound_emails',           'id'),
    ('outbound_emails',           'kind'),
    ('outbound_emails',           'to_email'),
    ('outbound_emails',           'subject'),
    ('outbound_emails',           'status'),
    ('outbound_emails',           'provider'),
    ('outbound_emails',           'error'),
    ('outbound_emails',           'related_table'),
    ('outbound_emails',           'related_id'),
    ('outbound_emails',           'created_at'),
    ('account_person_auth_links', 'auth_user_id'),
    ('account_person_auth_links', 'person_id'),
    ('account_person_auth_links', 'status'),
    ('account_person_auth_links', 'link_source'),
    ('account_person_auth_links', 'invited_at'),
    ('account_person_auth_links', 'activated_at'),
    ('account_person_auth_links', 'created_by'),
    ('admin_audit_log',           'actor_admin_user_id'),
    ('admin_audit_log',           'action_type'),
    ('admin_audit_log',           'details')
  ) as needed(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name   = needed.tbl
      and c.column_name  = needed.col
  );

  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.outbound_emails')
      and conname = 'outbound_emails_kind_check'
  ) then
    missing := concat_ws(', ', missing, 'ràng buộc outbound_emails_kind_check');
  end if;

  if missing is not null then
    raise exception
      'PREFLIGHT_MISSING_DEPENDENCY: production chưa có những thứ lời mời tài khoản cần tới: %', missing;
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Nới ràng buộc loại thư — đọc rồi nối, không chép lại danh sách
-- ───────────────────────────────────────────────────────────────────────────
--
-- Chép lại cả danh sách nghĩa là phải biết đúng production đang có những loại
-- nào; chép thiếu một loại thì thư loại đó ngừng ghi được sổ mà không ai thấy.
-- Nên khối này đọc định nghĩa hiện có, nối thêm một giá trị, rồi SO LẠI: tập giá
-- trị sau phải chứa trọn tập giá trị trước.
do $participant_invite_kind$
declare
  existing    text;
  rebuilt     text;
  after_def   text;
  before_vals text[];
  after_vals  text[];
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position('''participant_invite''' in existing) > 0 then
    return;
  end if;

  select array_agg(m[1])
    into before_vals
  from regexp_matches(existing, '''([^'']*)''::text', 'g') as m;

  if before_vals is null or coalesce(array_length(before_vals, 1), 0) = 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không đọc được giá trị nào trong outbound_emails_kind_check: %',
      existing;
  end if;

  rebuilt := regexp_replace(
    existing,
    '\]\)\)\)$',
    ', ''participant_invite''::text])))'
  );

  if rebuilt = existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check có dạng lạ, không nới được: %',
      existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(rebuilt, 'CHECK ', 'check ');

  select pg_get_constraintdef(c.oid)
    into after_def
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  select array_agg(m[1])
    into after_vals
  from regexp_matches(after_def, '''([^'']*)''::text', 'g') as m;

  if not (after_vals @> before_vals and 'participant_invite' = any(after_vals)) then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: nới outbound_emails_kind_check làm mất giá trị cũ. Trước: %, sau: %',
      before_vals, after_vals;
  end if;
end;
$participant_invite_kind$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Nới từ vựng admin_audit_log.action_type
-- ───────────────────────────────────────────────────────────────────────────
--
-- Mọi helper ghi audit đều nuốt lỗi, nên một action_type lạ bị từ chối 23514 và
-- ÂM THẦM không bao giờ được ghi. Chép khuôn đọc-và-nối của
-- 20260909090000_outbound_emails.sql, kể cả phép đếm dấu nháy.
do $participant_invite_audit_vocab$
declare
  v_new_value constant text := 'participant_account_invite';
  v_def    text;
  v_vocab  text[];
  v_post   text[];
  v_quotes integer;
  v_after  text;
  v_check  text[];
begin
  select pg_get_constraintdef(c.oid, true)
    into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise notice 'PARTICIPANT_INVITES: admin_audit_log_action_type_check not present; skipping vocabulary step.';
    return;
  end if;

  if position(quote_literal(v_new_value) in v_def) > 0 then
    raise notice 'PARTICIPANT_INVITES: audit vocabulary already accepts %; nothing to do.', v_new_value;
    return;
  end if;

  if v_def not ilike '%= ANY (ARRAY[%' then
    raise exception
      'PARTICIPANT_INVITES ABORTED [AUDIT_VOCAB_SHAPE]: constraint is not in ANY (ARRAY[...]) form: %',
      v_def;
  end if;

  select array_agg(m[1] order by m[1])
    into v_vocab
  from regexp_matches(v_def, '''([^'']*)''::text', 'g') as m;

  if v_vocab is null or coalesce(array_length(v_vocab, 1), 0) = 0 then
    raise exception 'PARTICIPANT_INVITES ABORTED [AUDIT_VOCAB_EMPTY]: no values parsed from the constraint.';
  end if;

  -- Mỗi giá trị đóng góp đúng hai dấu nháy. Lệch nghĩa là đã đọc hụt, và đọc
  -- hụt rồi dựng lại constraint là làm mất giá trị của người khác.
  v_quotes := length(v_def) - length(replace(v_def, '''', ''));
  if v_quotes <> array_length(v_vocab, 1) * 2 then
    raise exception
      'PARTICIPANT_INVITES ABORTED [AUDIT_VOCAB_SHAPE]: parsed % values but counted % quotes.',
      array_length(v_vocab, 1), v_quotes;
  end if;

  v_post := v_vocab || v_new_value;

  alter table public.admin_audit_log
    drop constraint admin_audit_log_action_type_check;

  execute format(
    'alter table public.admin_audit_log add constraint admin_audit_log_action_type_check check (action_type = any (array[%s]))',
    (select string_agg(format('%L::text', x), ', ' order by x) from unnest(v_post) x)
  );

  select pg_get_constraintdef(c.oid, true)
    into v_after
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  select array_agg(m[1] order by m[1])
    into v_check
  from regexp_matches(v_after, '''([^'']*)''::text', 'g') as m;

  if v_check is distinct from (select array_agg(x order by x) from unnest(v_post) x) then
    raise exception
      'PARTICIPANT_INVITES ABORTED [AUDIT_VOCAB_POST]: rebuilt vocabulary does not match the intended set.';
  end if;

  raise notice 'PARTICIPANT_INVITES: audit vocabulary grew from % to % values.',
    array_length(v_vocab, 1), array_length(v_post, 1);
end;
$participant_invite_audit_vocab$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Index giữ chỗ
-- ───────────────────────────────────────────────────────────────────────────
--
-- Người gửi chèn một dòng `queued` TRƯỚC khi tạo link. Lượt thứ hai cho cùng
-- một người nhận 23505 ngay tại đó và dừng — không tạo link thứ hai làm hỏng
-- link thứ nhất, không gửi lá thư thứ hai. Kết quả gửi được chốt lên chính dòng
-- ấy (sent/failed/skipped), nên nó rơi khỏi phạm vi index và lần gửi lại sau
-- vẫn giữ chỗ được.
create unique index if not exists outbound_emails_participant_invite_inflight_idx
  on public.outbound_emails (related_table, related_id)
  where kind = 'participant_invite' and status = 'queued' and related_id is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ───────────────────────────────────────────────────────────────────────────
do $self_check$
declare
  kind_def  text;
  audit_def text;
  predicate text;
begin
  select pg_get_constraintdef(c.oid)
    into kind_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.outbound_emails')
    and c.conname = 'outbound_emails_kind_check';

  if kind_def is null or position('''participant_invite''' in kind_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận participant_invite';
  end if;

  -- Một giá trị cũ vẫn phải còn: nới mà làm mất thư xác nhận đơn thì tệ hơn
  -- không nới.
  if position('''mentee_application_confirmation''' in kind_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check đã mất mentee_application_confirmation';
  end if;

  select pg_get_constraintdef(c.oid, true)
    into audit_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if audit_def is not null and position('''participant_account_invite''' in audit_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận participant_account_invite';
  end if;

  select pg_get_expr(i.indpred, i.indrelid)
    into predicate
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  where i.indrelid = to_regclass('public.outbound_emails')
    and ic.relname = 'outbound_emails_participant_invite_inflight_idx'
    and i.indisunique;

  if predicate is null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_participant_invite_inflight_idx phải tồn tại và là unique';
  end if;

  if position('''queued''' in predicate) = 0 or position('''sent''' in predicate) > 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: index giữ chỗ phải chỉ phủ queued. Điều kiện hiện tại: %', predicate;
  end if;

  if position('''participant_invite''' in predicate) = 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: index giữ chỗ chưa giới hạn vào participant_invite. Điều kiện hiện tại: %', predicate;
  end if;
end;
$self_check$;

commit;

notify pgrst, 'reload schema';
