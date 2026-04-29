# VAM OS Sprint 1A - Auth Release Note

## 1. Phạm vi đã hoàn thành

Sprint 1A đã triển khai lớp xác thực ứng dụng bằng Supabase Auth cho VAM OS, tập trung vào bảo vệ admin portal trước khi bật RLS.

Các hạng mục đã hoàn thành:

- Thêm Supabase Auth login/logout.
- Thêm cơ chế lookup role từ bảng `admin_users`.
- Thêm hiển thị current admin user trong app shell, gồm email, role và nút `Đăng xuất`.
- Bảo vệ các admin routes bằng session Supabase Auth và active admin role.
- Giữ temporary password gate như một lớp chuyển tiếp.
- Sửa password gate để không thể bypass Supabase Auth.
- Giới hạn recap correction workflow cho `admin` và `super_admin`.
- Ẩn correction links khỏi các role `viewer` và `reviewer`.

## 2. Auth order hiện tại

Thứ tự xác thực sau Sprint 1A:

1. Nếu `VAM_OS_ADMIN_PASSWORD` được cấu hình, password gate có thể xuất hiện trước.
2. Password gate unlock một mình không đủ để vào admin pages.
3. Supabase Auth login là bắt buộc cho protected admin routes.
4. User đăng nhập phải có row tương ứng trong `admin_users`.
5. `admin_users.status` phải là `active`.
6. `admin_users.role` điều khiển quyền ở app-level.
7. RLS chưa được bật trong Sprint 1A.

Kết luận: temporary password gate chỉ còn là lớp chuyển tiếp/trước cửa, không phải lớp phân quyền admin.

## 3. Roles

Các role hiện được hỗ trợ:

| Role | Ý nghĩa |
| --- | --- |
| `viewer` | Xem dữ liệu admin ở chế độ read-only. |
| `reviewer` | Xem dữ liệu và hỗ trợ review, chưa có quyền correction trong Sprint 1A. |
| `admin` | Có quyền sử dụng recap correction workflow. |
| `super_admin` | Có quyền cao nhất trong Sprint 1A; hiện dùng cho first admin và future user/role management. |

## 4. Production test result

Kết quả kiểm tra production trên Vercel:

- Vercel redirect protected routes sang login sau password gate.
- `thangnguyen@redsquarevietnam.com` đăng nhập được với role `super_admin`.
- Dashboard hiển thị email, role và nút `Đăng xuất`.
- Correction route chỉ truy cập được với `admin` hoặc `super_admin`.

## 5. Known limitations

- RLS chưa được bật.
- Password gate vẫn tồn tại như transition layer.
- Chưa có UI quản lý admin users/roles.
- `corrected_by` đã được cải thiện để ưu tiên Auth identity, nhưng sau này vẫn nên gắn chặt hơn với Auth/RLS và audit schema.
- Role checks hiện chỉ ở app-level cho đến khi RLS được triển khai.

## 6. Recommended next steps

- Sprint 1B: triển khai RLS read policies ở chế độ controlled mode.
- Thêm admin user management sau khi auth flow ổn định.
- Thêm security QA checklist trước khi chia sẻ rộng hơn.
- Quyết định thời điểm remove password gate.
