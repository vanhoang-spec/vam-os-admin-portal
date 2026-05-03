import Link from "next/link";

export const metadata = {
  title: "Cảm ơn đã đăng ký — VAM Mentoring"
};

export default function ApplyThanksPage({
  searchParams
}: {
  searchParams?: { role?: string };
}) {
  const role = searchParams?.role === "mentor" ? "mentor" : "mentee";
  const roleLabel = role === "mentor" ? "mentor" : "mentee";

  return (
    <section className="rounded-lg border border-vam-line bg-white p-6 shadow-soft sm:p-10">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-vam-mint text-2xl text-vam-green">
          ✓
        </div>
        <h1 className="text-2xl font-semibold text-vam-ink">Cảm ơn anh/chị/bạn đã đăng ký.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Hồ sơ {roleLabel} của bạn đã được ghi nhận trong hệ thống VAM OS. BTC chương trình
          sẽ liên hệ qua email/Zalo sau khi review. Vui lòng kiểm tra hộp thư trong vòng
          7-10 ngày tới.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Nếu bạn có thắc mắc, vui lòng phản hồi email mời ban đầu hoặc liên hệ trực tiếp BTC.
        </p>
      </div>

      <div className="mt-8 border-t border-vam-line pt-6">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Tiếp theo bạn cần gì?</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>Theo dõi email (kể cả thư mục Spam) để nhận thông báo từ BTC.</li>
          <li>Chuẩn bị thời gian trống cho phỏng vấn / orientation nếu được mời.</li>
          <li>Cập nhật LinkedIn / CV nếu chưa kèm vào đơn — có thể gửi bổ sung sau.</li>
        </ul>
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Quay lại trang chủ VAM
        </Link>
      </div>
    </section>
  );
}
