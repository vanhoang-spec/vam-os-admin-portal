"use client";

/**
 * Báo lỗi — thẻ "CẦN ĐỌC" trên Công việc của tôi và Tổng quan (chủ chương trình 27/10/2026): báo cho cả ban
 * tổ chức rằng từ nay mọi lỗi / điểm cần cải thiện gửi qua nút "Báo lỗi", kể cả việc còn tồn đọng chưa
 * xong. Bấm "Đã đọc" thì ẩn trên máy này; tự hết hiện sau HET_HIEN.
 *
 * Đây là thông báo một lần, nên trạng thái "đã đọc" chỉ lưu trên trình duyệt (localStorage) — không
 * cần bảng, và nguồn của Công việc của tôi giữ đúng luật chỉ đọc (__tests__/my-work.test.tsx mục 10).
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const KHOA = "vam_can_doc_bao_loi_27_10_2026";
const HET_HIEN = Date.UTC(2026, 10, 30, 17, 0, 0); // hết 30/11/2026 giờ Việt Nam

export function CanDocBaoLoi() {
  const [hien, setHien] = useState(false);
  useEffect(() => {
    let daDoc = false;
    try {
      daDoc = window.localStorage.getItem(KHOA) === "1";
    } catch {
      daDoc = false;
    }
    setHien(!daDoc && Date.now() < HET_HIEN);
  }, []);
  if (!hien) return null;

  function daDoc() {
    try {
      window.localStorage.setItem(KHOA, "1");
    } catch {
      /* chế độ riêng tư: lần sau hiện lại, không sao */
    }
    setHien(false);
  }

  return (
    <section aria-labelledby="can-doc-bao-loi" className="mb-4 rounded-lg border-2 border-orange-300 bg-orange-50 p-4 text-sm text-vam-ink">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-bold text-white">CẦN ĐỌC</span>
        <h2 id="can-doc-bao-loi" className="font-bold">
          Từ 27/10/2026: báo lỗi và góp ý cải thiện ngay trên VAM OS
        </h2>
      </div>
      <ul className="ml-5 list-disc space-y-0.5">
        <li>
          Gặp lỗi, hoặc thấy điểm nào cần làm tốt hơn: bấm nút cam <b>“Báo lỗi”</b> ở góc dưới bên trái mọi trang — chọn loại (có “Đề xuất cải thiện”), ghi
          tiêu đề, mô tả và dán hình chụp màn hình (Ctrl + V), rồi bấm “Gửi báo lỗi”.
        </li>
        <li>
          <b>Những việc còn tồn đọng, chưa xong hoặc chưa ổn từ trước cũng đưa hết vào đây</b> — mỗi việc một báo lỗi, không nhắn rời qua Zalo nữa.
        </li>
        <li>Mỗi ngày 17:00 ban xử lý rà báo lỗi; cần thêm thông tin thì bạn nhận thư + pop-up “Trả lời ngay”. Sửa xong bạn thấy trả lời khi mở VAM OS.</li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/bao-loi" className="rounded-md bg-orange-500 px-3 py-1.5 font-semibold text-white hover:bg-orange-600">
          Gửi báo lỗi / góp ý ngay
        </Link>
        <button type="button" onClick={daDoc} className="rounded-md border border-orange-300 bg-white px-3 py-1.5 font-semibold text-orange-800 hover:bg-orange-100">
          Đã đọc
        </button>
      </div>
    </section>
  );
}
