import QRCode from "qrcode";
import { getTicketByCode } from "@/lib/event-checkin";
import { checkinCodeUrl } from "@/lib/event-checkin-code";
import { getPublicOrigin } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vé tham dự — VAM Mentoring" };

/**
 * Tấm vé cá nhân của một người tham dự.
 *
 * Công khai có chủ ý: mã nằm trong hộp thư của chính chủ, và trang này phải mở
 * được trên một điện thoại chưa đăng nhập, ở cửa sự kiện, có khi bằng mạng 3G.
 *
 * Vì công khai nên nó chỉ hiện những gì cần để nhận ra tấm vé — họ tên và các
 * trạm đã đi qua. Không email, không số điện thoại, không mã số sinh viên: một
 * mã lọt ra ngoài không được kéo theo hồ sơ của ai.
 */
export default async function TicketPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const { ticket } = await getTicketByCode(code);

  if (!ticket) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-800">Không tìm thấy vé</h1>
          <p className="mt-2 text-sm text-slate-600">
            Đường dẫn này không ứng với vé nào. Kiểm lại email xác nhận, hoặc liên hệ ban tổ chức.
          </p>
        </div>
      </main>
    );
  }

  // Không có origin thì vẫn dựng được QR từ đường dẫn tương đối của chính
  // trang này — nhưng mã QR phải mang một URL tuyệt đối để camera mở được, nên
  // thiếu origin là thiếu thật và phải nói ra.
  const origin = (await getPublicOrigin()) ?? "";
  const qr = await QRCode.toDataURL(checkinCodeUrl(origin, ticket.code), {
    margin: 2,
    // Đủ lớn để lưu thành ảnh rồi mở ra quét: ảnh lưu từ một mã nhỏ, lại bị thu
    // nhỏ thêm trong thư viện ảnh, là mã camera ở cửa phải dí sát mới đọc được.
    width: 640
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-vam-ink px-5 py-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">
            Vé tham dự
          </p>
          <h1 className="mt-1 text-xl font-semibold">{ticket.fullName || "Người tham dự"}</h1>
        </div>

        <div className="flex flex-col items-center gap-3 px-5 py-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Mã QR điểm danh" width={280} height={280} className="h-auto w-full max-w-[280px]" />
          <p className="font-mono text-lg tracking-[0.3em] text-vam-ink">{ticket.code}</p>
          {/* Lưu thành ảnh để mở được cả khi ở cửa không có mạng, và không phải lục
              lại hộp thư giữa hàng người. Một mã dùng cho mọi lần quét của cả buổi. */}
          <a
            href={qr}
            download={`ve-${ticket.code}.png`}
            className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
          >
            Lưu ảnh mã QR
          </a>
          <p className="text-center text-sm text-slate-600">
            Đưa mã này cho ban tổ chức quét khi tới sự kiện. Không cần gõ gì. Cả buổi chỉ dùng một mã này, ở
            mọi điểm quét.
          </p>
          <p className="text-center text-xs text-slate-500">
            Nếu nút không lưu được ảnh, nhấn giữ vào mã QR rồi chọn lưu ảnh.
          </p>
        </div>

        {ticket.badges.length ? (
          <div className="border-t border-slate-200 px-5 py-4">
            <h2 className="text-xs font-semibold uppercase text-slate-500">Đã đi qua</h2>
            <ul className="mt-2 flex flex-wrap gap-1">
              {ticket.badges.map((badge) => (
                <li
                  key={badge.station}
                  className="rounded-full border border-vam-green/40 bg-vam-mint px-2 py-0.5 text-[11px] text-vam-ink"
                >
                  {badge.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </main>
  );
}
