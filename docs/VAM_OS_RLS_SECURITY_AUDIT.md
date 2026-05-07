# VAM OS — RLS Security Audit

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Trạng thái** | Audit only — không có migration, không enable RLS |
| **Tác giả** | Dev audit dựa trên code inspection |
| **Phụ thuộc** | Xem thêm: `SPRINT_1B_RLS_RECOVERY_STABLE_ACCESS_ARCHITECTURE.md`, `018_draft_rls_read_policies.sql` |

---

## 1. Executive Summary

VAM OS Admin Portal là một nội bộ admin tool chứa PII nhạy cảm (tên, email, SĐT, giới tính, ngày sinh, hồ sơ ứng tuyển). Hệ thống hiện tại bảo vệ bằng hai lớp: password gate và Supabase Auth. Row Level Security (RLS) chưa được áp dụng đầy đủ.

**Sprint 1B đã thử enable RLS và thất bại** vì lý do kiến trúc: data reads dùng anon Supabase client không mang user JWT, khiến `auth.uid()` luôn là null khi evaluating policies — tất cả rows bị filter ra, dashboard hiển thị zero.

**Trạng thái hiện tại (May 2026):**
- `admin_users` → RLS ENABLED (xác nhận từ `lib/admin-auth.ts` comment + migration 018)
- `programs`, `seasons`, `events`, `people`, `mentor_profiles`, `mentee_profiles` → Có khả năng RLS enabled (Sprint 1B Step 1 + 2 passed)
- `mentoring_recaps`, `event_participations` → RLS DISABLED (đã rollback sau incident)
- Các tables còn lại → Chưa xác định; cần kiểm tra trực tiếp trong Supabase SQL Editor

**Kiến trúc ổn định hiện tại (sau Sprint 1B Recovery):**
- Writes: `getSupabaseServiceRoleClient()` — bypass RLS hoàn toàn (an toàn vì server-only)
- Reads: `dataClient()` = `getSupabaseServerClient() ?? supabase` — ưu tiên dùng cookie auth client
- Nếu không có cookie (public routes, SSG): fallback về browser anon client

**Đề xuất cốt lõi:** Không enable thêm RLS cho đến khi:
1. Staging environment xác nhận được (xem VAM_OS_90_DAY_ROADMAP.md)
2. Helper functions từ migration 018 được verify trên staging
3. Tất cả server-side reads đều đi qua `dataClient()` hoặc service role, không còn raw anon reads

---

## 2. Lịch sử RLS — Sprint 1B Post-Mortem

### 2.1 Những gì đã xảy ra

| Giai đoạn | Kết quả |
|-----------|---------|
| Sprint 1A: Supabase Auth | ✅ PASS — login, session, middleware hoạt động |
| Sprint 1B Step 1: RLS cho programs/seasons/events | ✅ PASS (nhưng event KPI bị ảnh hưởng ngầm) |
| Sprint 1B Step 2: RLS cho people, mentor_profiles, mentee_profiles | ✅ PASS |
| Sprint 1B Step 3: RLS cho mentoring_recaps, event_participations | ❌ FAIL — Operations dashboard hiện zero recaps và zero event attendance |
| Rollback: Disable RLS trên mentoring_recaps + event_participations | ✅ Recaps trở về bình thường, nhưng event KPI vẫn bị ảnh hưởng |

### 2.2 Root cause

```
Browser → middleware (auth cookie ✅) → Next.js server component
                                              ↓
                                     lib/data.ts:dataClient()
                                              ↓
                                     lib/supabase.ts (anon client)
                                              ↓
                                     Supabase: auth.uid() = NULL
                                              ↓
                                     RLS policy fails → empty rows
                                              ↓
                                     Dashboard shows zero KPIs
```

Vấn đề: Middleware authenticate OK ở app layer, nhưng database query dùng anon client → không có JWT → RLS block toàn bộ.

### 2.3 Dependency ngầm trong Operations Dashboard

```
events (RLS enabled)
    ↓ filter by event_id
event_participations
    → attendance count = 0 nếu events trả về empty
```

Dù `event_participations` được rollback RLS disabled, event KPI vẫn bị ảnh hưởng vì `events` còn RLS enabled và không trả về data.

### 2.4 Bài học

1. **Không enable RLS từng table riêng lẻ** nếu có cross-table dependency trong KPI calculation
2. **Luôn test full dashboard sau mỗi batch** — không chỉ test table vừa enable
3. **Staging first** — không rollout RLS trực tiếp lên production
4. **Client architecture phải nhất quán** — không mix anon/service-role/auth-cookie trong cùng một page data path

---

## 3. Inventory Tables và Phân loại Nhạy cảm

### 3.1 Phân loại rủi ro

| Mức độ | Định nghĩa |
|--------|-----------|
| 🔴 CRITICAL | PII cá nhân + dữ liệu nhạy cảm; breach = harm thực tế |
| 🟠 HIGH | Dữ liệu vận hành; breach = privacy + operational damage |
| 🟡 MEDIUM | Audit/log; breach = operational, không trực tiếp harm cá nhân |
| 🟢 LOW | Reference data; breach = minimal harm |

### 3.2 Table Inventory

| Table | Nhạy cảm | Columns nhạy cảm | RLS hiện tại | Trong repo migration |
|-------|----------|-----------------|-------------|---------------------|
| `people` | 🔴 CRITICAL | full_name, email_primary, phone_primary, date_of_birth, gender, facebook_url, consent fields | Có thể enabled (Step 2) | Không có core migration — assume exists |
| `applications` | 🔴 CRITICAL | full_name, email_primary, phone_primary, gender, raw_payload (form answers), status | Unknown | Migration 038, 040, 041, 043 |
| `mentor_profiles` | 🔴 CRITICAL | person_id FK, industry, expertise, bio | Có thể enabled (Step 2) | Migration 036, 043 |
| `mentee_profiles` | 🔴 CRITICAL | person_id FK, goals, background | Có thể enabled (Step 2) | Migration 036, 043 |
| `admin_users` | 🔴 CRITICAL | email, full_name, role, auth_user_id | ✅ ENABLED | Migration 017, 018 |
| `matches` | 🟠 HIGH | mentor_person_id, mentee_person_id, status | Unknown | Migration 046a |
| `mentoring_recaps` | 🟠 HIGH | match_id, mentor_person_id, mentee_person_id, recap_note, recap_url | ❌ DISABLED (rolled back) | Migration 012, 013 |
| `application_reviews` | 🟠 HIGH | scores, recommendation, reviewer_user_id, review content | Unknown | Migration 040 |
| `application_decisions` | 🟠 HIGH | decision, reason, decided_by_user_id | Unknown | Migration 041 |
| `event_participations` | 🟠 HIGH | person_id, attendance_status, role_at_event | ❌ DISABLED (rolled back) | Migration 012, 013 |
| `activity_correction_log` | 🟡 MEDIUM | target_table, field changes, corrected_by (text) | Unknown | Migration 015 |
| `operational_team_assignments` | 🟡 MEDIUM | person_id, assignment_type, season_id | Unknown | Migration 016 |
| `events` | 🟢 LOW | event_name, event_type, starts_at | Có thể enabled (Step 1) | — |
| `programs` | 🟢 LOW | program_name, code | Có thể enabled (Step 1) | Migration 036 |
| `seasons` | 🟢 LOW | season_code, dates | Có thể enabled (Step 1) | — |
| `intake_batches` | 🟢 LOW | batch_code, open/close dates | Unknown | Migration 038 |
| `industries` | 🟢 LOW | name, code | Unknown | Migration 036 |
| `function_areas` | 🟢 LOW | name, code | Unknown | Migration 036 |
| `mentor_industries` | 🟢 LOW | FK join table | Unknown | Migration 036 |
| `mentor_function_area_links` | 🟢 LOW | FK join table | Unknown | Migration 036 |
| `admin_scope_access` | 🟡 MEDIUM | auth_user_id FK, program/season scope | Unknown | NOT in repo migrations |

> **Lưu ý:** `admin_scope_access` tồn tại trong live DB nhưng không có core migration trong repo. Schema chưa được verify từ local env.

---

## 4. Page/Action → Table Mapping

### 4.1 Read paths (theo module)

| Page / Route | Tables được đọc | Client hiện tại |
|-------------|----------------|----------------|
| `/` (dashboard) | seasons, people, mentee_profiles, matches, mentoring_recaps, events, event_participations | `dataClient()` → server anon hoặc service role RPC |
| `/operations` | Tương tự dashboard + RPC `get_operations_dashboard_data` | `dataClient()` + service role |
| `/people` | people, mentor_profiles, mentee_profiles | `dataClient()` |
| `/people/[id]` | people, mentor_profiles, mentee_profiles, matches, mentoring_recaps, event_participations | `dataClient()` |
| `/applications` | applications, people, intake_batches | `dataClient()` |
| `/applications/[id]` | applications, application_reviews, application_decisions, people | `dataClient()` |
| `/reviews` | application_reviews, applications, admin_users (reviewer info) | `dataClient()` |
| `/reviews/[id]` | application_reviews, applications, people | `dataClient()` |
| `/interviews` | applications, application_reviews (interview type) | `dataClient()` |
| `/events` | events, event_participations, people | `dataClient()` |
| `/events/[id]` | events, event_participations, people | `dataClient()` |
| `/matches` | matches, people, mentor_profiles, mentee_profiles | `dataClient()` |
| `/admin/users` | admin_users | Service role (via `getCurrentAdminUser`) |
| `/apply/mentor` | (public — no auth needed) | — |
| `/apply/mentee` | (public — no auth needed) | — |

### 4.2 Write paths (theo action)

| Action | Tables bị write | Client | Notes |
|--------|----------------|--------|-------|
| Submit application | applications | **Service role** | Public route, only gate = pilot token |
| Assign reviewer | application_reviews (bulk insert) | **Service role** | `lib/bulk-assignment.ts` |
| Self-claim interview | application_reviews | **Service role** | `lib/interview-claim.ts` |
| Submit review | application_reviews | **Service role** | `lib/application-reviews.ts` |
| Admin decision | application_decisions, applications | **Service role** | `lib/application-decisions.ts` |
| Approve as mentor/mentee | people, mentor_profiles, mentee_profiles, applications | **Service role** | `lib/application-approvals.ts` |
| Create/edit recap (admin) | mentoring_recaps | **Service role** | `lib/admin-corrections.ts` |
| Create match | matches + audit | **Service role** | `lib/matches.ts` |
| Create/edit event | events | **Service role** | `lib/events.ts` |
| Mark attendance | event_participations | **Service role** | `lib/events.ts` |
| Enable reviewer | admin_users | **Service role** | `lib/enable-reviewer.ts` |
| First-login auth link | admin_users | **Service role** | `lib/admin-auth.ts` |

---

## 5. Phân tích Client Usage

### 5.1 Browser client (`lib/supabase.ts`)

Dùng trong: login page, reset-password page, debug-auth page (dev only).

```
lib/supabase.ts:
  createClient(url, anonKey, { auth: { persistSession: false } })
  → NO user JWT → auth.uid() = NULL khi RLS evaluated
```

**Rủi ro:** Nếu bất kỳ component nào import `supabase` từ `lib/supabase.ts` và dùng để read data trong server component, RLS sẽ block. Hiện tại browser client chỉ dùng cho login/reset — OK.

### 5.2 Server anon client (`lib/supabase-server.ts` → `getSupabaseServerClient()`)

```typescript
// Carries user Bearer token từ cookie AUTH_ACCESS_COOKIE
// → auth.uid() = current user ID → RLS evaluates correctly
const client = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } }
})
```

**Điều kiện hoạt động đúng:** Cookie phải có `AUTH_ACCESS_COOKIE`. Nếu không có cookie (unauthenticated request), returns `null`.

### 5.3 `dataClient()` pattern (`lib/data.ts`)

```typescript
function dataClient() {
  return getSupabaseServerClient() ?? supabase
  // ↑ server auth client   ↑ browser anon client (fallback)
}
```

**Vấn đề của fallback:** Nếu server client null (vd. trong middleware, SSG, hoặc cookie không có), fallback về browser anon → RLS sẽ block nếu table có RLS enabled.

### 5.4 Service role client (`getSupabaseServiceRoleClient()`)

```typescript
// Uses SUPABASE_SERVICE_ROLE_KEY → bypasses RLS hoàn toàn
// Server-only (có `server-only` import guard)
```

**An toàn vì:** Server-only, không expose ra client. Không có `NEXT_PUBLIC_` prefix.
**Rủi ro tiềm ẩn:** Nếu ai vô tình move một server action thành client component mà vẫn giữ service role call → key exposure.

---

## 6. Role Helper Analysis

### 6.1 Helper functions trong migration 018

```sql
-- Hàm này dùng auth.uid() — chỉ hoạt động khi request có user JWT
CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS text AS $$
  SELECT role FROM admin_users
  WHERE auth_user_id = auth.uid() AND status = 'active'
$$ LANGUAGE sql SECURITY DEFINER;
```

**Trạng thái:** Có khả năng đã được apply (admin_users RLS dùng hàm này và đang hoạt động).

### 6.2 App-layer permissions (`lib/permissions.ts`)

```typescript
// Các role được nhận diện trong app:
["super_admin", "admin", "core_team"]     // canEditRecap, canAssignReview
["super_admin", "admin"]                   // canDecide, canManageMatches
["super_admin", "admin", "reviewer", "core_team"] // canReview
["super_admin"]                            // canManageUsers
```

### 6.3 ⚠️ Critical Gap: `core_team` role

| | `permissions.ts` | `admin_users` DB constraint |
|--|-----------------|---------------------------|
| `viewer` | ✅ | ✅ |
| `reviewer` | ✅ | ✅ |
| `admin` | ✅ | ✅ |
| `super_admin` | ✅ | ✅ |
| `core_team` | ✅ (used) | ❌ NOT IN CONSTRAINT |

`core_team` không nằm trong `admin_users_role_check` constraint trong migration 017. Không ai có thể có role `core_team` trong DB, nhưng code permissions vẫn check nó. Đây là dead code / nhất quán sai.

**Action cần thiết:** Quyết định xem `core_team` có phải là role riêng hay không. Nếu không, xóa khỏi `permissions.ts`. Nếu có, thêm vào DB constraint.

**Resolution note (2026-05-07):** `core_team` and `support_team` are now intended official internal admin roles. Migration `047_fix_admin_users_role_constraint_core_support_team.sql` updates `admin_users_role_check` to allow both roles and is a prerequisite before RLS rollout.

### 6.4 Migration 018 status (ambiguity)

| Bằng chứng | Cho thấy |
|-----------|---------|
| File header: "REVIEW ONLY. DO NOT RUN UNTIL APPROVED" | Chưa approved |
| `lib/admin-auth.ts` comment: "admin_users table has RLS enabled (migration 018)" | Đã apply ít nhất admin_users + helper functions |
| Sprint 1B passed for programs/seasons/events/people/profiles | Policies cho các tables đó có khả năng đã active |

**Kết luận:** Migration 018 đã được apply một phần. Cần verify trực tiếp trong Supabase SQL Editor để xác định chính xác tables nào có RLS + policies đang active.

---

## 7. Rủi ro nếu enable RLS không chuẩn bị

| Rủi ro | Xác suất | Ảnh hưởng | Điều kiện gây ra |
|--------|---------|----------|----------------|
| Dashboard hiển thị zero KPIs | 🔴 Cao | Cao | `dataClient()` fallback về anon khi cookie không có |
| Operations event KPI = 0 | 🔴 Cao | Cao | `events` + `event_participations` cross-dependency |
| Reviewer thấy trang trắng | 🟠 Trung bình | Cao | Reviewer reads qua anon client |
| Login loop / admin_users blocked | 🟠 Trung bình | Rất cao | admin_users RLS block auth lookup |
| Public apply form break | 🟡 Thấp | Cao | Service role bypass → không bị ảnh hưởng |
| `core_team` role bị block | 🟡 Thấp | Thấp | Role này không tồn tại trong DB |

### 7.1 Điều kiện an toàn trước khi enable thêm RLS

- [ ] Staging environment riêng biệt tồn tại (không phải production)
- [ ] Tất cả server-side reads dùng `dataClient()` — không còn raw `supabase` import trong server components
- [ ] Helper functions (`current_admin_role()`, `is_admin_role()`, `is_active_admin()`) đã verify trên staging
- [ ] `core_team` role gap được resolve
- [ ] Test accounts cho mỗi role: viewer, reviewer, admin, super_admin
- [ ] `admin_scope_access` schema được verify (bảng này tồn tại nhưng không có migration trong repo)
- [ ] Rollback scripts sẵn sàng (xem Section 9)

---

## 8. Phân tích Public Routes và Exposure Surface

### 8.1 Routes bypass toàn bộ admin auth

```
/login              → Supabase Auth only (no password gate)
/unlock             → Password gate only
/apply/mentor       → Token gate (VAM_OS_APPLICATION_PILOT_TOKEN)
/apply/mentee       → Token gate (VAM_OS_APPLICATION_PILOT_TOKEN)
/reset-password     → Supabase Auth flow
```

### 8.2 `/apply/*` write path (không có admin auth)

```
User submits form → Server Action → getSupabaseServiceRoleClient()
                                   → INSERT into applications
```

**Nhận xét:** Đây là expected behavior (ứng viên nộp hồ sơ không cần admin login). Service role bypass là OK vì đây là server action. Gate bảo vệ: pilot token. Không có RLS concern ở đây.

### 8.3 API không có public exposure

Không có `/api/` routes dùng anon client để serve sensitive data. Tất cả sensitive reads đều trong Next.js Server Components — không accessible trực tiếp từ browser.

---

## 9. Rollback Scripts Chuẩn bị

Các snippets sau chỉ để reference — không chạy mà không có human review:

```sql
-- Kiểm tra trạng thái RLS tất cả tables
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Kiểm tra policies hiện tại
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Disable RLS khẩn cấp cho một table
-- ALTER TABLE public.<table_name> DISABLE ROW LEVEL SECURITY;

-- Drop một policy cụ thể
-- DROP POLICY IF EXISTS "<policy_name>" ON public.<table_name>;
```

---

## 10. Đề xuất Staged Rollout (Tổng quan)

Chi tiết đầy đủ trong `VAM_OS_RLS_POLICY_BLUEPRINT.md`. Tóm tắt:

| Stage | Việc làm | Gating condition |
|-------|---------|----------------|
| Stage 0 | Verify current RLS state trên Supabase SQL Editor | Manual — no code change |
| Stage 1 | Staging env setup, verify helper functions | Staging exists |
| Stage 2 | Reference tables: programs, seasons, events (admin-only read) | Stage 1 done |
| Stage 3 | Personal data: people, profiles (admin-only read) | Stage 2 + dashboard test |
| Stage 4 | Operational: matches, recaps, reviews, decisions | Stage 3 + KPI test |
| Stage 5 | Reviewer scope: reviews limited to assigned | Stage 4 + reviewer test |
| Stage 6 | Mentor/mentee scope | RLS Phase 2 gate (after portal) |
| Stage 7 | Write policies (future) | Service role fully reviewed |

**Nguyên tắc bất biến:**
- `admin_users` phải là table CUỐI CÙNG trong bất kỳ batch RLS nào
- Không bao giờ enable RLS trên `admin_users` trước khi toàn bộ login/auth flow ổn định
- Staging phải pass trước production rollout
- Test full dashboard sau mỗi stage (không chỉ table vừa enable)

---

## 11. Gaps cần quyết định trước khi tiến hành

| Câu hỏi | Người quyết định | Priority |
|---------|----------------|---------|
| `core_team` role có tồn tại trong DB không? | Dev Lead | 🔴 Cao |
| `admin_scope_access` schema là gì? | Dev | 🔴 Cao |
| Viewer có được xem applications không? | Core Team Admin | 🟠 Trung bình |
| Reviewer có được xem application gốc khi review không? | Core Team Admin | 🟠 Trung bình |
| Correction log ai có thể xem? | Core Team Admin | 🟠 Trung bình |
| Mentor portal triggers RLS Phase 2 khi nào? | Dev Lead | 🟡 Thấp (Phase 2) |

---

*VAM OS RLS Security Audit — 07/05/2026 — Internal only. Do not share outside Core Team.*
