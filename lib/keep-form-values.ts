import type { FormEvent } from "react";

/**
 * lib/keep-form-values.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Giữ nguyên những gì người dùng đã gõ khi server action trả về LỖI.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN
 * ---------------------------------------------------------------------------
 * `<form action={serverAction}>` tự gọi reset sau khi action chạy xong — kể cả
 * khi action trả lỗi. Mọi ô không-điều-khiển (defaultValue, checkbox, radio)
 * quay về giá trị ban đầu, đúng vào lúc người dùng cần sửa MỘT chỗ rồi gửi lại.
 *
 * Cái giá của nó là thật, và có người đã trả: 24/09/2026 một mentor gọi điện
 * góp ý rằng gõ sai câu xác nhận trong form gia hạn thì phải điền lại toàn bộ
 * — hai mươi mốt ô, chỉ vì một dấu tiếng Việt. Ô đó chỉ được `required` ở trình
 * duyệt (không rỗng là qua), còn phép so từng chữ nằm ở máy chủ, nên lỗi CHỈ
 * lộ ra sau khi action đã chạy — tức là đúng lúc form bị xoá.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO KHÔNG SỬA BẰNG CÁCH KHÁC
 * ---------------------------------------------------------------------------
 * Biến mọi ô thành ô điều khiển (useState) cũng giữ được giá trị, nhưng phải
 * viết lại cả biểu mẫu và thêm một nguồn sự thật thứ hai cho mỗi ô. Chặn đúng
 * một sự kiện thì rẻ hơn và không đổi hành vi nào khác.
 *
 * Dự án dùng React 18.3.1 và `useFormState` của `react-dom` (KHÔNG phải
 * `useActionState` — xem CLAUDE.md), nên không có sẵn đường trả giá trị cũ về
 * biểu mẫu như React 19.
 *
 * ---------------------------------------------------------------------------
 * KHI NÀO KHÔNG DÙNG
 * ---------------------------------------------------------------------------
 * Biểu mẫu nhập liên tiếp nhiều bản ghi — thêm buổi, thêm người — thì reset là
 * đúng: người dùng muốn ô trống cho lần nhập kế tiếp. Chỉ gắn hàm này cho biểu
 * mẫu mà người ta điền MỘT lần và điền lâu.
 */
export function keepFormValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}
