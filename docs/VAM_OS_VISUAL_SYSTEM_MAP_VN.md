# VAM OS: Sơ đồ Hệ thống Logic (Visual System Map)

Sơ đồ này mô tả cách các lớp dữ liệu tương tác để chuyển hóa từ con người thành quyết định quản trị.

## 1. Luồng dữ liệu (Flow)
**People** → **Profiles** → **Matches** → **Recaps** (+ **Batches**) → **Dashboard**

---

## 2. Chi tiết các lớp (Layers)

### Lớp 1: People (Danh tính)
*   **Định nghĩa**: Lưu trữ thông tin cá nhân cơ bản (Họ tên, Email, SĐT).
*   **Tính chất**: Duy nhất. Email là khóa định danh chính.

### Lớp 2: Profiles (Vai trò)
*   **Định nghĩa**: Mentor Profile (Kinh nghiệm, ngành nghề) và Mentee Profile (Trường, chuyên ngành).
*   **Tính chất**: Một Person có thể có cả hai Profile nếu họ tham gia với các vai trò khác nhau.

### Lớp 3: Matches (Mối quan hệ)
*   **Định nghĩa**: Sự ghép cặp giữa 1 Mentor và 1 Mentee.
*   **Tính chất**: Được quản lý theo Mùa (Season). Một Mentor có thể có nhiều Match (kèm nhiều Mentee).

### Lớp 4: Recaps (Đơn vị hoạt động)
*   **Định nghĩa**: Bản ghi của một buổi gặp 1-kèm-1.
*   **VAI TRÒ**: Đây là **đơn vị đo lường cốt lõi**. Recap trả lời câu hỏi: "Mentoring có thực sự diễn ra không?"

### Lớp 5: Intake Batches (Đơn vị thực thi)
*   **Định nghĩa**: Cách gom nhóm để vận hành (Ví dụ: `UEHM-S12-B1`).
*   **VAI TRÒ**: Giúp admin quản lý theo từng đợt tuyển và khớp cặp, đảm bảo tính quy trình.

### Lớp 6: Dashboard (Lớp quyết định)
*   **Định nghĩa**: Giao diện tổng hợp dữ liệu từ Recap và Match.
*   **VAI TRÒ**: Giúp admin phát hiện ngay lập tức các "vùng đỏ" (ví dụ: Mentee không có recap trong 2 tháng) để ra quyết định can thiệp.

---

## 3. Tóm tắt nguyên lý
*   **Recap** = Nhịp đập (Hoạt động).
*   **Batch** = Khung vận hành (Quy trình).
*   **Dashboard** = Trung tâm chỉ huy (Quyết định).

---
*Phiên bản: 1.2.0 (Tháng 5, 2026)*
