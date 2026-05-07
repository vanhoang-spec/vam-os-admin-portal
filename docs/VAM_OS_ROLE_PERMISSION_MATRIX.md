# VAM OS — Role & Permission Matrix

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Trạng thái** | Current state + Planned (v2) |
| **Ghi chú** | Roles đánh dấu `[planned]` chưa tồn tại trong DB. Cần RLS trước khi implement. |

---

## Phần 1 — Định nghĩa các Role

### 1.1 Roles hiện có trong DB

| Role | Code trong DB | Mô tả |
|------|--------------|-------|
| Super Admin | `super_admin` | Toàn quyền hệ thống. Quản lý tài khoản, phân quyền. |
| Admin / Core Team | `admin` | Vận hành đầy đủ: hồ sơ, quyết định, sự kiện, ghép cặp, dashboard. |
| Reviewer | `reviewer` | Chỉ xem và submit review được giao. Không thấy dữ liệu người khác. |
| Viewer | `viewer` | Chỉ đọc dashboard và báo cáo. Không chỉnh sửa. |

### 1.2 Roles cần thêm (planned — sau khi RLS xong)

| Role | Code đề xuất | Mô tả | Prerequisite |
|------|-------------|-------|-------------|
| Interviewer | `interviewer` | Tự nhận và phỏng vấn ứng viên. Xem profile ứng viên được giao. | RLS Phase 1 |
| Support Team | `support_team` | Hỗ trợ vận hành: điểm danh sự kiện, xem hồ sơ (không edit). | RLS Phase 1 |
| Mentor | `mentor` | Portal: xem profile, xem match, submit recap. | RLS Phase 2 |
| Mentee | `mentee` | Portal: xem profile, xem match, xem recap. | RLS Phase 2 |
| BTC Operator | `btc_operator` | Quản lý support ticket, xem báo cáo vận hành. | Phase 2+ |

---

## Phần 2 — Permission Matrix

### Ký hiệu

| Ký hiệu | Nghĩa |
|---------|-------|
| `RW` | Read + Write (full access) |
| `R` | Read only |
| `W` | Write only (không đọc list của người khác) |
| `R*` | Read limited (chỉ own data) |
| `RW*` | Read + Write limited (chỉ own data) |
| `–` | Không có quyền |
| `[P]` | Planned — chưa implement |

### 2.1 Module: Applications & Reviews

| Module / Action | super_admin | admin | reviewer | viewer | interviewer[P] | support_team[P] | mentor[P] | mentee[P] |
|----------------|-------------|-------|----------|--------|----------------|-----------------|-----------|-----------|
| Xem danh sách applications | `RW` | `RW` | `–` | `R` | `R` (invited only) | `R` | `–` | `R*` (own) |
| Xem chi tiết application | `RW` | `RW` | `–` | `R` | `R` (assigned) | `R` | `–` | `R*` (own) |
| Assign reviewer | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Xem review form | `RW` | `RW` | `RW*` (own) | `–` | `RW*` (interview) | `–` | `–` | `–` |
| Submit review | `RW` | `RW` | `RW*` (own) | `–` | `RW*` (interview) | `–` | `–` | `–` |
| Xem review của người khác | `R` | `R` | `–` | `–` | `–` | `–` | `–` | `–` |
| Admin decision | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Duyệt thành mentor/mentee | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Review progress dashboard | `R` | `R` | `–` | `–` | `–` | `–` | `–` | `–` |
| Bulk assign reviewer | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Reviewer pool management | `RW` | `–` | `–` | `–` | `–` | `–` | `–` | `–` |

### 2.2 Module: Persons & Profiles

| Module / Action | super_admin | admin | reviewer | viewer | interviewer[P] | support_team[P] | mentor[P] | mentee[P] |
|----------------|-------------|-------|----------|--------|----------------|-----------------|-----------|-----------|
| Xem danh sách persons | `RW` | `RW` | `–` | `R` | `–` | `R` | `–` | `–` |
| Xem person detail | `RW` | `RW` | `–` | `R` | `R` (assigned) | `R` | `R*` (own) | `R*` (own) |
| Edit person profile | `RW` | `RW` | `–` | `–` | `–` | `–` | `RW*` (limited fields) | `RW*` (limited fields) |
| Xem mentor list | `RW` | `RW` | `R` | `R` | `R` | `R` | `R` | `R` |
| Xem mentee list | `RW` | `RW` | `R` | `R` | `R` | `R` | `–` | `–` |
| Edit mentor profile | `RW` | `RW` | `–` | `–` | `–` | `–` | `RW*` (own) | `–` |
| Edit mentee profile | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `RW*` (own) |

### 2.3 Module: Matching

| Module / Action | super_admin | admin | reviewer | viewer | interviewer[P] | support_team[P] | mentor[P] | mentee[P] |
|----------------|-------------|-------|----------|--------|----------------|-----------------|-----------|-----------|
| Xem danh sách matches | `RW` | `RW` | `–` | `R` | `–` | `–` | `R*` (own) | `R*` (own) |
| Tạo cặp match mới | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Hủy/update cặp | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Xem thông tin đối phương | `RW` | `RW` | `–` | `–` | `–` | `–` | `R*` (matched pair only) | `R*` (matched pair only) |

### 2.4 Module: Recaps

| Module / Action | super_admin | admin | reviewer | viewer | interviewer[P] | support_team[P] | mentor[P] | mentee[P] |
|----------------|-------------|-------|----------|--------|----------------|-----------------|-----------|-----------|
| Xem tất cả recaps | `R` | `R` | `–` | `R` | `–` | `R` | `–` | `–` |
| Tạo recap (admin/support) | `RW` | `RW` | `–` | `–` | `–` | `RW` | `–` | `–` |
| Tạo recap (mentor self) | `RW` | `RW` | `–` | `–` | `–` | `–` | `RW*` (own matches) | `–` |
| Xem recap của mình | `R` | `R` | `–` | `–` | `–` | `–` | `R*` (own) | `R*` (own match) |
| Edit recap sau khi submit | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Delete/invalidate recap | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Dashboard recap KPIs | `R` | `R` | `–` | `R` | `–` | `–` | `–` | `–` |
| Acknowledge recap (mentee) | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `RW*` (own) |

### 2.5 Module: Events & Attendance

| Module / Action | super_admin | admin | reviewer | viewer | interviewer[P] | support_team[P] | mentor[P] | mentee[P] |
|----------------|-------------|-------|----------|--------|----------------|-----------------|-----------|-----------|
| Xem danh sách events | `RW` | `RW` | `–` | `R` | `–` | `R` | `R` | `R` |
| Tạo/edit/hủy event | `RW` | `RW` | `–` | `–` | `–` | `–` | `–` | `–` |
| Thêm người vào event | `RW` | `RW` | `–` | `–` | `–` | `RW` | `–` | `–` |
| Đăng ký tham dự (self) | `RW` | `RW` | `–` | `–` | `–` | `–` | `RW*` (own) | `RW*` (own) |
| Đánh dấu điểm danh | `RW` | `RW` | `–` | `–` | `–` | `RW` | `–` | `–` |
| Submit event feedback | `–` | `–` | `–` | `–` | `–` | `–` | `RW*` (attended) | `RW*` (attended) |
| Xem attendance report | `R` | `R` | `–` | `R` | `–` | `R` | `–` | `–` |

### 2.6 Module: Admin & System

| Module / Action | super_admin | admin | reviewer | viewer | interviewer[P] | support_team[P] | mentor[P] | mentee[P] |
|----------------|-------------|-------|----------|--------|----------------|-----------------|-----------|-----------|
| Quản lý user accounts | `RW` | `–` | `–` | `–` | `–` | `–` | `–` | `–` |
| Assign roles | `RW` | `–` | `–` | `–` | `–` | `–` | `–` | `–` |
| Xem audit log | `R` | `R` | `–` | `–` | `–` | `–` | `–` | `–` |
| System configuration | `RW` | `–` | `–` | `–` | `–` | `–` | `–` | `–` |
| Support ticket (view all) | `R` | `R` | `–` | `–` | `–` | `RW` | `–` | `–` |
| Support ticket (submit) | `RW` | `RW` | `–` | `–` | `–` | `–` | `RW*` (own) | `RW*` (own) |

---

## Phần 3 — RLS Implementation Requirements

### 3.1 Supabase RLS Policies cần viết

Với mỗi table, cần có policies cho:
- `SELECT` — ai có thể đọc row nào
- `INSERT` — ai có thể tạo row mới
- `UPDATE` — ai có thể sửa row nào
- `DELETE` — ai có thể xóa (thường chỉ soft delete qua status)

**Priority order cho implementation:**

| Priority | Table | Lý do |
|---------|-------|-------|
| P0 | `reviews` | Reviewer phải chỉ thấy review của mình |
| P0 | `mentoring_recaps` | Mentor phải chỉ thấy recap của mình |
| P0 | `applications` | Mentee chỉ thấy application của mình |
| P1 | `persons` | Profile isolation |
| P1 | `mentor_profiles` | Mentor chỉ edit own |
| P1 | `mentee_profiles` | Mentee chỉ edit own |
| P1 | `matches` | Chỉ thấy own match |
| P2 | `event_registrations` | Self-registration isolation |
| P2 | `support_tickets` | Own ticket only |
| P3 | `events` | Read-only cho mentor/mentee |

### 3.2 Pattern cho RLS policy (ví dụ)

```sql
-- Reviewer chỉ thấy review được giao cho mình
CREATE POLICY "reviewer_select_own_reviews"
ON reviews FOR SELECT
USING (
  reviewer_user_id = auth.uid()
  OR
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Mentor chỉ submit recap cho match của mình
CREATE POLICY "mentor_insert_own_recaps"
ON mentoring_recaps FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM matches m
    JOIN mentor_profiles mp ON m.mentor_profile_id = mp.id
    JOIN persons p ON mp.person_id = p.id
    WHERE m.id = mentoring_recaps.match_id
    AND p.auth_user_id = auth.uid()
  )
);
```

### 3.3 Gaps cần quyết định trước khi implement RLS

| Câu hỏi | Quyết định cần thiết |
|---------|---------------------|
| Reviewer có thể thấy application gốc không? | Cần confirm: read-only application data khi review |
| Mentor directory: mentor thấy mentor khác không? | Cần confirm: opt-in directory hay hidden-by-default |
| Mentee có thể thấy mentor profile không? | Confirm: matched pair chỉ? hay tất cả mentor? |
| Support team thấy content recap không? | Confirm: cần để check data quality |
| BTC operator có quyền gì trong portal? | Define trước khi thêm role |

---

## Phần 4 — Route-level Protection (Next.js)

Bên cạnh RLS ở DB layer, cần bảo vệ ở route/middleware level:

| Route pattern | Roles được phép | Current state |
|--------------|----------------|---------------|
| `/` (dashboard) | admin, super_admin, viewer | ✅ Protected |
| `/applications/*` | admin, super_admin | ✅ Protected |
| `/reviews/*` | admin, super_admin, reviewer | ✅ Protected |
| `/interviews` | admin, super_admin, interviewer | ✅ Partial |
| `/events/*` | admin, super_admin, support_team | ✅ Protected |
| `/matches/*` | admin, super_admin | ✅ Protected |
| `/admin/users` | super_admin only | ✅ Protected |
| `/portal/*` | mentor, mentee | ❌ Not built yet |
| `/portal/recap/new` | mentor only | ❌ Not built yet |
| `/portal/ticket` | mentor, mentee | ❌ Not built yet |

---

## Phần 5 — Checklist trước khi mở bất kỳ Role mới

Trước khi cấp role `mentor` hoặc `mentee` cho người dùng thật:

- [ ] RLS Phase 1 pass (admin/reviewer/viewer isolation)
- [ ] RLS Phase 2 pass (mentor/mentee isolation)
- [ ] Test: mentor A không đọc được data của mentor B
- [ ] Test: mentee không thấy recap của cặp khác
- [ ] Test: mentor không INSERT vào match không phải của mình
- [ ] Penetration test cơ bản trên staging
- [ ] Portal routes có middleware protection
- [ ] Không dùng service_role key trong client-side
- [ ] Email verification bật (không dùng magic link tắt verification)
- [ ] Sign-off từ Dev Lead + Core Team Admin

---

*VAM OS Role & Permission Matrix — 07/05/2026 — Internal only*
