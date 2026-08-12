/**
 * Visual states for the public /apply pages.
 *
 * M069: the closed notice now carries the gate's own reason string. Every
 * refusal — closed, wrong token, missing token, unreadable control row —
 * produces one of two generic messages, so the page never tells an anonymous
 * visitor which condition they failed.
 */

export function ClosedFormView({ reason }: { reason?: string }) {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-6 shadow-soft sm:p-10">
      <h1 className="text-2xl font-semibold text-vam-ink">Form chưa được mở công khai.</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {reason ??
          "Đơn đăng ký chưa được mở. Vui lòng chờ thông báo chính thức từ Ban Tổ chức."}
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Nếu bạn nhận được email mời nhưng không truy cập được, vui lòng phản hồi lại email
        mời để BTC kiểm tra.
      </p>
      <p className="mt-3 text-xs text-slate-500">VAM OS · Vietnam Alumni Mentoring</p>
    </section>
  );
}

export function PilotModeBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <strong>Chế độ pilot:</strong> form này chỉ mở cho danh sách được BTC mời. Vui lòng
      không chia sẻ đường link.
    </div>
  );
}
