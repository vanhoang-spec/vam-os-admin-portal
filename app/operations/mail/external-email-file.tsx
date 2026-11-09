"use client";

import { useFormStatus } from "react-dom";
import { EXTERNAL_FILE_FIELD } from "@/lib/bulk-mail-external-core";

/**
 * Ô chọn file Excel danh sách email ngoài VAM (VAM00027).
 *
 * Chỉ nhận .xlsx. Byte của file KHÔNG được đọc ở trình duyệt: form gửi file lên lệnh
 * `readExternalEmailFileAction`, và máy chủ chỉ lấy byte qua lib/ai/uploads.ts › readEmailListXlsx
 * (kiểm cỡ, kiểm byte đầu, đọc ra chữ). Xem mục 3 và 3b của
 * __tests__/image-optimizer-attack-surface.test.ts.
 */
export function ExternalEmailFileForm({ action }: { action: (formData: FormData) => void }) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-testid="external-file-form">
      <input
        type="file"
        name={EXTERNAL_FILE_FIELD}
        accept=".xlsx"
        aria-label="Chọn file Excel danh sách email"
        className="max-w-full text-sm text-slate-700 file:mr-2 file:rounded-md file:border file:border-vam-line file:bg-white file:px-3 file:py-1.5 file:text-sm"
      />
      <ReadButton />
    </form>
  );
}

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-semibold text-vam-ink transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang đọc file…" : "Đọc file Excel"}
    </button>
  );
}
