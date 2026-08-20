# Mục lục tài liệu hướng dẫn

Các tài liệu viết cho **người không làm kỹ thuật**: chủ chương trình và ban tổ
chức. Mỗi tài liệu có bản `.html` (mở bằng trình duyệt) và `.pdf` (in hoặc gửi
qua tin nhắn), trừ hai bản Markdown ở cuối.

Thư mục `docs/audits/` còn nhiều file khác — đó là hồ sơ kỹ thuật của các đợt
đổi cơ sở dữ liệu, không phải hướng dẫn sử dụng.

---

## Bàn giao quyền sở hữu

Bốn tài liệu này trả lời cùng một câu hỏi theo bốn hướng khác nhau. **Không phải
làm cả bốn** — đọc rồi chọn hướng.

| Tài liệu | Trả lời câu hỏi |
|---|---|
| [Chuyển Supabase](audits/VAM_OS_HUONG_DAN_CHUYEN_SUPABASE_2026-08-19.html) | Chuyển hai project Supabase (staging + production) sang tài khoản của chủ chương trình. **Người bấm nút Transfer phải là chủ tài khoản hiện tại.** |
| [Chuyển GitHub và Vercel](audits/VAM_OS_HUONG_DAN_CHUYEN_GITHUB_VERCEL_2026-08-19.html) | Có thêm đồng sở hữu, hay chuyển hẳn? Vì sao GitHub thì miễn phí mà Vercel thì không. |
| [Tên miền riêng](audits/VAM_OS_HUONG_DAN_TEN_MIEN_RIENG_2026-08-19.html) | Cho app chạy trên tên miền của chương trình mà **vẫn ở Vercel**. |
| [Kế hoạch chuyển Netlify](audits/VAM_OS_KE_HOACH_CHUYEN_NETLIFY_2026-08-19.html) | Rời Vercel sang Netlify: làm thế nào, và hạn mức thật của gói miễn phí là gì. |

> **Về hạn mức Netlify:** con số đáng lo không phải số lần gọi function (ước
> tính ~20.000/tháng trên hạn mức 125.000, tức khoảng 16%) mà là **300 phút
> build mỗi tháng**. Mỗi lần build khoảng 2 phút, nên khoảng 150 lần deploy là
> hết — con số đó đạt được khá nhanh trong giai đoạn đang phát triển. Chi tiết
> trong tài liệu.

---

## Bật hai dịch vụ bên ngoài

| Tài liệu | Dùng để làm gì |
|---|---|
| [Brevo](audits/VAM_OS_HUONG_DAN_BREVO_2026-08-19.html) | Gửi email của hệ thống: thư mời, thư xác nhận, thư báo lịch. Gói miễn phí ~300 thư/ngày. |
| [DeepSeek](audits/VAM_OS_HUONG_DAN_DEEPSEEK_2026-08-19.html) | Phần AI: gợi ý ghép cặp và viết nháp bài đăng. Không bật cũng dùng app được — chỉ mất phần gợi ý. |

---

## Vận hành

| Tài liệu | Nội dung |
|---|---|
| [Thu recap từ Facebook](audits/VAM_OS_HUONG_DAN_THU_RECAP_FACEBOOK_2026-08-19.html) | Cài tiện ích Chrome đọc bài trong group rồi đưa vào app để duyệt. Tiện ích đọc trang mà người dùng đã tự mở — **không có tự động hoá phía máy chủ, không lưu phiên đăng nhập Facebook ở đâu cả**. |
| [Cross-mentoring cho ban tổ chức](CROSS_MENTORING_HUONG_DAN_BTC.md) | Chín bước từ lúc mentee nêu nguyện vọng tới lúc chốt sổ buổi gặp, kèm bảng phân quyền và cách hệ thống tính tỷ lệ tham dự. |

---

## Mùa 12

| Tài liệu | Nội dung |
|---|---|
| [Mùa 12 trước và sau](audits/VAM_OS_S12_TRUOC_VA_SAU_2026-08-18.html) | So sánh quy trình cũ với quy trình mới, để quyết định có merge hay không. |
| [Kế hoạch đăng nhập theo chương trình](audits/VAM_OS_KE_HOACH_DANG_NHAP_CHUONG_TRINH_2026-08-19.html) | Bản vẽ luồng đăng nhập của mentor/mentee, vẽ trước khi code. |
| [Chạy migration 072 và 073](CHAY_MIGRATION_072_073.md) | Cho người giữ tài khoản Supabase: dán, bấm Run, đối chiếu kết quả. Bảy bước kèm bảng tra lỗi. |

---

## Ghi chú

- Các tài liệu đề ngày **19/08/2026** được viết cùng một đợt và đọc được độc lập
  với nhau.
- Bản `.html` và `.pdf` cùng nội dung. `.html` dễ đọc trên điện thoại hơn.
- Tài liệu mô tả **hiện trạng lúc viết**. Nếu một nút hay một màn hình không
  giống ảnh chụp trong tài liệu, tin vào app trước.
