"use client";

import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/submit-button";
import { applyLegacyImportAction, createLegacyMentorManualAction, previewLegacyImportAction } from "./actions";
import { initialLegacyImportState, initialLegacyManualState } from "./state";

const field = "mt-1 min-h-11 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm";

export function LegacyMentorClient() {
  const [preview, previewAction] = useFormState(previewLegacyImportAction, initialLegacyImportState);
  const [applied, applyAction] = useFormState(applyLegacyImportAction, initialLegacyImportState);
  const [manual, manualAction] = useFormState(createLegacyMentorManualAction, initialLegacyManualState);
  const state = applied.phase === "complete" ? applied : preview;
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-vam-ink">Import CSV legacy mentor</h2>
        <p className="mt-1 text-sm text-slate-600">Upload → validate → preview → resolve identity → explicit apply. Preview không tạo business record.</p>
        <form action={previewAction} className="mt-4 grid gap-4">
          <input name="csv_file" type="file" accept=".csv,text/csv" required className={field} />
          <div className="flex flex-wrap gap-3">
            <SubmitButton variant="outline" pendingText="Đang kiểm tra…">Xem trước</SubmitButton>
            <a href="/admin/renewals/legacy/template" className="rounded-md border border-vam-line px-4 py-2 text-sm font-medium text-vam-green">Tải template</a>
          </div>
        </form>
        {state.message ? <p role="status" className={`mt-4 rounded-md border p-3 text-sm ${state.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{state.message}</p> : null}
        {preview.phase === "preview" && preview.rows.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-vam-line text-sm">
              <thead className="bg-slate-50 text-left"><tr><th className="px-3 py-2">Dòng</th><th className="px-3 py-2">Họ tên</th><th className="px-3 py-2">Email canonical</th><th className="px-3 py-2">Kết quả</th><th className="px-3 py-2">Giải thích</th></tr></thead>
              <tbody className="divide-y divide-vam-line">{preview.rows.map((row) => <tr key={row.rowNumber}><td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2">{row.fullName}</td><td className="px-3 py-2">{row.email}</td><td className="px-3 py-2 font-medium">{row.status}</td><td className="px-3 py-2 text-slate-600">{row.reason}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
        {preview.ok && preview.previewId && preview.previewIntegrity ? (
          <form action={applyAction} className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
            <input type="hidden" name="preview_id" value={preview.previewId} />
            <input type="hidden" name="preview_integrity" value={preview.previewIntegrity} />
            <p className="mb-3 text-sm text-amber-900">Áp dụng chỉ tạo/reuse person và mentor profile tối thiểu, đồng thời ghi provenance. Không tạo Season 12 membership và không tự tạo invitation.</p>
            <SubmitButton pendingText="Đang áp dụng…">Áp dụng import</SubmitButton>
          </form>
        ) : null}
        {applied.outcomes.length ? <ul className="mt-4 grid gap-2 text-sm">{applied.outcomes.map((outcome) => <li key={outcome.rowNumber} className="rounded border border-vam-line p-2">Dòng {outcome.rowNumber}: {outcome.outcome} — {outcome.reason}</li>)}</ul> : null}
      </section>

      <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-vam-ink">Thêm một legacy mentor</h2>
        <p className="mt-1 text-sm text-slate-600">Dùng cùng canonical identity resolver và lifecycle với CSV.</p>
        <form action={manualAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Họ tên<input className={field} name="full_name" required /></label>
          <label className="text-sm font-medium">Email<input className={field} name="email" type="email" required /></label>
          <label className="text-sm font-medium">Số điện thoại<input className={field} name="phone" /></label>
          <label className="text-sm font-medium">Mã mentor cũ<input className={field} name="legacy_mentor_code" /></label>
          <label className="text-sm font-medium">Mùa trước đây<input className={field} name="prior_season" placeholder="Ví dụ: S8" /></label>
          <label className="text-sm font-medium">Ghi chú<textarea className={field} name="notes" rows={2} /></label>
          <div className="sm:col-span-2"><SubmitButton pendingText="Đang xử lý…">Thêm ứng viên</SubmitButton></div>
        </form>
        {manual.message ? <p role="status" className={`mt-4 rounded-md border p-3 text-sm ${manual.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{manual.message}</p> : null}
      </section>
    </div>
  );
}
