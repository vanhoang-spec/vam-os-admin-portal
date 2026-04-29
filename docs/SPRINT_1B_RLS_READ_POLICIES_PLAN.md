# VAM OS Sprint 1B - RLS Read Policies Plan

## Executive summary

Sprint 1A đã hoàn thành Supabase Auth login/logout, lookup role từ `admin_users`, app-level route protection, và đã sửa password gate để không thể bypass Supabase Auth. Sprint 1B cần chuẩn bị bật Row Level Security ở mức đọc dữ liệu trước, theo từng bước nhỏ, để tăng an toàn dữ liệu mà không làm gãy các trang MVP đang hoạt động.

Tài liệu này chỉ là kế hoạch và checklist. Không tạo migration, không bật RLS, không thay đổi app code, không import dữ liệu.

## 1. Vì sao cần RLS

RLS là lớp bảo vệ ở database, bổ sung cho app-level checks hiện có.

Lý do cần triển khai:

- Bảo vệ PII trong `people`, `mentor_profiles`, `mentee_profiles`, `applications` và activity data.
- Enforce role-based access ở database level, không chỉ dựa vào UI hoặc server actions.
- Giảm rủi ro nếu app-level route checks, middleware hoặc client-side UI visibility bị lỗi.
- Chuẩn bị nền tảng an toàn trước khi mở rộng quyền truy cập cho core team, support team, reviewer hoặc các portal self-service trong tương lai.

## 2. Nguyên tắc rollout RLS

- Bật read policies trước.
- Test với ít nhất `viewer`, `admin`, `super_admin`, và unauthenticated user.
- Chỉ thêm write policies sau khi read policies ổn định.
- Không bật RLS toàn bộ bảng cùng lúc.
- Không enable policies mù quáng nếu chưa biết page nào đang đọc bảng nào.
- Mỗi batch RLS phải có rollback plan.
- Sau mỗi batch, test ngay các page production-like: Dashboard, Operations, People profile, Applications, Matches, Data Issues, Recap edit.

## 3. Role access model

| Role | Quyền đọc đề xuất trong Sprint 1B |
| --- | --- |
| `viewer` | Đọc core dashboards, people/profile data, events, matches, mentoring activity ở mức cần cho vận hành read-only. |
| `reviewer` | Bao gồm viewer, có thể đọc correction logs và review queues nếu founder/core team approve. |
| `admin` | Bao gồm reviewer, có thể dùng correction workflows ở app-level; Sprint 1B vẫn chỉ tập trung read policies. |
| `super_admin` | Full internal read access, gồm `admin_users` và các bảng cấu hình/quản trị nội bộ. |

Nguyên tắc mặc định:

- User phải authenticated.
- User phải có row trong `admin_users`.
- `admin_users.status` phải là `active`.
- Role phải nằm trong danh sách hợp lệ.

## 4. Proposed read policy by table

| Table | Who can read | Why | Risk | Special notes |
| --- | --- | --- | --- | --- |
| `admin_users` | `super_admin` only | Quản trị quyền truy cập nội bộ. | High | Không nên cho viewer/admin thường đọc toàn bộ danh sách role/email. Có thể cho user đọc chính row của mình sau này nếu cần. |
| `people` | `viewer+` | Cần cho dashboard, profile, matching context, operations. | High | Chứa PII như email/phone/name. Cần authenticated + active role. |
| `mentor_profiles` | `viewer+` | Cần cho mentor views, profile detail, dashboard. | Medium | Có thể chứa thông tin nghề nghiệp và bio link. |
| `mentee_profiles` | `viewer+` | Cần cho mentee views, profile detail, operations. | High | Có thông tin học tập/cá nhân; xem như PII. |
| `applications` | Decision pending: `viewer+` hoặc `reviewer+` | Cần cho Applications page và profile detail. | High | Có thể chứa dữ liệu ứng tuyển nhạy cảm. Nên quyết định trước khi bật RLS. |
| `matches` | `viewer+` | Cần cho dashboard, profile, match detail, operations. | Medium | Thể hiện quan hệ mentor/mentee và trạng thái chương trình. |
| `mentoring_recaps` | `viewer+` | Cần cho Operations Dashboard, profile activity, correction pages. | Medium | Có link recap, notes, status; write policies để sau. |
| `event_participations` | `viewer+` | Cần cho event pilot và profile activity. | Medium | Có attendance/excuse/admin notes; cần cẩn trọng nếu mở rộng cộng đồng. |
| `events` | `viewer+` | Reference table cho event activity và reporting. | Low | Ít rủi ro hơn nhưng vẫn nên authenticated. |
| `activity_correction_log` | `reviewer+` hoặc `admin+`; decision pending | Audit trail cho correction workflow. | High | Có old/new values, reason, corrected_by; có thể lộ dữ liệu nhạy cảm. |
| `operational_team_assignments` | `viewer+` hoặc `reviewer+`; decision pending | Hiển thị vai trò vận hành trên profile và planning. | Medium | Có thể tiết lộ cấu trúc nội bộ/core/support team. |
| `seasons` | `viewer+` | Reference table dùng toàn portal. | Low | Có thể bật sớm trong low-risk batch. |
| `programs` | `viewer+` nếu table tồn tại | Reference/generalization cho multi-program sau này. | Low | Nếu chưa dùng trong app hiện tại, vẫn nên đưa vào policy plan. |

## 5. Special care

### Applications

`applications` có thể chứa dữ liệu nhạy cảm về ứng viên, trạng thái, consent, kênh acquisition và liên kết profile. Cần founder/core team quyết định:

- `viewer` có được xem Applications không?
- Có cần giới hạn Applications cho `reviewer+` hoặc `admin+` không?
- Detail page có nên bị giới hạn hơn list page không?

### People

`people` chứa PII chính của hệ thống. Nếu RLS policy sai, dashboard/profile có thể gãy; nếu policy quá rộng, rủi ro lộ dữ liệu cao. Nên test kỹ với `viewer` và unauthenticated user.

### Correction log

`activity_correction_log` có thể tiết lộ field cũ/mới và lý do sửa. Khuyến nghị ban đầu: chỉ `admin+` hoặc `reviewer+` đọc, chưa mở cho `viewer` nếu chưa có quyết định rõ.

### Operational team assignments

`operational_team_assignments` có thể tiết lộ vai trò nội bộ của core/support team. Nếu support team được cấp viewer access, cần quyết định họ có được xem assignment của tất cả mọi người hay không.

### Admin users

`admin_users` nên restricted. Khuyến nghị Sprint 1B:

- `super_admin` đọc toàn bộ.
- Các role khác không đọc trực tiếp toàn bảng.
- Nếu app cần current user role, nên dùng helper function/security definer pattern thay vì cho mọi user select toàn bộ `admin_users`.

## 6. Recommended implementation sequence

### Step 1: Create helper SQL functions for role checking

Draft helper functions, chưa chạy:

- `current_admin_role()`
- `is_active_admin()`
- `has_admin_role(required_roles text[])`

Các function cần dựa vào `auth.uid()` và `admin_users.status = 'active'`.

### Step 2: Enable RLS on low-risk reference tables

Batch đầu tiên nên là bảng ít rủi ro:

- `seasons`
- `programs` nếu tồn tại và cần đọc
- `events`

Mục tiêu: xác nhận helper functions và authenticated read flow hoạt động trước khi chạm vào PII.

### Step 3: Enable RLS on people/profile tables

Batch tiếp theo:

- `people`
- `mentor_profiles`
- `mentee_profiles`

Mục tiêu: đảm bảo Dashboard, People list, Mentor/Mentee list và profile detail vẫn load.

### Step 4: Enable RLS on activity tables

Batch tiếp theo:

- `mentoring_recaps`
- `event_participations`

Mục tiêu: đảm bảo Operations Dashboard và profile activity vẫn load.

### Step 5: Enable RLS on applications/matches

Batch tiếp theo:

- `matches`
- `applications`

Lưu ý: `applications` cần quyết định policy trước. Không fetch hoặc mở thêm `application_answers` trong Sprint 1B nếu chưa được review.

### Step 6: Enable RLS on correction/admin tables

Batch cuối:

- `activity_correction_log`
- `operational_team_assignments`
- `admin_users`

Mục tiêu: bảo vệ audit/internal admin data sau khi các page chính ổn định.

### Step 7: Test production-like flows

Test toàn bộ các flow đang dùng trên Vercel hoặc môi trường preview tương đương:

- Login/logout.
- Dashboard.
- Operations Dashboard.
- People detail.
- Applications.
- Matches.
- Data Issues.
- Recap correction page với `admin`.
- Access denied với `viewer` khi vào correction edit.

## 7. QA checklist

Authentication/RLS:

- [ ] Unauthenticated user không query được dữ liệu protected tables.
- [ ] User không có row `admin_users` active không query được dữ liệu.
- [ ] User `admin_users.status != active` không query được dữ liệu.

Viewer:

- [ ] `viewer` load được Dashboard.
- [ ] `viewer` load được Operations Dashboard.
- [ ] `viewer` load được People profile.
- [ ] `viewer` không access được correction edit theo app-level check.
- [ ] `viewer` không đọc được correction log nếu decision là `reviewer+` hoặc `admin+`.

Reviewer:

- [ ] `reviewer` load được các trang read-only.
- [ ] `reviewer` đọc được correction log nếu được approve.
- [ ] `reviewer` không submit correction action.

Admin:

- [ ] `admin` load được Dashboard.
- [ ] `admin` load được Operations Dashboard.
- [ ] `admin` load được recap correction page.
- [ ] `admin` đọc được correction log nếu policy cho phép.

Super admin:

- [ ] `super_admin` đọc được `admin_users`.
- [ ] `super_admin` load được toàn bộ internal pages.

Regression:

- [ ] Operations Dashboard vẫn load.
- [ ] People profile vẫn load.
- [ ] Applications page vẫn load nếu role policy cho phép.
- [ ] Matches page/detail vẫn load.
- [ ] Data Issues vẫn load.
- [ ] Correction log loads nếu role policy cho phép.
- [ ] Không có policy nào vô tình cho anonymous access.

## 8. Rollback plan

Nếu RLS làm gãy app, rollback theo batch gần nhất, không rollback toàn bộ database nếu không cần.

Draft rollback snippets, chỉ để review, chưa chạy:

```sql
-- Draft only: disable RLS on a table if rollout breaks production.
alter table public.<table_name> disable row level security;
```

```sql
-- Draft only: drop a specific policy if policy logic is wrong.
drop policy if exists <policy_name> on public.<table_name>;
```

```sql
-- Draft only: inspect policies before rollback.
select schemaname, tablename, policyname, permissive, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Rollback nguyên tắc:

- Ưu tiên khôi phục read-only pages trước.
- Không xóa audit logs hoặc operational data.
- Ghi lại table/policy nào gây lỗi.
- Chỉ bật lại sau khi test bằng user thật cho từng role.

## 9. Open decisions

- `viewer` có được xem Applications không?
- `reviewer` có được xem correction log không?
- Support team có được cấp `viewer` access trong Sprint 1B không?
- Mentor/mentee sau này có được access profile của chính họ không?
- `admin_users` có nên chỉ visible với `super_admin` không?
- `operational_team_assignments` nên mở cho `viewer+` hay chỉ `reviewer+`?
- Có cần tách Applications list và Application detail bằng policy/route permission khác nhau không?

## 10. Recommended next step

Create a draft migration for SQL helper functions and read policies, but do not run until reviewed.

Khuyến nghị chính:

- Bắt đầu bằng helper functions và low-risk reference tables.
- Không bật RLS cho PII tables trước khi test helper functions.
- Quyết định rõ `applications`, `activity_correction_log`, `admin_users` trước khi viết policy.
- Chỉ triển khai write policies ở Sprint sau khi read policies đã ổn định.
