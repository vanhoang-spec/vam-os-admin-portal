import type { Metadata } from "next";

import { Card } from "@/components/ui";
import { getInvitationByToken } from "@/lib/cross-invitations";
import { InvitationForm } from "./invitation-form";

/**
 * Public cross-mentoring invitation page.
 *
 * The token is the only credential, exactly as at /confirm/<token>. Two
 * consequences follow and both are load-bearing.
 *
 * GET NEVER RECORDS ANYTHING. Mail scanners, link previewers and corporate
 * security proxies fetch these URLs the moment the letter lands. A page that
 * accepted on GET would mark half the mentors as available before they had read
 * the invitation.
 *
 * NOINDEX, NO-REFERRER. A token that reaches a search index or a third party's
 * referrer log is a token anybody can use.
 *
 * The page also never says who else was invited, how many accepted, or who was
 * chosen. A mentor sees their own invitation and nothing about the others.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lời mời cross-mentoring — VAM Mentoring",
  description: "Trang phản hồi lời mời tham gia buổi cross-mentoring dành cho mentor VAM.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-[#f7faf8] px-4 py-10">
      <section className="w-full max-w-xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-green">
            Vietnam Alumni Mentoring
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-vam-ink sm:text-3xl">
            Lời mời tham gia buổi cross-mentoring
          </h1>
        </header>
        {children}
      </section>
    </main>
  );
}

export default async function CrossInvitationPage({
  params
}: {
  params: { token: string };
}) {
  const view = await getInvitationByToken(params.token);

  if (view.state === "not_found") {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-vam-ink">Không tìm thấy đường dẫn</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Đường dẫn này không đúng hoặc đã được thay thế. Anh/chị vui lòng kiểm tra lại email mời
            mới nhất từ ban tổ chức, hoặc trả lời email đó để được gửi lại đường dẫn.
          </p>
        </Card>
      </Shell>
    );
  }

  if (view.state === "expired") {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-vam-ink">Đường dẫn đã hết hạn</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Thời hạn phản hồi qua đường dẫn này đã kết thúc. Nếu anh/chị vẫn muốn tham gia, vui lòng
            trả lời email của ban tổ chức — chúng tôi ghi nhận trực tiếp được.
          </p>
        </Card>
      </Shell>
    );
  }

  if (view.state === "closed") {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-vam-ink">Buổi này đã được sắp xếp xong</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Ban tổ chức đã chốt cho buổi cross-mentoring này. Cảm ơn anh/chị đã quan tâm — anh/chị
            vẫn nằm trong danh sách mời cho những buổi tiếp theo cùng lĩnh vực.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-5">
        <Card>
          <dl className="space-y-2 text-sm">
            {view.mentorName ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-vam-muted">Kính gửi:</dt>
                <dd className="font-medium text-vam-ink">{view.mentorName}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-vam-muted">Lĩnh vực:</dt>
              <dd className="font-medium text-vam-ink">{view.fieldLabel}</dd>
            </div>
            {view.seasonLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-vam-muted">Mùa:</dt>
                <dd className="font-medium text-vam-ink">{view.seasonLabel}</dd>
              </div>
            ) : null}
          </dl>

          {view.topic ? (
            <div className="mt-4 rounded-md bg-[#f7faf8] px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-vam-muted">
                Bạn mentee mong được nghe
              </p>
              <p className="mt-1 text-sm leading-6 text-vam-ink">{view.topic}</p>
            </div>
          ) : null}
        </Card>

        <InvitationForm token={params.token} updatedAt={view.updatedAt} />
      </div>
    </Shell>
  );
}
