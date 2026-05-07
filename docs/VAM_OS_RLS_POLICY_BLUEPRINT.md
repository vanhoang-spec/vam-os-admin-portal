# VAM OS — RLS Policy Blueprint

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Trạng thái** | Draft — chưa apply bất kỳ migration nào |
| **Phụ thuộc** | `VAM_OS_RLS_SECURITY_AUDIT.md`, `VAM_OS_ROLE_PERMISSION_MATRIX.md`, `018_draft_rls_read_policies.sql` |
| **Cảnh báo** | Các SQL trong tài liệu này là DRAFT. Không apply trực tiếp lên production. Test trên staging trước. |

---

## Tổng quan

Document này define:
1. Staged RLS rollout plan (7 stages)
2. Helper functions cần thiết
3. Policy SQL cho từng table và từng role
4. Pattern phân quyền chuẩn

**Phạm vi hiện tại (Phase 1 — Admin portal):** Roles `viewer`, `reviewer`, `admin`, `super_admin`
**Phạm vi tương lai (Phase 2 — Portal):** Thêm `mentor`, `mentee`, `interviewer`, `support_team`

---

## Phần 1 — Helper Functions (Prerequisite)

Migration 018 đã define các helper functions này. Cần verify chúng đã được apply và hoạt động đúng trên staging trước khi viết policies.

### 1.1 `current_admin_role()`

```sql
-- Trả về role hiện tại của user đang đăng nhập
-- Trả NULL nếu không phải active admin
CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM admin_users
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

-- Revoke from public, grant to authenticated only
REVOKE ALL ON FUNCTION public.current_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin_role() TO authenticated;
```

### 1.2 `is_admin_role(text[])`

```sql
-- Trả về TRUE nếu role của user hiện tại nằm trong danh sách roles được phép
CREATE OR REPLACE FUNCTION public.is_admin_role(allowed_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_users
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
      AND role = ANY(allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_role(text[]) TO authenticated;
```

### 1.3 `is_active_admin()`

```sql
-- Trả về TRUE nếu user hiện tại là bất kỳ active admin nào
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_users
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;
```

### 1.4 Verify helper functions trước khi proceed

```sql
-- Test trong Supabase SQL Editor với test user logged in:
SELECT public.current_admin_role();
-- Expected: 'admin' hoặc 'super_admin' hoặc 'reviewer' hoặc 'viewer'

SELECT public.is_active_admin();
-- Expected: true

SELECT public.is_admin_role(ARRAY['admin', 'super_admin']);
-- Expected: true (nếu current role là admin/super_admin), false (nếu là viewer/reviewer)
```

---

## Phần 2 — Staged Rollout Plan

### Nguyên tắc

1. **Staging first** — Mọi policy đều phải được test trên staging Supabase project trước
2. **Batch enable** — Enable RLS + policy cùng lúc cho một table (không bật RLS mà không có policy)
3. **Test full dashboard sau mỗi batch** — Không chỉ test table vừa enable
4. **admin_users luôn là table cuối cùng** — Không enable RLS admin_users trước khi auth flow ổn định
5. **Rollback sẵn sàng** — Mỗi stage có rollback SQL kèm theo

### Stage 0 — Verify Current State (Không có migration)

**Mục tiêu:** Biết chính xác RLS state hiện tại trên production và staging.

```sql
-- Chạy trong Supabase SQL Editor (production + staging)
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Xem policies đang active
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Output cần có:** Spreadsheet mapping table → RLS on/off → policies hiện có

**Gate:** Hoàn thành Stage 0 trước khi làm bất kỳ stage nào khác.

---

### Stage 1 — Infrastructure Setup (Staging only)

**Mục tiêu:** Staging environment riêng biệt + helper functions verified.

**Tasks:**
1. Xác nhận staging Supabase project URL: `ljfneyuvpxrmejpxsmpz.supabase.co`
2. Apply (hoặc verify đã có) helper functions trên staging
3. Tạo test accounts cho mỗi role trên staging
4. Verify `current_admin_role()` trả về đúng cho mỗi role

**SQL để apply helper functions (nếu chưa có):**
```sql
-- (Xem Phần 1 bên trên)
-- Chạy từng function một, verify sau mỗi function
```

**Gate:** 4 test accounts (viewer/reviewer/admin/super_admin) login được, `current_admin_role()` trả về đúng role cho từng account.

---

### Stage 2 — Reference Tables (Staging only)

**Tables:** `programs`, `seasons`, `events`

**Mục tiêu:** Enable RLS cho reference tables. Tất cả active admin đọc được; anon không đọc được.

```sql
-- ============================================================
-- STAGE 2: Reference Tables
-- ============================================================

-- programs
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "programs_read_active_admins"
ON public.programs FOR SELECT
USING (public.is_active_admin());

-- seasons
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasons_read_active_admins"
ON public.seasons FOR SELECT
USING (public.is_active_admin());

-- events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_read_active_admins"
ON public.events FOR SELECT
USING (public.is_active_admin());

-- ============================================================
-- ROLLBACK STAGE 2 (chạy nếu có vấn đề):
-- ============================================================
-- ALTER TABLE public.programs DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "programs_read_active_admins" ON public.programs;
-- ALTER TABLE public.seasons DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "seasons_read_active_admins" ON public.seasons;
-- ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "events_read_active_admins" ON public.events;
```

**Sau khi apply — Test checklist:**
- [ ] Dashboard Operations: event count đúng với tháng được chọn
- [ ] Dashboard Operations: event attendance count khác 0
- [ ] `/events` hiển thị danh sách sự kiện
- [ ] Anon request (không có cookie) không đọc được events

---

### Stage 3 — Personal Data Tables (Staging only)

**Tables:** `people`, `mentor_profiles`, `mentee_profiles`

**Mục tiêu:** Tất cả active admin đọc được; anon không đọc được. Mentor/mentee tự đọc own data (Phase 2).

```sql
-- ============================================================
-- STAGE 3: Personal Data Tables (Admin read-only scope)
-- ============================================================

-- people
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "people_read_active_admins"
ON public.people FOR SELECT
USING (public.is_active_admin());

-- mentor_profiles
ALTER TABLE public.mentor_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mentor_profiles_read_active_admins"
ON public.mentor_profiles FOR SELECT
USING (public.is_active_admin());

-- mentee_profiles
ALTER TABLE public.mentee_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mentee_profiles_read_active_admins"
ON public.mentee_profiles FOR SELECT
USING (public.is_active_admin());

-- ============================================================
-- ROLLBACK STAGE 3:
-- ============================================================
-- ALTER TABLE public.people DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "people_read_active_admins" ON public.people;
-- ALTER TABLE public.mentor_profiles DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "mentor_profiles_read_active_admins" ON public.mentor_profiles;
-- ALTER TABLE public.mentee_profiles DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "mentee_profiles_read_active_admins" ON public.mentee_profiles;
```

**Sau khi apply — Test checklist:**
- [ ] `/people` hiển thị danh sách đầy đủ (không bị empty)
- [ ] `/people/[id]` hiển thị profile đúng
- [ ] Dashboard: mentor/mentee counts đúng
- [ ] Follow-up count (dashboard) không bị sai

---

### Stage 4 — Operational Tables (Staging only)

**Tables:** `matches`, `mentoring_recaps`, `event_participations`

**Mục tiêu:** Tất cả active admin đọc được. Đây là tables đã fail trong Sprint 1B — cẩn thận test.

```sql
-- ============================================================
-- STAGE 4: Operational Tables
-- CRITICAL: Test Operations dashboard kỹ sau batch này
-- ============================================================

-- matches
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_read_active_admins"
ON public.matches FOR SELECT
USING (public.is_active_admin());

-- mentoring_recaps
ALTER TABLE public.mentoring_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mentoring_recaps_read_active_admins"
ON public.mentoring_recaps FOR SELECT
USING (public.is_active_admin());

-- event_participations
ALTER TABLE public.event_participations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_participations_read_active_admins"
ON public.event_participations FOR SELECT
USING (public.is_active_admin());

-- ============================================================
-- ROLLBACK STAGE 4:
-- ============================================================
-- ALTER TABLE public.matches DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "matches_read_active_admins" ON public.matches;
-- ALTER TABLE public.mentoring_recaps DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "mentoring_recaps_read_active_admins" ON public.mentoring_recaps;
-- ALTER TABLE public.event_participations DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "event_participations_read_active_admins" ON public.event_participations;
```

**Sau khi apply — Test checklist (Sprint 1B failure scenarios):**
- [ ] Dashboard: Recap count đúng (không phải zero)
- [ ] Dashboard: Active mentor/mentee count đúng (không phải zero)
- [ ] Dashboard: Event attendance count đúng (không phải zero) ← đây là sprint 1B failure point
- [ ] Dashboard: Follow-up count đúng
- [ ] `/people/[id]` → recaps list đúng
- [ ] KPI so sánh với production (trước khi apply) — phải giống nhau

---

### Stage 5 — Application & Review Tables (Staging only)

**Tables:** `applications`, `application_reviews`, `application_decisions`

```sql
-- ============================================================
-- STAGE 5: Application Pipeline Tables
-- ============================================================

-- applications: all active admins can read; viewer can also read
CREATE POLICY "applications_read_active_admins"
ON public.applications FOR SELECT
USING (public.is_active_admin());

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- application_reviews
-- admin/super_admin: read all
-- reviewer: read ONLY reviews assigned to them
ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "application_reviews_read_admin_super"
ON public.application_reviews FOR SELECT
USING (public.is_admin_role(ARRAY['admin', 'super_admin']));

CREATE POLICY "application_reviews_read_reviewer_own"
ON public.application_reviews FOR SELECT
USING (
  public.current_admin_role() = 'reviewer'
  AND reviewer_user_id = (
    SELECT id FROM admin_users
    WHERE auth_user_id = auth.uid()
    AND status = 'active'
    LIMIT 1
  )
);

-- application_decisions: admin/super_admin only
ALTER TABLE public.application_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "application_decisions_read_admin_super"
ON public.application_decisions FOR SELECT
USING (public.is_admin_role(ARRAY['admin', 'super_admin']));

-- ============================================================
-- ROLLBACK STAGE 5:
-- ============================================================
-- ALTER TABLE public.applications DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "applications_read_active_admins" ON public.applications;
-- ALTER TABLE public.application_reviews DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "application_reviews_read_admin_super" ON public.application_reviews;
-- DROP POLICY IF EXISTS "application_reviews_read_reviewer_own" ON public.application_reviews;
-- ALTER TABLE public.application_decisions DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "application_decisions_read_admin_super" ON public.application_decisions;
```

**Sau khi apply — Test checklist:**
- [ ] Admin: `/applications` hiển thị danh sách đầy đủ
- [ ] Reviewer: `/reviews` chỉ thấy reviews được giao — không thấy reviews của reviewer khác
- [ ] Reviewer: không thể access `/applications` (app-level redirect, không phải RLS)
- [ ] Admin: thấy được quyết định từ admin khác

---

### Stage 6 — Audit & Admin Tables (Staging only)

**Tables:** `activity_correction_log`, `operational_team_assignments`, `admin_users` (LAST)

```sql
-- ============================================================
-- STAGE 6: Audit Tables + Admin Users (LAST)
-- ============================================================

-- activity_correction_log: admin/super_admin read all; reviewer read limited
ALTER TABLE public.activity_correction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "correction_log_read_admin_super"
ON public.activity_correction_log FOR SELECT
USING (public.is_admin_role(ARRAY['admin', 'super_admin']));

-- Quyết định: reviewer có được xem correction log không?
-- Nếu CÓ (uncomment):
-- CREATE POLICY "correction_log_read_reviewer"
-- ON public.activity_correction_log FOR SELECT
-- USING (public.current_admin_role() = 'reviewer');

-- operational_team_assignments: admin/super_admin only
ALTER TABLE public.operational_team_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operational_assignments_read_admin_super"
ON public.operational_team_assignments FOR SELECT
USING (public.is_admin_role(ARRAY['admin', 'super_admin']));

-- ============================================================
-- admin_users — APPLY CUỐI CÙNG
-- Verify login/role lookup ổn định TRƯỚC khi apply cái này
-- ============================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Super admin: read all admin_users
CREATE POLICY "admin_users_read_super_admin"
ON public.admin_users FOR SELECT
USING (public.current_admin_role() = 'super_admin');

-- Mỗi admin user đọc được row của chính họ
CREATE POLICY "admin_users_read_self"
ON public.admin_users FOR SELECT
USING (auth_user_id = auth.uid());

-- ============================================================
-- ROLLBACK STAGE 6:
-- ============================================================
-- ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "admin_users_read_super_admin" ON public.admin_users;
-- DROP POLICY IF EXISTS "admin_users_read_self" ON public.admin_users;
-- ALTER TABLE public.activity_correction_log DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "correction_log_read_admin_super" ON public.activity_correction_log;
```

---

### Stage 7 — Production Rollout

**Chỉ tiến hành sau khi toàn bộ Stage 1-6 pass trên staging.**

**Thứ tự production:**
1. Stage 2 (reference tables) → test → monitor 24h
2. Stage 3 (personal data) → test → monitor 24h
3. Stage 4 (operational — CRITICAL) → test ngay lập tức → monitor 1h
4. Stage 5 (application/review) → test → monitor 24h
5. Stage 6 (audit + admin_users) → test ngay sau → monitor 1h

---

## Phần 3 — Policy Matrix (Phase 1 Admin Portal)

### Ký hiệu

| Policy | SQL pattern |
|--------|------------|
| ALL admins | `is_active_admin()` |
| Admin/Super only | `is_admin_role(ARRAY['admin', 'super_admin'])` |
| Reviewer own | `current_admin_role() = 'reviewer' AND reviewer_user_id = self` |
| Super only | `current_admin_role() = 'super_admin'` |
| Self | `auth_user_id = auth.uid()` |

### SELECT policies (Phase 1)

| Table | viewer | reviewer | admin | super_admin |
|-------|--------|----------|-------|-------------|
| `programs` | ✅ (active admin) | ✅ | ✅ | ✅ |
| `seasons` | ✅ | ✅ | ✅ | ✅ |
| `events` | ✅ | ✅ | ✅ | ✅ |
| `people` | ✅ | ✅ | ✅ | ✅ |
| `mentor_profiles` | ✅ | ✅ | ✅ | ✅ |
| `mentee_profiles` | ✅ | ✅ | ✅ | ✅ |
| `matches` | ✅ | ✅ | ✅ | ✅ |
| `mentoring_recaps` | ✅ | ✅ | ✅ | ✅ |
| `event_participations` | ✅ | ✅ | ✅ | ✅ |
| `applications` | ✅ | ❌ | ✅ | ✅ |
| `application_reviews` | ❌ | ✅ own only | ✅ all | ✅ all |
| `application_decisions` | ❌ | ❌ | ✅ | ✅ |
| `activity_correction_log` | ❌ | ❓ TBD | ✅ | ✅ |
| `operational_team_assignments` | ❌ | ❌ | ✅ | ✅ |
| `admin_users` | ❌ | ❌ | self only | ✅ all |

> ❓ = Cần quyết định từ Core Team trước khi implement

### INSERT/UPDATE/DELETE policies

**Phase 1: Không cần write policies** vì tất cả writes đi qua `getSupabaseServiceRoleClient()` (server-only, bypass RLS). Write policies cần thiết khi:
- Mentor/mentee portal live (self-service writes)
- Bất kỳ path nào chuyển từ server action → client-side

---

## Phần 4 — Phase 2: Mentor/Mentee Portal Policies (Draft)

**Áp dụng sau khi:** RLS Phase 1 đã stable + mentor portal sẵn sàng launch.

### 4.1 Mentor policies

```sql
-- Mentor đọc own profile
CREATE POLICY "mentor_profiles_read_own"
ON public.mentor_profiles FOR SELECT
USING (
  person_id IN (
    SELECT p.id FROM people p
    WHERE p.auth_user_id = auth.uid()
  )
);

-- Mentor đọc own match
CREATE POLICY "matches_read_mentor_own"
ON public.matches FOR SELECT
USING (
  mentor_person_id IN (
    SELECT p.id FROM people p
    WHERE p.auth_user_id = auth.uid()
  )
);

-- Mentor submit recap cho own matches
CREATE POLICY "mentoring_recaps_insert_mentor_own"
ON public.mentoring_recaps FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM matches m
    JOIN people p ON m.mentor_person_id = p.id
    WHERE m.id = mentoring_recaps.match_id
      AND p.auth_user_id = auth.uid()
  )
);

-- Mentor đọc own recaps
CREATE POLICY "mentoring_recaps_read_mentor_own"
ON public.mentoring_recaps FOR SELECT
USING (
  mentor_person_id IN (
    SELECT p.id FROM people p
    WHERE p.auth_user_id = auth.uid()
  )
);
```

### 4.2 Mentee policies

```sql
-- Mentee đọc own profile
CREATE POLICY "mentee_profiles_read_own"
ON public.mentee_profiles FOR SELECT
USING (
  person_id IN (
    SELECT p.id FROM people p
    WHERE p.auth_user_id = auth.uid()
  )
);

-- Mentee đọc own match (read only)
CREATE POLICY "matches_read_mentee_own"
ON public.matches FOR SELECT
USING (
  mentee_person_id IN (
    SELECT p.id FROM people p
    WHERE p.auth_user_id = auth.uid()
  )
);

-- Mentee đọc recaps của match của mình
CREATE POLICY "mentoring_recaps_read_mentee_own"
ON public.mentoring_recaps FOR SELECT
USING (
  mentee_person_id IN (
    SELECT p.id FROM people p
    WHERE p.auth_user_id = auth.uid()
  )
);
```

> **Prerequisite cho Phase 2:** `people.auth_user_id` phải được populate cho tất cả mentor/mentee có account. Hiện tại column này có thể null cho imported records.

---

## Phần 5 — `admin_scope_access` (Tương lai)

Table `admin_scope_access` tồn tại trong live DB nhưng **không có migration trong repo**. Hiện tại có 0 rows (từ Sprint 1B analysis). Mục đích: limit admin access theo program/season (ví dụ: admin UEHM không thấy data HAM).

**Khi implement:**
1. Verify schema trước (SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_scope_access')
2. Design policies sau khi biết schema
3. Seed rows cho current admins TRƯỚC khi enable — không enable khi 0 rows (sẽ block tất cả)

**Draft policy pattern (chưa implement):**
```sql
-- Ví dụ conceptual — không chạy cho đến khi schema verified
CREATE POLICY "seasons_read_scoped_admins"
ON public.seasons FOR SELECT
USING (
  -- super_admin thấy tất cả
  public.current_admin_role() = 'super_admin'
  OR
  -- admin thấy seasons trong program được assign
  EXISTS (
    SELECT 1 FROM admin_scope_access asa
    WHERE asa.auth_user_id = auth.uid()
      AND asa.program_id = seasons.program_id
  )
);
```

---

## Phần 6 — Dependency Map

```
Helper Functions (Stage 1)
    ↓ required by all policies
    ↓
Reference Tables (Stage 2): programs, seasons, events
    ↓ events required for event attendance KPI
    ↓
Personal Data (Stage 3): people, mentor_profiles, mentee_profiles
    ↓ people required for mentor/mentee name resolution in dashboard
    ↓
Operational (Stage 4): matches, mentoring_recaps, event_participations
    ↓ CRITICAL: Sprint 1B failed here — test all KPIs together
    ↓
Application Pipeline (Stage 5): applications, reviews, decisions
    ↓
Audit + admin_users (Stage 6) — admin_users LAST
    ↓
Production Rollout (Stage 7)
    ↓
Phase 2 — Mentor/Mentee Scope (future, after portal)
```

---

*VAM OS RLS Policy Blueprint — 07/05/2026 — Draft. Do NOT apply without staging validation.*
