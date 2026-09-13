/**
 * Tải lại hẳn trang, lấy bộ mã mới từ máy chủ.
 *
 * Tách thành module riêng để test giả được: jsdom không cho định nghĩa lại
 * `window.location`, nên một test gọi thẳng `reload()` không có cách nào biết
 * nút đã gọi nó hay chưa.
 */
export function hardReload() {
  window.location.reload();
}
