# VAM OS Phase 2E - Kế hoạch triển khai Supabase Auth + Roles + RLS

## Mục tiêu

Phase 2E thay thế temporary password gate bằng Supabase Auth, bổ sung phân quyền nội bộ, và chuẩn bị Row Level Security cho các bảng có dữ liệu vận hành/PII. Mục tiêu là mở rộng quyền truy cập cho core team một cách an toàn mà không làm gãy các trang read-only MVP hiện có.

## A. Hiện trạng bảo mật và rủi ro

Hiện tại VAM OS Admin Portal dùng temporary password gate. Cách này phù hợp cho MVP nội bộ ban đầu, nhưng chưa đủ an toàn khi chia sẻ rộng hơn.

Rủi ro chính:

- Không có danh tính người dùng thật ở cấp database.
- Không phân biệt quyền viewer/reviewer/admin.
- Các write action Phase 2D cho mentoring recap correction đã tồn tại, nhưng `corrected_by` vẫn là text nhập thủ công.
- Chưa có RLS nên app đang phụ thuộc vào việc giữ kín URL/env và password gate.
- Dữ liệu có PII: people, mentor/mentee profile, applications, matches, activity logs.
- Audit trail đã có, nhưng chưa gắn chắc với Supabase Auth user.

## B. Vai trò và quyền đề xuất

| Role | Quyền |
| --- | --- |
| `viewer` | Xem dashboard, hồ sơ, match, activity, event participation ở chế độ read-only. |
| `reviewer` | Bao gồm quyền viewer, có thể tạo note/review nếu workflow cho phép trong tương lai. |
| `admin` | Bao gồm quyền reviewer, có thể thực hiện correction workflow cho `mentoring_recaps`. |
| `super_admin` | Quản lý user/role và các thiết lập admin trong tương lai. |

Khuyến nghị:

- Bắt đầu với `viewer`, `admin`, `super_admin`.
- Chỉ thêm quyền `reviewer` vào workflow thật khi có nhu cầu rõ.
- Mặc định user mới không có quyền cho đến khi được gán role.

## C. Bảng đề xuất

### `admin_users` hoặc `user_roles`

Phương án đơn giản:

- `id uuid primary key default gen_random_uuid()`
- `auth_user_id uuid not null unique`
- `email text not null`
- `role text not null`
- `display_name text null`
- `status text not null default 'active'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Role check:

- `viewer`
- `reviewer`
- `admin`
- `super_admin`

Status check:

- `active`
- `disabled`

### Optional role audit log

`admin_role_audit_log` có thể thêm sau hoặc cùng Phase 2E nếu muốn audit quản trị user:

- `id uuid primary key default gen_random_uuid()`
- `target_auth_user_id uuid not null`
- `old_role text null`
- `new_role text null`
- `changed_by uuid null`
- `reason text null`
- `created_at timestamptz not null default now()`

Khuyến nghị: tạo role audit log nếu `super_admin` có UI đổi quyền trong Phase 2E. Nếu chưa có UI quản lý user, có thể để Phase sau.

## D. Chiến lược RLS theo bảng

Nguyên tắc chung:

- Bật RLS sau khi app đã dùng Supabase Auth session thật.
- Tạo helper function trong database để kiểm tra role, ví dụ `current_admin_role()` hoặc `has_admin_role(required_roles text[])`.
- Chỉ allow user có role `active`.
- Không public anonymous access cho dữ liệu admin.
- Với bảng write, tách rõ `select`, `insert`, `update`, `delete`.

### `people`

- `viewer+`: được `select`.
- Không cho update/delete từ app MVP.
- PII cao, cần bắt buộc authenticated + active role.

### `mentor_profiles`

- `viewer+`: được `select`.
- Không cho update/delete trong Phase 2E.

### `mentee_profiles`

- `viewer+`: được `select`.
- Không cho update/delete trong Phase 2E.
- Vì có dữ liệu học tập/cá nhân, cần xử lý như PII.

### `applications`

- `viewer+`: có thể `select` nếu founder/core team đồng ý.
- Cân nhắc giới hạn sâu hơn vì applications có thể chứa dữ liệu nhạy cảm.
- Không fetch `application_answers` từ Operations/Auth work nếu chưa cần.

### `matches`

- `viewer+`: được `select`.
- Không cho update/delete trong Phase 2E.

### `mentoring_recaps`

- `viewer+`: được `select`.
- `admin+`: được update các field correction được phép qua app/server action.
- Không cho delete.
- RLS không tự giới hạn field-level update tốt như app logic, nên vẫn cần validation trong app/server action.

### `event_participations`

- `viewer+`: được `select`.
- Không cho update trong Phase 2E vì correction workflow cho event participation chưa triển khai.
- Không cho delete.

### `activity_correction_log`

- `viewer+`: có thể `select` nếu muốn minh bạch audit trail nội bộ.
- `admin+`: được `insert` khi correction workflow chạy.
- Không cho update/delete audit log.
- Khi có Auth, `corrected_by` nên lấy từ auth user/email thay vì nhập tay, hoặc bổ sung `corrected_by_auth_user_id`.

## E. Migration plan

Không tạo migration trong tài liệu này. Khi triển khai, nên chia migration thành nhiều bước nhỏ:

1. Tạo bảng role: `admin_users` hoặc `user_roles`.
2. Seed `super_admin` đầu tiên bằng email/auth user id đã xác nhận.
3. Tạo helper function kiểm tra role.
4. Tạo policy `select` read-only cho các bảng chính.
5. Tạo policy `update` giới hạn cho `mentoring_recaps`.
6. Tạo policy `insert` cho `activity_correction_log`.
7. Bật RLS theo từng nhóm bảng sau khi đã test bằng Supabase Auth session.

Khuyến nghị không bật RLS toàn bộ một lần. Bật theo batch và test ngay sau mỗi batch.

## F. App implementation plan

1. Thay temporary password gate bằng Supabase Auth login.
2. Tạo login/logout UI tối giản.
3. Lưu session bằng Supabase SSR/auth helpers phù hợp với Next.js App Router.
4. Tạo server-side helper lấy current user và role.
5. Chặn route nếu user chưa đăng nhập hoặc role không active.
6. Ẩn hoặc disable correction UI nếu user không phải `admin`/`super_admin`.
7. Correction workflow:
   - Bỏ nhập tay `corrected_by` khi đã có Auth.
   - Ghi `corrected_by` từ email hoặc display name của auth user.
   - Có thể giữ text field tạm thời trong giai đoạn transition.
8. Không thay đổi logic import runner.
9. Không mở rộng write action ngoài correction workflow đã kiểm soát.

## G. Rollout sequence

1. Chuẩn bị Supabase Auth settings và danh sách core team email.
2. Tạo migration role table nhưng chưa bật RLS.
3. Implement login/logout và role lookup trong app.
4. Test read-only pages với user `viewer`.
5. Test correction workflow với user `admin`.
6. Bật RLS trên bảng ít rủi ro trước, ví dụ `matches`, sau đó tới profile/activity tables.
7. Bật RLS cho `mentoring_recaps` và `activity_correction_log`.
8. Tắt temporary password gate sau khi Auth/RLS ổn định.
9. Mời thêm core team theo role tối thiểu cần thiết.

## H. Testing checklist

Authentication:

- User chưa login không vào được admin portal.
- User login nhưng chưa có role active không vào được dữ liệu.
- User `viewer` xem được dashboard/profile.
- User `viewer` không thấy hoặc không dùng được correction action.
- User `admin` dùng được `/recaps/[id]/edit`.
- User `super_admin` có quyền quản trị role nếu UI được triển khai.

RLS:

- Anonymous request không đọc được bảng admin.
- Authenticated user không role không đọc được bảng admin.
- `viewer` không update được `mentoring_recaps`.
- `admin` update được correction fields thông qua app.
- Không role nào delete được `mentoring_recaps` hoặc `activity_correction_log`.
- `activity_correction_log` chỉ cho insert qua role phù hợp.

Regression:

- `/operations` vẫn load đúng KPI.
- `/people/[id]` vẫn load profile/activity.
- `/recaps/[id]/edit` vẫn ghi audit log.
- Event KPI tháng `2026-04` không bị ảnh hưởng.
- Không fetch `application_answers` ngoài các trang đang cần.

## I. Rollback plan

Nếu rollout gặp lỗi:

1. Tạm thời disable route guard Auth ở app nếu cần khôi phục truy cập nội bộ.
2. Tắt RLS từng bảng hoặc rollback policy migration gần nhất.
3. Giữ nguyên bảng `activity_correction_log`; không xóa audit trail.
4. Re-enable temporary password gate trong thời gian sửa lỗi.
5. Chỉ retry bật RLS sau khi test lại bằng user thật cho từng role.

Rollback cần ưu tiên khôi phục read-only dashboard trước, correction workflow sau.

## J. Open decisions cho founder/core team

- Ai là `super_admin` đầu tiên?
- Core team nào chỉ cần `viewer`, ai cần `admin`?
- Có cần role `reviewer` ngay trong Phase 2E không, hay để sau?
- Applications có nên được viewer xem toàn bộ không, hay cần hạn chế hơn?
- Audit log có nên hiển thị cho viewer không, hay chỉ admin/super_admin?
- Khi có Auth, `corrected_by` nên lưu email, full name, hay auth user id?
- Có cần mời user bằng email domain allowlist không?
- Có cần session timeout ngắn hơn vì dữ liệu có PII không?

## Khuyến nghị chính

- Triển khai Auth trước, role table sau, rồi mới bật RLS theo từng batch.
- Dùng least privilege: phần lớn core team nên là `viewer`.
- Chỉ `admin`/`super_admin` được correction.
- Không bật RLS toàn bộ cùng lúc.
- Giữ correction workflow hẹp cho `mentoring_recaps` cho đến khi event attendance source ổn định.
