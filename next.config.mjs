/** @type {import('next').NextConfig} */
const nextConfig = {
  // Công cụ AI đọc PDF bằng pdf-parse. ĐỪNG GỠ: đóng gói pdf-parse vào bundle thì
  // pdf.js không tìm thấy worker của nó, và mọi lần đọc PDF trả về rỗng mà không có
  // lỗi nào hiện ra (lib/ai/extract-text.ts cố ý nuốt lỗi từng file). @napi-rs/canvas
  // là thư viện native pdf.js nạp lúc import; nó phải được đọc từ node_modules chứ
  // không thể nằm trong bundle.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  experimental: {
    serverActions: {
      // Mặc định 1MB; vượt mức thì Next trả 413 TRƯỚC khi action chạy và trang vỡ.
      // Giới hạn này áp cho MỌI server action, kể cả form ứng tuyển công khai, nên
      // chỉ nới vừa đủ cho một file 8MB của Công cụ AI (lib/ai/upload-core.ts).
      bodySizeLimit: "10mb"
    }
  }
};

export default nextConfig;
