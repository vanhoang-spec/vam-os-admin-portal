# VAM OS: Nguyên tắc Thiết kế Dashboard (Redesign Principles)

Dashboard mới của VAM OS được thiết kế theo tư duy "Quản trị dựa trên vấn đề" (Issue-first design), giúp admin hiểu tình hình chỉ trong 5 giây.

## 1. Triết lý Thiết kế
*   **Ưu tiên vấn đề thay vì số liệu**: Không chỉ hiển thị "có bao nhiêu người", mà phải hiển thị "có bao nhiêu người đang cần giúp đỡ".
*   **Giảm tải KPI (KPI Hardening)**: Chỉ giữ lại các chỉ số dẫn đến hành động cụ thể.

## 2. 5 Nguyên tắc vàng
1.  **Issue-First (Vấn đề lên trên)**: Các cảnh báo về Mentee "im lặng", Mentor quá tải hoặc dữ liệu lỗi phải nằm ở vị trí dễ thấy nhất.
2.  **Hierarchy rõ ràng (Phân cấp thông tin)**: Sử dụng kích thước và màu sắc (Đỏ, Vàng, Xanh) để dẫn dắt sự chú ý của admin vào nơi quan trọng nhất.
3.  **Mobile-First (Ưu tiên di động)**:
    *   Sử dụng **Card (Thẻ)** thay cho bảng ngang trên màn hình nhỏ.
    *   Nút bấm hành động (Gọi điện, Email) phải lớn và dễ thao tác bằng một tay.
4.  **Actionable Context (Hành động trực tiếp)**: Mỗi con số trên dashboard nên có link dẫn đến danh sách chi tiết để admin có thể xử lý ngay (Drill-down).
5.  **Clean Aesthetics (Thẩm mỹ hiện đại)**: Sử dụng khoảng trắng hợp lý, Typography hiện đại (Inter/Roboto) và các biểu tượng (Icons) trực quan để giảm bớt sự nặng nề của dữ liệu.

## 3. Cấu trúc Dashboard đề xuất
*   **Top**: 3 Thẻ vấn đề khẩn cấp (Silent Mentee, Overloaded Mentor, Missing Recaps).
*   **Middle**: Biểu đồ tiến độ Recap tháng hiện tại (Thực tế vs Mục tiêu).
*   **Bottom**: Danh sách các "Hành động cần làm ngay" (Tasks/Follow-ups).

## 4. Trạng thái Hệ thống
*   **MVP**: Hệ thống hiện tại tập trung vào hiển thị dữ liệu chính xác từ Supabase.
*   **Lộ trình**: Tự động hóa các thông báo nhắc nhở khi phát hiện "vùng đỏ" trên Dashboard.

---
*Phiên bản: 1.2.0 (Tháng 5, 2026)*
