import Link from "next/link";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getEventSurveyOverview, listEventSurveyResponses } from "@/lib/event-survey";
import { getEventDetailData, isValidUuid } from "@/lib/events";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Câu trả lời khảo sát của một buổi.
 *
 * ---------------------------------------------------------------------------
 * HAI CỘT QUAN TRỌNG NHẤT KHÔNG PHẢI NỘI DUNG TRẢ LỜI
 * ---------------------------------------------------------------------------
 * Là "khớp đăng ký" và "đã check in". Trang này được mở ra để trả lời câu hỏi
 * hành chính — ai đủ căn cứ đề xuất điểm rèn luyện — trước khi ai đó đọc nội
 * dung. Phiếu không khớp được người là phiếu ban tổ chức phải đối chiếu tay, nên
 * nó nằm ngay đầu bảng chứ không lẫn vào giữa.
 */

const BADGE = {
  good: "rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800",
  warn: "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
};

export default async function EventSurveyResponsesPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  if (!isValidUuid(params.id)) {
    return (
      <>
        <PageHeader title="ID sự kiện không hợp lệ" />
        <ErrorBox message="Đường dẫn không chứa UUID sự kiện hợp lệ." />
      </>
    );
  }

  const scope = await getScopeFilter(await getAdminScopeContext());
  const detail = await getEventDetailData(params.id, scope);
  if (!detail.event) {
    return (
      <>
        <PageHeader title="Không tìm thấy sự kiện" />
        <EmptyState message="Không tìm thấy sự kiện trong phạm vi truy cập của bạn." />
      </>
    );
  }

  const [overview, list] = await Promise.all([
    getEventSurveyOverview(params.id),
    listEventSurveyResponses(params.id)
  ]);

  // Phiếu chưa khớp người lên đầu: đó là việc cần làm tay, và việc cần làm tay
  // mà nằm giữa hai trăm dòng thì không ai thấy.
  const rows = list.rows.slice().sort((a, b) => Number(a.matched) - Number(b.matched));

  return (
    <>
      <PageHeader
        title={`Khảo sát cuối buổi · ${displayText(detail.event.event_name, "Sự kiện")}`}
        description="Nộp phiếu được tính là check out. Đối chiếu bằng email, rồi tới số điện thoại."
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          href={`/events/${params.id}`}
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Trang sự kiện
        </Link>
        <a
          href={`/api/exports/event-registrations?event_id=${params.id}`}
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          Tải danh sách kèm câu trả lời (CSV)
        </a>
      </div>

      {list.ok ? null : <ErrorBox message={list.message ?? "Không đọc được danh sách phiếu."} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Đã check in" value={overview.checkedIn} />
        <KpiCard label="Phiếu đã nhận" value={overview.responses} />
        <KpiCard label="Đủ check in + check out" value={overview.completed} />
        <KpiCard label="Phiếu chưa khớp đăng ký" value={overview.responses - overview.matchedResponses} />
      </div>

      <div className="mt-6">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">
            Câu trả lời <span className="text-sm font-normal text-slate-500">({rows.length})</span>
          </h2>
          {rows.length === 0 ? (
            <EmptyState message="Chưa có ai nộp phiếu khảo sát cho buổi này." />
          ) : (
            <div className="grid gap-3">
              {rows.map((row) => (
                <article key={row.id} className="rounded-md border border-vam-line bg-white p-3">
                  <header className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-vam-ink">{row.fullName}</span>
                    <span className="text-sm text-slate-500">{row.email}</span>
                    {row.phone ? <span className="text-sm text-slate-500">· {row.phone}</span> : null}
                    {row.studentId ? <span className="text-sm text-slate-500">· MSSV {row.studentId}</span> : null}
                    <span className={row.matched ? BADGE.good : BADGE.warn}>
                      {row.matched ? "Khớp đăng ký" : "Chưa khớp đăng ký"}
                    </span>
                    <span className={row.checkedIn ? BADGE.good : BADGE.warn}>
                      {row.checkedIn ? "Đã check in" : "Chưa có lượt check in"}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">
                      {row.source === "email" ? "Từ thư" : "Từ mã QR"} · {formatDateTime(row.submittedAt)}
                    </span>
                  </header>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-vam-ink">{row.impression}</p>
                  {row.question ? (
                    <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-sm text-slate-700">
                      <strong>Câu hỏi cho BTC:</strong> {row.question}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
