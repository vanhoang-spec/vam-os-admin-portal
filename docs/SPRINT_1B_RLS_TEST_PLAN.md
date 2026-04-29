# VAM OS Sprint 1B - RLS Safe Test Plan

## Executive summary

Draft migration `018_draft_rls_read_policies.sql` đã tồn tại nhưng chưa được chạy. Kế hoạch này mô tả cách test RLS an toàn, từng bảng một, để tránh làm gãy production.

Nguyên tắc quan trọng nhất: không bật RLS hàng loạt. Mỗi bước chỉ bật một nhóm nhỏ, deploy/test ngay trên môi trường giống production, rồi mới chuyển sang bước tiếp theo.

## 1. Pre-check trước khi bật RLS

Trước khi chạy bất kỳ RLS statement nào, cần kiểm tra:

- `admin_users` đã tồn tại.
- `admin_users` có đủ row cho các tài khoản test.
- `auth_user_id` đã được link đúng với Supabase Auth user.
- `status = 'active'` cho các user test.
- Role đúng với mục tiêu test.

Tài khoản test tối thiểu:

| Test account | Role | Mục đích |
| --- | --- | --- |
| Super admin | `super_admin` | Kiểm tra quyền cao nhất và quyền đọc `admin_users`. |
| Admin | `admin` | Kiểm tra dashboard và recap correction workflow. |
| Viewer | `viewer` | Kiểm tra read-only pages và chặn correction edit. |

Checklist trước rollout:

- [ ] Login Supabase Auth thành công với cả 3 tài khoản.
- [ ] Dashboard load trước khi bật RLS.
- [ ] Operations Dashboard load trước khi bật RLS.
- [ ] Recap edit hoạt động với `admin`.
- [ ] Viewer không access được `/recaps/[id]/edit`.
- [ ] Có rollback SQL snippets sẵn sàng.

## 2. Step-by-step RLS enable strategy

Không enable tất cả bảng cùng lúc. Bật RLS một bảng hoặc một nhóm rất nhỏ theo thứ tự sau:

1. `programs`, `seasons`
2. `events`
3. `people`
4. `mentor_profiles`, `mentee_profiles`
5. `mentoring_recaps`
6. `event_participations`
7. `matches`
8. `applications`
9. `operational_team_assignments`
10. `activity_correction_log`
11. `admin_users` last

## 3. Quy trình cho từng bước

Với mỗi bảng/nhóm bảng:

1. Enable RLS cho đúng bảng/nhóm bảng.
2. Add read policy tương ứng.
3. Deploy/apply trên môi trường test hoặc staging trước nếu có.
4. Test ngay trên Vercel hoặc môi trường production-like.
5. Nếu pass, ghi nhận kết quả rồi mới sang bước tiếp theo.
6. Nếu fail, rollback batch vừa bật, không tiếp tục bật bảng khác.

## 4. Checklist theo từng bước

### Step 1: `programs`, `seasons`

- [ ] Dashboard vẫn load.
- [ ] Operations Dashboard vẫn load.
- [ ] Không có blank page.
- [ ] Unauthenticated user không đọc được data qua protected route.

### Step 2: `events`

- [ ] Operations Dashboard vẫn load event metrics.
- [ ] Profile event activity vẫn load nếu có dữ liệu.
- [ ] Không có blank page.

### Step 3: `people`

- [ ] Viewer load được Dashboard.
- [ ] People page load được.
- [ ] People profile load được.
- [ ] Operations Dashboard vẫn load.
- [ ] Không có blank page.

### Step 4: `mentor_profiles`, `mentee_profiles`

- [ ] Mentors page load được.
- [ ] Mentees page load được.
- [ ] People profile vẫn hiển thị mentor/mentee sections.
- [ ] Dashboard vẫn load KPI mentor/mentee.

### Step 5: `mentoring_recaps`

- [ ] Operations Dashboard vẫn load recap metrics.
- [ ] People profile vẫn hiển thị mentoring activity.
- [ ] Admin vẫn vào được recap edit page.
- [ ] Viewer vẫn bị chặn khỏi `/recaps/[id]/edit`.

### Step 6: `event_participations`

- [ ] Profile event activity vẫn load.
- [ ] Operations event participation metrics vẫn load.
- [ ] Không có blank page.

### Step 7: `matches`

- [ ] Matches page load được.
- [ ] Match detail load được.
- [ ] Dashboard match KPIs vẫn load.
- [ ] People profile vẫn hiển thị match relationships.

### Step 8: `applications`

- [ ] Applications page load với role được phép.
- [ ] Viewer behavior đúng theo quyết định policy.
- [ ] People profile application section vẫn load nếu role được phép.
- [ ] Không fetch thêm `application_answers`.

### Step 9: `operational_team_assignments`

- [ ] People profile vẫn hiển thị vai trò vận hành.
- [ ] Viewer/reviewer/admin/super_admin behavior đúng policy.
- [ ] Không lộ dữ liệu cho unauthenticated user.

### Step 10: `activity_correction_log`

- [ ] Admin load được correction log trên recap edit page.
- [ ] Reviewer behavior đúng theo quyết định policy.
- [ ] Viewer không xem được correction log nếu policy không cho phép.
- [ ] Correction edit page không blank.

### Step 11: `admin_users` last

- [ ] Super admin đọc được `admin_users`.
- [ ] User active đọc được own admin_users row nếu policy cho phép.
- [ ] Viewer/admin thường không đọc được toàn bộ `admin_users`.
- [ ] Login vẫn hoạt động.
- [ ] Role lookup vẫn hoạt động.

## 5. Test checklist tổng

Sau mỗi step, test lại tối thiểu:

- [ ] Viewer load được Dashboard.
- [ ] Viewer load được Operations Dashboard.
- [ ] Viewer không access được `/recaps/[id]/edit`.
- [ ] Admin load được Dashboard.
- [ ] Admin edit được recap.
- [ ] Super admin login được.
- [ ] Super admin đọc được admin-related views nếu có.
- [ ] Không có blank page.
- [ ] Không có lỗi permission trên console/server logs.
- [ ] Logout/login lại vẫn hoạt động.

## 6. Failure handling

Nếu bất kỳ step nào làm gãy page:

1. Dừng rollout.
2. Xác định bảng vừa bật RLS.
3. Disable RLS trên bảng đó.
4. Drop policy vừa tạo nếu cần.
5. Test lại page bị gãy.
6. Ghi lại lỗi và không tiếp tục bảng tiếp theo cho đến khi policy được review.

Ví dụ disable RLS:

```sql
alter table public.<table_name> disable row level security;
```

Ví dụ drop policy:

```sql
drop policy if exists "<policy_name>" on public.<table_name>;
```

Không rollback dữ liệu. Không xóa audit logs. Chỉ rollback policy/RLS state của batch vừa gây lỗi.

## 7. Critical rule

NEVER enable RLS on `admin_users` first.

Lý do:

- `admin_users` là bảng gốc để xác định role.
- Nếu policy sai, app có thể không lookup được role.
- User có thể bị lock out khỏi toàn bộ admin portal.
- Các helper function và policies phụ thuộc vào việc role lookup hoạt động ổn định.

`admin_users` phải là bảng cuối cùng trong rollout, sau khi tất cả helper functions và read policies khác đã được test.

## 8. Recommendation

Test trên staging Supabase project trước production nếu có thể.

Khuyến nghị triển khai:

- Chạy draft policies trên staging với data copy/safe subset.
- Test đủ 3 role: `viewer`, `admin`, `super_admin`.
- Chỉ apply production theo từng bước sau khi staging pass.
- Không bật write policies trong Sprint 1B.
- Không bật `admin_users` RLS cho đến khi toàn bộ flow login/role lookup đã được xác nhận ổn định.
