# Hướng dẫn kiểm thử Support Team — 22/07/2026

- URL kiểm thử: `[OWNER_TO_FILL_SAFE_TEST_URL]`
- Tài khoản: `[OWNER_TO_FILL_SUPPORT_ACCOUNT]`; mật khẩu gửi qua kênh riêng, không ghi vào tài liệu/lỗi.
- Dữ liệu: chỉ dữ liệu giả có nhãn `DEMO-S12` / `DEMO-S12-B1`.
- Không sửa dữ liệu ngoài phạm vi demo, không mở production, không tải lên giấy tờ/thông tin thật.

Thực hiện các ca trong kế hoạch UAT, ghi lại route, chương trình/mùa/đợt, trình duyệt và kết quả. Với lỗi, dùng issue template; ảnh chụp phải có toàn màn hình/URL và vùng lỗi nhưng che token, mật khẩu hoặc dữ liệu cá nhân. S0 = lộ dữ liệu/bảo mật (dừng ngay); S1 = không thể tiếp tục; S2 = luồng chính sai; S3 = khó dùng/accessibility; S4 = nội dung/thẩm mỹ. Liên hệ khẩn cấp: `[OWNER_TO_FILL_UAT_ESCALATION_CONTACT]`.
