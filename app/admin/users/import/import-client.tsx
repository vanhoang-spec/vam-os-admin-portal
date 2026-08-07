"use client";

import { useFormState, useFormStatus } from "react-dom";
import { accountImportResultsCsv } from "@/lib/account-import";
import { confirmImportAction, previewImportAction } from "./actions";
import { initialImportState } from "./import-state";
import { SubmitButton } from "@/components/submit-button";

function PreviewRows({ rows }: { rows: typeof initialImportState.rows }) {
  return <div className="grid gap-3" aria-live="polite">{rows.map((row) => <article key={row.rowNumber} className={row.valid ? "rounded-lg border border-green-200 bg-green-50 p-4" : "rounded-lg border border-red-200 bg-red-50 p-4"}>
    <div className="flex flex-wrap items-start justify-between gap-2"><strong>Dòng {row.rowNumber}: {row.email || "(không có email)"}</strong><span className="rounded-full bg-white px-2 py-1 text-xs">{row.valid ? "Hợp lệ" : "Có lỗi"}</span></div>
    <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-slate-500">Loại</dt><dd>{row.role === "mentor" || row.role === "mentee" ? "Membership, không Auth" : "Tài khoản vận hành"}</dd></div><div><dt className="text-slate-500">Vai trò</dt><dd>{row.role || "—"}</dd></div><div><dt className="text-slate-500">Program</dt><dd>{row.programCode || "—"}</dd></div><div><dt className="text-slate-500">Season / batch</dt><dd>{row.seasonCode || "—"} / {row.intakeBatchCode || "—"}</dd></div></dl>
    {row.reasons.length ? <ul className="mt-2 list-disc pl-5 text-sm text-red-700">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
  </article>)}</div>;
}

export function AccountImportClient() {
  const [preview, previewAction] = useFormState(previewImportAction, initialImportState);
  const [confirmed, confirmAction] = useFormState(confirmImportAction, initialImportState);
  const finalState = confirmed.phase === "complete" ? confirmed : preview;
  function downloadResults() {
    const blob = new Blob([accountImportResultsCsv(confirmed.outcomes)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "vam-account-import-results.csv"; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="grid gap-6">
    <form action={previewAction} className="grid gap-4 rounded-lg border border-vam-line bg-white p-4 sm:p-6">
      <label className="grid gap-2"><span className="font-medium">Chọn tệp CSV</span><input name="csv_file" type="file" accept=".csv,text/csv" required className="min-h-11 rounded-md border border-vam-line p-2" /></label>
      <p className="text-sm text-slate-600">Tối đa 500 dòng và 512 KiB. Tệp chỉ được đọc để xem trước; hệ thống không lưu tệp thô.</p>
      <div><SubmitButton aria-label="Xem trước an toàn" variant="outline" pendingText="Đang xử lý...">Xem trước an toàn</SubmitButton></div>
    </form>
    {finalState.message ? <div tabIndex={-1} className={finalState.ok ? "rounded-md border border-green-200 bg-green-50 p-4 text-green-800" : "rounded-md border border-red-200 bg-red-50 p-4 text-red-800"} role="status">{finalState.message}</div> : null}
    {preview.phase === "preview" ? <><PreviewRows rows={preview.rows} />{preview.ok && preview.previewId && preview.previewIntegrity ? <form action={confirmAction} className="sticky bottom-3 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg">
      <input type="hidden" name="preview_id" value={preview.previewId} />
      <input type="hidden" name="preview_integrity" value={preview.previewIntegrity} />
      <p className="mb-3 text-sm text-amber-900">Xác nhận sẽ kiểm tra lại toàn bộ dữ liệu trên server. Staff sẽ nhận lời mời; mentor/mentee chỉ nhận membership và không có Auth.</p>
      <SubmitButton aria-label="Xác nhận import" variant="primary" pendingText="Đang nhập dữ liệu...">Xác nhận import</SubmitButton>
    </form> : null}</> : null}
    {confirmed.phase === "complete" ? <section className="grid gap-3"><h2 className="text-lg font-semibold">Kết quả từng dòng</h2>{confirmed.outcomes.map((row) => <div key={row.rowNumber} className="flex flex-wrap justify-between gap-2 rounded-md border border-vam-line bg-white p-3"><span>Dòng {row.rowNumber}</span><strong>{row.status}</strong><span className="w-full text-sm text-slate-600">{row.reason}</span></div>)}<button type="button" onClick={downloadResults} className="min-h-11 justify-self-start rounded-md border border-vam-line bg-white px-4 py-2 font-medium text-vam-green">Tải CSV kết quả</button></section> : null}
  </div>;
}
