# VAM OS — Program-Scoped Access MVP Blueprint

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Trạng thái** | Blueprint — chờ implementation |
| **Blocker của** | HAM staging import · HAM production import · Mentor/Mentee portal |
| **Phụ thuộc** | Migration 047 done · `admin_scope_access` table exists in DB |

---

## Tại sao cần document này

VAM OS ngày càng mở rộng sang nhiều chương trình: hiện có **UEHM Mentoring** và sắp có **HAM Mentoring**. Một admin UEHM không được phép thấy data của HAM, và ngược lại — dù cả hai đều có role `admin` trong hệ thống. Tính năng program-scoped access giải quyết vấn đề này ở app layer, trước khi RLS được triển khai đầy đủ.

**Câu hỏi cốt lõi mà blueprint này trả lời:**
> "User này được phép thấy data của program nào và season nào — và với quyền gì?"

---

## Phần 1 — Access Principles (Nguyên tắc phân quyền)

### 1.1 Nguyên tắc nền tảng

| # | Nguyên tắc | Giải thích |
|---|-----------|-----------|
| P1 | **Super admin bypass** | `super_admin` không cần scope — thấy tất cả programs và seasons. Không có rows trong `admin_scope_access` cho super_admin, hoặc có một row đặc biệt `all_access = true`. |
| P2 | **Scope từ access table, không từ data** | Quyền truy cập một program KHÔNG được suy ra từ việc user có mentor/mentee profile trong program đó. Phải explicit từ `admin_scope_access`. |
| P3 | **Role per program** | Một user có thể có role khác nhau trong từng program. VD: `core_team` trong UEHM, `reviewer` trong HAM. Role trong `admin_scope_access` quyết định quyền hạn trong phạm vi program đó. |
| P4 | **Multi-program access** | Một user có thể được cấp quyền vào nhiều programs. Mỗi program–role là một record riêng. |
| P5 | **No scope = No access** | User không có row trong `admin_scope_access` (và không phải super_admin) không được thấy bất kỳ program data nào. Không fallback về "xem tất cả". |
| P6 | **App layer first** | Scope enforcement phải ở app layer (helper functions trong server components) trước. RLS là lớp bổ sung sau. |
| P7 | **Season scope từ program scope** | Nếu user có quyền vào program X, họ có quyền vào tất cả seasons thuộc program X — trừ khi có giới hạn season cụ thể. |
| P8 | **Default deny** | Mọi page/action phải filter theo allowed scope. Không có page nào được load toàn bộ data rồi filter sau ở UI. |

### 1.2 Quyết định thiết kế quan trọng

**Câu hỏi:** Global role hay per-program role?

**Quyết định cho MVP:** **Per-program role** trong `admin_scope_access` là nguồn sự thật chính cho scope + quyền trong từng program. `admin_users.role` vẫn giữ nhưng chỉ dùng cho:
- Xác định `super_admin` (bypass toàn bộ scope)
- Backward compatibility trong các tính năng không liên quan đến program scope (VD: `/admin/users`, login flow)

Khi một user truy cập một trang liên quan đến program data, hệ thống dùng role từ `admin_scope_access` cho program đó — không dùng `admin_users.role`.

---

## Phần 2 — Data Model: `admin_scope_access`

### 2.1 Schema đề xuất

Bảng `admin_scope_access` hiện đã tồn tại trong DB nhưng schema chưa được verify từ repo. Blueprint này đề xuất schema sau — cần so sánh với schema thực tế trước khi implement.

| Column | Type | Nullable | Mô tả |
|--------|------|---------|-------|
| `id` | uuid | NOT NULL | PK, gen_random_uuid() |
| `auth_user_id` | uuid | NOT NULL | FK → Supabase Auth user (không phải admin_users.id) |
| `program_id` | uuid | NOT NULL | FK → programs.id |
| `role_in_program` | text | NOT NULL | Role của user trong program này: `core_team`, `admin`, `support_team`, `reviewer`, `viewer` |
| `season_ids` | uuid[] | NULL | Nếu null = access tất cả seasons của program. Nếu có array = chỉ access seasons trong array. |
| `is_active` | boolean | NOT NULL, default true | Tạm vô hiệu hóa mà không xóa row |
| `granted_by` | uuid | NULL | auth_user_id của người cấp quyền (audit trail) |
| `granted_at` | timestamptz | NOT NULL, default now() | Thời điểm cấp quyền |
| `notes` | text | NULL | Ghi chú lý do cấp quyền |

**Unique constraint:** `(auth_user_id, program_id)` — một user chỉ có một role trong mỗi program.

### 2.2 Ví dụ rows minh họa

| User | program_id | role_in_program | season_ids | Ý nghĩa |
|------|-----------|----------------|-----------|---------|
| Anh A | UEHM-uuid | `core_team` | NULL | Anh A là core_team của UEHM, thấy tất cả seasons UEHM |
| Anh A | HAM-uuid | `core_team` | NULL | Anh A cũng là core_team của HAM |
| Chị B | UEHM-uuid | `reviewer` | [S11-uuid, S12-uuid] | Chị B là reviewer chỉ trong S11 và S12 của UEHM |
| Chị B | HAM-uuid | `viewer` | NULL | Chị B là viewer của HAM (toàn bộ) |
| Anh C | UEHM-uuid | `support_team` | NULL | Anh C chỉ có quyền trong UEHM |
| — | — | — | — | Anh C không thấy HAM data (không có row HAM) |

### 2.3 Quan hệ với bảng khác

```
admin_scope_access
    ├── auth_user_id → (Supabase Auth) → admin_users.auth_user_id
    ├── program_id   → programs.id
    └── season_ids[] → seasons.id (array FK — referential integrity phải enforce ở app layer)

programs.id
    └── seasons.program_id → seasons (mỗi season thuộc 1 program)
                └── matches.season_id
                └── events.season_id
                └── mentoring_recaps.season_id
                └── event_participations.season_id

programs.id
    └── intake_batches.program_id → intake_batches
                └── applications.intake_batch_id
```

---

## Phần 3 — Helper Functions

Tất cả helper functions dưới đây là **server-only**. Không gọi từ client components. Nên đặt trong file mới: `lib/program-scope.ts` (hoặc tương tự).

### 3.1 `getCurrentAdminContext()`

**Mục đích:** Lấy toàn bộ context của user hiện tại — global role + danh sách program scopes.

**Input:** Không cần tham số (đọc từ auth session).

**Output:**

```
{
  authUserId: string
  globalRole: string          // từ admin_users.role
  isSuperAdmin: boolean       // globalRole === 'super_admin'
  programScopes: [
    {
      programId: string
      programCode: string      // 'uehm_mentoring', 'ham_mentoring'
      roleInProgram: string
      allowedSeasonIds: string[] | null  // null = tất cả seasons
    }
  ]
}
```

**Logic:**
1. Lấy Supabase Auth user từ server session (cookie)
2. Lookup `admin_users` bằng `auth_user_id` → lấy `globalRole`
3. Nếu `globalRole === 'super_admin'` → return với `isSuperAdmin: true`, `programScopes: []` (bypass)
4. Lookup `admin_scope_access` WHERE `auth_user_id = current` AND `is_active = true`
5. Join với `programs` để lấy `program_code`
6. Return đầy đủ context

**Caching:** Context này được gọi nhiều lần trong một request. Dùng React `cache()` hoặc pattern tương tự để không query DB nhiều lần per request.

---

### 3.2 `getAllowedProgramIds()`

**Mục đích:** Trả về danh sách program_ids mà user hiện tại có quyền truy cập.

**Output:** `string[]` — mảng program UUIDs.

**Logic:**
- Nếu `isSuperAdmin` → trả về tất cả program_ids (query `programs` table)
- Ngược lại → trả về `programScopes.map(s => s.programId)`
- Nếu mảng rỗng → user không có quyền vào program nào → throw hoặc redirect

**Dùng ở đâu:** Bất kỳ page nào cần filter data theo program.

---

### 3.3 `getAllowedSeasonIds()`

**Mục đích:** Trả về danh sách season_ids mà user hiện tại có quyền truy cập.

**Output:** `string[]` — mảng season UUIDs.

**Logic:**
- Nếu `isSuperAdmin` → query tất cả seasons, return tất cả IDs
- Ngược lại → với mỗi scope trong `programScopes`:
  - Nếu `allowedSeasonIds === null` → query tất cả seasons của `programId` đó, thêm vào result
  - Nếu `allowedSeasonIds` có array → thêm array đó vào result
- Deduplicate, return

**Dùng ở đâu:** Filter cho `matches`, `events`, `mentoring_recaps`, `event_participations`, `/people` (qua match lookup).

---

### 3.4 `canAccessProgram(programId)`

**Mục đích:** Kiểm tra user có quyền truy cập một program cụ thể không.

**Input:** `programId: string`

**Output:** `boolean`

**Logic:**
- Nếu `isSuperAdmin` → `true`
- Ngược lại → kiểm tra `programId` có trong `getAllowedProgramIds()` không

**Dùng ở đâu:** Trước khi hiển thị detail page của một program cụ thể, hoặc khi filter dropdown "chọn program".

---

### 3.5 `canAccessSeason(seasonId)`

**Mục đích:** Kiểm tra user có quyền truy cập một season cụ thể không.

**Input:** `seasonId: string`

**Output:** `boolean`

**Logic:**
- Nếu `isSuperAdmin` → `true`
- Ngược lại → kiểm tra `seasonId` có trong `getAllowedSeasonIds()` không

**Dùng ở đâu:** Trước khi load detail của season, hoặc check khi user chọn season trong dashboard.

---

### 3.6 `requireProgramScope(programId?)`

**Mục đích:** Guard function — throw hoặc redirect nếu user không có quyền. Dùng ở đầu server components và server actions.

**Input:** `programId?: string` (nếu null → chỉ check user có ít nhất 1 program scope không)

**Output:** Không return gì. Throw `UNAUTHORIZED` hoặc redirect nếu không có quyền.

**Logic:**
- Nếu `isSuperAdmin` → pass qua (không làm gì)
- Nếu `programId` được cung cấp → check `canAccessProgram(programId)` → nếu false → redirect `/403`
- Nếu không có `programId` → check `getAllowedProgramIds().length > 0` → nếu rỗng → redirect `/403`

**Dùng ở đâu:** Đầu mỗi server component và server action quan trọng.

---

### 3.7 `getRoleInProgram(programId)`

**Mục đích:** Trả về role của user trong một program cụ thể — để dùng cho permission checks trong context của program đó.

**Input:** `programId: string`

**Output:** `string | null` — role hoặc null nếu không có quyền

**Logic:**
- Nếu `isSuperAdmin` → return `'super_admin'`
- Ngược lại → tìm scope có `programId` trong `programScopes`, return `roleInProgram`
- Nếu không tìm thấy → return `null`

**Dùng ở đâu:** Khi cần biết user có quyền gì trong một program cụ thể (VD: reviewer trong HAM có thể submit review, nhưng viewer trong UEHM thì không).

---

## Phần 4 — Pages Cần Scope Trước

### 4.1 Thứ tự ưu tiên implement

| Priority | Page | Lý do ưu tiên | Scope mechanism |
|---------|------|--------------|----------------|
| 🔴 P0 | Home Dashboard (`/`) | Cao nhất — đây là trang đầu tiên user thấy; KPIs phải đúng theo scope | Filter by allowed seasonIds |
| 🔴 P0 | `/operations` | Dashboard chi tiết — cùng data source | Filter by allowed seasonIds |
| 🔴 P0 | `/events` | Đơn giản nhất — events có `season_id` FK trực tiếp | Filter by allowed seasonIds |
| 🟠 P1 | `/matches` | Matches có `season_id` FK trực tiếp | Filter by allowed seasonIds |
| 🟠 P1 | `/mentors` | mentor_profiles → matches → season_id | Join qua allowed seasonIds |
| 🟠 P1 | `/mentees` | mentee_profiles → matches → season_id | Join qua allowed seasonIds |
| 🟠 P1 | `/people` | Phức tạp nhất — people không có program FK trực tiếp | Join qua matches hoặc applications |
| 🟡 P2 | `/applications` | applications → intake_batch → program_id | Filter by allowed programIds |
| 🟡 P2 | `/reviews` | Phụ thuộc vào applications scope | Follows applications scope |
| 🟡 P2 | `/interviews` | Phụ thuộc vào applications scope | Follows applications scope |

### 4.2 Chi tiết từng trang

#### Home Dashboard và `/operations`

**Điểm cần scope:**
- Season selector: chỉ hiện seasons mà user có quyền truy cập
- KPIs: recap count, attendance, active mentors/mentees — tất cả phải filter theo `allowedSeasonIds`
- "Tháng được chọn" phải nằm trong một season user có quyền

**Fallback path cần xử lý:**
- Nếu season đang chọn không nằm trong `allowedSeasonIds` → auto-switch sang season đầu tiên user có quyền
- Nếu user không có season nào → hiển thị "Bạn chưa được cấp quyền truy cập chương trình nào"

---

#### `/events`

**Điểm cần scope:**
- List events: `WHERE season_id IN (allowedSeasonIds)`
- Event detail page: check `canAccessSeason(event.season_id)` → nếu false → 403
- Attendance update action: cần check season scope trước khi write

---

#### `/matches`

**Điểm cần scope:**
- List matches: `WHERE season_id IN (allowedSeasonIds)`
- Match detail: check `canAccessSeason(match.season_id)`
- Create/cancel match action: cần check season scope + role trong program

---

#### `/mentors` và `/mentees`

**Điểm cần scope:**
- `mentor_profiles` và `mentee_profiles` không có `season_id` trực tiếp
- Scope thông qua: chỉ hiện profiles có ít nhất 1 match trong `allowedSeasonIds`
- Hoặc: chỉ hiện profiles được approved qua `applications` trong `allowedProgramIds`
- **MVP recommendation:** Scope qua applications (applications có `intake_batch_id` → `program_id`) vì đây là nguồn data sạch hơn

---

#### `/people`

**Đây là page phức tạp nhất vì people không có FK trực tiếp đến program.**

**Hai cách scope:**

| Cách | Logic | Pros | Cons |
|------|-------|------|------|
| **A — qua matches** | Hiện people có `person_id` trong matches thuộc `allowedSeasonIds` | Đơn giản | Có thể miss người chưa được match |
| **B — qua applications** | Hiện people có application trong `allowedProgramIds` | Chính xác hơn cho ứng viên | Phức tạp hơn, cần join nhiều |
| **C — union A + B** | Hiện people thỏa A hoặc B | Đầy đủ nhất | Query phức tạp nhất |

**MVP recommendation:** Dùng cách C (union) để không miss người. Nếu quá phức tạp → bắt đầu với cách A, refine sau.

---

#### `/applications`

**Điểm cần scope:**
- `applications` → `intake_batch_id` → `intake_batches.program_id`
- List: `WHERE intake_batch.program_id IN (allowedProgramIds)`
- Detail: check `canAccessProgram(application.intake_batch.program_id)`

---

#### `/reviews` và `/interviews`

**Follows applications scope:**
- Reviews chỉ hiện nếu application tương ứng nằm trong allowed programs
- Interviewer chỉ thấy interviews của applications trong allowed programs
- Reviewer chỉ thấy reviews được giao — nhưng cũng phải trong allowed programs (double-check)

---

## Phần 5 — Server Actions Cần Role + Scope Checks

Dưới đây là các server actions (write paths) cần được bổ sung scope check. Thứ tự từ quan trọng nhất.

| Server Action | File | Scope Check cần thêm | Role Check cần thêm |
|--------------|------|---------------------|---------------------|
| Tạo/edit event | `lib/events.ts` | `canAccessSeason(event.season_id)` | `core_team`, `admin`, `support_team` trong program đó |
| Mark attendance | `lib/events.ts` | `canAccessSeason(event.season_id)` | `core_team`, `admin`, `support_team` |
| Tạo match | `lib/matches.ts` | `canAccessSeason(season_id)` | `core_team`, `admin` |
| Hủy/update match | `lib/matches.ts` | `canAccessSeason(match.season_id)` | `core_team`, `admin` |
| Tạo recap (admin) | `lib/admin-corrections.ts` | `canAccessSeason(recap.season_id)` | `core_team`, `admin`, `support_team` |
| Edit recap | `lib/admin-corrections.ts` | `canAccessSeason(recap.season_id)` | `core_team`, `admin` |
| Admin decision | `lib/application-decisions.ts` | `canAccessProgram(application.program_id)` | `core_team`, `admin` |
| Assign reviewer | `lib/bulk-assignment.ts` | `canAccessProgram(application.program_id)` | `core_team`, `admin` |
| Submit review | `lib/application-reviews.ts` | `canAccessProgram(application.program_id)` | `reviewer` (và được assigned) |
| Self-claim interview | `lib/interview-claim.ts` | `canAccessProgram(application.program_id)` | `interviewer` (future) |
| Approve as mentor/mentee | `lib/application-approvals.ts` | `canAccessProgram(application.program_id)` | `core_team`, `admin` |

**Quy tắc chung cho tất cả server actions:**

1. Gọi `getCurrentAdminContext()` đầu tiên
2. Check `requireProgramScope(programId)` — throw nếu không có quyền
3. Check role trong program (`getRoleInProgram()`) — throw nếu role không đủ
4. Proceed với write

---

## Phần 6 — Thin-Slice Implementation Plan

### Tiêu chí thin-slice

Mỗi slice phải:
- Deliverable và testable độc lập
- Không break tính năng hiện có
- Unblock một milestone cụ thể

---

### Slice 0 — Schema Verification (Prerequisite, không viết code)

**Mục tiêu:** Biết chính xác `admin_scope_access` schema hiện tại.

**Việc cần làm:**
1. Chạy SQL query trong Supabase SQL Editor để lấy columns, types, constraints
2. So sánh với schema đề xuất trong Phần 2.1 của document này
3. Ghi lại gaps (columns thiếu, columns thừa, tên khác)
4. Quyết định: dùng schema hiện có hay cần migration để align?

**Output:** Một bảng so sánh "đề xuất vs. thực tế" → quyết định có cần migration 051 không.

**Thời gian estimate:** 30 phút (read-only).

**Gate:** Phải xong trước khi viết bất kỳ code nào liên quan đến `admin_scope_access`.

---

### Slice 1 — Helper Functions Core (không có UI)

**Mục tiêu:** Implement 3 hàm nền tảng: `getCurrentAdminContext()`, `getAllowedProgramIds()`, `getAllowedSeasonIds()`.

**Việc cần làm:**
1. Tạo `lib/program-scope.ts` (server-only)
2. Implement `getCurrentAdminContext()` — query `admin_users` + `admin_scope_access` + `programs`
3. Implement `getAllowedProgramIds()` — dùng context từ bước trên
4. Implement `getAllowedSeasonIds()` — query `seasons` WHERE `program_id IN allowedProgramIds`
5. Unit test thủ công: login với từng test account, verify output

**Không thay đổi bất kỳ page nào trong slice này.**

**Gate:** Các hàm trả về đúng data cho từng test account trong QA matrix (Phần 7).

---

### Slice 2 — Seed `admin_scope_access` Rows cho Current Admins

**Mục tiêu:** Đảm bảo current admins có rows trong `admin_scope_access` trước khi enforcement bật.

**Việc cần làm:**
1. Liệt kê tất cả users trong `admin_users` (không phải super_admin)
2. Assign mỗi user vào UEHM program (vì đó là program duy nhất có data hiện tại)
3. Role trong `admin_scope_access` = role hiện tại trong `admin_users` (copy)
4. `season_ids = NULL` (access tất cả seasons UEHM)

**Quan trọng:** Slice này phải xong TRƯỚC khi enforcement bật. Nếu bật enforcement mà chưa có rows → tất cả user bị block.

**Gate:** Đếm rows trong `admin_scope_access`: phải bằng số users trong `admin_users` trừ super_admin.

---

### Slice 3 — Home Dashboard + Operations Scope

**Mục tiêu:** Dashboard KPIs phản ánh đúng scope của user.

**Việc cần làm:**
1. Tích hợp `getAllowedSeasonIds()` vào data fetch của dashboard
2. Season selector chỉ hiện seasons trong allowed scope
3. Tất cả KPIs filter theo `allowedSeasonIds`
4. Fallback: nếu season đang chọn không trong scope → auto-select season đầu tiên có quyền

**Gate:** Login với UEHM-only account → chỉ thấy UEHM seasons và KPIs. Login với super_admin → thấy tất cả.

---

### Slice 4 — Events + Matches Scope

**Mục tiêu:** `/events` và `/matches` chỉ hiện data trong allowed scope.

**Việc cần làm:**
1. Thêm scope filter vào `getEvents()` và `getMatches()` trong `lib/data.ts`
2. Event detail: guard với `canAccessSeason()`
3. Match detail: guard với `canAccessSeason()`

**Gate:** UEHM-only account không thấy events/matches của HAM.

---

### Slice 5 — People, Mentors, Mentees Scope

**Mục tiêu:** Profile lists được filter theo program scope.

**Việc cần làm:**
1. Implement scope filter cho `/mentors` và `/mentees` (qua applications hoặc matches)
2. Implement scope filter cho `/people` (union qua matches + applications)
3. Person detail: check scope trước khi load

**Gate:** UEHM-only account không thấy HAM mentors/mentees trong list.

---

### Slice 6 — Applications, Reviews, Interviews Scope

**Mục tiêu:** Application pipeline hoàn toàn scoped.

**Việc cần làm:**
1. Filter `/applications` theo `allowedProgramIds` (qua intake_batch)
2. Filter `/reviews` follows applications scope
3. Filter `/interviews` follows applications scope

**Gate:** Reviewer với scope UEHM chỉ thấy UEHM applications.

---

### Slice 7 — Server Actions Scope Guards

**Mục tiêu:** Mọi write action đều có scope + role check.

**Việc cần làm:**
1. Thêm `requireProgramScope()` vào đầu mỗi server action trong danh sách Phần 5
2. Thêm `getRoleInProgram()` check sau scope check
3. Không thay đổi business logic — chỉ thêm guard ở đầu

**Gate:** UEHM admin không thể write data vào HAM seasons qua server action.

---

### Slice 8 — HAM Staging Import Unblock

**Mục tiêu:** Sau khi Slices 0-7 done, HAM staging import được unblock.

**Việc cần làm:**
1. Seed HAM program record trong `programs` table
2. Seed seasons cho HAM trong `seasons` table
3. Tạo `admin_scope_access` rows cho super_admin/dev users với HAM program
4. Import HAM data lên staging (từ audit đã done)
5. Verify UEHM users không thấy HAM data

**Đây là milestone cuối của MVP.**

---

## Phần 7 — QA Account Matrix

Cần tạo 5 loại test accounts trên staging. Mỗi account test một combination scope khác nhau.

### 7.1 Danh sách accounts cần tạo

| Account | Global Role | UEHM Scope | HAM Scope | Mục đích test |
|---------|------------|-----------|---------|--------------|
| `qa-super@vam.test` | `super_admin` | Không cần | Không cần | Verify bypass toàn bộ — thấy tất cả |
| `qa-uehm-core@vam.test` | `core_team` | `core_team` | Không có | Verify UEHM-only access |
| `qa-ham-core@vam.test` | `core_team` | Không có | `core_team` | Verify HAM-only access |
| `qa-both-core@vam.test` | `core_team` | `core_team` | `core_team` | Verify multi-program access |
| `qa-viewer@vam.test` | `viewer` | `viewer` | Không có | Verify viewer scope + read-only |

### 7.2 Test scenarios cho mỗi account

#### `qa-super@vam.test` — Super Admin

| Test | Expected |
|------|---------|
| Dashboard season selector | Hiện TẤT CẢ seasons (UEHM + HAM) |
| `/events` list | Hiện events của UEHM và HAM |
| `/people` list | Hiện tất cả people |
| `/applications` list | Hiện applications của UEHM và HAM |
| Tạo match trong UEHM season | ✅ Cho phép |
| Tạo match trong HAM season | ✅ Cho phép |

---

#### `qa-uehm-core@vam.test` — UEHM Only

| Test | Expected |
|------|---------|
| Dashboard season selector | Chỉ hiện UEHM seasons |
| `/events` list | Chỉ hiện UEHM events |
| `/people` list | Chỉ hiện people liên quan UEHM |
| `/applications` list | Chỉ hiện UEHM applications |
| Tạo match trong UEHM season | ✅ Cho phép |
| Cố tình truy cập `/events/[ham-event-id]` | 🚫 403 hoặc redirect |
| Tạo match trong HAM season | 🚫 403 từ server action |

---

#### `qa-ham-core@vam.test` — HAM Only

| Test | Expected |
|------|---------|
| Dashboard season selector | Chỉ hiện HAM seasons |
| `/events` list | Chỉ hiện HAM events |
| `/people` list | Chỉ hiện people liên quan HAM |
| `/applications` list | Chỉ hiện HAM applications |
| Cố tình truy cập `/events/[uehm-event-id]` | 🚫 403 hoặc redirect |
| Dashboard không hiện UEHM recaps | ✅ Confirmed |

---

#### `qa-both-core@vam.test` — UEHM + HAM

| Test | Expected |
|------|---------|
| Dashboard season selector | Hiện cả UEHM và HAM seasons |
| `/events` list | Hiện events của cả hai programs |
| Switch season từ UEHM sang HAM | Dashboard update đúng |
| Tạo match trong UEHM | ✅ |
| Tạo match trong HAM | ✅ |
| KHÔNG thấy data của program thứ 3 (nếu có) | ✅ Confirmed |

---

#### `qa-viewer@vam.test` — UEHM Viewer

| Test | Expected |
|------|---------|
| Dashboard load | ✅ Read-only |
| Không thấy HAM data | ✅ |
| Không thể tạo event, match, recap | 🚫 UI ẩn buttons / 403 từ actions |
| Không thể truy cập `/applications` | 🚫 403 hoặc redirect (viewer không có quyền) |

---

## Phần 8 — Go/No-Go Checklist: HAM Staging Import

*Staging import chỉ được proceed khi tất cả điều kiện dưới đây là YES.*

### 8.1 Scope Enforcement Readiness

- [ ] Slice 0 done: `admin_scope_access` schema verified và documented
- [ ] Slice 1 done: `getCurrentAdminContext()`, `getAllowedProgramIds()`, `getAllowedSeasonIds()` implemented và tested
- [ ] Slice 2 done: Tất cả current admins có rows trong `admin_scope_access` với UEHM scope
- [ ] Slice 3 done: Dashboard + Operations chỉ hiện UEHM data cho UEHM-only accounts
- [ ] Slice 4 done: `/events` và `/matches` scoped

### 8.2 HAM Program Infrastructure

- [ ] `programs` table có record cho HAM (program_code = `ham_mentoring` hoặc tương tự)
- [ ] `seasons` table có ít nhất 1 season record cho HAM S6
- [ ] `intake_batches` record tồn tại cho HAM S6 (nếu có applications)

### 8.3 Data Readiness

- [ ] HAM audit hoàn chỉnh: 100% recaps classified (1on1 / cross / group / other)
- [ ] Identity resolution dry-run done: biết rõ bao nhiêu emails match với `people` table
- [ ] Unmatched emails có quyết định: tạo mới hoặc bỏ qua
- [ ] Import scripts đã reviewed và không có risk của data corruption

### 8.4 Staging Environment Safety

- [ ] Staging Supabase project là project RIÊNG BIỆT — không phải production
- [ ] Staging chỉ accessible cho `super_admin` và dev users — KHÔNG có admin thường
- [ ] Không có real user data hay PII thật trên staging (hoặc đã anonymized)

### 8.5 QA Coverage

- [ ] `qa-ham-core@vam.test` account đã được tạo trên staging với HAM scope
- [ ] `qa-uehm-core@vam.test` account đã verify KHÔNG thấy HAM data (test isolation)
- [ ] `qa-super@vam.test` thấy cả UEHM và HAM data sau import

**Sign-off HAM Staging:**
- Dev Lead: _____________ Ngày: _____________
- Core Team Admin: _____________ Ngày: _____________

---

## Phần 9 — Go/No-Go Checklist: HAM Production Import

*Production import chỉ được proceed khi HAM staging import đã pass VÀ tất cả điều kiện dưới đây là YES.*

### 9.1 Staging Validation (Prerequisites)

- [ ] HAM staging import đã pass (Part 8 sign-off xong)
- [ ] Row counts trên staging verified: số mentors, mentees, recaps khớp với HAM audit
- [ ] Zero data integrity errors sau staging import (không có FK violations, không có duplicate records)
- [ ] Operations dashboard trên staging hiện đúng KPIs cho HAM seasons

### 9.2 Full Scope Enforcement (Tất cả slices done)

- [ ] Slices 0–7 đã complete và pass QA trên staging
- [ ] `/people`, `/mentors`, `/mentees`, `/matches`, `/events`, `/applications`, `/reviews` đều scoped
- [ ] Tất cả server actions có scope + role guard
- [ ] UEHM admin đã verify không thấy HAM data trên staging (sau khi HAM data có mặt)

### 9.3 Access Control cho HAM Admins

- [ ] Danh sách users sẽ có quyền vào HAM đã được Core Team confirm
- [ ] `admin_scope_access` rows cho HAM admins đã được chuẩn bị (sẵn sàng insert)
- [ ] Rõ ràng ai có role gì trong HAM program

### 9.4 Production Data Safety

- [ ] Backup production DB trước khi import (hoặc confirm Supabase point-in-time recovery bật)
- [ ] Import script được review bởi ít nhất 2 người
- [ ] Import chạy trong giờ thấp traffic (không phải giờ làm việc chính)
- [ ] Rollback plan rõ ràng: biết cách xóa HAM data nếu import sai

### 9.5 QA trên Production (Ngay sau import)

- [ ] Row counts verify ngay sau import: HAM recaps = N, HAM events = M
- [ ] Super admin thấy đầy đủ HAM data
- [ ] UEHM admin đã login lại và confirm KHÔNG thấy HAM data
- [ ] HAM admin (nếu đã có) login và thấy đúng HAM data
- [ ] Operations dashboard không bị ảnh hưởng cho UEHM users

**Sign-off HAM Production:**
- Dev Lead: _____________ Ngày: _____________
- Core Team Admin: _____________ Ngày: _____________
- Founder/Anh Thắng: _____________ Ngày: _____________

---

## Tóm tắt: Dependency Chain

```
Slice 0: Verify admin_scope_access schema
    ↓
Slice 1: Helper functions (getCurrentAdminContext, getAllowedProgramIds, getAllowedSeasonIds)
    ↓
Slice 2: Seed admin_scope_access rows cho current UEHM admins  ← PHẢI TRƯỚC KHI ENFORCE
    ↓
Slice 3: Dashboard + Operations scope
    ↓
Slice 4: Events + Matches scope
    ↓
Slice 5: People + Profiles scope
    ↓
Slice 6: Applications + Reviews + Interviews scope
    ↓
Slice 7: Server actions scope guards
    ↓
[HAM Staging Go/No-Go — Part 8]
    ↓
HAM Staging Import (restricted staging, super_admin only)
    ↓
[HAM Production Go/No-Go — Part 9]
    ↓
HAM Production Import
```

**Thời gian estimate cho Slices 0–7:** 3–5 ngày dev, tùy complexity của schema alignment và số lượng pages cần refactor.

---

*VAM OS Program-Scoped Access MVP Blueprint — 07/05/2026 — Internal only.*
*Không chứa code. Không apply migration. Không import data.*
