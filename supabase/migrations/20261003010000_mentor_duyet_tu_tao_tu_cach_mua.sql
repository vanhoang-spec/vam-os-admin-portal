-- ============================================================
-- 20261003010000_mentor_duyet_tu_tao_tu_cach_mua.sql
-- ============================================================
--
-- LỖI (BTC báo 03/10/2026): mentor mới đã "Đã duyệt — Mentor" nhưng không hiện ở
-- Cộng đồng VAM → Mentor (Mùa 12), và không có trong danh sách để cấp quyền chấm
-- phỏng vấn.
--
-- Vì sao: cả hai trang đó lấy người từ TƯ CÁCH THÀNH VIÊN MÙA
-- (person_season_memberships, role 'mentor', đang active) — còn hai hàm duyệt
-- chính thức (vam090 duyệt từng đơn, vam092 duyệt hàng loạt) chỉ tạo person +
-- mentor_profile, KHÔNG tạo tư cách mùa. Tới nay BTC thêm tay cho từng người
-- (46/62 mentor mới, cả 260 mentor gia hạn); 16 người duyệt 30/09 chưa ai thêm.
--
--   1. Trigger trên applications: đơn MENTOR chuyển sang approved_as_mentor (đã
--      có person) → tạo tư cách mentor active của đúng mùa đó. Một chỗ cho mọi
--      đường duyệt — từng đơn, hàng loạt, và đường nào thêm sau này — thay vì
--      chép lại hai hàm duyệt dài. Đã có tư cách (gia hạn, thêm tay, kể cả đã rút)
--      thì KHÔNG đụng: on conflict do nothing.
--   2. Bổ sung tư cách cho mọi đơn mentor Mùa 12 đã duyệt mà còn thiếu (16 người).
--   3. Tự kiểm.
--
-- Mentee KHÔNG nằm trong trigger: luồng chấm phỏng vấn mentee (vam104) tự tạo
-- tư cách mentee và còn ghi owns_membership để gỡ khi sửa kết quả — trigger chen
-- vào sẽ tranh việc đó.
--
-- Không có mã ứng dụng đi kèm, nên dán trước hay sau merge đều được; dán càng sớm
-- càng tốt để BTC cấp quyền phỏng vấn cho 16 người.

begin;

-- ------------------------------------------------------------
-- 1. Duyệt mentor → tư cách mùa
-- ------------------------------------------------------------
create or replace function public.vam108_mentor_approval_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program uuid;
begin
  if new.status = 'approved_as_mentor'
     and lower(coalesce(new.role_applied::text, '')) = 'mentor'
     and new.person_id is not null
     and new.season_id is not null
     and (old.status is distinct from new.status or old.person_id is distinct from new.person_id) then
    select s.program_id into v_program from public.seasons s where s.id = new.season_id;
    -- Không có chương trình thì để lệnh insert báo lỗi (validate trigger của bảng
    -- tư cách): duyệt mà lặng lẽ không tạo tư cách chính là lỗi đang sửa.
    insert into public.person_season_memberships (
      person_id, program_id, season_id, role, status, source, notes
    ) values (
      new.person_id, v_program, new.season_id, 'mentor', 'active', 'application',
      'Tự tạo khi duyệt chính thức đơn mentor'
    )
    on conflict (person_id, season_id, role) do nothing;
  end if;
  return new;
end;
$$;

alter function public.vam108_mentor_approval_membership() owner to postgres;
revoke all on function public.vam108_mentor_approval_membership() from public, anon, authenticated;

drop trigger if exists vam108_mentor_approval_membership on public.applications;
create trigger vam108_mentor_approval_membership
  after update of status, person_id on public.applications
  for each row execute function public.vam108_mentor_approval_membership();

-- ------------------------------------------------------------
-- 2. Bổ sung cho Mùa 12
-- ------------------------------------------------------------
do $bo_sung$
declare
  v_n integer;
begin
  insert into public.person_season_memberships (
    person_id, program_id, season_id, role, status, source, notes
  )
  select distinct a.person_id, s.program_id, a.season_id, 'mentor', 'active', 'application',
         'Bổ sung 03/10/2026: duyệt chính thức trước đây không tạo tư cách mùa'
    from public.applications a
    join public.seasons s on s.id = a.season_id
   where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
     and lower(coalesce(a.role_applied::text, '')) = 'mentor'
     and a.status = 'approved_as_mentor'
     and a.person_id is not null
  on conflict (person_id, season_id, role) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'Đã bổ sung tư cách mentor Mùa 12 cho % người', v_n;
end
$bo_sung$;

-- ------------------------------------------------------------
-- 3. Tự kiểm — sai một điều là huỷ cả transaction
-- ------------------------------------------------------------
do $mentor_membership_self_check$
declare
  v_n integer;
begin
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.applications'::regclass
       and t.tgname = 'vam108_mentor_approval_membership' and not t.tgisinternal
  ) then
    raise exception 'Tự kiểm: chưa có trigger vam108_mentor_approval_membership';
  end if;

  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'vam108_mentor_approval_membership') then
    raise exception 'Tự kiểm: hàm trigger phải security definer';
  end if;

  select count(*) into v_n
    from public.applications a
   where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
     and lower(coalesce(a.role_applied::text, '')) = 'mentor'
     and a.status = 'approved_as_mentor'
     and a.person_id is not null
     and not exists (
       select 1 from public.person_season_memberships m
        where m.person_id = a.person_id and m.season_id = a.season_id and m.role = 'mentor'
     );
  if v_n <> 0 then
    raise exception 'Tự kiểm: còn % mentor Mùa 12 đã duyệt mà chưa có tư cách mùa', v_n;
  end if;
end
$mentor_membership_self_check$;

commit;
