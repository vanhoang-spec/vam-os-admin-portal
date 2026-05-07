# VAM OS — Program-Scoped Access: Codex Implementation Package

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Loại tài liệu** | Implementation package — dành cho Codex |
| **Source blueprint** | `docs/VAM_OS_PROGRAM_SCOPED_ACCESS_MVP_BLUEPRINT.md` |
| **Trạng thái** | Sẵn sàng implement — chưa có code nào được viết |

---

## Ràng buộc tuyệt đối (Global Constraints)

Codex phải tuân thủ tất cả ràng buộc sau trong mọi slice:

| Ràng buộc | Chi tiết |
|----------|---------|
| ❌ Không import HAM data | Dù staging hay production — chưa được phép trong toàn bộ package này |
| ❌ Không enable RLS | Không `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` ở bất kỳ đâu |
| ❌ Không big-bang refactor | Mỗi slice phải là thay đổi nhỏ, độc lập, không đụng đến toàn bộ codebase cùng lúc |
| ❌ Không suy luận quyền từ mentor/mentee profile | Quyền truy cập program phải đến từ `admin_scope_access`, không phải từ việc user có profile trong program đó |
| ❌ Không chạy migration trên production chưa được review | Mọi migration mới phải test staging trước |
| ✅ Server-only | `lib/program-scope.ts` phải có `import "server-only"` ở đầu file |
| ✅ Typecheck + lint + build sau mỗi slice | Không slice nào được merge nếu ba lệnh này fail |
| ✅ Không sửa untracked files | Không đụng đến backfill scripts, HAM CSVs, UEHM event audit CSVs, `exports/` folder |

---

## Hiện trạng code (Để Codex không đọc lại từ đầu)

### Pattern data fetch hiện tại

```
app/events/page.tsx
  → getEventListData() [lib/events.ts — service role, load ALL events]
  → filter trong JS tại page: allRows.filter(row => season_code === seasonFilter)
  → PROBLEM: filter chỉ ở UI, DB trả về tất cả

app/people/page.tsx
  → getPeople() [lib/data.ts — dataClient(), load ALL people]
  → không có filter nào

app/matches/page.tsx
  → getMatchList({ intakeBatchId, status }) [lib/matches.ts]
  → filter theo batch/status, nhưng không có program scope

app/page.tsx (dashboard)
  → getOperationsDashboardKpis() [lib/data.ts]
  → load ALL seasons, matches, recaps, events, participations
  → compute KPIs từ tất cả data
```

### Client pattern hiện tại

```
lib/data.ts: dataClient() = getSupabaseServerClient() ?? supabase
lib/events.ts: getSupabaseServiceRoleClient() cho tất cả operations
lib/matches.ts: getSupabaseServiceRoleClient()
lib/admin-auth.ts: getCurrentAdminUser() → đọc admin_users qua service role
```

### Role check hiện tại

```
lib/permissions.ts: canManageMatches(role), canEditRecaps(role), v.v.
  → nhận vào adminUser?.role (global role từ admin_users)
  → KHÔNG biết gì về program scope

lib/auth-constants.ts: canEditRecaps(adminUser) → check global role
```

---

## QA Account Matrix

Tạo 5 accounts này trên staging trước khi bắt đầu bất kỳ slice nào:

| Handle | Email | Global Role (admin_users) | UEHM Scope | HAM Scope | Mục đích |
|--------|-------|--------------------------|-----------|---------|---------|
| `qa-super` | `qa-super@vam.test` | `super_admin` | bypass | bypass | Verify thấy tất cả, không bị scope filter |
| `qa-uehm` | `qa-uehm@vam.test` | `core_team` | `core_team` | không có | Verify chỉ thấy UEHM |
| `qa-ham` | `qa-ham@vam.test` | `core_team` | không có | `core_team` | Verify chỉ thấy HAM (sau khi HAM data có) |
| `qa-both` | `qa-both@vam.test` | `core_team` | `core_team` | `core_team` | Verify thấy cả hai programs |
| `qa-viewer` | `qa-viewer@vam.test` | `viewer` | `viewer` | không có | Verify read-only + UEHM scope |

> **Quan trọng:** `qa-ham` chỉ có thể test isolation sau khi HAM có ít nhất 1 record trong DB. Hiện tại HAM chưa có data — test account này sau khi HAM staging import được unblock.

---

## Slice 0 — Schema Inspection (Read-only, không viết code)

### Mục tiêu

Biết chính xác `admin_scope_access` schema trên live DB trước khi viết bất kỳ dòng code nào. Nếu schema khác với blueprint → phải điều chỉnh Slice 1 và 2 theo thực tế.

### Files được đọc

Không có file nào được tạo hoặc sửa. Chỉ đọc.

### Database assumptions cần verify

Chạy hai queries sau trong **Supabase SQL Editor** (project production hoặc staging):

**Query 1 — Columns của admin_scope_access:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'admin_scope_access'
ORDER BY ordinal_position;
```

**Query 2 — Indexes và constraints:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'admin_scope_access';
```

**Query 3 — Số rows hiện có:**
```sql
SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT auth_user_id) AS distinct_users,
       COUNT(DISTINCT program_id) AS distinct_programs
FROM admin_scope_access;
```

**Query 4 — Sample rows (nếu có):**
```sql
SELECT * FROM admin_scope_access LIMIT 10;
```

**Query 5 — programs table để lấy program IDs:**
```sql
SELECT id, code, name FROM programs ORDER BY code;
```

### Implementation steps

1. Chạy 5 queries trên
2. Ghi lại kết quả vào một comment hoặc note (không tạo file mới)
3. So sánh columns thực tế với blueprint đề xuất (Phần 2.1 của MVP Blueprint)
4. Xác định: có cần migration để thêm columns không?

**Columns cần có theo blueprint (kiểm tra từng cái):**

| Column | Type | Required? |
|--------|------|----------|
| `id` | uuid | Bắt buộc |
| `auth_user_id` | uuid | Bắt buộc |
| `program_id` | uuid | Bắt buộc |
| `role_in_program` | text | Bắt buộc |
| `season_ids` | uuid[] hoặc text[] | Nice to have |
| `is_active` | boolean | Bắt buộc |
| `granted_by` | uuid | Optional |
| `granted_at` | timestamptz | Optional |

**Nếu thiếu columns quan trọng:** Cần migration mới (đề xuất: `051_admin_scope_access_schema_align.sql`) — viết migration draft, không apply lên production.

### QA steps

- [ ] Có kết quả của cả 5 queries
- [ ] Biết rõ columns nào tồn tại, columns nào thiếu
- [ ] Biết rõ có bao nhiêu rows và chúng trông như thế nào
- [ ] Biết rõ programs table có records chưa (UEHM program_id là gì)

### Rollback concern

Không có — read-only.

### Do-not-touch list

- Không viết code
- Không thêm row nào vào `admin_scope_access`
- Không tạo file mới

### Gate để sang Slice 1

- [ ] Schema verified: biết columns thực tế
- [ ] Programs table có ít nhất record UEHM
- [ ] Nếu cần migration: draft migration đã được viết và reviewed, CHƯA apply

---

## Slice 1 — `lib/program-scope.ts`: Helper Functions

### Mục tiêu

Tạo file `lib/program-scope.ts` với tất cả helper functions cho scope resolution. File này là nền tảng cho tất cả các slices sau. Không sửa bất kỳ page nào trong slice này.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `lib/program-scope.ts` | **TẠO MỚI** | File mới hoàn toàn |
| `lib/types.ts` | Có thể sửa | Thêm types cho scope context nếu chưa có |

### Database assumptions

Dựa trên kết quả Slice 0. Assumptions mặc định:

- `admin_scope_access` có columns: `auth_user_id`, `program_id`, `role_in_program`, `is_active`
- `programs` có columns: `id`, `code` (VD: `'uehm_mentoring'`, `'ham_mentoring'`)
- `seasons` có columns: `id`, `program_id`, `code`
- `admin_users` có columns: `auth_user_id`, `role` (global role)

> Nếu Slice 0 phát hiện schema khác → điều chỉnh assumptions ở đây trước khi code.

### Các types cần define (trong `lib/types.ts` hoặc đầu file `lib/program-scope.ts`)

```
ProgramScope {
  programId: string
  programCode: string
  roleInProgram: string           // role của user trong program này
  allowedSeasonIds: string[]      // empty array = tất cả seasons của program
}

AdminScopeContext {
  authUserId: string
  globalRole: string
  isSuperAdmin: boolean
  programScopes: ProgramScope[]   // rỗng nếu super_admin (bypass)
}
```

### Implementation steps

**Bước 1:** Tạo file `lib/program-scope.ts` với `import "server-only"` ở dòng đầu tiên.

**Bước 2:** Implement `getAdminScopeContext()` (tên khác với blueprint `getCurrentAdminContext` để tránh conflict với `getCurrentAdminUser` đã có):

Logic:
- Gọi `getSupabaseServerClient()` để lấy authenticated client
- Nếu không có session → throw error hoặc return null context
- Query `admin_users` WHERE `auth_user_id = auth.uid()` → lấy `role`, `status`
- Nếu `status !== 'active'` → return unauthorized context
- Nếu `role === 'super_admin'` → return `{ isSuperAdmin: true, programScopes: [] }`
- Query `admin_scope_access` JOIN `programs` WHERE `auth_user_id = current` AND `is_active = true`
- Map kết quả thành `ProgramScope[]`
- Return `AdminScopeContext`

**Quan trọng về caching:** Dùng React `cache()` để wrap `getAdminScopeContext()`. Trong một request, function này chỉ chạy một lần dù được gọi nhiều lần từ nhiều components.

**Bước 3:** Implement `getAllowedProgramIds(ctx: AdminScopeContext)`:

Logic:
- Nếu `ctx.isSuperAdmin` → query `programs` table, return tất cả `id[]`
- Ngược lại → return `ctx.programScopes.map(s => s.programId)`

**Bước 4:** Implement `getAllowedSeasonIds(ctx: AdminScopeContext)`:

Logic:
- Nếu `ctx.isSuperAdmin` → query `seasons` table, return tất cả `id[]`
- Ngược lại:
  - Với mỗi scope trong `ctx.programScopes`:
    - Nếu `scope.allowedSeasonIds.length === 0` → query tất cả `seasons` WHERE `program_id = scope.programId`, thêm vào result
    - Nếu `scope.allowedSeasonIds.length > 0` → thêm trực tiếp vào result
  - Deduplicate, return

**Bước 5:** Implement `canAccessProgram(ctx, programId)` → boolean:

Logic: `ctx.isSuperAdmin || ctx.programScopes.some(s => s.programId === programId)`

**Bước 6:** Implement `canAccessSeason(ctx, seasonId, allowedSeasonIds)` → boolean:

Logic: `ctx.isSuperAdmin || allowedSeasonIds.includes(seasonId)`

**Bước 7:** Implement `requireProgramAccess(ctx, programId?)`:

Logic:
- Nếu `ctx.isSuperAdmin` → return (no-op)
- Nếu `programId` được cung cấp → check `canAccessProgram(ctx, programId)` → nếu false, throw `Error("UNAUTHORIZED: no access to this program")`
- Nếu không có `programId` → check `ctx.programScopes.length > 0` → nếu false, throw

**Bước 8:** Implement `getRoleInProgram(ctx, programId)` → string | null:

Logic:
- Nếu `ctx.isSuperAdmin` → return `'super_admin'`
- Tìm scope có `programId` → return `scope.roleInProgram`
- Nếu không tìm thấy → return `null`

### QA steps

Không có UI để test slice này. Test bằng cách:

1. Viết một temporary test endpoint hoặc dùng `console.log` trong một server component (xóa sau khi verify)
2. Login với `qa-super` → `getAdminScopeContext()` phải trả về `isSuperAdmin: true`
3. Login với `qa-uehm` → phải trả về `programScopes` có 1 entry với UEHM program
4. Login với `qa-viewer` → phải trả về `programScopes` có 1 entry với UEHM program, `roleInProgram: 'viewer'`
5. Chạy `npm run typecheck` và `npm run build` — phải pass

### Rollback concern

File mới hoàn toàn, không sửa file nào hiện có. Rollback = xóa file `lib/program-scope.ts`.

### Do-not-touch list

- Không sửa `lib/data.ts`
- Không sửa `lib/events.ts`
- Không sửa `lib/matches.ts`
- Không sửa bất kỳ page nào
- Không sửa `lib/permissions.ts`
- Không sửa `lib/admin-auth.ts`

### Gate để sang Slice 2

- [ ] `lib/program-scope.ts` tạo thành công
- [ ] `npm run typecheck` PASS
- [ ] `npm run build` PASS
- [ ] Manual verify: `getAdminScopeContext()` trả về đúng cho ít nhất `qa-super` và `qa-uehm`

---

## Slice 2 — Seed `admin_scope_access` (Migration Script + SQL)

### Mục tiêu

Đảm bảo tất cả current admins trong `admin_users` đều có rows trong `admin_scope_access` với UEHM scope **trước khi** enforcement được bật. Nếu enforcement bật mà không có rows → tất cả users bị block.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `supabase_migrations/051_seed_admin_scope_access_uehm.sql` | **TẠO MỚI** | Draft migration — chú thích rõ "staging first" |

> Nếu Slice 0 phát hiện cần schema alignment trước → số migration này có thể thay đổi (051 là schema align, 052 là seed).

### Database assumptions

- UEHM program đã có record trong `programs` table với code = `'uehm_mentoring'` (hoặc tương tự — verify từ Slice 0)
- `admin_users` có tất cả current active admins
- `admin_scope_access` có columns: `auth_user_id`, `program_id`, `role_in_program`, `is_active`

### Implementation steps

**Bước 1:** Xác định UEHM `program_id` từ kết quả Slice 0 (hoặc query lại).

**Bước 2:** Viết migration SQL với pattern:

```
-- Seed admin_scope_access cho tất cả active admins với UEHM scope
-- CHẠY TRÊN STAGING TRƯỚC
-- Chỉ insert nếu chưa có (ON CONFLICT DO NOTHING)

INSERT INTO admin_scope_access (auth_user_id, program_id, role_in_program, is_active, notes)
SELECT
  au.auth_user_id,
  '<UEHM_PROGRAM_ID_HERE>',     -- replace bằng UUID thực từ programs table
  au.role,                       -- copy global role làm role_in_program mặc định
  true,
  'Seeded from admin_users on 2026-05-07 — UEHM initial setup'
FROM admin_users au
WHERE au.status = 'active'
  AND au.role != 'super_admin'   -- super_admin không cần scope
  AND au.auth_user_id IS NOT NULL
ON CONFLICT (auth_user_id, program_id) DO NOTHING;
```

**Bước 3:** Thêm verification query cuối migration:

```sql
-- Verification: số rows vừa insert phải bằng số active non-super admins
SELECT COUNT(*) AS seeded_rows FROM admin_scope_access
WHERE program_id = '<UEHM_PROGRAM_ID_HERE>';

SELECT COUNT(*) AS expected_rows FROM admin_users
WHERE status = 'active' AND role != 'super_admin' AND auth_user_id IS NOT NULL;
```

**Bước 4:** Thêm rollback section:

```sql
-- ROLLBACK (chỉ chạy nếu cần undo):
-- DELETE FROM admin_scope_access
-- WHERE notes LIKE 'Seeded from admin_users on 2026-05-07%';
```

**Bước 5:** Apply trên **staging** trước. Verify counts. Sau đó apply production nếu staging pass.

**Lưu ý về unique constraint:** Nếu `admin_scope_access` chưa có unique constraint trên `(auth_user_id, program_id)` → thêm vào migration 051 trước khi seed:

```sql
-- Thêm vào đầu migration nếu constraint chưa có:
ALTER TABLE admin_scope_access
ADD CONSTRAINT admin_scope_access_user_program_unique
UNIQUE (auth_user_id, program_id);
```

### QA steps

1. Sau khi apply staging: `SELECT COUNT(*) FROM admin_scope_access` → phải khớp với số non-super active admins
2. Query sample rows: verify `role_in_program` đúng cho từng user
3. Login `qa-uehm` → `getAdminScopeContext()` phải thấy UEHM trong `programScopes`
4. Login `qa-super` → vẫn thấy `isSuperAdmin: true` (không bị ảnh hưởng bởi seed)

### Rollback concern

Migration có rollback section rõ ràng. `ON CONFLICT DO NOTHING` đảm bảo không duplicate. Nếu cần undo: dùng rollback section trong migration.

### Do-not-touch list

- Không sửa `admin_users` table
- Không thay đổi global roles của bất kỳ user nào
- Không apply migration lên production trước khi staging verify pass

### Gate để sang Slice 3

- [ ] Migration draft viết xong
- [ ] Apply staging: verified row counts đúng
- [ ] `qa-uehm` account: `getAdminScopeContext()` thấy UEHM scope
- [ ] Apply production sau khi staging pass và Core Team confirm

---

## Slice 3 — Scope `/events` (Simplest scoped page)

### Mục tiêu

`/events` chỉ hiện events thuộc seasons mà user có quyền. Đây là page đơn giản nhất vì `events` có `season_id` FK trực tiếp.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `lib/events.ts` | **SỬA** | Thêm `allowedSeasonIds` filter vào `getEventListData()` |
| `app/events/page.tsx` | **SỬA** | Gọi `getAdminScopeContext()`, truyền `allowedSeasonIds` vào data fetch |
| `app/events/[id]/attendance/page.tsx` | **SỬA** | Thêm guard: check `canAccessSeason()` |
| `app/events/[id]/edit/page.tsx` | **SỬA** | Thêm guard: check `canAccessSeason()` |
| `lib/program-scope.ts` | Chỉ đọc | Dùng helpers từ Slice 1 |

### Database assumptions

- `events.season_id` là FK → `seasons.id` (nullable — events không có season sẽ bị exclude khỏi scope filter)
- `seasons.program_id` là FK → `programs.id`

### Implementation steps

**Bước 1:** Sửa `lib/events.ts` — `getEventListData()`:

- Thêm optional parameter `allowedSeasonIds?: string[]`
- Nếu `allowedSeasonIds` được cung cấp và không rỗng → thêm `.in('season_id', allowedSeasonIds)` vào query events
- Nếu `allowedSeasonIds` rỗng nhưng user không phải super_admin → trả về events rỗng (no access)
- Nếu `allowedSeasonIds` không được cung cấp (undefined) → behavior hiện tại (không filter — backward compat)

**Bước 2:** Sửa `app/events/page.tsx`:

- Import `getAdminScopeContext`, `getAllowedSeasonIds` từ `lib/program-scope`
- Trong `EventsPage` server component:
  - Gọi `getAdminScopeContext()` → lấy `ctx`
  - Gọi `getAllowedSeasonIds(ctx)` → lấy `allowedSeasonIds`
  - Truyền `allowedSeasonIds` vào `getEventListData(allowedSeasonIds)` thay vì gọi không có tham số
- Season selector filter (`seasonOptions`) phải được tính từ seasons trong scope, không phải tất cả seasons
  - Hiện tại: `data.seasons.map(s => s.code)` — nếu `getEventListData` chỉ trả về seasons trong scope thì tự nhiên đúng

**Bước 3:** Sửa `app/events/[id]/attendance/page.tsx`:

- Thêm scope guard ở đầu: lấy event → lấy `event.season_id` → kiểm tra `canAccessSeason(ctx, event.season_id, allowedSeasonIds)`
- Nếu không có quyền → redirect `/events` hoặc throw 403

**Bước 4:** Sửa `app/events/[id]/edit/page.tsx`:

- Tương tự bước 3

**Bước 5:** Server actions trong `lib/events.ts` (create/update/attendance):

- Thêm scope check ở đầu mỗi mutation: lấy context → verify `canAccessSeason()`
- Create event: check `canAccessSeason` với season_id được submit

### Xử lý edge cases

| Case | Xử lý |
|------|-------|
| Event không có `season_id` (null) | Chỉ `super_admin` thấy. Non-super admins không thấy events không có season. |
| User không có scope nào | Trả về danh sách rỗng + hiển thị message "Bạn chưa được cấp quyền truy cập chương trình nào" |
| `qa-super` | Thấy tất cả events (no filter applied) |

### QA steps

Login với `qa-uehm`:
- [ ] `/events` chỉ hiện UEHM events (nếu có HAM events trong DB → không thấy)
- [ ] Season filter chỉ hiện UEHM seasons
- [ ] Cố tình truy cập `/events/[ham-event-id]/attendance` → redirect hoặc 403
- [ ] Tạo event mới với UEHM season → thành công
- [ ] Tạo event mới với HAM season (nếu có) → thất bại với error

Login với `qa-super`:
- [ ] `/events` hiện TẤT CẢ events
- [ ] Không bị restrict bởi scope filter

Login với `qa-viewer`:
- [ ] Thấy UEHM events (read scope)
- [ ] Button "Tạo sự kiện" ẩn (behavior hiện tại — không thay đổi)

Chạy: `npm run typecheck` + `npm run lint` + `npm run build` → phải PASS.

### Rollback concern

Nếu filter bị sai (VD: trả về rỗng cho super_admin): xóa `allowedSeasonIds` parameter khỏi `getEventListData()` call trong page — behavior về lại như cũ trong vài dòng.

### Do-not-touch list

- Không sửa `lib/data.ts`
- Không sửa `lib/matches.ts`
- Không sửa pages khác ngoài `/events`
- Không sửa `lib/admin-auth.ts`
- Không sửa `lib/permissions.ts`

### Gate để sang Slice 4

- [ ] `qa-uehm` chỉ thấy UEHM events
- [ ] `qa-super` thấy tất cả events
- [ ] Build PASS
- [ ] Không có regression trên `/events` cho users hiện tại

---

## Slice 4 — Scope `/people`, `/mentors`, `/mentees`

### Mục tiêu

People list và profile pages chỉ hiện persons liên quan đến programs user có quyền. Đây là page phức tạp hơn vì `people` không có FK trực tiếp đến `programs`.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `lib/data.ts` | **SỬA** | Sửa `getPeople()` để accept scope filter |
| `app/people/page.tsx` | **SỬA** | Thêm scope context |
| `app/people/[id]/page.tsx` | **SỬA** | Thêm scope guard |
| `app/mentors/page.tsx` | **SỬA** | Thêm scope filter |
| `app/mentees/page.tsx` | **SỬA** | Thêm scope filter |
| `app/mentors/[id]/edit/page.tsx` | **SỬA** | Thêm scope guard |
| `app/mentees/[id]/edit/page.tsx` | **SỬA** | Thêm scope guard |

### Database assumptions

Cần chọn strategy để join `people` với `programs`. Hai options:

**Option A — Qua `applications`:**
- `applications.intake_batch_id` → `intake_batches.program_id`
- Lấy people có application trong allowed programs

**Option B — Qua `matches` + `seasons`:**
- `matches.season_id` → `seasons.program_id`
- Lấy people là mentor/mentee trong allowed seasons

**Khuyến nghị cho MVP:** Dùng **union của cả hai** để không miss người nào. Nếu quá phức tạp → bắt đầu với Option B (matches), vì matches là data chính.

### Implementation steps

**Bước 1:** Sửa `lib/data.ts` — `getPeople()`:

- Thêm optional parameter `allowedSeasonIds?: string[]`
- Nếu `allowedSeasonIds` được cung cấp:
  - **Option B (MVP):** Lấy `person_id` từ `matches` WHERE `season_id IN (allowedSeasonIds)` → lấy UNION của `mentor_person_id` và `mentee_person_id` → filter `people` WHERE `id IN (personIds)`
  - Hoặc: Dùng subquery/join nếu Supabase SDK hỗ trợ hiệu quả hơn
- Nếu `allowedSeasonIds` không được cung cấp → behavior hiện tại

**Bước 2:** Sửa `app/people/page.tsx`:

- Import và call `getAdminScopeContext()` + `getAllowedSeasonIds()`
- Truyền `allowedSeasonIds` vào `getPeople(allowedSeasonIds)`

**Bước 3:** Sửa `app/people/[id]/page.tsx`:

- Lấy person detail → check xem person có liên quan đến bất kỳ allowed season nào không
- Nếu không → redirect `/people` hoặc show 403

**Bước 4:** `/mentors/page.tsx` và `/mentees/page.tsx`:

- Hiện tại các page này call gì? Cần đọc để biết data fetch function.
- Pattern tương tự: thêm `allowedSeasonIds` filter vào data fetch function tương ứng

**Bước 5:** Edit pages (`/mentors/[id]/edit`, `/mentees/[id]/edit`):

- Check scope trước khi cho edit
- Role check: chỉ `core_team`, `admin` mới có thể edit (behavior hiện tại — giữ nguyên)

### Xử lý edge cases

| Case | Xử lý |
|------|-------|
| Person không có match và không có application | Chỉ `super_admin` thấy. Đây là "orphan records". |
| Person có cả UEHM match và HAM application | Thấy nếu user có quyền ở ít nhất một trong hai |
| Empty list | Hiện thị "Không có dữ liệu trong phạm vi quyền của bạn" thay vì "Chưa có người nào" |

### QA steps

Login với `qa-uehm`:
- [ ] `/people` chỉ hiện persons liên quan UEHM
- [ ] `/people/[uehm-person-id]` load được
- [ ] Cố tình truy cập `/people/[ham-person-id]` → redirect hoặc 403 (chỉ có thể test sau khi HAM data có)

Login với `qa-super`:
- [ ] `/people` hiện tất cả persons

Chạy: `npm run typecheck` + `npm run lint` + `npm run build` → phải PASS.

### Rollback concern

`getPeople()` có thêm optional parameter — nếu không truyền → behavior cũ. Rollback: xóa `allowedSeasonIds` call trong page components.

### Do-not-touch list

- Không sửa `lib/events.ts`
- Không sửa `lib/matches.ts`
- Không sửa `/applications`, `/reviews`, `/interviews` pages
- Không sửa `people-create.ts` (create flow — giữ nguyên)

### Gate để sang Slice 5

- [ ] `qa-uehm` chỉ thấy UEHM people
- [ ] `qa-super` thấy tất cả
- [ ] Build PASS
- [ ] Không có regression trên `/mentors` và `/mentees`

---

## Slice 5 — Scope `/matches`

### Mục tiêu

`/matches` chỉ hiện matches trong seasons user có quyền. Đây là page đơn giản hơn `/people` vì `matches` có `season_id` FK trực tiếp.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `lib/matches.ts` | **SỬA** | Thêm scope filter vào `getMatchList()` |
| `app/matches/page.tsx` | **SỬA** | Thêm scope context |
| `app/matches/[id]/page.tsx` | **SỬA** | Thêm scope guard |

### Database assumptions

- `matches.season_id` là FK → `seasons.id`

### Implementation steps

**Bước 1:** Đọc `lib/matches.ts` — tìm `getMatchList()` function.

- Thêm optional `allowedSeasonIds?: string[]` vào parameter
- Nếu cung cấp → thêm `.in('season_id', allowedSeasonIds)` vào query
- `getManualMatchingCandidates()`: cũng cần scope filter tương tự

**Bước 2:** Sửa `app/matches/page.tsx`:

- Lấy scope context
- Truyền `allowedSeasonIds` vào `getMatchList()`

**Bước 3:** Sửa `app/matches/[id]/page.tsx`:

- Guard: lấy match → check `canAccessSeason(ctx, match.season_id, allowedSeasonIds)`

**Bước 4:** Server actions trong `lib/matches.ts` (create match, cancel match):

- Thêm scope + role check: user phải có `core_team` hoặc `admin` role trong program của season đó
- Pattern: lấy `ctx` → `getRoleInProgram(ctx, programId)` → check role level

### QA steps

Login với `qa-uehm`:
- [ ] `/matches` chỉ hiện UEHM matches
- [ ] Tạo match trong UEHM season → thành công
- [ ] Hủy UEHM match → thành công

Login với `qa-viewer`:
- [ ] `/matches` hiện UEHM matches (read scope)
- [ ] Không có button tạo/hủy match (behavior hiện tại — giữ nguyên)

Chạy: `npm run typecheck` + `npm run lint` + `npm run build` → phải PASS.

### Rollback concern

Tương tự Slice 3: `allowedSeasonIds` là optional parameter. Xóa call trong page → behavior cũ.

### Do-not-touch list

- Không sửa `/events`, `/people` pages (đã done)
- Không sửa `/applications`, `/reviews`, `/interviews`

### Gate để sang Slice 6

- [ ] `qa-uehm` chỉ thấy UEHM matches
- [ ] `qa-super` thấy tất cả matches
- [ ] Create + cancel match vẫn hoạt động cho authorized users
- [ ] Build PASS

---

## Slice 6 — Scope Dashboard + Operations Fallback Paths

### Mục tiêu

Dashboard home (`app/page.tsx`) và `/operations` chỉ hiện KPIs của seasons user có quyền. Season selector chỉ hiện seasons trong scope.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `app/page.tsx` | **SỬA** | Thêm scope filter cho KPI computation |
| `app/operations/page.tsx` | **SỬA** | Thêm scope filter |
| `lib/data.ts` | **SỬA** | Sửa `getOperationsDashboardKpis()` để accept scope |

### Database assumptions

- `computeOperationsDashboardKpis()` hiện nhận `matches`, `recaps`, `events`, `eventParticipations` là tất cả rows
- Cần pass scope-filtered data vào hàm này thay vì all data

### Implementation steps

**Bước 1:** Đọc `lib/data.ts` — `getOperationsDashboardKpis()` và `computeOperationsDashboardKpis()`:

- Hiện tại: load ALL seasons, matches, recaps, events, participations
- Cần: filter theo `allowedSeasonIds` trước khi load hoặc sau khi load

**Bước 2:** Sửa `lib/data.ts`:

- Thêm optional `allowedSeasonIds?: string[]` vào `getOperationsDashboardKpis()`
- Apply filter: `WHERE season_id IN (allowedSeasonIds)` cho recaps, matches, events, participations
- Filter `seasons`: chỉ trả về seasons trong `allowedSeasonIds`

**Bước 3:** Sửa `app/page.tsx` (dashboard):

- Lấy `ctx = getAdminScopeContext()`
- Lấy `allowedSeasonIds = getAllowedSeasonIds(ctx)`
- Truyền vào `getOperationsDashboardKpis(allowedSeasonIds)`

**Bước 4:** Season selector fallback logic:

- Hiện tại: `selectedMonth` được compute từ tất cả available months
- Sau scope: `selectedMonth` phải nằm trong một season user có quyền
- Nếu `lastSelectedSeason` (từ URL param) không trong scope → auto-select season đầu tiên trong scope

**Bước 5:** Xử lý trường hợp user không có scope:

- `allowedSeasonIds` rỗng (non-super user chưa có scope) → hiện message "Bạn chưa được cấp quyền truy cập chương trình nào. Liên hệ admin để được cấp quyền."
- Không crash, không infinite loading

**Bước 6:** Sửa `/operations/page.tsx` — tương tự `app/page.tsx`.

### QA steps

Login với `qa-uehm`:
- [ ] Dashboard chỉ hiện UEHM KPIs (recap count, attendance từ UEHM seasons)
- [ ] Season selector chỉ hiện UEHM seasons
- [ ] KPIs so sánh với giá trị baseline (phải khớp với UEHM data hiện có)

Login với `qa-super`:
- [ ] Dashboard hiện tất cả KPIs (UEHM + HAM khi có)
- [ ] Season selector hiện tất cả seasons

Chạy: `npm run typecheck` + `npm run lint` + `npm run build` → phải PASS.

**Critical regression test:** KPIs cho `qa-super` và `qa-uehm` phải giống nhau **trong giai đoạn hiện tại** (vì chỉ có UEHM data) — nếu khác nhau → có bug.

### Rollback concern

`getOperationsDashboardKpis()` có optional parameter — xóa call trong pages → behavior cũ.

### Do-not-touch list

- Không sửa `/operations/intelligence` (founder dashboard — ngoài scope MVP)
- Không sửa `/operations/monthly`, `/operations/tasks`

### Gate để sang Slice 7

- [ ] Dashboard KPIs đúng cho cả `qa-uehm` và `qa-super`
- [ ] Season selector scoped đúng
- [ ] Không có zero-KPI regression (Sprint 1B failure mode)
- [ ] Build PASS

---

## Slice 7 — Scope `/applications`, `/reviews`, `/interviews` + Server Action Guards

### Mục tiêu

Application pipeline và tất cả server actions (writes) có scope + role check. Đây là slice cuối trước khi HAM staging import được unblock.

### Files được tạo/sửa

| File | Hành động | Ghi chú |
|------|----------|---------|
| `lib/data.ts` | **SỬA** | Thêm scope filter vào application queries |
| `app/applications/page.tsx` | **SỬA** | Scope filter |
| `app/applications/[id]/page.tsx` | **SỬA** | Scope guard |
| `app/reviews/page.tsx` | **SỬA** | Scope filter (follows applications) |
| `app/reviews/[id]/page.tsx` | **SỬA** | Scope guard |
| `app/interviews/page.tsx` | **SỬA** | Scope filter |
| `lib/application-decisions.ts` | **SỬA** | Scope + role guard |
| `lib/bulk-assignment.ts` | **SỬA** | Scope + role guard |
| `lib/application-reviews.ts` | **SỬA** | Scope + role guard |
| `lib/admin-corrections.ts` | **SỬA** | Scope + role guard |
| `lib/matches.ts` (write actions) | **SỬA** | Scope + role guard (đã đề cập Slice 5) |
| `lib/events.ts` (write actions) | **SỬA** | Scope + role guard (đã đề cập Slice 3) |

### Database assumptions

- `applications.intake_batch_id` → `intake_batches.id`
- `intake_batches.program_id` → `programs.id`
- Nếu `applications` không có `intake_batch_id` hoặc `intake_batches` không có `program_id` → cần verify schema trước

### Implementation steps

**Bước 1:** Scope `/applications`:

- Lấy `allowedProgramIds` từ context
- Query applications: join với `intake_batches` → filter `WHERE intake_batches.program_id IN (allowedProgramIds)`
- Hoặc: lấy allowed `intake_batch_id` list trước, rồi filter applications

**Bước 2:** Scope `/reviews`:

- Reviews phụ thuộc vào applications → filter reviews WHERE `application_id IN (scopedApplicationIds)`
- Reviewer vẫn chỉ thấy reviews được assigned cho họ (behavior hiện tại — giữ nguyên)

**Bước 3:** Scope `/interviews`:

- Tương tự reviews — filter theo applications trong scope

**Bước 4:** Server action guards — pattern chung:

Với mỗi server action (create/update/delete):
1. Gọi `getAdminScopeContext()` → lấy `ctx`
2. Xác định `programId` liên quan đến action (từ request data)
3. Gọi `requireProgramAccess(ctx, programId)` → throw nếu không có quyền
4. Gọi `getRoleInProgram(ctx, programId)` → check role đủ không
5. Proceed với business logic

**Bước 5:** Admin corrections (`lib/admin-corrections.ts`):

- Recap correction: lấy `recap.season_id` → lấy `season.program_id` → check access

**Bước 6:** Bulk assignment (`lib/bulk-assignment.ts`):

- Lấy applications' program_ids → check tất cả đều trong allowed scope

### Xử lý edge cases

| Case | Xử lý |
|------|-------|
| Application không có `intake_batch_id` | Chỉ `super_admin` thấy |
| `intake_batches` không có `program_id` | Log error, treat as no-access cho non-super |
| Bulk assign mixed programs (UEHM + HAM) | Block nếu user không có access cả hai |

### QA steps

Login với `qa-uehm`:
- [ ] `/applications` chỉ hiện UEHM applications
- [ ] `/reviews` chỉ hiện UEHM reviews
- [ ] Giao review cho UEHM application → thành công
- [ ] Cố tình giao review cho HAM application (nếu có) → fail với error

Login với `qa-viewer` (UEHM):
- [ ] `/applications` → load nhưng không có edit buttons (role check hiện tại)

Server actions:
- [ ] `createEvent(hamSeasonId)` từ UEHM-only account → error
- [ ] `createMatch(hamSeasonId)` từ UEHM-only account → error
- [ ] `adminDecision(hamApplicationId)` từ UEHM-only account → error

Chạy: `npm run typecheck` + `npm run lint` + `npm run build` → phải PASS.

### Rollback concern

Server action guards là additive (thêm check ở đầu). Nếu guard sai: comment out guard → behavior cũ.

### Do-not-touch list

- Không sửa `lib/enable-reviewer.ts` (reviewer management — separate concern)
- Không sửa `/admin/users` page
- Không sửa `lib/application-approvals.ts` chưa (approve as mentor/mentee — để Phase 2)

### Gate: HAM Staging Import Unblock

Sau khi Slice 7 pass:
- [ ] Tất cả pages: Slices 3–7 pass QA
- [ ] Tất cả server actions có scope guard
- [ ] `qa-uehm` không thể accidentally write vào HAM data
- [ ] `qa-super` vẫn có full access
- [ ] Build PASS
- [ ] Core Team sign-off

---

## Tổng hợp: Dependency Chain và Timeline

```
Slice 0: Schema verification (read-only, 30 phút)
    ↓
Slice 1: lib/program-scope.ts helpers (½ ngày)
    ↓
Slice 2: Seed admin_scope_access — UEHM admins (migration + 1-2 giờ)
    ↓ (có thể làm song song Slices 3–5)
Slice 3: /events scoped (½ ngày)
Slice 4: /people, /mentors, /mentees scoped (1 ngày)
Slice 5: /matches scoped (½ ngày)
    ↓
Slice 6: Dashboard + Operations scoped (½ ngày)
    ↓
Slice 7: /applications, /reviews, /interviews + server action guards (1–1.5 ngày)
    ↓
HAM Staging Import Unblock → HAM Production Import (separate checklist)
```

**Total estimate:** 4–5 ngày dev, mỗi slice là 1 PR độc lập.

---

## Kiểm tra cuối cùng: Những gì KHÔNG được làm trong toàn bộ package này

| KHÔNG làm | Lý do |
|-----------|-------|
| Import HAM data (staging hay production) | Chưa đủ điều kiện — phải hoàn thành Slice 7 trước |
| Enable RLS | Riêng biệt với program-scoped access — sẽ xử lý sau |
| Sửa tất cả files cùng lúc (big-bang) | Mỗi slice là một PR độc lập |
| Suy luận scope từ mentor/mentee profile | Scope phải từ `admin_scope_access` |
| Hardcode program_id hay season_id | Luôn query từ DB |
| Apply migration lên production trước staging | Staging luôn trước |
| Merge slice có build fail | Build phải PASS trước mỗi merge |

---

*VAM OS Program-Scoped Access — Codex Implementation Package — 07/05/2026*
*Không chứa code implement. Không chứa data. Internal use only.*
