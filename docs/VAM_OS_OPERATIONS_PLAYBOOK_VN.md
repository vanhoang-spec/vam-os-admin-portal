# VAM OS: Sổ tay Vận hành (Operations Playbook)

Tài liệu này hướng dẫn cách Coreteam và Ban Vận hành sử dụng hệ thống VAM OS để quản lý hoạt động mentoring thực tế hàng ngày, hàng tuần và hàng tháng.

---

## 1. Quy trình Vận hành Hàng tháng (Monthly Workflow)

Hệ thống VAM OS xoay quanh "nhịp đập" hàng tháng. Mục tiêu là đảm bảo mọi cặp Match đều hoạt động.

### Kỳ vọng Recap
*   **Tiêu chuẩn:** Mỗi Mentee được kỳ vọng có ít nhất **01 Recap/tháng**.
*   **Ý nghĩa:** Recap là minh chứng duy nhất cho việc mentoring có diễn ra. Không có recap đồng nghĩa với việc cặp match đang "im lặng".

### Kiểm tra Mentee im lặng (Silent Mentees)
1.  Truy cập **Dashboard** hoặc trang **Operations**.
2.  Xem danh sách tại khu vực **"Mentees im lặng"** (Dữ liệu tính từ tháng đã chốt gần nhất).
3.  Lọc theo từng Batch hoặc Program để phân chia cho team hỗ trợ.

### Quy trình Follow-up (Theo dõi hỗ trợ)
*   Hệ thống tự động liệt kê các Mentee thiếu hoạt động.
*   Admin dựa trên danh sách này để bắt đầu quy trình liên hệ (Email/Zalo/Điện thoại).

---

## 2. Vai trò và Trách nhiệm (Roles & Responsibilities)

*   **Super Admin:** Quản lý toàn bộ hệ thống, cấu hình mùa vụ (Seasons), chương trình (Programs) và phân quyền. Chịu trách nhiệm chốt dữ liệu tháng (Data Governance).
*   **Admin (Vận hành):** Theo dõi dashboard, xử lý danh sách follow-up, rà soát lỗi dữ liệu và liên hệ hỗ trợ các cặp match.
*   **Reviewer (Hỗ trợ/Kiểm soát):** Đọc nội dung Recap, đánh giá chất lượng buổi gặp, gắn cờ (flag) các vấn đề cần admin xử lý sâu hơn.

---

## 3. Hoạt động Định kỳ (Daily / Weekly Actions)

### Công việc hàng tuần của Admin
*   Kiểm tra mục **"Data Issues"**: Xử lý các lỗi trùng email, thiếu số điện thoại hoặc match bị lỗi.
*   Rà soát **"Follow-up Queue"**: Đảm bảo các yêu cầu hỗ trợ mới được phân bổ cho người phụ trách.
*   Cập nhật trạng thái các Match (Active/Inactive) nếu có biến động.

### Công việc hàng tuần của Reviewer
*   Duyệt danh sách Recap mới: Đảm bảo link recap hợp lệ và nội dung không có vấn đề nghiêm trọng.
*   Gắn cờ **"Issue Flag"** trên Recap nếu phát hiện mâu thuẫn hoặc yêu cầu hỗ trợ từ Mentor/Mentee.

---

## 4. Quy trình xử lý sự cố (Follow-up Workflow)

Quy trình 4 bước để đảm bảo không bỏ sót bất kỳ cặp match nào:
1.  **Phát hiện (Detect):** Hệ thống cảnh báo Mentee im lặng hoặc Recap có cờ đỏ.
2.  **Phân bổ (Assign):** Admin giao vụ việc cho người phụ trách (Support lead).
3.  **Liên hệ (Contact):** Người phụ trách liên hệ Mentor/Mentee để tìm hiểu nguyên nhân (Bận việc, mất kết nối, vấn đề cá nhân...).
4.  **Giải quyết (Resolve):** Cập nhật ghi chú vào hệ thống, sửa đổi thông tin match nếu cần hoặc đóng vụ việc nếu đã xử lý xong.

---

## 5. Kịch bản thực tế (Example Scenario)

**Tình huống:** Mentee Nguyễn Văn A (Batch S12-B1) không có recap trong 2 tháng liên tiếp.

**Các bước xử lý:**
*   **Bước 1:** Admin vào trang **People**, tìm hồ sơ Nguyễn Văn A.
*   **Bước 2:** Xem lịch sử liên lạc và ghi chú cũ (nếu có).
*   **Bước 3:** Gửi tin nhắn/gọi điện cho Mentee A để nhắc nhở.
*   **Bước 4:** Nếu Mentee không phản hồi, liên hệ với Mentor tương ứng để kiểm tra tình trạng buổi gặp.
*   **Bước 5:** 
    *   Nếu đã gặp nhưng quên báo cáo: Nhắc mentee bổ sung recap.
    *   Nếu không gặp được: Tìm hiểu lý do và đề xuất giải pháp (nhắc nhở hoặc break-match).
*   **Bước 6:** Ghi chú kết quả vào mục **"Admin Notes"** của Match để team cùng theo dõi.

---

## 6. Checklist Chốt tháng (Month-end Checklist)

Trước khi đóng dữ liệu một tháng để báo cáo Ban điều hành, Admin cần thực hiện:
- [ ] 100% Recap trong tháng đã được Reviewer rà soát.
- [ ] Xử lý xong ít nhất 90% các cảnh báo trong mục "Data Issues".
- [ ] Cập nhật kết quả follow-up cho tất cả Silent Mentees của tháng trước đó.
- [ ] Kiểm tra tính chính xác của số lượng Match Active so với thực tế vận hành.
- [ ] Backup dữ liệu hoặc xuất báo cáo KPI (nếu cần).

---
*Cập nhật lần cuối: 02/05/2026*
