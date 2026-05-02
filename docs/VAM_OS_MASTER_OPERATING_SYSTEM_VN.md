# VAM OS: Tài liệu Hệ điều hành Quản trị (Master Operating System)

## 1. Tóm tắt dành cho Ban điều hành (Executive Summary)
VAM OS là nền tảng số hóa toàn bộ quy trình vận hành của Vietnam Alumni Mentoring (VAM). Hệ thống chuyển hóa các mối quan hệ con người thành dữ liệu có thể đo lường, tập trung vào đơn vị cốt lõi là **Recap** (Biên bản buổi gặp) để đánh giá sức khỏe cộng đồng và đưa ra các quyết định can thiệp kịp thời.

## 2. Mô hình Tư duy (Mental Model)
Để vận hành VAM OS, cần hiểu rõ 5 lớp dữ liệu logic:
1.  **People (Danh tính)**: Lớp nền tảng. Một người = một bản ghi duy nhất, không thay đổi.
2.  **Profiles (Vai trò)**: Lớp ngữ cảnh. Một người có thể đóng vai Mentor, Mentee hoặc cả hai.
3.  **Matches (Quan hệ)**: Lớp kết nối. Thiết lập mối quan hệ giữa Mentor và Mentee trong một mùa cụ thể.
4.  **Recaps (Hoạt động)**: Lớp nhịp đập. Minh chứng cho việc mentoring thực sự diễn ra.
5.  **Dashboard (Quyết định)**: Lớp trí tuệ. Chuyển hóa dữ liệu hoạt động thành các quyết định vận hành.

## 3. Nguyên lý Vận hành cốt lõi
*   **Recap là đơn vị đo lường trung tâm**: Mọi chỉ số (KPI) của hệ thống đều được dẫn dắt bởi Recap. Một Match chỉ được coi là "Sống" khi có Recap định kỳ.
*   **Kỳ vọng vận hành hàng tháng**: Mỗi cặp Match được kỳ vọng có ít nhất **01 Recap/tháng**.
*   **Quản trị theo đợt (Intake Batches)**: Mọi đơn ứng tuyển, ghép cặp và vận hành đều được quản lý theo Batch (Ví dụ: `UEHM-S12-B1`, `UEHM-S12-B2`). Đây là đơn vị thực thi (Execution Unit) của hệ thống.
*   **Logic Chốt tháng (Closed-month)**: Dashboard ưu tiên hiển thị dữ liệu của tháng đã chốt để đảm bảo tính chính xác cho các báo cáo quản trị chính thức.

## 4. Danh mục Chương trình (Programs)
VAM OS hỗ trợ đa chương trình, bao gồm:
*   **UEHM**: UEH Mentoring
*   **HAM**: Hanoi Alumni Mentoring
*   **FTU**: Ngoại thương
*   **BK**: Bách khoa
*   **HUFLIT**, **HUB**, **DUE**,...

## 5. Tình trạng MVP & Bảo mật
*   **Hiện tại**: Hệ thống đang ở giai đoạn MVP (Minimum Viable Product).
*   **Bảo mật**: Chưa kích hoạt RLS (Row Level Security). Quyền truy cập hiện được quản lý ở tầng Ứng dụng.

---
*Phiên bản: 1.2.0 (Tháng 5, 2026)*
