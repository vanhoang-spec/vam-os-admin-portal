# VAM OS Phase 2F - Ghi chú release Operational Team Assignments

## Phạm vi đã hoàn thành

- Re-audit Coreteam và Support Team theo business rules V3.
- Lọc Coreteam chỉ còn các thành viên UEH Mentoring coreteam hợp lệ.
- Giữ cấu trúc functional team của Support Team:
  - Project Co-ordination
  - Communication / Content & Media
  - Event
  - Design
- Tạo bảng `operational_team_assignments`.
- Import 25 operational assignments có độ tin cậy cao.
- Hiển thị “Vai trò vận hành VAM” trên hồ sơ cá nhân.

## Dữ liệu chính

- Raw Coreteam rows: 35
- Coreteam excluded: 21
- Valid UEH Mentoring Coreteam rows considered: 14
- Coreteam high-confidence matched: 12
- Coreteam manual review: 2
- Support team total: 14
- Support team high-confidence matched: 13
- Support team manual review: 1
- Draft/imported assignments: 25

## Data model

- `source_role_group`: `coreteam` / `support_team`
- `operational_role`
- `functional_team`
- `team_name`
- `assigned_scope`
- `role_note`
- `status`

## Giới hạn hiện tại

- 3 dòng vẫn cần manual review.
- Team assignments hiện chỉ read-only trong app.
- Operational roles chưa được kết nối với Auth/RLS permissions.
- `corrected_by` và phân quyền vẫn còn dựa trên nhập tay/password gate.

## Đề xuất bước tiếp theo

- Resolve 2 Coreteam manual-review rows và 1 Support Team manual-review row.
- Bổ sung team assignment correction workflow ở giai đoạn sau.
- Dùng `operational_team_assignments` làm một input cho Auth/RLS role mapping trong tương lai.
- Xây dựng generic profile correction workflow cho `people` / `mentor_profiles` / `mentee_profiles`.
