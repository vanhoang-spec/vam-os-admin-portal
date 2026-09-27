import QRCode from "qrcode";

/** Mã điểm danh tách khỏi link đổi ca: ảnh vé không cấp quyền đổi lịch. */
export async function InterviewTicket({ code }: { code: string }) {
  if (!code) return <p role="alert">Chưa tải được vé. Bạn mở lại link hoặc liên hệ ban tổ chức.</p>;
  const image = await QRCode.toDataURL(`VAM-PV:${code}`, { width: 360, margin: 2, errorCorrectionLevel: "M" });
  return (
    <div className="mt-4 grid justify-items-center gap-3 rounded-lg bg-white p-4 text-center">
      <h3 className="font-semibold">Mã QR check-in phỏng vấn</h3>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} width={280} height={280} alt="Mã QR check-in phỏng vấn của bạn" />
      <a href={image} download="ve-phong-van-mentee.png" className="rounded-md bg-vam-green px-4 py-3 font-semibold text-white">Lưu ảnh mã QR</a>
      <p className="text-sm">Nếu nút không lưu được ảnh, nhấn giữ QR rồi chọn lưu ảnh. Đưa mã này cho Support Team khi tới phỏng vấn.</p>
      <p className="text-sm text-slate-600">Xác nhận ngay tại đây, không gửi thêm email. Mở lại link trong thư mời để xem ca hiện tại. Đến trước giờ hẹn 10 phút.</p>
    </div>
  );
}
