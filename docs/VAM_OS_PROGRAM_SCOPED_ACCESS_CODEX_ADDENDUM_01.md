# VAM OS — Program-Scoped Access: Addendum 01
## Thực tế Schema `admin_scope_access` và Điều chỉnh Implementation

| | |
|---|---|
| **Addendum cho** | `VAM_OS_PROGRAM_SCOPED_ACCESS_CODEX_PACKAGE.md` |
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Lý do tạo** | Schema thực tế của `admin_scope_access` khác với assumption trong Codex Package |
| **Ưu tiên** | Addendum này **ghi đè** các database assumptions trong Slices 0–7 của Codex Package |

---

## Vấn đề phát sinh

Slice 0 (Schema Inspection) đã chạy và phát hiện schema thực tế khác với blueprint đề xuất:

| Column | Blueprint giả định | Thực tế |
|--------|-------------------|---------|
| `program_id` | `uuid` | `text` |
| `season_id` | `uuid` | `text` |
| `role_in_program` | `text` (business role name) | **Không tồn tại** — column tên `role` với value tập riêng |

**Giá trị thực tế của `admin_scope_access.role`:**

```
full_access | operations | review | read
```

Đây **không phải** business role names (`admin`, `core_team`, `reviewer`, v.v.). Đây là **scope permission levels** — một taxonomy riêng biệt, độc lập với `admin_users.role`.

---

## Phần 1 — Mapping Table: Business Role → Scope Level

Mỗi business role trong `admin_users.role` được map sang một scope level trong `admin_scope_access.role` khi cấp quyền vào một program.

| Business Role (`admin_users.role`) | Scope Level (`admin_scope_access.role`) | Giải thích |
|-----------------------------------|----------------------------------------|-----------|
| `super_admin` | — (không cần row) | Bypass hoàn toàn. Không có row trong `admin_scope_access`. |
| `admin` | `full_access` | Toàn quyền trong phạm vi program được assign. |
| `core_team` | `operations` | Quản lý vận hành chính: events, matches, recaps. Không có system-level config. |
| `support_team` | `operations` *(khuyến nghị)* hoặc `read` | Xem ghi chú Section 1.1 bên dưới. |
| `reviewer` | `review` | Chỉ workflow review: xem và submit reviews được giao. |
| `viewer` | `read` | Chỉ đọc dashboard và báo cáo. |

### 1.1 Ghi chú về `support_team`

`support_team` có hai use case khác nhau tùy context:

| Scenario | Scope phù hợp | Lý do |
|---------|--------------|-------|
| Support team điểm danh sự kiện, nhập data | `operations` | Cần write access vào `event_participations` |
| Support team chỉ cần xem báo cáo | `read` | Read-only là đủ |

**Khuyến nghị cho MVP:** Gán `operations` làm default cho `support_team`. Nếu trong tương lai cần phân biệt "support chỉ đọc" vs "support có quyền nhập", đây là lúc thêm `support_read` vào scope enum — không phải bây giờ.

**Không nên làm ngay:** Tạo thêm scope level mới (`support_ops`, `support_read`, v.v.) — over-engineering cho MVP hiện tại.

---

## Phần 2 — Ý nghĩa từng Scope Level

### `full_access`

Người dùng có toàn quyền trong program được assign, tương đương `admin` nhưng giới hạn trong phạm vi program đó.

**Được phép:**
- Xem tất cả data của program (people, matches, recaps, events, applications, reviews)
- Tạo, sửa, xóa mềm bất kỳ record nào trong program
- Ra quyết định (approve/reject applications)
- Giao reviewer
- Tạo và hủy matches
- Tạo và edit events

**Không được phép:**
- Quản lý user accounts (`/admin/users` — reserved for `super_admin` only)
- Xem data của program khác nếu không có row tương ứng

---

### `operations`

Người dùng quản lý vận hành chính của program nhưng không có quyền quyết định cấp cao.

**Được phép:**
- Xem tất cả data của program
- Tạo và chỉnh sửa events
- Đánh dấu điểm danh
- Tạo recaps (admin-side manual entry)
- Xem applications và reviews (read)
- Tạo và quản lý matches (nếu role `core_team` theo business logic)

**Không được phép (so với `full_access`):**
- Ra quyết định approve/reject application
- Giao reviewer (bulk assignment — reserved for `full_access`)
- Sửa hoặc xóa recaps đã được submit bởi người khác

> **Lưu ý cho Codex:** Ranh giới chính xác giữa `full_access` và `operations` cho từng server action cần được confirm với Core Team. Blueprint này đề xuất ranh giới trên — nhưng nếu Core Team muốn `core_team` được giao reviewer thì `operations` scope phải cho phép action đó.

---

### `review`

Người dùng chỉ tham gia vào workflow review — không có quyền với dữ liệu vận hành chính.

**Được phép:**
- Xem applications được giao để review
- Xem và submit reviews của bản thân (không xem review của reviewer khác)
- Xem thông tin cơ bản của applicant trong context review

**Không được phép:**
- Xem danh sách tất cả applications
- Xem events, matches, recaps
- Bất kỳ write action nào ngoài submit review

---

### `read`

Người dùng chỉ xem — không có bất kỳ write action nào.

**Được phép:**
- Xem dashboard KPIs
- Xem danh sách people, matches, events (read-only)
- Xem báo cáo tổng hợp

**Không được phép:**
- Bất kỳ thao tác tạo, sửa, xóa nào
- Xem nội dung review (privacy)
- Xem applications (tùy quyết định của Core Team — hiện tại để `read` không thấy applications)

---

## Phần 3 — Cách `admin_users.role` và `admin_scope_access.role` Tương tác

### 3.1 Hai layers độc lập

```
Layer 1: admin_users.role (global role)
  → Dùng cho: login flow, super_admin bypass, /admin/users access,
               app-level permission checks hiện tại (lib/permissions.ts)
  → KHÔNG dùng để: quyết định user thấy data của program nào

Layer 2: admin_scope_access.role (per-program scope level)
  → Dùng cho: filter data theo program, check quyền write vào program data
  → KHÔNG dùng để: thay thế toàn bộ lib/permissions.ts ngay bây giờ
```

### 3.2 Quy tắc tương tác (Priority Rules)

| Situation | Rule |
|-----------|------|
| User là `super_admin` | Bypass tất cả. Không check `admin_scope_access`. Thấy tất cả programs. |
| User có global role + `admin_scope_access` row | Scope level trong `admin_scope_access` quyết định **data access** trong program đó |
| User không có row trong `admin_scope_access` (và không phải `super_admin`) | Không thấy bất kỳ program data nào — default deny |
| User có row nhưng `is_active = false` | Treat như không có row — deny |
| Global role cao hơn scope level | Scope level vẫn WIN trong context program |

**Ví dụ quan trọng:** Một `admin` (global) có thể có scope `read` trong HAM. Trong trường hợp này, dù global role là `admin`, user đó chỉ được đọc HAM data — không được write. Global role không override per-program scope.

### 3.3 Scope level quyết định quyền gì

Khi Codex implement permission check trong server actions và pages, logic phải là:

```
1. Lấy context: global role + program scopes
2. Nếu super_admin → proceed (no restriction)
3. Nếu không phải super_admin:
   a. Check user có row trong admin_scope_access cho program liên quan không?
   b. Nếu không → deny
   c. Nếu có → lấy scope level (full_access / operations / review / read)
   d. Check scope level có đủ cho action này không?
   e. Nếu không đủ → deny
```

### 3.4 Điều chỉnh cho `lib/permissions.ts` hiện tại

`lib/permissions.ts` hiện tại nhận `role?: string` là global role từ `admin_users`. **Không thay đổi lib/permissions.ts trong MVP này.** Giữ nguyên để không break tính năng hiện có.

Thêm scope checks là **additive**: helper functions mới trong `lib/program-scope.ts` chạy **song song** với permission checks hiện tại, không thay thế.

---

## Phần 4 — Khuyến nghị: Giữ Schema Hiện Tại cho MVP

### 4.1 Tại sao không migrate schema ngay

Blueprint gốc đề xuất column `role_in_program` dùng business role names. Schema thực tế dùng scope levels (`full_access`, `operations`, `review`, `read`). **Khuyến nghị: giữ schema thực tế, không migrate.**

| Lý do | Chi tiết |
|-------|---------|
| Schema đang hoạt động | `admin_scope_access` đang có data. Migration = risk không cần thiết. |
| Scope levels rõ ràng hơn | `full_access` / `operations` / `review` / `read` là abstraction tốt hơn business role names cho purpose này |
| Business roles có thể thay đổi | Nếu thêm role mới (`btc_operator`, `interviewer`), chỉ cần cập nhật mapping table — không sửa schema |
| One-to-one map đủ dùng | Mapping từ business role sang scope level là deterministic và đơn giản |

### 4.2 `role_in_program` là future enhancement

Column `role_in_program` (tên trong blueprint gốc) là đổi tên của column `role` trong schema thực tế, với business role values. Đây là enhancement có thể xem xét ở **Phase 2** nếu:

- Cần lưu trực tiếp business role vào scope table (thay vì mapping)
- Một business role cần nhiều scope levels khác nhau tùy program
- System phức tạp hơn hiện tại

**Hiện tại (MVP):** Dùng mapping table ở Phần 1, implement helper functions xung quanh column `role` (scope levels) đang có.

---

## Phần 5 — Điều chỉnh Codex Package: Slice 1 và Slice 2

### 5.1 Điều chỉnh Slice 1 — `lib/program-scope.ts`

**Thay đổi so với Codex Package gốc:**

Trong type `ProgramScope`, field `roleInProgram` phải phản ánh schema thực tế:

```
ProgramScope {
  programId: string          -- text (không phải uuid)
  programCode: string
  scopeLevel: string         -- 'full_access' | 'operations' | 'review' | 'read'
  seasonId: string | null    -- text (không phải uuid), null nếu không có season restriction
}
```

Thêm một helper function để convert từ scope level sang permission check:

```
hasScopeLevel(ctx, programId, requiredLevel):
  - full_access satisfies: full_access
  - operations satisfies: full_access, operations
  - review satisfies: full_access, operations, review
  - read satisfies: full_access, operations, review, read

Hierarchy: full_access > operations > review > read
```

Khi check quyền write, ví dụ:
- Tạo event → cần ít nhất `operations`
- Submit review → cần ít nhất `review`
- Xem dashboard → cần ít nhất `read`
- Admin decision → cần `full_access`

### 5.2 Điều chỉnh Slice 2 — Migration Seed

**Thay đổi so với Codex Package gốc:**

Column cần seed là `role` (scope level), không phải `role_in_program`. SQL seed pattern:

```
-- Mapping business role → scope level:
CASE au.role
  WHEN 'admin'        THEN 'full_access'
  WHEN 'core_team'    THEN 'operations'
  WHEN 'support_team' THEN 'operations'
  WHEN 'reviewer'     THEN 'review'
  WHEN 'viewer'       THEN 'read'
  ELSE 'read'         -- safe default
END
```

`program_id` là `text` — dùng program `code` string (VD: `'uehm_mentoring'`) hoặc UUID cast thành text tùy theo cách DB hiện đang lưu. Verify từ kết quả Slice 0.

---

## Phần 6 — Priority Đầu Tiên cho Codex: Fix `upsertScope`

### 6.1 Vấn đề hiện tại

Có khả năng hàm `upsertScope` hiện tại (nếu đã tồn tại) hoặc pattern add scope hiện tại **overwrite toàn bộ scope của user** thay vì upsert theo `(user, program)` pair.

**Ví dụ lỗi nguy hiểm:**

```
Trước: user A có scope UEHM (full_access)
Action: Thêm scope HAM (operations) cho user A
Sau (nếu upsert sai): user A chỉ có scope HAM (UEHM bị mất)
```

Kết quả: UEHM admin bị mất quyền vào UEHM data mà không ai hay biết.

### 6.2 Upsert đúng

Pattern upsert phải là theo `(auth_user_id, program_id)` — unique pair:

```
Nếu row với (auth_user_id=X, program_id=UEHM) đã có → UPDATE chỉ row đó
Nếu chưa có → INSERT row mới
Không được xóa các rows khác của cùng user
```

SQL pattern đúng:

```sql
INSERT INTO admin_scope_access (auth_user_id, program_id, role, is_active)
VALUES ($1, $2, $3, true)
ON CONFLICT (auth_user_id, program_id)
DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
```

**Nếu `admin_scope_access` chưa có unique constraint trên `(auth_user_id, program_id)`:** Phải thêm constraint này trước khi bất kỳ upsert nào được chạy. Đây là việc đầu tiên Codex phải làm nếu constraint chưa có.

### 6.3 Thứ tự ưu tiên cho Codex khi bắt đầu

Thứ tự này thay thế "Gate" trong Codex Package gốc cho giai đoạn khởi động:

**Bước đầu tiên (trước Slice 1):**

1. Chạy Slice 0 đầy đủ — verify columns, constraints, hiện trạng rows
2. Xác nhận unique constraint `(auth_user_id, program_id)` có tồn tại không
3. Nếu chưa có → thêm constraint (migration nhỏ, không ảnh hưởng data)

**Bước thứ hai (Slice 1):**

4. Implement `lib/program-scope.ts` với đúng types theo schema thực tế (`scopeLevel`, `programId` là text, `seasonId` là text)
5. Implement `hasScopeLevel()` helper với hierarchy `full_access > operations > review > read`

**Bước thứ ba (trước Slice 2):**

6. Nếu có function nào đang upsert `admin_scope_access` — tìm và verify nó upsert theo `(auth_user_id, program_id)`, không phải cách khác
7. Fix nếu sai — đây là bug có thể gây mất quyền

**Sau đó tiếp tục Slice 2–7 theo Codex Package.**

### 6.4 Không làm trong đợt này

| Không làm | Lý do |
|-----------|-------|
| Import HAM data | Chưa đến thời điểm |
| Migrate schema `admin_scope_access` | Không cần — schema hiện tại đủ dùng |
| Rename column `role` thành `role_in_program` | Không cần — tránh migration không cần thiết |
| Thêm scope level mới | Over-engineering cho MVP |
| Sửa `lib/permissions.ts` | Scope check là additive — giữ permissions.ts nguyên |

---

## Tóm tắt nhanh cho Codex

```
Schema thực tế:
  admin_scope_access.role = 'full_access' | 'operations' | 'review' | 'read'
  admin_scope_access.program_id = text
  admin_scope_access.season_id = text

Mapping (không thay đổi DB):
  admin       → full_access
  core_team   → operations
  support_team→ operations (default)
  reviewer    → review
  viewer      → read

Hierarchy cho permission check:
  full_access > operations > review > read

Việc làm ngay:
  1. Verify unique constraint (auth_user_id, program_id) tồn tại
  2. Fix upsertScope nếu đang overwrite sai
  3. Implement lib/program-scope.ts với đúng types
  4. Tiếp tục Slices 2–7 theo Codex Package

Không làm:
  - Import HAM
  - Enable RLS
  - Migrate schema
```

---

*VAM OS Program-Scoped Access — Addendum 01 — 07/05/2026 — Internal only.*
*Addendum này ghi đè database assumptions trong Codex Package Slices 0–7.*
