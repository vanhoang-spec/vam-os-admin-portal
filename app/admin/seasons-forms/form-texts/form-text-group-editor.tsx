"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { saveApplicationFormTextsAction } from "@/app/actions/application-form-texts";
import { InlineActionMessage, LoadingButton } from "@/components/action-feedback";
import { FormRichText } from "@/components/form-rich-text";
import {
  FORM_TEXT_LINE_MAX,
  FORM_TEXT_RICH_MAX,
  initialFormTextActionState,
  type ApplicationFormTextKind
} from "@/lib/application-form-text-core";

export type FormTextEditorSlot = {
  key: string;
  label: string;
  kind: ApplicationFormTextKind;
  optional: boolean;
  defaultText: string;
  /** Chữ đang hiện trên form công khai. */
  value: string;
  edited: boolean;
  updatedLabel: string | null;
};

const LF = String.fromCharCode(10);

const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm leading-6 text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

/**
 * Một nhóm khối chữ (ví dụ "Form mentor · Quy trình 3 bước") với một nút lưu riêng.
 *
 * Mỗi nhóm một form: lưu phần liên hệ không gửi kèm phần giới thiệu đang sửa dở
 * ở nhóm khác.
 */
export function FormTextGroupEditor({
  title,
  shownOn,
  slots
}: {
  title: string;
  shownOn: string;
  slots: FormTextEditorSlot[];
}) {
  const [state, formAction] = useFormState(saveApplicationFormTextsAction, initialFormTextActionState);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(slots.map((entry) => [entry.key, entry.value]))
  );
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();

  // Next đặt lại form sau mỗi lần action chạy xong — kể cả khi lưu hỏng, ví dụ vì
  // người khác vừa sửa. Các ô ở đây có kiểm soát, nên React giữ defaultValue theo
  // chữ đang gõ và lần đặt lại đó không xoá gì (test "chữ đang gõ vẫn còn" canh
  // hành vi này; bỏ riêng đoạn chặn dưới đây thì test vẫn xanh, và đó là đúng).
  // Vẫn chặn, để phần vừa gõ không phụ thuộc vào chi tiết đồng bộ thuộc tính của
  // từng phiên bản React.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const keepText = (event: Event) => event.preventDefault();
    form.addEventListener("reset", keepText);
    return () => form.removeEventListener("reset", keepText);
  }, []);

  return (
    <form ref={formRef} action={formAction} className="grid gap-5">
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">Hiện trên: {shownOn}</p>
      </div>

      {slots.map((entry) => {
        const id = `${baseId}-${entry.key}`;
        const value = values[entry.key] ?? "";
        const set = (next: string) => setValues((current) => ({ ...current, [entry.key]: next }));
        return (
          <div key={entry.key} className="grid gap-1">
            <input type="hidden" name={`expected:${entry.key}`} value={entry.value} />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={id} className="text-sm font-medium text-vam-ink">
                {entry.label}
                {entry.optional ? <span className="font-normal text-slate-500"> · để trống thì không hiện</span> : null}
              </label>
              <span className={entry.edited ? "text-xs font-medium text-amber-700" : "text-xs text-slate-500"}>
                {entry.edited ? `Đã sửa${entry.updatedLabel ? ` · ${entry.updatedLabel}` : ""}` : "Chữ mặc định"}
              </span>
            </div>

            {entry.kind === "line" ? (
              <input
                id={id}
                name={entry.key}
                value={value}
                maxLength={FORM_TEXT_LINE_MAX}
                onChange={(event) => set(event.target.value)}
                className={FIELD_CLASS}
              />
            ) : (
              <textarea
                id={id}
                name={entry.key}
                value={value}
                maxLength={FORM_TEXT_RICH_MAX}
                rows={Math.min(14, Math.max(3, value.split(LF).length + 1))}
                onChange={(event) => set(event.target.value)}
                className={FIELD_CLASS}
              />
            )}

            {value !== entry.defaultText ? (
              <button
                type="button"
                onClick={() => set(entry.defaultText)}
                className="w-fit text-xs font-medium text-vam-green underline-offset-2 hover:underline"
              >
                Dùng lại chữ mặc định
              </button>
            ) : null}

            {entry.kind === "rich" && value.trim() ? (
              <div className="mt-1 rounded-md border border-dashed border-vam-line bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Xem trước</p>
                <FormRichText text={value} className="mt-1 space-y-2 text-sm leading-6 text-slate-600" />
              </div>
            ) : null}
          </div>
        );
      })}

      <InlineActionMessage state={state} errorFallback="Không lưu được chữ trên form. Thử lại." />

      <LoadingButton
        pendingLabel="Đang lưu…"
        className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
      >
        Lưu phần này
      </LoadingButton>
    </form>
  );
}
