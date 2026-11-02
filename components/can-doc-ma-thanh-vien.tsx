"use client";

/**
 * Thẻ "CẦN ĐỌC" trên Công việc của tôi và Tổng quan (chủ chương trình 03/11/2026): báo cho cả ban tổ chức rằng mã
 * thành viên UEH mới đã dùng được. Support team không vào Công việc của tôi, nên thẻ phải có cả ở Tổng quan.
 * Bấm "Đã đọc" thì ẩn trên máy này; tự hết hiện sau HET_HIEN. Cùng khuôn với thẻ Báo lỗi.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const KHOA = "vam_can_doc_ma_thanh_vien_03_11_2026";
const HET_HIEN = Date.UTC(2026, 10, 30, 17, 0, 0); // hết 30/11/2026 giờ Việt Nam

export function CanDocMaThanhVien() {
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
    <section aria-labelledby="can-doc-ma-thanh-vien" className="mb-4 rounded-lg border-2 border-orange-300 bg-orange-50 p-4 text-sm text-vam-ink">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-bold text-white">CẦN ĐỌC</span>
        <h2 id="can-doc-ma-thanh-vien" className="font-bold">
          Từ 03/11/2026: mã thành viên UEH mới đã sẵn sàng sử dụng
        </h2>
      </div>
      <ul className="ml-5 list-disc space-y-0.5">
        <li>
          Mỗi người có một mã duy nhất: <b>UEH + nhóm + 4 số</b> (R: Mentor, E: Mentee, S: Support team, C: Core team), ví dụ <b>UEHR0012</b>.
        </li>
        <li>Đã cấp cho toàn bộ mentor, mentee mùa 12, Core team và Support team.</li>
        <li>Mã hiện trên danh sách Mentor, Mentee, hồ sơ từng người và các trang liên quan, dạng UEHR0012 (UEHRF01005); trong ngoặc là mã cũ nếu có.</li>
        <li>Ô tìm kiếm nhận được cả mã mới lẫn mã cũ. Người mới được duyệt sẽ tự nhận số kế tiếp.</li>
        <li>Chỉ admin trở lên được cấp hoặc sửa mã. Thấy mã sai thì gửi qua nút “Báo lỗi”.</li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/mentors" className="rounded-md bg-orange-500 px-3 py-1.5 font-semibold text-white hover:bg-orange-600">
          Xem danh sách mentor
        </Link>
        <button type="button" onClick={daDoc} className="rounded-md border border-orange-300 bg-white px-3 py-1.5 font-semibold text-orange-800 hover:bg-orange-100">
          Đã đọc
        </button>
      </div>
    </section>
  );
}
