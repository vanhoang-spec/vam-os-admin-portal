"use client";
import { useState } from "react";
import {
  DESCRIPTOR_LEVELS,
  EXPECTATION_ALIGNMENTS,
  TAKE_CHOICES,
  formatWeightedScore,
  type ExpectationAlignment,
  type InterviewRubric,
  type TakeChoice
} from "@/lib/mentee-interview-rubric-core";
import {
  OFFLINE_OUTCOMES,
  PROFILE_SCREENING_SCORES,
  type OfflineOperation,
  type OfflineOutcome,
  type OfflineReview
} from "@/lib/mentee-offline-core";

const field = "w-full rounded-md border border-slate-300 bg-white p-2";
const button = "rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-50";

export type ResultFormProps = {
  rubric: InterviewRubric;
  review: OfflineReview | undefined;
  operation: OfflineOperation | null;
  candidateName: string;
  mentorLabel: string;
  /** Mentor đã đủ chỗ (hoặc chưa có hồ sơ mentor hợp lệ) và cặp hiện tại không phải của lượt này. */
  full: boolean;
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
};

/**
 * Form chấm phỏng vấn vẽ từ phiếu của mùa — tiêu chí, trọng số, câu hỏi và mô tả
 * 1/3/5 đều đến từ dữ liệu, mùa sau đổi phiếu không phải sửa file này.
 *
 * KHÔNG hiện tổng điểm: phiếu ghi rõ không cộng tổng và không có điểm sàn. Điểm
 * quy đổi chỉ BTC thấy, ở thẻ kết quả sau khi lưu.
 */
export function InterviewResultForm({ rubric, review, operation: op, candidateName, mentorLabel, full, busy, onSubmit }: ResultFormProps) {
  const [outcome, setOutcome] = useState<OfflineOutcome>(op?.outcome ?? "passed");
  const [takeChoice, setTakeChoice] = useState<TakeChoice | "">(review?.take_choice ?? "");
  const [error, setError] = useState("");
  const previous = new Map((review?.interview_scores ?? []).map((s) => [s.key, s]));
  const takeLocked = outcome !== "passed" || full;

  return (
    <form
      className="grid gap-4 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!takeChoice) {
          setError("Chọn mentor có muốn nhận bạn này không (mục C).");
          return;
        }
        setError("");
        const criteria: Record<string, { score: number; note: string }> = {};
        for (const c of rubric.criteria) {
          criteria[c.key] = { score: Number(f.get(`score:${c.key}`)), note: String(f.get(`note:${c.key}`) ?? "") };
        }
        const willTake = takeChoice === "take";
        if (!window.confirm(
          `Xác nhận ${OFFLINE_OUTCOMES[outcome]} cho ${candidateName}${willTake ? " và nhận làm mentee của bạn" : ""}?` +
          `${op?.match_id && !willTake ? " Cặp hiện tại sẽ được hủy và hoàn lại chỗ." : ""}`
        )) return;
        onSubmit({
          outcome,
          rubricId: rubric.id,
          rubricVersion: rubric.version,
          criteria,
          rationale: String(f.get("rationale") ?? ""),
          keyNeed: String(f.get("keyNeed") ?? ""),
          alignment: String(f.get("alignment") ?? ""),
          alignmentNote: String(f.get("alignmentNote") ?? ""),
          takeChoice,
          desiredMentor: String(f.get("desiredMentor") ?? ""),
          additionalNote: String(f.get("additionalNote") ?? ""),
          reason: String(f.get("reason") ?? "")
        });
      }}
    >
      <div className="grid gap-1">
        <h3 className="font-semibold">Chấm phỏng vấn · {rubric.criteria.length} tiêu chí · phiếu {rubric.seasonCode} (phiên bản {rubric.version})</h3>
        {rubric.guidance.motto ? <p className="text-sm text-vam-ink">Kim chỉ nam: {rubric.guidance.motto}</p> : null}
        {rubric.guidance.note ? <p className="text-sm text-slate-600">{rubric.guidance.note}</p> : null}
      </div>

      {rubric.criteria.map((c, index) => {
        const prev = previous.get(c.key);
        return (
          <fieldset key={c.key} className="grid gap-2 rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-vam-ink">
              {index + 1}. {c.label} <span className="font-normal text-slate-500">· trọng số {c.weight}%</span>
            </legend>
            {c.label_en ? <p className="-mt-1 text-xs text-slate-500">{c.label_en}</p> : null}
            {c.question ? <p className="text-sm">Câu hỏi cốt lõi: <strong>{c.question}</strong></p> : null}
            <dl className="grid gap-1 text-xs text-slate-600 sm:grid-cols-3">
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
              <details className="text-sm">
                <summary className="cursor-pointer text-vam-green">Câu hỏi gợi ý ({c.interview_questions.length})</summary>
                <ul className="mt-1 list-disc pl-5">{c.interview_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </details>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <label>
                {c.label}
                <select required name={`score:${c.key}`} defaultValue={prev?.score ?? ""} className={field}>
                  <option value="">Chọn điểm</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label>
                Evidence / Note — {c.label}
                <textarea name={`note:${c.key}`} rows={2} defaultValue={prev?.note ?? ""} className={field} />
              </label>
            </div>
          </fieldset>
        );
      })}

      <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">A. Quyết định tuyển mentee — bắt buộc</legend>
        <label>
          Kết quả
          <select
            className={field}
            value={outcome}
            onChange={(e) => {
              const next = e.target.value as OfflineOutcome;
              setOutcome(next);
              if (next !== "passed" && takeChoice === "take") setTakeChoice("");
            }}
          >
            {Object.entries(OFFLINE_OUTCOMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>
          Lý do chọn / không chọn
          <textarea name="rationale" required rows={3} defaultValue={review?.interview_scores ? review.reviewer_note ?? "" : ""} className={field}
            placeholder='Tránh ghi chung chung như "good candidate" hay "not fit".' />
        </label>
        <label>
          Nhu cầu phát triển chính
          <textarea name="keyNeed" required rows={2} defaultValue={review?.key_development_need ?? ""} className={field} />
        </label>
      </fieldset>

      <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">B. Expectation alignment — sau khi Mentor brief lại chương trình</legend>
        <label>
          Mức độ alignment
          <select name="alignment" required defaultValue={review?.expectation_alignment ?? ""} className={field}>
            <option value="">Chọn mức độ</option>
            {(Object.entries(EXPECTATION_ALIGNMENTS) as Array<[ExpectationAlignment, string]>).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Concern / Note nếu có
          <textarea name="alignmentNote" rows={2} defaultValue={review?.alignment_note ?? ""} className={field} />
        </label>
      </fieldset>

      <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">C. Matching — tách riêng khỏi quyết định Đạt / Không chọn</legend>
        <div role="radiogroup" aria-label="Mentor có muốn nhận bạn này?" className="grid gap-1">
          <span className="text-sm">Mentor có muốn nhận bạn này? <span className="text-slate-500">({mentorLabel})</span></span>
          {(Object.entries(TAKE_CHOICES) as Array<[TakeChoice, string]>).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2">
              <input
                type="radio"
                name="takeChoice"
                value={key}
                checked={takeChoice === key}
                disabled={key === "take" && takeLocked}
                onChange={() => setTakeChoice(key)}
              />
              <span>{label}</span>
            </label>
          ))}
          {full && !op?.match_id ? <p className="text-sm text-slate-600">Chưa thể nhận thêm mentee. Vẫn có thể chốt Đạt để BTC/mentor khác ghép sau.</p> : null}
          <p className="text-xs text-slate-500">Chọn "Có" là tạo cặp ghép ngay khi lưu.</p>
        </div>
        <label>
          Chân dung Mentor phù hợp
          <textarea name="desiredMentor" required rows={2} defaultValue={review?.desired_mentor_profile ?? ""} className={field}
            placeholder="Background / experience / mentoring style phù hợp" />
        </label>
        <label>
          Additional Note (không bắt buộc)
          <textarea name="additionalNote" rows={2} defaultValue={review?.additional_note ?? ""} className={field} />
        </label>
      </fieldset>

      {op?.outcome ? (
        <label>
          Lý do sửa kết quả
          <textarea name="reason" required rows={2} className={field} />
        </label>
      ) : null}
      {rubric.guidance.reminder ? <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Nhắc Mentor: {rubric.guidance.reminder}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <p className="text-sm text-slate-600">Lưu sẽ chốt kết quả ngay. Mọi lần sửa đều có lịch sử cho BTC; chưa gửi email kết quả.</p>
      <button className={button} disabled={busy}>{busy ? "Đang lưu…" : "Xác nhận kết quả"}</button>
    </form>
  );
}

/**
 * Thẻ kết quả đã lưu. Phiếu theo mùa hiện điểm từng tiêu chí + mục A/B/C; phiếu
 * cũ (nộp theo 5 tiêu chí trước khi có phiếu theo mùa) hiện theo 5 nhãn cũ.
 * Điểm quy đổi CHỈ hiện cho Support/BTC (showWeighted).
 */
export function InterviewResultSummary({ review, operation: op, showWeighted }: {
  review: OfflineReview | undefined;
  operation: OfflineOperation;
  showWeighted: boolean;
}) {
  const scores = review?.interview_scores;
  const editReason = op.outcome_reason && op.outcome_reason !== review?.reviewer_note ? op.outcome_reason : null;
  return (
    <div className="grid gap-1">
      <strong>{op.outcome ? OFFLINE_OUTCOMES[op.outcome] : ""}</strong>
      {scores?.length ? (
        <>
          <ul className="text-sm">
            {scores.map((s) => (
              <li key={s.key}>
                {s.label}: <strong>{s.score}/5</strong> <span className="text-slate-500">({s.weight}%)</span>
                {s.note ? <span className="whitespace-pre-wrap"> — {s.note}</span> : null}
              </li>
            ))}
          </ul>
          {showWeighted ? (
            <p className="text-sm">Điểm quy đổi tham khảo: <strong>{formatWeightedScore(review?.weighted_score)}</strong> — không phải điểm sàn.</p>
          ) : null}
          {review?.reviewer_note ? <p className="whitespace-pre-wrap text-sm">Lý do chọn / không chọn: {review.reviewer_note}</p> : null}
          {review?.key_development_need ? <p className="whitespace-pre-wrap text-sm">Nhu cầu phát triển chính: {review.key_development_need}</p> : null}
          {review?.expectation_alignment ? (
            <p className="text-sm">
              Alignment: {EXPECTATION_ALIGNMENTS[review.expectation_alignment]}
              {review.alignment_note ? ` — ${review.alignment_note}` : ""}
            </p>
          ) : null}
          {review?.take_choice ? <p className="text-sm">Mentor nhận: {TAKE_CHOICES[review.take_choice]}</p> : null}
          {review?.desired_mentor_profile ? <p className="whitespace-pre-wrap text-sm">Chân dung Mentor phù hợp: {review.desired_mentor_profile}</p> : null}
          {review?.additional_note ? <p className="whitespace-pre-wrap text-sm">Ghi chú thêm: {review.additional_note}</p> : null}
        </>
      ) : (
        <>
          <p className="text-sm">Điểm phỏng vấn (phiếu cũ 5 tiêu chí): {review?.total_score ?? "—"}/25</p>
          {review ? (
            <p className="text-sm">{PROFILE_SCREENING_SCORES.map(([key, label]) => `${label}: ${review[key] ?? "—"}`).join(" · ")}</p>
          ) : null}
          {review?.reviewer_note ? <p className="whitespace-pre-wrap text-sm">{review.reviewer_note}</p> : null}
        </>
      )}
      {editReason ? <p className="whitespace-pre-wrap text-sm">Lý do sửa: {editReason}</p> : null}
    </div>
  );
}
