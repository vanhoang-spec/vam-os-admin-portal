import type { Metadata } from "next";
import { getPublicDocumentBySlug } from "@/lib/program-documents";
import {
  AUDIENCE_LABELS,
  KIND_LABELS,
  renderDocumentHtml,
  type DocumentAudience,
  type DocumentKind
} from "@/lib/program-documents-core";

/**
 * Page: /documents/<slug> — public, no login.
 *
 * The code of conduct and the tips, as linked from the emails that go out
 * after matching. Mentees and most mentors have no account, so this page is
 * reached by address alone; it is therefore read-only, shows only PUBLISHED
 * text, and carries nothing about anybody in particular.
 *
 * The body is rendered by `renderDocumentHtml`, which escapes the stored text
 * before adding its own tags — the text was typed into an admin form, and this
 * is the one place it is shown without a login in front of it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // A program document is for the people who were sent the link, not for search.
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <div className="mb-6 text-sm font-semibold uppercase tracking-wide text-vam-green">
        VAM Mentoring
      </div>
      {children}
      <p className="mt-12 border-t border-vam-line pt-5 text-xs text-slate-500">
        Ban tổ chức VAM Mentoring · Vietnam Alumni Mentoring. Nếu cần hỗ trợ, vui lòng trả lời email
        mà bạn nhận được đường dẫn này.
      </p>
    </main>
  );
}

export default async function ProgramDocumentPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const view = await getPublicDocumentBySlug(params.slug);

  if (view.state !== "ready") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-vam-ink">Không tìm thấy tài liệu</h1>
        <p className="mt-3 text-slate-600">
          {view.state === "not_published"
            ? "Tài liệu này chưa được ban tổ chức phát hành. Vui lòng quay lại sau ít ngày."
            : "Đường dẫn không đúng hoặc đã thay đổi. Vui lòng kiểm tra lại email mà bạn nhận được."}
        </p>
      </Shell>
    );
  }

  const { document } = view;
  const html = renderDocumentHtml(document.body);

  return (
    <Shell>
      <p className="text-sm text-slate-500">
        {KIND_LABELS[document.kind as DocumentKind] ?? document.kind} ·{" "}
        {AUDIENCE_LABELS[document.audience as DocumentAudience] ?? document.audience}
      </p>
      <h1 className="mt-1 text-3xl font-semibold leading-tight text-vam-ink">{document.title}</h1>

      <article
        className="vam-document mt-8 text-[15px] leading-7 text-slate-700"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <style>{`
        .vam-document h2 { font-size: 1.25rem; font-weight: 600; color: #14352a; margin: 1.8rem 0 .6rem; }
        .vam-document h3 { font-size: 1.05rem; font-weight: 600; color: #14352a; margin: 1.4rem 0 .5rem; }
        .vam-document h4 { font-size: .98rem; font-weight: 600; color: #14352a; margin: 1.2rem 0 .4rem; }
        .vam-document p { margin: 0 0 .85rem; }
        .vam-document ul, .vam-document ol { margin: 0 0 .95rem; padding-left: 1.35rem; }
        .vam-document li { margin-bottom: .35rem; }
        .vam-document ul { list-style: disc; }
        .vam-document ol { list-style: decimal; }
        .vam-document a { color: #16834c; text-decoration: underline; }
        .vam-document strong { font-weight: 600; color: #14352a; }
      `}</style>
    </Shell>
  );
}
