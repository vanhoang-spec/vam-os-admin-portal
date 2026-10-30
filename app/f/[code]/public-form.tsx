"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOM_FORM_CONSENT_TEXT,
  FIELD_FORMAT_HINTS,
  customFormDraftKey,
  hasBranching,
  hasDraftContent,
  isQuestion,
  nextPageIndex,
  parseDraft,
  serializeDraft,
  splitPages,
  themeTextColor,
  validateAnswers,
  validateFormAnswers,
  visitedPages,
  type CustomFormAnswerValue,
  type CustomFormField
} from "@/lib/custom-form-core";
import { maskVietnamDate } from "@/lib/event-datetime";
import { formatDateTime } from "@/lib/utils";
import { submitCustomFormAction } from "./actions";

/** Tự lưu nháp sau khi ngừng gõ chừng này — đủ thưa để không ghi bộ nhớ ở mỗi phím bấm. */
export const DRAFT_SAVE_DELAY_MS = 800;
const timeLabel = (ms: number) => formatDateTime(new Date(ms).toISOString());

const BOX =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint aria-[invalid=true]:border-red-400";
const SECONDARY =
  "w-full rounded-md border border-vam-line bg-white px-5 py-3 text-base font-semibold text-vam-ink hover:bg-slate-50 disabled:opacity-60 sm:w-auto";
const PRIMARY =
  "w-full rounded-md bg-vam-green px-5 py-3 text-base font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60 sm:w-auto";

const INPUT_MODE: Partial<Record<CustomFormField["type"], React.HTMLAttributes<HTMLInputElement>["inputMode"]>> = {
  email: "email",
  phone: "tel",
  student_id: "numeric",
  citizen_id: "numeric",
  date: "numeric",
  number: "decimal",
  url: "url",
  file_link: "url"
};

const CONSENT_KEY = "__consent";

function asList(value: CustomFormAnswerValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Form công khai (/f/<mã>) — và bản xem thử của ban tổ chức (`preview`), dùng đúng cùng một thành
 * phần để bản xem thử không bao giờ khác form thật.
 *
 * Nhiều trang (BTC 15/10/2026): form chia tại các “Ngắt trang”. “Tiếp” kiểm các mục của trang đang
 * xem — thiếu mục bắt buộc hay sai định dạng thì không qua trang sau. Ô đồng ý và nút Gửi ở trang
 * cuối. Câu trả lời của mọi trang giữ nguyên khi bấm “Quay lại”.
 *
 * Bấm "Gửi": kiểm lại TOÀN BỘ bằng đúng luật máy chủ dùng (lib/custom-form-core.ts); lỗi ở trang
 * trước thì quay về đúng trang đó. Máy chủ vẫn kiểm lại toàn bộ: trình duyệt chỉ để người điền khỏi
 * phải chờ.
 *
 * Lưu nháp (BTC 15/10/2026): câu đã điền tự lưu trên MÁY NÀY (bộ nhớ trình duyệt) sau mỗi lần ngừng
 * gõ, và nút "Lưu nháp" lưu ngay. Mở lại đúng đường dẫn trên máy đó thì câu cũ và trang đang điền dở
 * hiện lại. Gửi thành công hay bấm "Xoá nháp" thì nháp mất. Ô đồng ý không bao giờ được lưu. Chỉ lưu
 * sau khi người điền đã gõ: mở trang thôi không ghi gì, và không đè lên nháp cũ.
 */
export function PublicForm({ code, fields, preview = false, themeColor = null }: { code: string; fields: CustomFormField[]; preview?: boolean; themeColor?: string | null }) {
  const [values, setValues] = useState<Record<string, CustomFormAnswerValue>>({});
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "preview"; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // Các trang đã đi qua trước trang đang xem: có rẽ nhánh thì "Quay lại" là về trang vừa đi, không phải trang số liền trước.
  const [trail, setTrail] = useState<number[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Người điền đã gõ/chọn gì chưa — chưa thì không ghi nháp (mở trang không được đè nháp cũ).
  const touched = useRef(false);

  const pages = useMemo(() => splitPages(fields), [fields]);
  const draftKey = customFormDraftKey(code, preview);

  /** Ghi nháp; trả giờ đã ghi, hoặc null (không có gì để ghi, hay trình duyệt chặn bộ nhớ). */
  const writeDraft = useCallback(
    (vals: Record<string, CustomFormAnswerValue>, pg: number): number | null => {
      try {
        if (!hasDraftContent(vals)) {
          window.localStorage.removeItem(draftKey);
          return null;
        }
        const now = Date.now();
        window.localStorage.setItem(draftKey, serializeDraft(vals, pg, now));
        return now;
      } catch {
        return null;
      }
    },
    [draftKey]
  );
  const removeDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // bộ nhớ bị chặn: không có gì để xoá
    }
  }, [draftKey]);

  // Mở lại nháp đã lưu trên máy này (chỉ đọc được sau khi trang đã lên trình duyệt).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(draftKey);
    } catch {
      raw = null;
    }
    const draft = parseDraft(fields, raw, Date.now());
    if (draft) {
      setValues(draft.values);
      // Nháp mở lại đúng đường đã đi: trang đã lưu không còn trên đường (BTC đổi form) thì về trang cuối của đường.
      const path = visitedPages(pages, (id) => asList(draft.values[id])[0]);
      const at = path.indexOf(draft.page);
      const stop = at >= 0 ? at : path.length - 1;
      setPage(path[stop]);
      setTrail(path.slice(0, stop));
      setRestoredAt(draft.savedAt);
    } else if (raw) {
      removeDraft();
    }
  }, [draftKey, fields, pages, removeDraft]);

  // Tự lưu sau mỗi lần ngừng gõ / chuyển trang.
  useEffect(() => {
    if (!touched.current || done) return;
    const timer = setTimeout(() => {
      const at = writeDraft(values, page);
      if (at) setSavedAt(at);
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [values, page, done, writeDraft]);
  const current = pages[Math.min(page, pages.length - 1)];
  const answerOf = (id: string) => asList(values[id])[0];
  // Trang cuối của lượt điền này: phụ thuộc câu trả lời, không phải trang số cuối của form.
  const next = nextPageIndex(pages, page, answerOf);
  const onLastPage = next === null;
  const branching = useMemo(() => hasBranching(fields), [fields]);
  // Mọi mục đang hiện của cả form (không gồm ngắt trang) — để tìm trang chứa mục lỗi.
  const allFields = useMemo(() => pages.flatMap((p) => p.fields), [pages]);
  /** Tới một trang nằm trên đường đi hiện tại, giữ "Quay lại" đúng. */
  const jumpTo = (target: number) => {
    const path = visitedPages(pages, answerOf);
    const at = path.indexOf(target);
    setPage(at >= 0 ? target : path[path.length - 1]);
    setTrail(path.slice(0, at >= 0 ? at : path.length - 1));
  };

  // Đưa con trỏ tới mục lỗi SAU khi trang chứa nó đã hiện ra.
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(focusId === "top" ? "custom-form-top" : `q-${focusId}`);
    el?.scrollIntoView?.({ behavior: "smooth", block: focusId === "top" ? "start" : "center" });
    if (focusId !== "top") (el as HTMLElement | null)?.focus?.();
    setFocusId(null);
  }, [focusId, page]);

  const clearError = (id: string) => {
    if (errors[id]) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
  };
  const setValue = (id: string, value: CustomFormAnswerValue) => {
    touched.current = true;
    setValues((prev) => ({ ...prev, [id]: value }));
    clearError(id);
  };

  const saveNow = () => {
    if (!hasDraftContent(values)) {
      setNotice({ kind: "error", message: "Chưa có câu nào để lưu nháp." });
      return;
    }
    const at = writeDraft(values, page);
    if (!at) {
      setNotice({ kind: "error", message: "Trình duyệt này không cho lưu nháp (có thể đang ở chế độ ẩn danh). Bạn điền xong rồi gửi trong lần này nhé." });
      return;
    }
    setSavedAt(at);
    setNotice({ kind: "ok", message: `Đã lưu nháp trên máy này lúc ${timeLabel(at)}. Mở lại đúng đường dẫn này trên máy này để điền tiếp.` });
  };
  const clearDraft = () => {
    removeDraft();
    touched.current = false;
    setValues({});
    setErrors({});
    setPage(0);
    setTrail([]);
    setRestoredAt(null);
    setSavedAt(null);
    setNotice({ kind: "ok", message: "Đã xoá bản nháp — form trống, bạn điền lại từ đầu." });
    setFocusId("top");
  };

  /** Hiện lỗi; nếu mục lỗi đầu tiên nằm ở trang khác thì chuyển tới trang đó. */
  const showErrors = (found: Record<string, string>, message: string) => {
    setErrors(found);
    setNotice({ kind: "error", message });
    const first = allFields.find((f) => found[f.id]);
    if (first) {
      const target = pages.findIndex((p) => p.fields.some((f) => f.id === first.id));
      if (target >= 0) jumpTo(target);
      setFocusId(first.id);
    } else if (found[CONSENT_KEY]) {
      jumpTo(pages.length - 1);
      setFocusId(CONSENT_KEY);
    }
  };

  const goNext = () => {
    const checked = validateAnswers(current.fields, (id) => asList(values[id]));
    if (!checked.ok) {
      showErrors(checked.errors, "Một vài mục chưa đúng — xem chữ đỏ dưới từng mục.");
      return;
    }
    setNotice(null);
    if (next !== null) {
      setTrail((t) => [...t, page]);
      setPage(next);
    }
    setFocusId("top");
  };
  const goBack = () => {
    setNotice(null);
    setPage(trail[trail.length - 1] ?? 0);
    setTrail((t) => t.slice(0, -1));
    setFocusId("top");
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    // Enter trong một ô ở trang chưa cuối = bấm "Tiếp", không gửi cả form.
    if (!onLastPage) {
      goNext();
      return;
    }
    const checked = validateFormAnswers(fields, (id) => asList(values[id]));
    const found: Record<string, string> = { ...checked.errors };
    if (!consent) found[CONSENT_KEY] = "Vui lòng tích ô đồng ý trước khi gửi.";
    if (Object.keys(found).length) {
      showErrors(found, "Một vài mục chưa đúng — xem chữ đỏ dưới từng mục.");
      return;
    }
    if (preview) {
      setNotice({ kind: "preview", message: "Bản xem thử: câu trả lời hợp lệ. Bản xem thử không gửi đi đâu cả." });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const result = await submitCustomFormAction(code, { values, consent, trap });
      if (result.ok) {
        // Đã gửi: nháp hết việc. Không xoá khi gửi hỏng — người điền còn cần nó.
        touched.current = false;
        removeDraft();
        setDone(result.message);
        return;
      }
      showErrors(result.errors ?? {}, result.message);
    } catch {
      setNotice({ kind: "error", message: "Chưa gửi được — kiểm tra kết nối mạng rồi bấm Gửi lại. Câu trả lời của bạn vẫn còn trên trang." });
    } finally {
      setSending(false);
    }
  };

  const accent = themeColor ? { backgroundColor: themeColor, color: themeTextColor(themeColor) } : undefined;

  if (done) {
    return (
      <div role="status" data-testid="form-done" className="whitespace-pre-line rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-base text-green-800">
        {done}
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5" data-testid="custom-form" data-page={page + 1}>
      <div id="custom-form-top" />
      {restoredAt ? (
        <div data-testid="draft-restored" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span>Đã mở lại bản nháp bạn lưu lúc {timeLabel(restoredAt)} trên máy này.</span>
          <button type="button" data-testid="draft-clear" className="font-medium underline" onClick={clearDraft}>
            Xoá nháp, điền lại từ đầu
          </button>
        </div>
      ) : null}
      {pages.length > 1 ? (
        <div className="grid gap-1" data-testid="page-header">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="page-progress">
            {branching ? `Trang ${trail.length + 1}` : `Trang ${page + 1}/${pages.length}`}
          </p>
          {current.title ? <h2 className="text-lg font-semibold text-vam-ink">{current.title}</h2> : null}
          {current.help ? <p className="whitespace-pre-line text-sm text-slate-600">{current.help}</p> : null}
        </div>
      ) : null}

      {current.fields.map((field) => {
        const error = errors[field.id];
        const describedBy = error ? `q-${field.id}-error` : field.help ? `q-${field.id}-help` : undefined;
        if (!isQuestion(field)) {
          return (
            <div key={field.id} data-field={field.id} className="border-t border-vam-line pt-4">
              <h2 className="text-lg font-semibold text-vam-ink">{field.label}</h2>
              {field.help ? <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{field.help}</p> : null}
            </div>
          );
        }
        const hint = FIELD_FORMAT_HINTS[field.type];
        const value = values[field.id];
        const text = typeof value === "string" ? value : "";
        const common = {
          id: `q-${field.id}`,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
          "aria-required": field.required || undefined
        };
        let control: React.ReactNode;
        if (field.type === "long_text") {
          control = <textarea {...common} rows={4} className={BOX} value={text} onChange={(e) => setValue(field.id, e.target.value)} />;
        } else if (field.type === "single_choice" || field.type === "multi_choice" || field.type === "yes_no") {
          const oneOnly = field.type !== "multi_choice";
          const picked = asList(value);
          control = (
            <div {...common} role={oneOnly ? "radiogroup" : "group"} tabIndex={-1} className="grid gap-2">
              {field.options.map((option) => (
                <label key={option} className="flex items-start gap-2 text-base text-vam-ink">
                  <input
                    type={oneOnly ? "radio" : "checkbox"}
                    name={`q-${field.id}`}
                    className="mt-1 h-4 w-4"
                    checked={picked.includes(option)}
                    onChange={(e) => {
                      if (oneOnly) setValue(field.id, option);
                      else setValue(field.id, e.target.checked ? [...picked, option] : picked.filter((p) => p !== option));
                    }}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          );
        } else if (field.type === "dropdown") {
          control = (
            <select {...common} className={BOX} value={text} onChange={(e) => setValue(field.id, e.target.value)}>
              <option value="">— Chọn —</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <input
              {...common}
              type="text"
              inputMode={INPUT_MODE[field.type]}
              autoComplete={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "off"}
              placeholder={field.type === "date" ? "DD/MM/YYYY" : field.type === "file_link" ? "https://drive.google.com/…" : undefined}
              className={BOX}
              value={text}
              onChange={(e) => setValue(field.id, field.type === "date" ? maskVietnamDate(e.target.value) : e.target.value)}
            />
          );
        }
        return (
          <div key={field.id} data-field={field.id} className="grid gap-1.5">
            <label htmlFor={`q-${field.id}`} className="text-base font-medium text-vam-ink">
              {field.label}
              {field.required ? (
                <span className="ml-1 text-red-600" aria-label="bắt buộc">
                  *
                </span>
              ) : null}
            </label>
            {field.help ? (
              <p id={`q-${field.id}-help`} className="whitespace-pre-line text-sm text-slate-600">
                {field.help}
              </p>
            ) : null}
            {control}
            {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
            {error ? (
              <p id={`q-${field.id}-error`} data-testid="field-error" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}

      {/* Ô bẫy: người thật không thấy, máy tự điền thì điền vào — máy chủ bỏ qua lần gửi đó. */}
      <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
        </label>
      </div>

      {onLastPage ? (
        <div className="grid gap-1.5 border-t border-vam-line pt-4">
          <label className="flex items-start gap-2 text-sm text-vam-ink">
            <input
              id={`q-${CONSENT_KEY}`}
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={consent}
              aria-invalid={errors[CONSENT_KEY] ? true : undefined}
              onChange={(e) => {
                setConsent(e.target.checked);
                clearError(CONSENT_KEY);
              }}
            />
            <span>
              {CUSTOM_FORM_CONSENT_TEXT}
              <span className="ml-1 text-red-600">*</span>
            </span>
          </label>
          {errors[CONSENT_KEY] ? (
            <p data-testid="field-error" className="text-sm text-red-600">
              {errors[CONSENT_KEY]}
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          data-testid="form-notice"
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : notice.kind === "ok"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" data-testid="draft-save" className={SECONDARY} onClick={saveNow} disabled={sending}>
          Lưu nháp
        </button>
        {trail.length > 0 ? (
          <button type="button" data-testid="page-back" className={SECONDARY} onClick={goBack} disabled={sending}>
            Quay lại
          </button>
        ) : null}
        {/* key khác nhau là bắt buộc (VAM00010, 30/10/2026): không có key, React giữ nguyên MỘT phần tử <button>
            và chỉ đổi type từ "button" sang "submit". Bấm "Tiếp" ở trang kế cuối thì React vẽ lại ngay trong cú bấm,
            trình duyệt xử lý cú bấm trên nút giờ đã là "submit" và GỬI form — chưa tích đồng ý thì hiện chữ đỏ,
            đã tích (Quay lại → Tiếp) thì gửi thật dù người điền chưa bấm "Gửi". */}
        {!onLastPage ? (
          <button key="page-next" type="button" data-testid="page-next" className={PRIMARY} style={accent} onClick={goNext}>
            Tiếp
          </button>
        ) : (
          <button key="form-submit" type="submit" data-testid="form-submit" disabled={sending} className={PRIMARY} style={accent}>
            {sending ? "Đang gửi…" : preview ? "Gửi (xem thử)" : "Gửi"}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500" data-testid="draft-status">
        {savedAt ? `Đã tự lưu nháp trên máy này lúc ${timeLabel(savedAt)}. ` : ""}
        Câu trả lời được lưu nháp trên máy này trong lúc bạn điền — mở lại đúng đường dẫn này trên máy này để điền tiếp.
      </p>
    </form>
  );
}
