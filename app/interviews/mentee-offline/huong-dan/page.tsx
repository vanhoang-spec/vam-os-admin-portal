import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DESCRIPTOR_LEVELS } from "@/lib/mentee-interview-rubric-core";
import { getInterviewGuide } from "@/lib/mentee-offline";
import { OFFLINE_PATH } from "@/lib/mentee-offline-core";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Hướng dẫn phỏng vấn mentee của mùa hiện hành — đọc được trên điện thoại ngay
 * tại bàn phỏng vấn. Phần trên là tóm tắt phiếu chấm (luôn có nếu mùa có phiếu);
 * phần dưới là Handbook BTC tải lên từ file Word, đã lọc chỉ còn chữ và bảng.
 * Cùng cổng xem với màn hình phỏng vấn (vam104_offline_access).
 */

const handbookStyle =
  "text-sm leading-relaxed [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold " +
  "[&_h3]:mt-3 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_td]:align-top " +
  "[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_a]:text-vam-green [&_a]:underline";

export default async function MenteeInterviewGuidePage() {
  const result = await getInterviewGuide();
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Hướng dẫn phỏng vấn mentee" />
        <Card><EmptyState message={result.message} /></Card>
      </div>
    );
  }
  const rubric = result.data.rubric;
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Hướng dẫn phỏng vấn mentee"
        description={rubric ? `Phiếu chấm ${rubric.seasonCode} · phiên bản ${rubric.version}${rubric.own ? "" : ` · mùa ${result.seasonCode} đang dùng phiếu gần nhất`}` : undefined}
      />
      <Link href={OFFLINE_PATH} className="w-fit rounded border px-3 py-2">← Về màn hình phỏng vấn</Link>

      {!rubric ? (
        <Card><EmptyState message="Mùa này chưa có phiếu chấm và Handbook. Nhờ BTC cài ở mục Phiếu chấm & hướng dẫn mentee." /></Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-2 text-base font-semibold text-vam-ink">Phiếu chấm — {rubric.criteria.length} tiêu chí</h2>
            {rubric.guidance.motto ? <p className="mb-1 font-medium">Kim chỉ nam: {rubric.guidance.motto}</p> : null}
            {rubric.guidance.note ? <p className="mb-3 text-sm text-slate-600">{rubric.guidance.note}</p> : null}
            <div className="grid gap-3">
              {rubric.criteria.map((c, index) => (
                <section key={c.key} className="rounded-md border border-slate-200 p-3">
                  <h3 className="font-semibold">
                    {index + 1}. {c.label} <span className="font-normal text-slate-500">· {c.weight}%</span>
                  </h3>
                  {c.label_en ? <p className="text-xs text-slate-500">{c.label_en}</p> : null}
                  {c.question ? <p className="mt-1 text-sm">Câu hỏi cốt lõi: <strong>{c.question}</strong></p> : null}
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                    {DESCRIPTOR_LEVELS.map((level) =>
                      c.descriptors?.[level] ? (
                        <div key={level} className="rounded bg-slate-50 p-2">
                          <dt className="font-semibold">{level} điểm</dt>
                          <dd>{c.descriptors[level]}</dd>
                        </div>
                      ) : null
                    )}
                  </dl>
                  {c.interview_questions?.length ? (
                    <div className="mt-2 text-sm">
                      <p className="font-medium">Câu hỏi gợi ý</p>
                      <ul className="list-disc pl-5">{c.interview_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
            {rubric.guidance.reminder ? <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">Nhắc Mentor: {rubric.guidance.reminder}</p> : null}
          </Card>

          <Card>
            <h2 className="mb-1 text-base font-semibold text-vam-ink">Handbook phỏng vấn</h2>
            {rubric.handbookHtml ? (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  {rubric.handbookFileName}
                  {rubric.handbookUpdatedAt ? ` · cập nhật ${formatDateTime(rubric.handbookUpdatedAt)}` : ""}
                  {rubric.handbookUpdatedByName ? ` · ${rubric.handbookUpdatedByName}` : ""}
                </p>
                {/* HTML đã lọc lúc lưu và lọc lại trong getInterviewGuide (lib/handbook-html.ts): chỉ chữ và bảng. */}
                <div className={handbookStyle} dangerouslySetInnerHTML={{ __html: rubric.handbookHtml }} />
              </>
            ) : (
              <EmptyState message="BTC chưa tải Handbook cho mùa này. Phần phiếu chấm ở trên vẫn đủ để phỏng vấn." />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
