# VAM OS Sprint 1 - Phạm vi Auth/RLS

## Executive summary

Sprint 1 tập trung bảo mật VAM OS cho phạm vi sử dụng giới hạn bởi founder/core team, trong khi vẫn giữ nguyên các năng lực MVP đã hoạt động sau Phase 2: Operations Dashboard, mentoring recap import, event pilot, correction workflow và operational team assignments.

Mục tiêu chính là thay thế hoặc giảm phụ thuộc vào temporary password gate bằng Supabase Auth, user roles, route protection và kiểm soát quyền ở các action nhạy cảm. Sprint này chỉ chuẩn bị RLS theo hướng an toàn, không bật rộng hoặc thay đổi cấu trúc dữ liệu nếu app auth chưa ổn định.

Tài liệu này là scope planning. Không thay đổi app code, không tạo migration, không import dữ liệu.

## 1. Sprint 1 goals

- Thêm Supabase Auth login/logout cho admin portal.
- Tạo mô hình internal user roles cho core team.
- Bảo vệ các admin routes bằng session và role.
- Ẩn/hiện UI theo role, đặc biệt là các edit/correction controls.
- Bảo vệ correction workflow hiện có để chỉ role phù hợp được sửa recap.
- Chuẩn bị RLS theo từng bước để không làm gãy MVP hiện tại.
- Giữ Operations Dashboard, profile views, Data Issues, matches và operational team assignment views hoạt động như hiện tại.

## 2. Sprint 1 non-goals

- Không làm public forms.
- Không làm matching recommendation.
- Không làm generic profile correction.
- Không làm full event import.
- Không làm multi-program rewrite.
- Không làm broad application decision editing.
- Không mở rộng write workflow ngoài correction workflow hiện có cho `mentoring_recaps`.

## 3. Role model cho Sprint 1

| Role | Mô tả | Ghi chú |
| --- | --- | --- |
| `viewer` | Xem dashboard, hồ sơ, applications, matches, Data Issues và operational views ở chế độ read-only. | Role mặc định an toàn cho core team cần quan sát dữ liệu. |
| `reviewer` | Bao gồm quyền viewer, có thể xem correction log và hỗ trợ review dữ liệu. | Sprint 1 chưa cần thêm write action riêng cho reviewer. |
| `admin` | Bao gồm quyền reviewer, được dùng recap edit/correction workflow hiện có. | Không được quản lý role nếu không phải super_admin. |
| `super_admin` | Bao gồm quyền admin, quản lý user/role và cấu hình bảo mật nội bộ. | Số lượng nên rất ít. |

Nguyên tắc: user mới không nên có quyền truy cập dữ liệu cho đến khi được gán role active.

## 4. Permission matrix cho Sprint 1

| Khu vực / hành động | viewer | reviewer | admin | super_admin |
| --- | --- | --- | --- | --- |
| Dashboard / Operations view | View | View | View | View |
| People/Mentor/Mentee profile view | View | View | View | View |
| Applications view | View | View | View | View |
| Matches view | View | View | View | View |
| Data Issues view | View | View | View | View |
| Recap edit/correction | No | No | Edit | Edit |
| Correction log view | No hoặc limited | View | View | View |
| Operational team assignment view | View | View | View | View |
| User/role management | No | No | No | Manage |

Ghi chú cần quyết định trước khi coding:

- Applications view có thể chứa dữ liệu nhạy cảm; nếu founder/core team muốn thận trọng hơn, có thể giới hạn applications cho `reviewer+` hoặc `admin+`.
- Correction log view nên ít nhất cho `admin+`; reviewer có được xem hay không cần quyết định rõ.
- Sprint 1 không thêm quyền sửa profile, match, application decision hoặc event participation.

## 5. Proposed implementation tasks

| Task ID | Task | Description | Dependency | Risk | Definition of done |
| --- | --- | --- | --- | --- | --- |
| S1-01 | Create admin user/role migration | Thiết kế migration tạo bảng user/role nội bộ, ví dụ `admin_users` hoặc `user_roles`, gắn với Supabase Auth user. | Founder/core team chốt role model | High | Migration plan được review, field tối thiểu gồm auth user id, email, role, status, timestamps; chưa chạy nếu chưa được approve. |
| S1-02 | Seed first super_admin | Xác định và seed user đầu tiên có quyền `super_admin`. | S1-01, quyết định first super_admin | High | Email/auth identity đầu tiên được xác nhận; seed plan có rollback/kiểm tra lockout. |
| S1-03 | Add Supabase Auth helpers | Thêm helper đọc session, current user và current role ở server/app layer. | S1-01 | Medium | App có helper thống nhất để lấy user/role; không copy logic role ở nhiều nơi. |
| S1-04 | Add login page | Thêm trang login cho admin portal bằng Supabase Auth. | S1-03, quyết định login method | Medium | Unauthenticated user có thể login; lỗi login hiển thị rõ; không lộ dữ liệu admin. |
| S1-05 | Add logout/session display | Thêm logout và hiển thị user/session tối thiểu trong admin UI. | S1-03, S1-04 | Low | User thấy email/role hiện tại và có thể logout thành công. |
| S1-06 | Protect admin routes | Chặn admin routes nếu chưa login hoặc role không active. | S1-03, S1-04 | High | Unauthenticated user bị redirect login; no-role/disabled user không thấy dữ liệu. |
| S1-07 | Replace/keep password gate during transition | Quyết định giữ password gate như backup, chạy song song tạm thời, hoặc demote sau khi Auth ổn định. | S1-06, QA cơ bản pass | Medium | Có transition rule rõ: khi nào gate còn tồn tại, khi nào tắt, ai approve. |
| S1-08 | Add role checks to correction workflow | Bảo vệ server action/route correction để chỉ `admin` và `super_admin` được sửa recap. | S1-03, S1-06 | High | Viewer/reviewer không thể submit correction kể cả khi gọi trực tiếp route/action. |
| S1-09 | Hide edit links for non-admin roles | Ẩn edit links/buttons với viewer/reviewer. | S1-08 | Medium | UI read-only không hiển thị correction entry points cho non-admin roles. |
| S1-10 | Add read-only policies planning | Chuẩn bị scope RLS read policies cho các bảng hiện MVP đang đọc. | S1-06, page verification | High | Có policy matrix cho `people`, profiles, applications, matches, recaps, events, correction log và assignments; chưa bật RLS rộng nếu chưa QA. |
| S1-11 | Add QA checklist | Tạo checklist test Auth, roles, route guard, correction và Vercel env. | S1-04 đến S1-10 | Medium | Checklist bao phủ viewer/admin/super_admin/no-role và các trang MVP hiện có. |
| S1-12 | Update admin user guide | Cập nhật hướng dẫn admin về login/logout, role, correction permission và transition password gate. | S1-04, S1-05, S1-08, S1-09 | Low | Admin guide có hướng dẫn mới, đủ để core team dùng không cần dev hỗ trợ trực tiếp. |

## 6. Recommended rollout sequence

1. Implement auth without RLS.
   - Thêm login/logout, session helpers và route protection ở app layer.
   - Chưa bật RLS trên các bảng MVP để tránh làm gãy data loading.

2. Role-check app actions.
   - Thêm role check cho correction workflow.
   - Ẩn edit links cho non-admin roles.
   - Đảm bảo server action vẫn chặn nếu user cố gọi trực tiếp.

3. Verify all current pages still work.
   - Test Operations Dashboard.
   - Test People/Mentor/Mentee profile views.
   - Test Applications, Matches, Data Issues.
   - Test Operational team assignment view.
   - Test recap edit với admin.

4. Add RLS in a controlled second step only after app auth works.
   - Bật theo batch nhỏ.
   - Bắt đầu từ read policies.
   - Kiểm tra mỗi nhóm bảng ngay sau khi bật.
   - Giữ rollback plan rõ ràng.

5. Remove or demote password gate.
   - Chỉ thực hiện khi Auth, role checks, correction workflow và production env đã pass QA.
   - Có thể giữ password gate tạm thời như backup trong giai đoạn transition nếu founder/core team muốn thận trọng.

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| RLS can break data loading | Dashboard/profile pages có thể trắng hoặc lỗi nếu policies thiếu bảng/role. | Không bật RLS trong chunk đầu; tạo policy matrix; bật từng batch nhỏ và test ngay. |
| User locked out | Core team hoặc super_admin không vào được portal. | Seed first super_admin cẩn thận; có rollback/backup access; test no-role và super_admin trước production cutover. |
| Service role/client key confusion | Lộ key nhạy cảm hoặc dùng sai client khiến RLS bị bypass/blocked. | Chỉ dùng anon key ở client; service role chỉ ở server-side job an toàn nếu thật sự cần; kiểm tra Vercel env. |
| Correction workflow blocked | Admin không sửa được recap hoặc audit log không ghi. | Test correction với admin trước và sau route guard; thêm negative test cho viewer/reviewer. |
| Vercel env variables missing | Production login hoặc Supabase calls lỗi dù local chạy được. | Checklist env cho Supabase URL, anon key, auth redirect URLs và site URL trước deploy. |

## 8. Testing checklist

Authentication:

- Unauthenticated user bị redirect về login khi vào admin routes.
- User login nhưng chưa có active role không xem được dữ liệu admin.
- Logout xóa session và không còn truy cập được admin pages.
- Session display hiển thị đúng email/role hiện tại.

Roles:

- `viewer` xem được dashboard/profile nhưng không thấy edit links.
- `reviewer` xem được dữ liệu read-only theo matrix nhưng không sửa recap.
- `admin` sửa được recap qua correction workflow.
- `super_admin` quản lý được user/role nếu UI quản lý role nằm trong Sprint 1.

Current MVP regression:

- Existing Operations Dashboard vẫn load.
- People/Mentor/Mentee profile pages vẫn load.
- Applications view vẫn load theo permission matrix đã chốt.
- Matches view vẫn load.
- Data Issues view vẫn load.
- Operational team assignment view vẫn load.
- Correction log view hoạt động theo role đã chốt.

Security:

- Viewer/reviewer không thể submit recap correction dù gọi trực tiếp route/action.
- Anonymous request không đọc được dữ liệu qua protected app routes.
- Không có service role key trong client bundle hoặc public env.
- Vercel production env hoạt động với Auth redirect URL đúng.

RLS readiness:

- Có read policy planning trước khi bật RLS.
- Có danh sách bảng MVP đang đọc.
- Có rollback plan nếu RLS làm gãy data loading.
- RLS chỉ bật sau khi app auth ổn định.

## 9. Open decisions

- Ai là first `super_admin`?
- Login method dùng email magic link hay password?
- Password gate có nên giữ làm backup trong giai đoạn transition không?
- Email nào được phép truy cập?
- Support team có được access ngay trong Sprint 1 hay để sau?
- `reviewer` có được xem correction log không?
- Applications view có mở cho `viewer` không, hay chỉ `reviewer+`?
- User/role management có cần UI ngay trong Sprint 1 hay seed/manual admin đủ cho giai đoạn đầu?

## 10. Recommendation

Nên làm Sprint 1 thành hai PR-style chunks:

### A. App Auth without RLS

- Supabase Auth helpers.
- Login/logout UI.
- Route protection.
- Role lookup.
- Correction workflow role checks.
- Hide edit links cho non-admin roles.
- QA toàn bộ MVP hiện có.
- Update admin user guide.

### B. RLS after auth is stable

- Tạo/bật RLS policies theo policy matrix đã review.
- Bắt đầu với read policies.
- Bật theo batch nhỏ, test ngay từng nhóm bảng.
- Chỉ thêm write policies cho correction workflow hiện có.
- Remove hoặc demote password gate sau khi production QA pass.

Khuyến nghị cuối: ưu tiên hoàn tất chunk A ổn định trước, sau đó mới mở chunk B để tránh vừa đổi auth vừa bật RLS cùng lúc làm khó debug.
