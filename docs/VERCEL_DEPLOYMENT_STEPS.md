# Các Bước Deploy VAM OS Admin Portal MVP Lên Vercel Preview

Tài liệu này dùng cho VAM OS Admin Portal MVP v0.1. Portal hiện là bản nội bộ, read-only, chưa có auth/RLS.

## 1. Kiểm tra trước khi deploy

Chạy local:

```bash
npm.cmd run dev:clean
```

Chạy build:

```bash
npm.cmd run build
```

Đảm bảo:

- Dashboard mở được.
- People, Mentors, Mentees, Applications, Matches, Data Issues mở được.
- Application detail chỉ tải câu trả lời của một application.
- Không có warning oversized fetch từ `application_answers` trên Dashboard hoặc list pages.
- Không có form chỉnh sửa dữ liệu.

## 2. Biến môi trường cần cấu hình trên Vercel

Chỉ thêm:

```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
VAM_OS_ADMIN_PASSWORD
```

Không thêm:

- Supabase `service_role` key.
- Database password.
- Secret key.
- Bất kỳ key backend/private nào.

## 3. Cách A: Deploy qua GitHub private repo + Vercel

1. Tạo private GitHub repo cho project.
2. Push source code lên repo.
3. Vào Vercel, chọn “Add New Project”.
4. Import private GitHub repo.
5. Framework preset: Next.js.
6. Build command: để mặc định `npm run build`.
7. Output directory: để mặc định.
8. Thêm Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `VAM_OS_ADMIN_PASSWORD`
9. Deploy Preview.
10. Chạy checklist trong `docs/MVP_QA_CHECKLIST.md` trên Preview URL.
11. Chỉ promote Production khi core team đã review xong.

## 4. Cách B: Deploy bằng Vercel CLI

Cài Vercel CLI nếu chưa có:

```bash
npm install -g vercel
```

Login:

```bash
vercel login
```

Deploy preview:

```bash
vercel
```

Khi CLI hỏi environment variables, cấu hình:

```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
VAM_OS_ADMIN_PASSWORD
```

Deploy production chỉ khi đã sẵn sàng:

```bash
vercel --prod
```

## 5. Domain gợi ý

```text
app.alumni-mentoring.edu.vn
```

Chỉ trỏ domain sau khi Preview đã qua QA và được core team xác nhận.

## 6. Cảnh báo bảo mật

MVP v0.1 chưa có đăng nhập, phân quyền, hoặc RLS. Vì vậy:

- Không chia sẻ Preview/Production URL rộng rãi.
- Chỉ dùng cho core team nội bộ.
- Không dùng làm portal công khai cho mentor/mentee.
- Không nhập, chỉnh sửa, hoặc xóa dữ liệu qua app vì MVP hiện read-only.
- `VAM_OS_ADMIN_PASSWORD` chỉ là lớp bảo vệ tạm thời, không thay thế Supabase Auth/RLS.

## 7. Sau khi deploy

Kiểm tra:

- Dashboard count chính xác.
- `/applications` không tải toàn bộ `application_answers`.
- `/applications/[id]` tải đúng câu trả lời của một application.
- `/data-issues` tính động từ Supabase và không tải `application_answers`.
- Các link profile/application/match hoạt động.
- Không có secret key trong Vercel environment variables.
- Truy cập Preview yêu cầu mật khẩu nội bộ nếu `VAM_OS_ADMIN_PASSWORD` đã được cấu hình.
