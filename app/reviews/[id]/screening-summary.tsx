import { Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { ApplicationReview } from "@/lib/types";

/**
 * The profile-screening result, shown to an interviewer while they score the
 * interview.
 *
 * The point of the Season 12 process is that the interview is judged against
 * what the form already said — an interviewer who cannot see the screening
 * score is scoring the same criteria twice from scratch. Only submitted rounds
 * are shown: a half-finished score is not evidence.
 */

const CRITERIA: Array<{ key: keyof ApplicationReview; label: string }> = [
  { key: "score_motivation", label: "Động lực" },
  { key: "score_goal_clarity", label: "Rõ ràng mục tiêu" },
  { key: "score_commitment", label: "Cam kết" },
  { key: "score_fit", label: "Phù hợp chương trình" },
  { key: "score_communication", label: "Giao tiếp" }
];

const RECOMMENDATION_LABELS: Record<string, string> = {
  pass_to_interview: "Mời vào vòng phỏng vấn",
  approve_recommended: "Đề xuất duyệt",
  waitlist: "Danh sách chờ",
  reject: "Không phù hợp / từ chối",
  needs_admin_review: "Cần core team xem thêm",
  pass_orientation: "Qua vòng định hướng"
};

function scoreChip(value: unknown) {
  const score = typeof value === "number" ? value : null;
  const tone =
    score === null
      ? "border-slate-200 bg-slate-50 text-slate-400"
      : score >= 4
      ? "border-green-200 bg-green-50 text-green-700"
      : score >= 3
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
  return { label: score === null ? "—" : String(score), tone };
}

export function ScreeningSummary({
  reviews,
  reviewerNameById
}: {
  reviews: ApplicationReview[];
  reviewerNameById: Map<string, string>;
}) {
  const submitted = reviews.filter(
    (review) => review.review_round === "profile_screening" && review.status === "submitted"
  );

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold text-vam-ink">Điểm vòng hồ sơ</h2>
      <p className="mb-3 text-xs text-slate-500">
        Kết quả chấm hồ sơ của ứng viên này, để anh/chị đối chiếu khi phỏng vấn.
      </p>

      {submitted.length === 0 ? (
        <EmptyState message="Hồ sơ này chưa có lượt chấm nào được nộp." />
      ) : (
        <div className="space-y-3">
          {submitted.map((review) => {
            const reviewerName = review.reviewer_admin_user_id
              ? reviewerNameById.get(review.reviewer_admin_user_id) ?? "Người chấm"
              : "Người chấm";
            return (
              <div key={review.id} className="rounded-md border border-vam-line bg-slate-50 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-vam-ink">{reviewerName}</span>
                  <span className="text-xs text-slate-500">
                    Nộp {review.submitted_at ? formatDate(review.submitted_at) : "—"}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {CRITERIA.map((criterion) => {
                    const chip = scoreChip(review[criterion.key]);
                    return (
                      <span
                        key={String(criterion.key)}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${chip.tone}`}
                      >
                        {criterion.label}
                        <strong>{chip.label}</strong>
                      </span>
                    );
                  })}
                  <span className="inline-flex items-center gap-1 rounded-md border border-vam-green/40 bg-vam-mint px-2 py-0.5 text-xs text-vam-green">
                    Tổng <strong>{review.total_score ?? "—"}</strong>
                  </span>
                </div>

                {review.recommendation ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Đề xuất:{" "}
                    <strong className="text-vam-ink">
                      {RECOMMENDATION_LABELS[review.recommendation] ?? review.recommendation}
                    </strong>
                  </p>
                ) : null}

                {review.reviewer_note ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">
                    {review.reviewer_note}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
