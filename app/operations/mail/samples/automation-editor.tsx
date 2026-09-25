"use client";

import { useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import {
  revertAutomationContentAction,
  saveAutomationContentAction
} from "@/app/actions/email-automation";
import {
  type AutomationActionState,
  EMPTY_AUTOMATION_STATE
} from "@/lib/email-automation-action-types";
import { keepFormValues } from "@/lib/keep-form-values";

/**
 * Sửa nội dung một lá thư tự động.
 *
 * ---------------------------------------------------------------------------
 * HAI CHI TIẾT CÓ CHỦ Ý
 * ---------------------------------------------------------------------------
 * 1. `useFormState` của **react-dom**, không phải `useActionState` của react.
 *    Dự án chạy React 18.3.1; `useActionState` qua được typecheck, lint và
 *    build rồi mới vỡ lúc chạy (CLAUDE.md).
 *
 * 2. `onReset={keepFormValues}`. `<form action={serverAction}>` tự xoá trắng ô
 *    nhập sau khi action chạy xong — KỂ CẢ khi action trả về lỗi. Không có
 *    dòng đó, một người sửa hỏng ô bắt buộc sẽ mất sạch đoạn vừa viết cùng lúc
 *    nhận được câu báo lỗi.
 */

export type EditorPlaceholder = { key: string; label: string; required: boolean; hint: string };

export type EditorHistoryRow = {
  id: string;
  action: "save" | "revert";
  changedByName: string | null;
  changedAt: string;
  subjectBefore: string | null;
  bodyBefore: string | null;
};

export type EditorSlot = {
  id: string;
  title: string;
  audience: string;
  trigger: string;
  kind: string;
  note?: string;
  placeholders: EditorPlaceholder[];
  subject: string;
  body: string;
  customised: boolean;
  updatedLabel: string | null;
  previewHtml: string | null;
  history: EditorHistoryRow[];
};

function SubmitButton({ label, busy, tone }: { label: string; busy: string; tone: "primary" | "quiet" }) {
  const { pending } = useFormStatus();
  const base = "rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";
  const style =
    tone === "primary"
      ? "bg-vam-green text-white hover:bg-vam-green/90"
      : "border border-vam-line text-slate-700 hover:bg-slate-50";
  return (
    <button type="submit" disabled={pending} className={`${base} ${style}`}>
      {pending ? busy : label}
    </button>
  );
}

function Banner({ state, slotId }: { state: AutomationActionState; slotId: string }) {
  // Dải thông báo chỉ hiện ở lá thư vừa bấm: 17 lá mở cùng lúc, một câu "Đã lưu"
  // không biết mình thuộc về ai thì hiện ở mọi chỗ.
  if (!state.message || state.slotId !== slotId) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-md border px-3 py-2 text-sm ${
        state.ok
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </p>
  );
}

export function AutomationEditor({ slot }: { slot: EditorSlot }) {
  const [saveState, saveAction] = useFormState(saveAutomationContentAction, EMPTY_AUTOMATION_STATE);
  const [revertState, revertAction] = useFormState(
    revertAutomationContentAction,
    EMPTY_AUTOMATION_STATE
  );
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  /** Chèn ô vào đúng chỗ con trỏ, không phải nối vào cuối. */
  function insert(key: string) {
    const area = bodyRef.current;
    if (!area) return;
    const token = `{{${key}}}`;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    area.value = `${area.value.slice(0, start)}${token}${area.value.slice(end)}`;
    area.focus();
    area.setSelectionRange(start + token.length, start + token.length);
  }

  return (
    <div className="mb-4 rounded-lg border border-vam-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-vam-ink">{slot.title}</h3>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-medium">Gửi cho:</span> {slot.audience}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            <span className="font-medium">Khi nào gửi:</span> {slot.trigger}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Loại thư trong Nhật ký gửi:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">{slot.kind}</code>
          </p>
          {slot.note ? <p className="mt-2 text-sm text-slate-700">{slot.note}</p> : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              slot.customised ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"
            }`}
          >
            {slot.customised ? "Ban tổ chức đã sửa" : "Bản mặc định"}
          </span>
          {slot.updatedLabel ? (
            <span className="text-xs text-slate-500">{slot.updatedLabel}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-md border border-vam-line px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            aria-expanded={open}
          >
            {open ? "Đóng" : "Xem và sửa"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 border-t border-vam-line pt-4">
          <form action={saveAction} onReset={keepFormValues} className="space-y-3">
            <input type="hidden" name="slot_id" value={slot.id} />

            <div>
              <label
                htmlFor={`subject-${slot.id}`}
                className="block text-xs font-medium uppercase text-slate-500"
              >
                Tiêu đề thư
              </label>
              <input
                id={`subject-${slot.id}`}
                name="subject"
                defaultValue={slot.subject}
                className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor={`body-${slot.id}`}
                className="block text-xs font-medium uppercase text-slate-500"
              >
                Nội dung thư (văn bản thuần — phần định dạng do hệ thống dựng)
              </label>
              <textarea
                id={`body-${slot.id}`}
                name="body"
                ref={bodyRef}
                defaultValue={slot.body}
                rows={18}
                className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-slate-500">Ô điền — bấm để chèn</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {slot.placeholders.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => insert(p.key)}
                    title={p.hint}
                    className="rounded-md border border-vam-line px-2.5 py-1 text-xs hover:bg-slate-50"
                  >
                    <code>{`{{${p.key}}}`}</code>{" "}
                    <span className="text-slate-600">{p.label}</span>
                    {p.required ? <span className="ml-1 text-red-600">*</span> : null}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Ô có dấu <span className="text-red-600">*</span> là bắt buộc — xoá nó thì hệ thống
                từ chối lưu, vì thiếu nó người nhận không làm gì được với lá thư. Dòng nào chứa một
                ô không có dữ liệu ở lần gửi đó thì cả dòng không xuất hiện.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton label="Lưu" busy="Đang lưu..." tone="primary" />
              <span className="text-xs text-slate-500">
                Lưu xong là thư gửi từ lúc đó dùng nội dung mới.
              </span>
            </div>
            <Banner state={saveState} slotId={slot.id} />
          </form>

          {slot.customised ? (
            <form action={revertAction} className="mt-4 border-t border-vam-line pt-4">
              <input type="hidden" name="slot_id" value={slot.id} />
              <SubmitButton label="Trả về bản mặc định" busy="Đang trả về..." tone="quiet" />
              <p className="mt-2 text-xs text-slate-500">
                Xoá nội dung đã sửa và quay lại câu chữ gốc của hệ thống. Bản vừa xoá vẫn nằm trong
                lịch sử bên dưới.
              </p>
              <Banner state={revertState} slotId={slot.id} />
            </form>
          ) : null}

          {slot.previewHtml ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-slate-600">
                Xem trước bản đang lưu (dữ liệu ví dụ)
              </summary>
              {/* Trong iframe sandbox rỗng: thư có style riêng, thả thẳng vào
                  trang quản trị thì CSS của thư và của app chồng lên nhau. */}
              <iframe
                title={`Xem trước: ${slot.title}`}
                sandbox=""
                srcDoc={slot.previewHtml}
                className="mt-2 h-96 w-full rounded-md border border-vam-line bg-white"
              />
            </details>
          ) : null}

          {slot.history.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-slate-600">
                Lịch sử sửa ({slot.history.length} lần gần nhất)
              </summary>
              <ul className="mt-2 space-y-2">
                {slot.history.map((row) => (
                  <li key={row.id} className="rounded-md border border-vam-line bg-slate-50 p-2 text-sm">
                    <p className="text-slate-700">
                      <span className="font-medium">
                        {row.action === "revert" ? "Trả về mặc định" : "Lưu nội dung mới"}
                      </span>{" "}
                      — {row.changedByName || "—"}, {row.changedAt}
                    </p>
                    {row.bodyBefore ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-600">
                          Nội dung trước đó
                        </summary>
                        <p className="mt-1 text-xs text-slate-500">Tiêu đề: {row.subjectBefore}</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-vam-line bg-white p-2 text-xs">
                          {row.bodyBefore}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
