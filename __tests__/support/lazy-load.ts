/**
 * Thời hạn cho hook NẠP SẴN một thư viện nặng mà mã sản phẩm nạp lười — `mammoth`,
 * `pdf-parse` trong lib/ai/extract-text.ts.
 *
 * Lần gọi đầu tiên trong mỗi worker phải nạp cả cây module của thư viện từ đĩa.
 * Với mammoth đó là 188 file, Node đọc tuần tự trong MỘT khối đồng bộ — gần như toàn
 * bộ là chờ đĩa, không phải tính toán. Đo 13/10/2026 trên máy phát triển:
 *   ~0,1 giây   máy rảnh, file đã từng được mở
 *   ~1,6 giây   máy rảnh, file còn "lạnh" (vừa `npm ci`, chưa ai mở)
 *   4–6 giây    giữa một lần chạy cả bộ, file lạnh
 *   ~12 giây    thêm một phiên khác đang `npm ci`
 *   10–35 giây  thêm hai bộ test và hai `npm ci` chạy nền
 * Lần đỏ đầu tiên (13/10/2026) là 32,8 giây trên thời hạn 30 giây của ca.
 *
 * Tức là để lần nạp đó nằm trong thân ca thì thời hạn của ca đo tải của máy, không
 * đo việc của ca. Cách chữa: một `beforeAll` gọi đúng cửa của sản phẩm một lần, mang
 * thời hạn này; các ca phía sau giữ thời hạn của chúng cho việc của chúng. Dưới mức
 * tải nặng nhất ở trên: lần nạp lâu nhất ~35 giây; đã nạp sẵn thì ca lâu nhất 2,6 giây.
 *
 *   beforeAll(async () => {
 *     expect(await extractTextFromFile(docx, AI_UPLOAD_KINDS.docx)).not.toBeNull();
 *   }, LAZY_LOAD_TIMEOUT);
 *
 * Hai điều giữ cho hook đó không che lỗi:
 *   - Gọi hàm của sản phẩm, ĐỪNG tự `import("mammoth")` trong test. Test tự nạp thì
 *     nạp gì, theo thứ tự nào không còn do mã sản phẩm quyết định — mà đó chính là
 *     thứ lib/ai/extract-text.ts phải làm đúng (`pdf-parse/worker` TRƯỚC `pdf-parse`).
 *   - Khẳng định lần gọi đó THÀNH CÔNG. Bỏ kết quả đi thì một lỗi chỉ xảy ra ở lần
 *     gọi đầu sẽ bị hook nuốt mất và mọi ca phía sau vẫn xanh (đã thử bằng cách cố ý
 *     làm hỏng lần đọc đầu); mà mỗi lần function khởi động lạnh trên Vercel đều là
 *     một "lần gọi đầu".
 *
 * Vì sao không nới thời hạn chung trong vitest.config.ts: các ca này đã tự đặt thời
 * hạn, và thời hạn đặt trên ca thắng thời hạn chung — nới chung không chạm tới chúng,
 * trong khi một ca treo thật ở mọi file còn lại sẽ lâu lộ hơn.
 */
export const LAZY_LOAD_TIMEOUT = 120_000;
