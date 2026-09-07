import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { getPublicConfirmationByToken } from "@/lib/mentor-confirmations";
import { ConfirmForm } from "./confirm-form";

/**
 * Public mentor confirmation page.
 *
 * The token in the URL is the only credential — there is no login. The page is
 * therefore read-only on GET (mail scanners and link previewers fetch these
 * URLs routinely, so a GET must never record an answer), and it is marked
 * noindex with no referrer so the token cannot leak into a search index or into
 * a third-party site's referrer log.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Xác nhận đồng hành — VAM Mentoring",
  description: "Trang xác nhận tham gia mùa mới dành cho mentor VAM Mentoring.",
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
            Xác nhận đồng hành cùng chương trình
          </h1>
        </header>
        {children}
      </section>
    </main>
  );
}

function NotFoundView() {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-vam-ink">Không tìm thấy đường dẫn</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Đường dẫn xác nhận không đúng hoặc đã được thay thế. Anh/chị vui lòng kiểm tra lại email mời
        mới nhất từ ban tổ chức, hoặc trả lời email đó để được gửi lại đường dẫn.
      </p>
    </Card>
  );
}

function ExpiredView() {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-vam-ink">Đường dẫn đã hết hạn</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Thời hạn xác nhận qua đường dẫn này đã kết thúc. Anh/chị vui lòng trả lời email mời để ban tổ
        chức gia hạn hoặc ghi nhận phản hồi trực tiếp.
      </p>
    </Card>
  );
}

function LockedView({ status, maxMentees }: { status: string; maxMentees: number | null }) {
  const answered =
    status === "confirmed"
      ? `Ban tổ chức đã ghi nhận: anh/chị tiếp tục đồng hành${
          maxMentees ? `, nhận tối đa ${maxMentees} mentee` : ""
        }.`
      : status === "declined"
        ? "Ban tổ chức đã ghi nhận: anh/chị không tiếp tục mùa này."
        : "Ban tổ chức đã ghi nhận phản hồi của anh/chị.";

  return (
    <Card>
      <h2 className="text-lg font-semibold text-vam-ink">Phản hồi đã được ghi nhận</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{answered}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Nếu cần thay đổi, anh/chị vui lòng liên hệ trực tiếp ban tổ chức — việc ghép cặp có thể đã bắt
        đầu dựa trên thông tin này.
      </p>
    </Card>
  );
}

export default async function MentorConfirmPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const view = await getPublicConfirmationByToken(params.token);

  if (view.state === "not_found") {
    return (
      <Shell>
        <NotFoundView />
      </Shell>
    );
  }

  if (view.state === "expired") {
    return (
      <Shell>
        <ExpiredView />
      </Shell>
    );
  }

  if (view.state === "locked") {
    return (
      <Shell>
        <LockedView status={view.status} maxMentees={view.maxMentees} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <p className="text-sm leading-6 text-slate-600">
          Kính gửi <strong className="text-vam-ink">{view.mentorName || "anh/chị"}</strong>, ban tổ chức
          đang chuẩn bị cho <strong className="text-vam-ink">{view.seasonLabel || "mùa mới"}</strong> và
          rất mong tiếp tục đồng hành cùng anh/chị. Anh/chị vui lòng trả lời vài câu hỏi ngắn dưới đây.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Đường dẫn này dành riêng cho anh/chị, vui lòng không chuyển tiếp cho người khác.
        </p>

        <div className="mt-5">
          <ConfirmForm
            token={params.token}
            updatedAt={view.updatedAt}
            initialStatus={view.status}
            initialMaxMentees={view.maxMentees}
            initialAgreeToReview={view.agreeToReview}
            initialAgreeToInterview={view.agreeToInterview}
            initialNote={view.note}
            alreadyAnswered={Boolean(view.respondedAt)}
          />
        </div>
      </Card>
    </Shell>
  );
}
