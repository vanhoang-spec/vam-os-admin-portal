# Phân biệt M072/M073 lịch sử với S12-M1 M083

> **CẢNH BÁO CHO NGƯỜI VẬN HÀNH SUPABASE:** S12-M1 không còn là migration 072. Không dùng bất kỳ file 072 nào để cài S12-M1.

Tài liệu này chỉ phân biệt tên để tránh chạy nhầm. Nó không cấp quyền chạy migration trên Staging hoặc Production.

| Tên thấy trong repo/lịch sử | Chủ sở hữu thật | Trạng thái/hành động |
|---|---|---|
| M072 tạo `public.vam063_trusted_api_role()` | Trusted-context remediation của renewal runtime | Đã được ghi nhận là áp dụng trên Staging và M073 phụ thuộc vào nó. **Không đổi tên, không ghi đè, không chạy lại theo tài liệu S12-M1.** |
| `072_cross_mentoring.sql` trên ref `origin/s12-phase8-cross-mentoring` | Tính năng cross-mentoring | Là một claimant M072 khác trên ref khác. Tài liệu vận hành gốc của ref đó ghi “chưa chạy” tại thời điểm viết; không suy diễn trạng thái hiện tại và không chạy từ nhánh S12-M1. |
| M073 renewal decline feedback | Renewal runtime | Phụ thuộc đúng một object của M072 authoritative: `public.vam063_trusted_api_role()`. Không thuộc S12-M1. |
| `074_mkt_plan.sql` trên `origin/s12-phase9-mkt-plan` | Marketing plan | M074 đã có chủ; không dùng cho S12-M1. |
| `VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827` | **S12-M1 remediation** | Đây là package duy nhất của S12-M1. Hiện **REVIEW ONLY / NOT APPLIED**. |

## Nếu mục tiêu là kiểm thử S12-M1

Chỉ mở package:

`VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827`

Thứ tự tài liệu trong package:

1. đọc `README.md`;
2. kiểm tra `SHA256SUMS.txt`;
3. chạy riêng `preflight.sql` trên database cô lập đã được phê duyệt;
4. chỉ sau review mới chạy `apply.sql`;
5. chạy `verifier.sql` độc lập.

Không copy SQL từ migration 072 cũ. Không chạy migration kết nối chỉ vì package đã có trong repo. Khi có bất kỳ tên/đối tượng khác với bảng trên, dừng lại và yêu cầu review kỹ thuật; không tự chọn file có số gần nhất.

