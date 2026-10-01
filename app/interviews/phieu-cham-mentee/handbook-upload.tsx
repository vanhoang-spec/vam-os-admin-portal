"use client";
import { useFormState, useFormStatus } from "react-dom";
import { saveInterviewHandbookAction } from "@/app/actions/mentee-interview-rubric";

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-fit rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-50">
      {pending ? "Đang chuyển đổi…" : "Tải Handbook lên"}
    </button>
  );
}

/**
 * Tải Handbook phỏng vấn (.docx) của một mùa. File chỉ đi qua cửa
 * lib/ai/uploads.ts → readHandbookDocx: nhận diện bằng byte đầu, chuyển sang HTML
 * chữ + bảng, ảnh bị bỏ, lọc thẻ. Không lưu file gốc ở đâu cả.
 */
export function HandbookUpload({ seasonId, expectedHandbookVersion }: { seasonId: string; expectedHandbookVersion: number }) {
  const [state, action] = useFormState(saveInterviewHandbookAction, null);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="expectedHandbookVersion" value={expectedHandbookVersion} />
      <label className="text-sm">
        File Word Handbook (.docx, tối đa 8MB)
        <input type="file" name="handbook" accept=".docx" required className="mt-1 block text-sm" />
      </label>
      <p className="text-xs text-slate-500">Ảnh trong file bị bỏ — chỉ giữ chữ, tiêu đề và bảng. Tải file mới sẽ thay Handbook hiện tại của mùa này.</p>
      <UploadButton />
      {state ? <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-vam-green" : "text-red-700"}>{state.message}</p> : null}
    </form>
  );
}
