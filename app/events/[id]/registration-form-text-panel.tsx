"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { updateRegistrationFormTextAction } from "@/app/actions/events";
import { InlineActionMessage, LoadingButton } from "@/components/action-feedback";
import { initialEventActionState } from "@/lib/event-action-types";
import { FORM_TEXT_MAX_LENGTH, type FormTextPanelField } from "@/lib/event-form-text";

/**
 * Khung "Nội dung form đăng ký" trên trang chi tiết sự kiện.
 *
 * Chỉ có các đoạn chữ người đăng ký đọc. Các ô người đăng ký phải điền vẫn đổi ở
 * "Sửa sự kiện" — xem lý do trong lib/event-form-text.ts.
 */
export function RegistrationFormTextPanel({
  eventId,
  fields,
  seriesTotal,
  registrationUrl
}: {
  eventId: string;
  fields: FormTextPanelField[];
  /** Tổng số buổi của chuỗi, null nếu buổi này đứng một mình. */
  seriesTotal: number | null;
  registrationUrl: string | null;
}) {
  const [state, formAction] = useFormState(updateRegistrationFormTextAction, initialEventActionState);
  const formRef = useRef<HTMLFormElement>(null);

  // Next đặt lại form sau mỗi lần action chạy xong — kể cả khi lưu hỏng. Với một
  // đoạn giới thiệu dài cả nghìn chữ, đặt lại nghĩa là mất trắng phần vừa sửa đúng
  // lúc cần sửa lại cho đúng. Chặn việc đặt lại: chữ trong ô luôn là chữ người sửa
  // đang thấy, lưu xong thì đó cũng chính là bản đã lưu.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const keepText = (event: Event) => event.preventDefault();
    form.addEventListener("reset", keepText);
    return () => form.removeEventListener("reset", keepText);
  }, []);

  const isSeries = typeof seriesTotal === "number" && seriesTotal > 1;

  return (
    <form ref={formRef} action={formAction} className="grid gap-4">
      <input type="hidden" name="event_id" value={eventId} />

      <p className="text-sm text-slate-600">
        Sửa phần chữ người đăng ký đọc trên form, kể cả khi link đã gửi đi: người mở link sau khi lưu thấy ngay
        nội dung mới. Các ô người đăng ký phải điền không đổi ở đây — muốn thêm bớt ô, vào{" "}
        <strong className="font-medium text-vam-ink">Sửa sự kiện</strong>.
      </p>

      {registrationUrl ? (
        <a
          href={registrationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-sm font-medium text-vam-green underline-offset-2 hover:underline"
        >
          Mở form đăng ký để xem →
        </a>
      ) : null}

      <InlineActionMessage state={state} errorFallback="Không lưu được nội dung form. Thử lại." />

      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="text-sm font-medium text-vam-ink">{field.label}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{field.hint}</span>
          <textarea
            name={field.key}
            defaultValue={field.value}
            rows={field.rows}
            maxLength={FORM_TEXT_MAX_LENGTH}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm leading-6 text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
        </label>
      ))}

      {isSeries ? (
        <label className="flex items-start gap-2 rounded-md border border-vam-line bg-slate-50 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            name="apply_to_series"
            value="1"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
          />
          <span>
            <span className="block font-medium">Áp dụng cho cả {seriesTotal} buổi trong chuỗi</span>
            <span className="block text-xs text-slate-500">
              Mỗi buổi giữ một bản nội dung riêng. Chỉ những đoạn vừa sửa được chép sang các buổi khác. Bỏ chọn nếu
              chỉ muốn sửa buổi này.
            </span>
          </span>
        </label>
      ) : null}

      <LoadingButton
        pendingLabel="Đang lưu…"
        className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
      >
        Lưu nội dung form
      </LoadingButton>
    </form>
  );
}
