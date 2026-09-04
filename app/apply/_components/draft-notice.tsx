"use client";

/**
 * The applicant-facing statement about drafts.
 *
 * Deliberately explicit that the draft lives on THIS device only. An applicant
 * who believes the form is saved "in the system" will happily switch machines
 * and lose everything, so the copy names the limit rather than implying a
 * server-side save. It also carries the explicit clear control, because a
 * draft on a shared university machine needs a way out that does not depend on
 * knowing how to clear site data.
 */
export function ApplyDraftNotice({
  restored,
  ttlDays,
  onClear
}: {
  restored: boolean;
  ttlDays: number;
  onClear: () => void;
}) {
  return (
    <div
      data-testid="apply-draft-notice"
      data-restored={restored ? "true" : "false"}
      className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-blue-900" role="status">
          {restored
            ? "Đã khôi phục bản nháp chưa gửi."
            : "Hệ thống tự động lưu nháp khi bạn nhập."}
        </p>
        <button
          type="button"
          onClick={onClear}
          data-testid="apply-clear-draft"
          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100"
        >
          Xóa bản nháp
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-blue-800">
        Bản nháp được lưu trên trình duyệt này (không gửi lên hệ thống), giữ tối đa {ttlDays} ngày và
        sẽ mất khi bạn xóa dữ liệu duyệt web. Nếu bạn dùng máy chung/công cộng, hãy bấm “Xóa bản
        nháp” sau khi hoàn tất.
      </p>
    </div>
  );
}
