# VAM OS Sprint 1B - RLS Go/No-Go Checklist

## Executive summary

Checklist này dùng để quyết định có nên bật Sprint 1B RLS read policies trên production hay không. Đây là tài liệu review thủ công trước rollout, không phải migration và không chạy SQL.

Khuyến nghị cuối: không enable RLS cho đến khi checklist này được review thủ công và founder/core team xác nhận các quyết định còn mở.

## 1. Required preconditions

Trước khi cân nhắc Go, tất cả điều kiện sau phải đạt:

- [ ] Có ít nhất một tài khoản `super_admin` hoạt động được trên production.
- [ ] `auth_user_id` đã được link trong `admin_users` cho `super_admin`.
- [ ] `auth_user_id` đã được link cho các tài khoản test cần dùng.
- [ ] Production login/logout đã được test.
- [ ] Password gate transition behavior đã được xác nhận:
  - Password gate có thể xuất hiện trước nếu `VAM_OS_ADMIN_PASSWORD` được set.
  - Password gate unlock không bypass Supabase Auth.
  - Sau unlock, user vẫn phải login Supabase Auth.
- [ ] Backup/rollback SQL đã sẵn sàng.
- [ ] Người chịu trách nhiệm rollback đã được xác định.
- [ ] Có khung thời gian rollout ít rủi ro, tránh giờ core team đang cần dùng dashboard.

## 2. Go criteria

Chỉ Go nếu tất cả tiêu chí sau đã đạt:

- [ ] Helper functions đã được review:
  - `current_admin_role()`
  - `is_admin_role(text[])`
  - `is_active_admin()`
- [ ] Policies đã được review table by table.
- [ ] `admin_users` được xác nhận là bảng bật RLS cuối cùng, không bật đầu tiên.
- [ ] Applications policy đã được approve:
  - `viewer` có được xem Applications không?
  - Hay chỉ `reviewer/admin/super_admin`?
- [ ] Correction log policy đã được approve:
  - `reviewer` có được xem correction log không?
  - Hay chỉ `admin/super_admin`?
- [ ] Test accounts đã chuẩn bị:
  - `viewer`
  - `admin`
  - `super_admin`
- [ ] Test accounts login được trên production hoặc production-like environment.
- [ ] Có người test ngay sau mỗi table/batch.
- [ ] Có người có quyền rollback ngay nếu page bị gãy.

## 3. No-Go criteria

Không Go nếu có bất kỳ điều kiện nào sau đây:

- [ ] `auth_user_id` còn null cho tài khoản `super_admin` hoặc test accounts cần dùng.
- [ ] Không có test account `viewer`.
- [ ] Không có test account `admin`.
- [ ] Chưa chắc policy cho `applications`.
- [ ] Chưa chắc policy cho `activity_correction_log`.
- [ ] Không có rollback plan.
- [ ] Người có quyền rollback không sẵn sàng.
- [ ] Production login không ổn định.
- [ ] Logout/login lại chưa được test.
- [ ] Password gate vẫn có thể bypass Supabase Auth.
- [ ] Chưa xác nhận `admin_users` sẽ được bật RLS cuối cùng.

## 4. Table-by-table enable order

Thứ tự bật RLS production nếu Go:

1. `programs` / `seasons`
2. `events`
3. `people`
4. `mentor_profiles` / `mentee_profiles`
5. `mentoring_recaps`
6. `event_participations`
7. `matches`
8. `applications`
9. `operational_team_assignments`
10. `activity_correction_log`
11. `admin_users` last

Critical rule:

NEVER enable RLS on `admin_users` first.

Sau mỗi bước:

- [ ] Test Dashboard.
- [ ] Test Operations Dashboard.
- [ ] Test People profile.
- [ ] Test role-specific behavior.
- [ ] Check không có blank page.
- [ ] Check logs nếu có lỗi permission.
- [ ] Chỉ tiếp tục bước tiếp theo nếu batch hiện tại pass.

## 5. Rollback snippets

Các snippet dưới đây chỉ là ví dụ comment để chuẩn bị rollback. Không chạy mặc định.

```sql
-- Disable RLS for one table if rollout breaks a page.
-- alter table public.<table_name> disable row level security;
```

```sql
-- Drop one policy if policy condition is wrong.
-- drop policy if exists "<policy_name>" on public.<table_name>;
```

```sql
-- Inspect current policies.
-- select schemaname, tablename, policyname, permissive, roles, cmd, qual
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
```

Rollback nguyên tắc:

- Rollback batch vừa gây lỗi, không rollback dữ liệu.
- Không xóa audit logs.
- Không thay đổi business data.
- Ghi lại bảng/policy gây lỗi trước khi sửa.

## 6. Final recommendation

Do not enable RLS until this checklist is reviewed manually.

Khuyến nghị thêm:

- Test trên staging Supabase project trước nếu có thể.
- Bật production theo từng bảng hoặc batch nhỏ.
- Giữ write policies ngoài phạm vi Sprint 1B.
- Chỉ bật `admin_users` sau cùng, khi toàn bộ flow login/role lookup đã ổn định.
