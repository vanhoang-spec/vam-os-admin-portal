"use client";

import { useState } from "react";
import {
  CUSTOM_FORM_CONSENT_TEXT,
  FIELD_FORMAT_HINTS,
  isQuestion,
  validateAnswers,
  type CustomFormAnswerValue,
  type CustomFormField
} from "@/lib/custom-form-core";
import { maskVietnamDate } from "@/lib/event-datetime";
import { submitCustomFormAction } from "./actions";

const BOX =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint aria-[invalid=true]:border-red-400";

const INPUT_MODE: Partial<Record<CustomFormField["type"], React.HTMLAttributes<HTMLInputElement>["inputMode"]>> = {
  email: "email",
  phone: "tel",
  student_id: "numeric",
  citizen_id: "numeric",
  date: "numeric",
  number: "decimal",
  url: "url"
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
 * Bấm "Gửi": kiểm ngay trên trình duyệt bằng đúng luật máy chủ dùng (lib/custom-form-core.ts) — thiếu
 * mục bắt buộc hay sai định dạng thì không gửi, báo ngay dưới từng mục và đưa con trỏ tới mục lỗi đầu
 * tiên. Máy chủ vẫn kiểm lại toàn bộ: trình duyệt chỉ để người điền khỏi phải chờ.
 */
export function PublicForm({ code, fields, preview = false }: { code: string; fields: CustomFormField[]; preview?: boolean }) {
  const [values, setValues] = useState<Record<string, CustomFormAnswerValue>>({});
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "preview"; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const visible = fields.filter((f) => !f.hidden);
  const setValue = (id: string, value: CustomFormAnswerValue) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
  };

  const focusFirst = (found: Record<string, string>) => {
    const first = visible.find((f) => found[f.id]) ?? (found[CONSENT_KEY] ? { id: CONSENT_KEY } : null);
    if (!first) return;
    const el = document.getElementById(`q-${first.id}`);
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    (el as HTMLElement | null)?.focus?.();
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const checked = validateAnswers(visible, (id) => asList(values[id]));
    const found: Record<string, string> = { ...checked.errors };
    if (!consent) found[CONSENT_KEY] = "Vui lòng tích ô đồng ý trước khi gửi.";
    setErrors(found);
    if (Object.keys(found).length) {
      setNotice({ kind: "error", message: "Một vài mục chưa đúng — xem chữ đỏ dưới từng mục." });
      focusFirst(found);
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
      setErrors(result.errors ?? {});
      setNotice({ kind: "error", message: result.message });
      focusFirst(result.errors ?? {});
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
    <form noValidate onSubmit={onSubmit} className="grid gap-5" data-testid="custom-form">
      {visible.map((field) => {
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
              placeholder={field.type === "date" ? "DD/MM/YYYY" : undefined}
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
              if (errors[CONSENT_KEY]) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== CONSENT_KEY)));
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

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-md bg-vam-green px-5 py-3 text-base font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60 sm:w-auto sm:justify-self-start"
      >
        {sending ? "Đang gửi…" : preview ? "Gửi (xem thử)" : "Gửi"}
      </button>
    </form>
  );
}
