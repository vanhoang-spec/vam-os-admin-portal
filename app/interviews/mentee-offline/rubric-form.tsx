"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAFT_PREFIX,
  draftExpired,
  draftHasContent,
  parseDraft,
  type InterviewDraft
} from "@/lib/interview-draft-core";
import { formatDateTime } from "@/lib/utils";
import {
  DESCRIPTOR_LEVELS,
  EXPECTATION_ALIGNMENTS,
  EXPECTATION_BRIEF_NOTE,
  MAX_TAKES_PER_INTERVIEWER,
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
  /** Mentor đã chọn "Có – Tôi muốn nhận" cho đủ MAX_TAKES_PER_INTERVIEWER hồ sơ KHÁC trong mùa. */
  takeLimitReached: boolean;
  busy: boolean;
  /** Khoá localStorage của nháp (draftKey(mentor, hồ sơ)); null = không lưu nháp. */
  draftKey?: string | null;
  /** Kết quả lưu của máy chủ: ok → xoá nháp; lỗi → hiện ngay cạnh nút gửi, giữ nháp. */
  onSubmit: (values: Record<string, unknown>) => Promise<boolean | { ok: boolean; message?: string }> | void;
};

const DRAFT_DEBOUNCE_MS = 400;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Giá trị mọi ô select/textarea có tên (radio mục C giữ bằng state, không lấy ở đây). */
function collectFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const el of Array.from(form.elements)) {
    if ((el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.name) fields[el.name] = el.value;
  }
  return fields;
}

function applyFields(form: HTMLFormElement, fields: Record<string, string>) {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name) continue;
    if (!(el.name in fields)) continue;
    const value = fields[el.name];
    // Ô chọn chỉ nhận giá trị còn có trong danh sách — phiếu có thể đã bớt lựa chọn.
    if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === value)) continue;
    el.value = value;
  }
}

/**
 * Form chấm phỏng vấn vẽ từ phiếu của mùa — tiêu chí, trọng số, câu hỏi và mô tả
 * 1/3/5 đều đến từ dữ liệu, mùa sau đổi phiếu không phải sửa file này.
 *
 * KHÔNG hiện tổng điểm: phiếu ghi rõ không cộng tổng và không có điểm sàn. Điểm
 * quy đổi chỉ BTC thấy, ở thẻ kết quả sau khi lưu.
 */
export function InterviewResultForm({ rubric, review, operation: op, candidateName, mentorLabel, full, takeLimitReached, busy, draftKey = null, onSubmit }: ResultFormProps) {
  const initialOutcome: OfflineOutcome = op?.outcome ?? "passed";
  const initialTake: TakeChoice | "" = review?.take_choice ?? "";
  const [outcome, setOutcome] = useState<OfflineOutcome>(initialOutcome);
  const [takeChoice, setTakeChoice] = useState<TakeChoice | "">(initialTake);
  const [error, setError] = useState("");
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const previous = new Map((review?.interview_scores ?? []).map((s) => [s.key, s]));
  // "Không chọn làm mentee" khoá cả mục C (BTC 02/10): không còn câu hỏi ai nhận bạn này.
  const rejected = outcome === "rejected";
  const takeLocked = outcome !== "passed" || full || takeLimitReached;

  // ── Bản nháp (BTC 03/10/2026) ────────────────────────────────────────────────
  // Lưu khi gõ (trễ DRAFT_DEBOUNCE_MS) và lưu NGAY khi trang bị ẩn — điện thoại
  // chuyển app là lúc trang có thể bị huỷ. Chỉ ghi sau khi người dùng thật sự sửa
  // (dirty), để lần mở form đầu tiên không đè lên nháp cũ.
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ outcome, takeChoice });
  latest.current = { outcome, takeChoice };

  const persist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const store = storage();
    if (!draftKey || !dirty.current || !formRef.current || !store) return;
    const draft: InterviewDraft = {
      savedAt: Date.now(),
      rubricVersion: rubric.version,
      outcome: latest.current.outcome,
      takeChoice: latest.current.takeChoice,
      fields: collectFields(formRef.current)
    };
    try {
      if (draftHasContent(draft)) {
        store.setItem(draftKey, JSON.stringify(draft));
        setSavedAt(draft.savedAt);
      }
    } catch {
      // Hết chỗ / trình duyệt chặn: form vẫn dùng được, chỉ không có nháp.
    }
  }, [draftKey, rubric.version]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, DRAFT_DEBOUNCE_MS);
  }, [persist]);

  const discardDraft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    try {
      if (draftKey) storage()?.removeItem(draftKey);
    } catch {
      // bỏ qua
    }
    setSavedAt(null);
  }, [draftKey]);

  // Khôi phục một lần khi mở form; dọn luôn mọi nháp quá hạn trên máy này.
  useEffect(() => {
    const store = storage();
    if (!draftKey || !store || !formRef.current) return;
    const now = Date.now();
    try {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (key?.startsWith(DRAFT_PREFIX) && key !== draftKey && draftExpired(store.getItem(key), now)) store.removeItem(key);
      }
      const raw = store.getItem(draftKey);
      const updatedAt = (op as { updated_at?: string | null } | null)?.updated_at;
      const draft = parseDraft(raw, {
        rubricVersion: rubric.version,
        nowMs: now,
        savedResultAtMs: op?.outcome && updatedAt ? Date.parse(updatedAt) : null
      });
      if (!draft) {
        if (raw) store.removeItem(draftKey);
        return;
      }
      applyFields(formRef.current, draft.fields);
      if (draft.outcome in OFFLINE_OUTCOMES) setOutcome(draft.outcome as OfflineOutcome);
      if (draft.takeChoice === "" || draft.takeChoice in TAKE_CHOICES) setTakeChoice(draft.takeChoice as TakeChoice | "");
      setRestoredAt(draft.savedAt);
    } catch {
      // localStorage hỏng/bị chặn: mở form trống như cũ.
    }
    // Chỉ chạy lúc mở form — chạy lại sẽ đè lên những gì người dùng vừa gõ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const flush = () => persist();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      // Đóng hồ sơ / form bị gỡ khi còn chờ lưu: lưu nốt, đừng để mất mấy chữ cuối.
      if (timer.current) persist();
    };
  }, [persist]);

  return (
    <form
      ref={formRef}
      className="grid gap-4 rounded-lg border p-3"
      onInput={schedule}
      onChange={schedule}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!rejected && !takeChoice) {
          setError("Chọn mentor có muốn nhận bạn này không (mục C).");
          return;
        }
        setError("");
        const criteria: Record<string, { score: number; note: string }> = {};
        for (const c of rubric.criteria) {
          criteria[c.key] = { score: Number(f.get(`score:${c.key}`)), note: String(f.get(`note:${c.key}`) ?? "") };
        }
        const willTake = !rejected && takeChoice === "take";
        if (!window.confirm(
          `Xác nhận ${OFFLINE_OUTCOMES[outcome]} cho ${candidateName}${willTake ? " và nhận làm mentee của bạn" : ""}?` +
          `${op?.match_id && !willTake ? " Cặp hiện tại sẽ được hủy và hoàn lại chỗ." : ""}`
        )) return;
        // Lưu nháp lần cuối trước khi gửi: gửi hỏng (mất mạng) thì vẫn còn nguyên.
        persist();
        const sent = onSubmit({
          outcome,
          rubricId: rubric.id,
          rubricVersion: rubric.version,
          criteria,
          rationale: String(f.get("rationale") ?? ""),
          keyNeed: String(f.get("keyNeed") ?? ""),
          alignment: String(f.get("alignment") ?? ""),
          alignmentNote: String(f.get("alignmentNote") ?? ""),
          takeChoice: rejected ? null : takeChoice,
          desiredMentor: rejected ? "" : String(f.get("desiredMentor") ?? ""),
          additionalNote: String(f.get("additionalNote") ?? ""),
          reason: String(f.get("reason") ?? "")
        });
        // Chỉ xoá nháp khi máy chủ đã lưu thật — lỗi mạng/lỗi kiểm tra thì giữ.
        if (sent && typeof sent.then === "function") {
          void sent.then((result) => {
            const ok = typeof result === "boolean" ? result : result.ok;
            if (ok) {
              discardDraft();
              return;
            }
            const message = typeof result === "boolean" ? "" : result.message ?? "";
            setError(`Chưa lưu được: ${message || "thử lại sau ít giây."} Phiếu vẫn còn nguyên — không cần nhập lại.`);
          });
        }
      }}
    >
      {restoredAt ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded border border-sky-300 bg-sky-50 p-2 text-sm text-sky-900">
          <span>Đã khôi phục bản nháp lưu lúc {formatDateTime(new Date(restoredAt).toISOString())}. Kiểm tra lại rồi bấm &quot;Xác nhận kết quả&quot;.</span>
          <button
            type="button"
            className="rounded border border-sky-400 px-2 py-1"
            onClick={() => {
              discardDraft();
              formRef.current?.reset();
              setOutcome(initialOutcome);
              setTakeChoice(initialTake);
              setRestoredAt(null);
            }}
          >
            Bỏ bản nháp
          </button>
        </div>
      ) : null}
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
                <textarea name={`note:${c.key}`} required rows={2} defaultValue={prev?.note ?? ""} className={field} />
              </label>
            </div>
          </fieldset>
        );
      })}

      <fieldset className="grid gap-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">A. Quyết định chọn mentee</legend>
        <label>
          Kết quả
          <select
            className={field}
            value={outcome}
            onChange={(e) => {
              const next = e.target.value as OfflineOutcome;
              setOutcome(next);
              if (next === "rejected" || (next !== "passed" && takeChoice === "take")) setTakeChoice("");
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
        <legend className="px-1 text-sm font-semibold">B. Sự phù hợp về kỳ vọng của Mentee</legend>
        <p className="text-xs text-slate-600">{EXPECTATION_BRIEF_NOTE}</p>
        <label>
          Mức độ phù hợp về kỳ vọng của Mentee
          <select name="alignment" required defaultValue={review?.expectation_alignment ?? ""} className={field}>
            <option value="">Chọn mức độ</option>
            {(Object.entries(EXPECTATION_ALIGNMENTS) as Array<[ExpectationAlignment, string]>).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Concern / Note
          <textarea name="alignmentNote" required rows={2} defaultValue={review?.alignment_note ?? ""} className={field} />
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
                disabled={rejected || (key === "take" && takeLocked)}
                onChange={() => setTakeChoice(key)}
              />
              <span>{label}</span>
            </label>
          ))}
          {rejected ? <p className="text-sm text-slate-600">Không chọn làm mentee — mục C khoá lại.</p> : null}
          {!rejected && takeLimitReached ? (
            <p className="text-sm text-slate-600">Bạn đã chọn &quot;Có – Tôi muốn nhận bạn này&quot; cho đủ {MAX_TAKES_PER_INTERVIEWER} hồ sơ. Vẫn có thể chốt Đạt để Mentor khác nhận bạn.</p>
          ) : null}
          {!rejected && !takeLimitReached && full && !op?.match_id ? <p className="text-sm text-slate-600">Chưa thể nhận thêm mentee. Vẫn có thể chốt Đạt để BTC/mentor khác ghép sau.</p> : null}
          <p className="text-xs text-slate-500">Chọn &quot;Có&quot; là tạo cặp ghép ngay khi lưu.</p>
        </div>
        <label>
          Chân dung Mentor phù hợp
          <textarea name="desiredMentor" required={!rejected} disabled={rejected} rows={2} defaultValue={review?.desired_mentor_profile ?? ""} className={field}
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
      {draftKey ? (
        <p className="text-xs text-slate-500" data-testid="draft-status">
          {savedAt
            ? `Đã lưu nháp trên máy này lúc ${formatDateTime(new Date(savedAt).toISOString())} — chuyển tab/app vẫn không mất.`
            : "Phiếu đang chấm tự lưu nháp trên máy này — chuyển tab/app vẫn không mất."}
        </p>
      ) : null}
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
              Phù hợp về kỳ vọng: {EXPECTATION_ALIGNMENTS[review.expectation_alignment]}
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
