"use client";

import type { DraftRecoveryStatus } from "./use-draft-recovery";

function formatSavedAt(savedAt: string): string {
  const parsed = new Date(savedAt);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export function DraftRecoveryBanner({
  status,
  savedAt,
  hasDraft,
  onRestore,
  onDiscard
}: {
  status: DraftRecoveryStatus;
  savedAt: string | null;
  hasDraft: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (status === "prompt") {
    return (
      <div
        role="alertdialog"
        aria-labelledby="draft-recovery-title"
        className="mb-6 rounded-lg border border-vam-line bg-vam-mint/40 p-4 text-sm text-vam-ink"
      >
        <p id="draft-recovery-title" className="font-semibold">Chúng tôi tìm thấy một bản nháp chưa gửi.</p>
        <p className="mt-1 text-slate-700">
          {savedAt ? `Lưu lần cuối lúc ${formatSavedAt(savedAt)}. ` : ""}
          Bạn có muốn khôi phục các câu trả lời đã điền không? Vì lý do minh bạch, các mục đồng ý và cam kết
          sẽ để trống và cần bạn xác nhận lại.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRestore}
            className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Khôi phục bản nháp
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Bắt đầu mới (xoá bản nháp)
          </button>
        </div>
      </div>
    );
  }

  if (!hasDraft) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-md border border-vam-line bg-slate-50 px-4 py-2 text-xs text-slate-600">
      <span aria-live="polite">
        {savedAt ? `Đã lưu nháp trên thiết bị này lúc ${formatSavedAt(savedAt)}.` : "Bản nháp được lưu trên thiết bị này."}
      </span>
      <button type="button" onClick={onDiscard} className="font-medium text-red-700 underline underline-offset-2">
        Xoá bản nháp
      </button>
    </div>
  );
}
