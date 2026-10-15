"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CUSTOM_FORM_CONSENT_TEXT,
  FIELD_FORMAT_HINTS,
  isQuestion,
  splitPages,
  validateAnswers,
  type CustomFormAnswerValue,
  type CustomFormField
} from "@/lib/custom-form-core";
import { maskVietnamDate } from "@/lib/event-datetime";
import { submitCustomFormAction } from "./actions";

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
 */
export function PublicForm({ code, fields, preview = false }: { code: string; fields: CustomFormField[]; preview?: boolean }) {
  const [values, setValues] = useState<Record<string, CustomFormAnswerValue>>({});
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "preview"; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);

  const pages = useMemo(() => splitPages(fields), [fields]);
  const last = pages.length - 1;
  const current = pages[Math.min(page, last)];
  // Mọi mục đang hiện của cả form (không gồm ngắt trang) — để kiểm lần cuối trước khi gửi.
  const allFields = useMemo(() => pages.flatMap((p) => p.fields), [pages]);

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
    setValues((prev) => ({ ...prev, [id]: value }));
    clearError(id);
  };

  /** Hiện lỗi; nếu mục lỗi đầu tiên nằm ở trang khác thì chuyển tới trang đó. */
  const showErrors = (found: Record<string, string>, message: string) => {
    setErrors(found);
    setNotice({ kind: "error", message });
    const first = allFields.find((f) => found[f.id]);
    if (first) {
      const target = pages.findIndex((p) => p.fields.some((f) => f.id === first.id));
      if (target >= 0) setPage(target);
      setFocusId(first.id);
    } else if (found[CONSENT_KEY]) {
      setPage(last);
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
    setPage((p) => Math.min(p + 1, last));
    setFocusId("top");
  };
  const goBack = () => {
    setNotice(null);
    setPage((p) => Math.max(p - 1, 0));
    setFocusId("top");
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    // Enter trong một ô ở trang chưa cuối = bấm "Tiếp", không gửi cả form.
    if (page < last) {
      goNext();
      return;
    }
    const checked = validateAnswers(allFields, (id) => asList(values[id]));
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
      {pages.length > 1 ? (
        <div className="grid gap-1" data-testid="page-header">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="page-progress">
            Trang {page + 1}/{pages.length}
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
        } else if (field.type === "single_choice" || field.type === "multi_choice") {
          const picked = asList(value);
          control = (
            <div {...common} role={field.type === "single_choice" ? "radiogroup" : "group"} tabIndex={-1} className="grid gap-2">
              {field.options.map((option) => (
                <label key={option} className="flex items-start gap-2 text-base text-vam-ink">
                  <input
                    type={field.type === "single_choice" ? "radio" : "checkbox"}
                    name={`q-${field.id}`}
                    className="mt-1 h-4 w-4"
                    checked={picked.includes(option)}
                    onChange={(e) => {
                      if (field.type === "single_choice") setValue(field.id, option);
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

      {page === last ? (
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
            notice.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {page > 0 ? (
          <button type="button" data-testid="page-back" className={SECONDARY} onClick={goBack} disabled={sending}>
            Quay lại
          </button>
        ) : null}
        {page < last ? (
          <button type="button" data-testid="page-next" className={PRIMARY} onClick={goNext}>
            Tiếp
          </button>
        ) : (
          <button type="submit" disabled={sending} className={PRIMARY}>
            {sending ? "Đang gửi…" : preview ? "Gửi (xem thử)" : "Gửi"}
          </button>
        )}
      </div>
    </form>
  );
}
