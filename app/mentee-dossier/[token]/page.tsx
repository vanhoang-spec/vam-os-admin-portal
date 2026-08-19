import type { Metadata } from "next";
import { getDossierByToken } from "@/lib/mentee-dossier";
import { applicationFieldLabel } from "@/lib/ui-labels";

/**
 * Page: /mentee-dossier/<token> — public, no login.
 *
 * What a mentor was sent instead of an email full of a student's answers. The
 * link is one mentor, one application, with an expiry date and a revoke switch,
 * and every visit is counted.
 *
 * Nothing on this page is indexable and no referrer is sent onward: the URL
 * itself is the credential.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <div className="mb-6 text-sm font-semibold uppercase tracking-wide text-vam-green">
        VAM Mentoring
      </div>
      {children}
    </main>
  );
}

export default async function MenteeDossierPage({ params }: { params: { token: string } }) {
  const view = await getDossierByToken(params.token);

  if (view.state !== "ready") {
    const message =
      view.state === "expired"
        ? `Đường dẫn này đã hết hiệu lực từ ngày ${formatDate(view.expiresAt)}. Vui lòng liên hệ ban tổ chức để được cấp lại.`
        : view.state === "revoked"
        ? "Đường dẫn này đã được ban tổ chức thu hồi. Vui lòng liên hệ ban tổ chức nếu anh/chị vẫn cần xem hồ sơ."
        : "Đường dẫn không đúng hoặc đã thay đổi. Vui lòng kiểm tra lại email mà anh/chị nhận được.";

    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-vam-ink">Không mở được hồ sơ</h1>
        <p className="mt-3 text-slate-600">{message}</p>
      </Shell>
    );
  }

  const { application } = view;

  return (
    <Shell>
      <p className="text-sm text-slate-500">
        Hồ sơ mentee {view.seasonLabel ? `· ${view.seasonLabel}` : ""}
      </p>
      <h1 className="mt-1 text-3xl font-semibold leading-tight text-vam-ink">
        {application.full_name ?? "Ứng viên"}
      </h1>
      {view.mentorName ? (
        <p className="mt-2 text-sm text-slate-600">
          Gửi mentor <strong className="text-vam-ink">{view.mentorName}</strong>.
        </p>
      ) : null}

      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Đây là thông tin cá nhân của một bạn sinh viên. Anh/chị vui lòng không chuyển tiếp đường dẫn này
        cho người khác. Đường dẫn có hiệu lực đến ngày <strong>{formatDate(view.expiresAt)}</strong>.
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin liên hệ</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ["Họ tên", application.full_name],
            ["Email", application.email_primary],
            ["Số điện thoại", application.phone_primary],
            ["Giới tính", application.gender],
            ["Ngày nộp hồ sơ", formatDate(application.submitted_at)]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
              <dd className="mt-1 break-words text-sm text-vam-ink">{value || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Nội dung hồ sơ</h2>
        {application.answers.length === 0 ? (
          <p className="text-sm text-slate-500">Hồ sơ này không có câu trả lời chi tiết.</p>
        ) : (
          <div className="space-y-2">
            {application.answers.map(([key, value]) => (
              <div key={key} className="rounded-md border border-vam-line bg-white px-3 py-2">
                <p className="text-xs font-medium uppercase text-slate-500">
                  {applicationFieldLabel(key)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-vam-ink">{value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-12 border-t border-vam-line pt-5 text-xs text-slate-500">
        Ban tổ chức VAM Mentoring · Vietnam Alumni Mentoring. Nếu cần hỗ trợ, anh/chị vui lòng trả lời
        email đã gửi kèm đường dẫn này.
      </p>
    </Shell>
  );
}
