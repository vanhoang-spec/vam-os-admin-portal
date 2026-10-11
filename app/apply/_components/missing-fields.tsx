"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Danh sách "mục bắt buộc chưa hoàn thành" ngay cạnh nút gửi — dùng chung cho form
 * nộp đơn (mentor, mentee) và form gia hạn mentor.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TÁCH RA
 * ---------------------------------------------------------------------------
 * Phần này vốn nằm trong `ApplicationForm`. Form gia hạn không có nó: bấm "Xác nhận
 * tiếp tục" khi còn thiếu thì trình duyệt chỉ chỉ ra MỘT ô, sửa xong bấm lại mới biết
 * ô kế — BTC góp ý 11/10/2026 rằng phải liệt kê ngay tại nút xác nhận những gì còn
 * thiếu. Viết lại một bản thứ hai cho form gia hạn là hai bản sẽ lệch nhau; một cửa
 * cho một việc.
 *
 * ---------------------------------------------------------------------------
 * CÁCH NỐI VÀO MỘT FORM
 * ---------------------------------------------------------------------------
 *   const m = useMissingFields();
 *   <form ref={m.formRef} onInvalidCapture={m.revealInvalid}
 *         onSubmit={m.clearMissing} onChange={m.clearFieldMark}>
 *     ...
 *     <MissingFieldsSummary missing={m.missing} />
 *     <button type="submit">...</button>
 *   </form>
 *
 * Mỗi ô cần một phần tử bọc mang `data-field-name` và `data-field-label`: tên để gộp
 * các ô cùng nhóm (radio, checkbox) thành một dòng, nhãn là chữ hiện trong danh sách.
 * Ô không có phần tử bọc vẫn được liệt kê, nhưng bằng tên kỹ thuật của nó.
 */
export type MissingField = { name: string; label: string };

function fieldDetails(control: HTMLElement): MissingField {
  const container = control.closest<HTMLElement>("[data-field-name]");
  return {
    name: container?.dataset.fieldName || control.getAttribute("name") || control.id,
    label: container?.dataset.fieldLabel || control.getAttribute("name") || "Mục bắt buộc"
  };
}

export function useMissingFields() {
  const formRef = useRef<HTMLFormElement>(null);
  const [missing, setMissing] = useState<MissingField[]>([]);

  // Runs from the form's `invalid` capture listener, which the browser fires once
  // per invalid control during interactive validation.
  //
  // MUST NOT call checkValidity(): per the HTML spec that method *dispatches* an
  // `invalid` event at the control, which captures straight back into this handler
  // and recurses without bound. Read the `validity` property instead — a plain
  // property access that fires nothing.
  const revealInvalid = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const controls = Array.from(form.querySelectorAll<HTMLElement>("input, select, textarea"));
    const invalid = controls.filter((control) => {
      const candidate = control as HTMLInputElement;
      return candidate.validity ? !candidate.validity.valid : false;
    });
    const unique = Array.from(new Map(invalid.map((control) => {
      const details = fieldDetails(control);
      return [details.name, details];
    })).values());
    // The browser fires one `invalid` event per invalid control, so this handler
    // runs N times per submit. Keep the previous array when nothing changed so the
    // repeats collapse into a single React render.
    setMissing((prev) =>
      prev.length === unique.length && prev.every((item, i) => item.name === unique[i].name)
        ? prev
        : unique
    );
    form.querySelectorAll("[data-field-name]").forEach((node) => node.removeAttribute("data-invalid"));
    controls.forEach((control) => control.removeAttribute("aria-invalid"));
    invalid.forEach((control) => {
      control.setAttribute("aria-invalid", "true");
      control.closest("[data-field-name]")?.setAttribute("data-invalid", "true");
    });
    // Deterministic first-invalid handling in DOM order. Idempotent across the N
    // repeats because `invalid[0]` is the same node every time.
    const first = invalid[0];
    if (first && document.activeElement !== first) {
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      first.focus({ preventScroll: true });
    }
  }, []);

  /** `submit` chỉ nổ khi mọi ô đã hợp lệ — đó là lúc danh sách cũ hết đúng. */
  const clearMissing = useCallback(() => setMissing([]), []);

  /** Người dùng vừa sửa một ô: gỡ dấu đỏ của riêng ô đó, không đợi lần bấm gửi sau. */
  const clearFieldMark = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    const control = event.target as HTMLElement;
    control.removeAttribute("aria-invalid");
    control.closest("[data-field-name]")?.removeAttribute("data-invalid");
  }, []);

  return { formRef, missing, setMissing, revealInvalid, clearMissing, clearFieldMark };
}

export function MissingFieldsSummary({ missing }: { missing: MissingField[] }) {
  if (!missing.length) return null;
  return (
    <div
      className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
      role="alert"
      aria-live="polite"
      data-testid="missing-fields-summary"
    >
      <p className="font-semibold">Bạn còn {missing.length} mục bắt buộc chưa hoàn thành.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {missing.map((item) => <li key={item.name}>{item.label}</li>)}
      </ul>
    </div>
  );
}
