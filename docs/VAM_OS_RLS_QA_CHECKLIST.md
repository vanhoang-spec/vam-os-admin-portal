# VAM OS — RLS QA Checklist

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Trạng thái** | Checklist thực hành — dùng trong staging test trước production |
| **Phụ thuộc** | `VAM_OS_RLS_POLICY_BLUEPRINT.md` (định nghĩa policies), `VAM_OS_RLS_SECURITY_AUDIT.md` (hiểu risk) |

---

## Hướng dẫn sử dụng

1. Chạy từng section theo thứ tự — không skip
2. Mỗi checkbox phải có người thật ký off (tên + ngày)
3. Nếu bất kỳ check nào fail → **STOP, rollback stage đó, investigate**
4. Không tiến sang stage tiếp theo nếu stage hiện tại chưa pass 100%
5. Chạy checklist này trên staging trước production

---

## Phần 0 — Pre-conditions (Phải đủ trước khi bắt đầu)

### 0.1 Environment

- [ ] Staging Supabase project URL đã được xác nhận: `ljfneyuvpxrmejpxsmpz.supabase.co`
- [ ] Staging là project riêng biệt — KHÔNG phải production
- [ ] `.env.staging.local` có đúng staging URL và anon key (không phải production credentials)
- [ ] Staging app deploy ra URL riêng (không phải production Vercel)

### 0.2 Data

- [ ] Staging DB có data tương đương production (ít nhất 1 season với recaps và events)
- [ ] Row counts staging ~ production:
  - `mentoring_recaps`: ______ rows
  - `event_participations`: ______ rows
  - `people`: ______ rows
  - `events`: ______ rows
  - `matches`: ______ rows

### 0.3 Test Accounts (Bắt buộc — 4 accounts)

| Role | Email | auth_user_id linked? | Login test |
|------|-------|---------------------|-----------|
| `super_admin` | | [ ] | [ ] |
| `admin` | | [ ] | [ ] |
| `reviewer` | | [ ] | [ ] |
| `viewer` | | [ ] | [ ] |

> **Rule:** `auth_user_id` trong `admin_users` phải NOT NULL cho tất cả test accounts trước khi enable RLS.

Verify SQL:
```sql
SELECT email, role, auth_user_id IS NOT NULL AS linked
FROM admin_users
WHERE email IN ('test-superadmin@...', 'test-admin@...', 'test-reviewer@...', 'test-viewer@...')
ORDER BY role;
```

### 0.4 Helper Functions

- [ ] `current_admin_role()` đã exist trên staging
- [ ] `is_admin_role(text[])` đã exist trên staging
- [ ] `is_active_admin()` đã exist trên staging

Verify SQL:
```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('current_admin_role', 'is_admin_role', 'is_active_admin');
-- Expected: 3 rows
```

### 0.5 Baseline KPI Snapshot (Ghi lại TRƯỚC khi enable bất kỳ RLS nào)

Đăng nhập với `admin` account, ghi lại:

| Metric | Giá trị baseline |
|--------|----------------|
| Tháng được chọn | |
| Recap count (Operations) | |
| Active mentor count | |
| Active mentee count | |
| Event count (tháng đó) | |
| Event attendance count | |
| Follow-up count | |
| People count | |
| Matches count | |

> Sau mỗi stage, compare với baseline. Nếu sai → rollback.

### 0.6 Rollback Readiness

- [ ] Rollback SQL scripts đã được chuẩn bị (xem `VAM_OS_RLS_POLICY_BLUEPRINT.md` Phần 2, mỗi stage)
- [ ] Người có quyền chạy SQL trên Supabase SQL Editor đang available trong suốt thời gian test
- [ ] Không test trong giờ peak usage của Core Team

**Sign-off Pre-conditions:** Tên: _____________ Ngày: _____________

---

## Phần 1 — Stage 2: Reference Tables Test

*Sau khi apply policies cho `programs`, `seasons`, `events`*

### 1.1 Anon access check

```
URL không có auth cookie → Table phải trả về 0 rows hoặc 403
```

- [ ] `GET /rest/v1/events` với `Authorization: Bearer <anon_key>` (không có user JWT) → `[]` hoặc error

### 1.2 Authenticated reads (test với mỗi role)

Đăng nhập với từng account, kiểm tra:

| Check | super_admin | admin | reviewer | viewer |
|-------|------------|-------|----------|--------|
| `/events` hiển thị danh sách | [ ] | [ ] | [ ] | [ ] |
| Event count đúng với baseline | [ ] | [ ] | [ ] | [ ] |

### 1.3 Operations Dashboard check

Đăng nhập với `admin`:
- [ ] Event count (KPI) khớp với baseline
- [ ] **Event attendance count KHÔNG phải zero** ← điểm fail của Sprint 1B

### 1.4 Trang `/events`

- [ ] Danh sách events hiển thị đầy đủ
- [ ] Không có blank page
- [ ] Event detail page hoạt động

**Stage 2 Pass/Fail:** [ ] PASS [ ] FAIL
**Sign-off:** Tên: _____________ Ngày: _____________

---

## Phần 2 — Stage 3: Personal Data Tables Test

*Sau khi apply policies cho `people`, `mentor_profiles`, `mentee_profiles`*

### 2.1 People reads (test mỗi role)

| Check | super_admin | admin | reviewer | viewer |
|-------|------------|-------|----------|--------|
| `/people` list đầy đủ | [ ] | [ ] | [ ] | [ ] |
| `/people/[id]` detail đúng | [ ] | [ ] | [ ] | [ ] |
| People count khớp baseline | [ ] | [ ] | [ ] | [ ] |

### 2.2 Operations Dashboard check

Đăng nhập với `admin`:
- [ ] Active mentor count khớp baseline
- [ ] Active mentee count khớp baseline
- [ ] Follow-up count khớp baseline
- [ ] Mentor without recap count khớp baseline

### 2.3 Profile pages

- [ ] Mentor profile section hiển thị (không blank)
- [ ] Mentee profile section hiển thị (không blank)

**Stage 3 Pass/Fail:** [ ] PASS [ ] FAIL
**Sign-off:** Tên: _____________ Ngày: _____________

---

## Phần 3 — Stage 4: Operational Tables Test (CRITICAL)

*Sau khi apply policies cho `matches`, `mentoring_recaps`, `event_participations`*

> **Đây là stage đã fail trong Sprint 1B. Test kỹ hơn các stage khác.**

### 3.1 Sprint 1B Regression Tests (PHẢI PASS)

Đăng nhập với `admin`:

| Check | Expected | Actual | Pass? |
|-------|---------|--------|-------|
| Recap count | = baseline | | [ ] |
| Active mentor count | = baseline | | [ ] |
| Active mentee count | = baseline | | [ ] |
| **Event attendance count** | = baseline (> 0) | | [ ] |
| Follow-up count | = baseline | | [ ] |

### 3.2 Cross-dependency Test

*Events + event_participations phải cùng lúc accessible*

```
Scenario: Chọn tháng có events và attendees
Expected: attendance count = số người attended trong tháng đó
```

- [ ] Chọn tháng trong Operations dashboard
- [ ] `events` trong tháng đó hiển thị (count > 0)
- [ ] `event_participations` count = tổng số attended
- [ ] Số KHÔNG phải zero nếu có data

### 3.3 Matches

- [ ] `/matches` hiển thị danh sách (không empty nếu có data)
- [ ] Match count trong profile page đúng

### 3.4 Mentoring Recaps

- [ ] `/people/[id]` → recap list đúng cho mentor
- [ ] `/people/[id]` → recap list đúng cho mentee
- [ ] Recap count trong dashboard đúng

### 3.5 Multi-role test (quan trọng)

Đăng nhập với từng role, verify Operations dashboard:

| Role | Recap count đúng? | Event count đúng? | Attendance đúng? |
|------|------------------|------------------|-----------------|
| super_admin | [ ] | [ ] | [ ] |
| admin | [ ] | [ ] | [ ] |
| reviewer | [ ] | [ ] | [ ] |
| viewer | [ ] | [ ] | [ ] |

**Stage 4 Pass/Fail:** [ ] PASS [ ] FAIL
**Sign-off:** Tên: _____________ Ngày: _____________

---

## Phần 4 — Stage 5: Application Pipeline Test

*Sau khi apply policies cho `applications`, `application_reviews`, `application_decisions`*

### 4.1 Admin access

| Check | admin | super_admin |
|-------|-------|------------|
| `/applications` list đầy đủ | [ ] | [ ] |
| `/applications/[id]` detail | [ ] | [ ] |
| Decisions visible | [ ] | [ ] |

### 4.2 Reviewer isolation (CRITICAL SECURITY CHECK)

Đăng nhập với `reviewer` account A (đã được giao review một số applications):

- [ ] `/reviews` → chỉ thấy reviews được giao cho account A
- [ ] Không thấy reviews của reviewer khác (verify bằng cách đếm)
- [ ] Thử truy cập review ID của reviewer khác → 403 hoặc 0 rows

```
Test case:
- Reviewer A được giao review: application IDs [X, Y, Z]
- Reviewer B được giao review: application IDs [P, Q]
- Login với Reviewer A: phải thấy X, Y, Z; KHÔNG được thấy P, Q
```

- [ ] Reviewer A: thấy đúng X, Y, Z
- [ ] Reviewer A: KHÔNG thấy P, Q (isolation confirmed)

### 4.3 Viewer access

- [ ] Viewer thấy được applications (nếu policy allow)
- [ ] Viewer KHÔNG thấy reviews (policy block)
- [ ] Viewer KHÔNG thấy decisions (policy block)

### 4.4 Public apply form (phải tiếp tục hoạt động)

- [ ] `/apply/mentor?token=<pilot_token>` load được (public route)
- [ ] Submit form thành công → application tạo được trong DB

**Stage 5 Pass/Fail:** [ ] PASS [ ] FAIL
**Sign-off:** Tên: _____________ Ngày: _____________

---

## Phần 5 — Stage 6: Admin Users Test (LAST — HIGHEST RISK)

*Sau khi apply policy cho `admin_users`*

> **CẢNH BÁO:** Đây là table quản lý login. Nếu policy sai → mọi người bị locked out.
> Chuẩn bị rollback SQL sẵn trong tab khác TRƯỚC khi apply.

### 5.1 Pre-apply checklist

- [ ] Rollback SQL `ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;` đã có trong clipboard
- [ ] Ít nhất 1 super_admin session đang active (không close tab này)
- [ ] Biết cách chạy SQL trực tiếp từ Supabase Dashboard nếu app bị lock

### 5.2 Login flow test (sau apply)

Với mỗi test account:

| Account | Logout → Login lại | Role đúng? | Dashboard load? |
|---------|-------------------|-----------|----------------|
| super_admin | [ ] | [ ] | [ ] |
| admin | [ ] | [ ] | [ ] |
| reviewer | [ ] | [ ] | [ ] |
| viewer | [ ] | [ ] | [ ] |

### 5.3 Role lookup integrity

```sql
-- Chạy trong Supabase SQL Editor khi logged in với super_admin:
SELECT public.current_admin_role();
-- Expected: 'super_admin'
```

- [ ] `current_admin_role()` trả về đúng role cho super_admin
- [ ] `is_active_admin()` trả về `true` cho active accounts

### 5.4 Super admin visibility

- [ ] `/admin/users` → super_admin thấy tất cả admin users
- [ ] Admin (non-super) → `/admin/users` → redirect hoặc forbidden

### 5.5 Self-read isolation

- [ ] Admin chỉ thấy own row trong `admin_users` (nếu không phải super_admin)
- [ ] Admin KHÔNG thấy passwords, tokens của người khác (not applicable — Supabase Auth không store passwords trong admin_users)

**Stage 6 Pass/Fail:** [ ] PASS [ ] FAIL
**Sign-off:** Tên: _____________ Ngày: _____________

---

## Phần 6 — Full Regression (Sau tất cả stages)

### 6.1 End-to-end workflow test

| Workflow | Kết quả |
|---------|---------|
| Admin login → Operations dashboard → KPIs đúng | [ ] |
| Admin login → giao reviewer → reviewer nhận được review | [ ] |
| Reviewer login → xem review → submit → chuyển sang read-only | [ ] |
| Admin login → ra quyết định về application | [ ] |
| Admin login → tạo match mới | [ ] |
| Admin login → tạo event + điểm danh | [ ] |
| Viewer login → xem dashboard (read-only, không edit) | [ ] |
| Public user → submit application form | [ ] |

### 6.2 Security isolation checks

| Check | Pass? |
|-------|-------|
| Anon user KHÔNG thể đọc `people` table | [ ] |
| Anon user KHÔNG thể đọc `mentoring_recaps` | [ ] |
| Anon user KHÔNG thể đọc `applications` | [ ] |
| Reviewer KHÔNG thấy reviews của reviewer khác | [ ] |
| Viewer KHÔNG thấy `application_reviews` | [ ] |
| Non-super-admin KHÔNG thấy tất cả `admin_users` | [ ] |

### 6.3 Performance check

> RLS policies với `SECURITY DEFINER` functions và subqueries có thể ảnh hưởng performance.

- [ ] `/` dashboard load time < 3s (so sánh với baseline trước RLS)
- [ ] `/operations` load time < 5s
- [ ] `/people` list load time < 3s
- [ ] Không có timeout errors trong 30 phút sau rollout

### 6.4 Error log check

- [ ] Không có `permission denied` errors trong Supabase logs (Logs → API)
- [ ] Không có infinite redirect loops trong Next.js logs
- [ ] Không có `auth_user_id is null` warnings

**Full Regression Pass/Fail:** [ ] PASS [ ] FAIL
**Sign-off:** Tên: _____________ Ngày: _____________

---

## Phần 7 — Production Go/No-Go

**Chỉ proceed production nếu tất cả checks dưới đây là YES:**

| Điều kiện | Yes/No |
|----------|--------|
| Toàn bộ stages (2-6) pass trên staging | |
| Full regression pass trên staging | |
| KPI values trên staging khớp với expected (cross-check với production raw data) | |
| Reviewer isolation confirmed (không phải chỉ assume) | |
| Performance acceptable (< 3s dashboard) | |
| Rollback scripts tested trên staging (biết cách dùng) | |
| Core Team sign-off | |
| Dev Lead sign-off | |
| Rollout không trong giờ peak operation | |
| Có người on-call trong 2h sau production rollout | |

**Production Go/No-Go Decision:**

- [ ] ✅ GO — tất cả điều kiện YES
- [ ] ❌ NO-GO — lý do: ________________________________

**Final Sign-off:**
- Dev Lead: _____________ Ngày: _____________
- Core Team Admin: _____________ Ngày: _____________

---

## Phần 8 — Incident Response (Nếu Production bị ảnh hưởng)

### 8.1 Dấu hiệu cần rollback ngay

- Dashboard hiển thị zero trong KPI đáng lẽ có data
- Login không vào được (redirect loop)
- Blank pages sau khi login thành công
- Error 403/42501 xuất hiện trong logs

### 8.2 Rollback nhanh (< 2 phút)

```sql
-- Bước 1: Identify table gây vấn đề (nếu biết)
-- Bước 2: Disable RLS cho table đó
ALTER TABLE public.<table_name> DISABLE ROW LEVEL SECURITY;

-- Nếu không biết table nào, disable tất cả theo thứ tự ngược:
ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_correction_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_team_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_decisions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentoring_recaps DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentee_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.people DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs DISABLE ROW LEVEL SECURITY;
```

### 8.3 Sau rollback

- [ ] Verify dashboard hoạt động lại
- [ ] Ghi lại table nào gây vấn đề
- [ ] Document symptom + root cause trước khi retry

---

## Phần 9 — Phase 2 Checklist (Mentor/Mentee Portal — Future)

**Chỉ làm sau khi Phase 1 (Stages 1-6) ổn định.**

### 9.1 Prerequisites

- [ ] Phase 1 RLS ổn định trên production ít nhất 2 tuần
- [ ] `people.auth_user_id` được populate cho tất cả mentors và mentees có account
- [ ] Mentor portal alpha deployed trên staging
- [ ] Test accounts cho `mentor` và `mentee` roles tạo sẵn

### 9.2 Mentor isolation tests

| Check | Expected |
|-------|---------|
| Mentor A login → chỉ thấy recaps của match mình | [ ] |
| Mentor A KHÔNG thấy recaps của Mentor B | [ ] |
| Mentor A submit recap cho own match → success | [ ] |
| Mentor A submit recap cho match của Mentor B → 403 | [ ] |
| Mentor A KHÔNG thấy profile của Mentor B | [ ] |

### 9.3 Mentee isolation tests

| Check | Expected |
|-------|---------|
| Mentee X login → chỉ thấy match của mình | [ ] |
| Mentee X KHÔNG thấy recaps của cặp khác | [ ] |
| Mentee X thấy thông tin mentor của mình (matched pair only) | [ ] |
| Mentee X KHÔNG thấy thông tin mentor của người khác | [ ] |

### 9.4 Cross-role isolation

| Check | Expected |
|-------|---------|
| Mentor KHÔNG thấy data của mentee không phải match của mình | [ ] |
| Mentee KHÔNG thấy data của mentor không phải match của mình | [ ] |
| Admin vẫn thấy tất cả (unchanged) | [ ] |

**Phase 2 Sign-off:**
- Dev Lead: _____________ Ngày: _____________
- Core Team Admin: _____________ Ngày: _____________

---

*VAM OS RLS QA Checklist — 07/05/2026 — Sử dụng nội bộ. Phải có sign-off trước khi production rollout.*
