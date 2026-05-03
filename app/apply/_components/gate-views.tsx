/**
 * Visual states for the public /apply pages when the pilot token gate
 * is closed or running in dev-bypass mode. Pure presentational; no
 * data-fetching.
 */

export function ClosedFormView() {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-6 shadow-soft sm:p-10">
      <h1 className="text-2xl font-semibold text-vam-ink">Form chưa được mở công khai.</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Đường link đăng ký đang ở chế độ pilot và chỉ mở cho danh sách được BTC mời. Nếu bạn
        nhận được email mời nhưng không truy cập được, vui lòng phản hồi lại email mời để BTC
        kiểm tra.
      </p>
      <p className="mt-3 text-xs text-slate-500">VAM OS · Vietnam Alumni Mentoring</p>
    </section>
  );
}

export function DevWarningBanner({ reason }: { reason: string }) {
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <strong>Dev bypass:</strong> {reason} Form chỉ ghi vào DB local/staging. KHÔNG dùng URL
      này trên production khi chưa cấu hình token.
    </div>
  );
}
