"use client";

export function SelectAllMentorRows() {
  function toggleAll(checked: boolean) {
    document
      .querySelectorAll<HTMLInputElement>('input[name="application_id"][data-mentor-bulk="1"]')
      .forEach((input) => {
        input.checked = checked;
      });
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300"
        onChange={(event) => toggleAll(event.currentTarget.checked)}
      />
      Chọn tất cả trang
    </label>
  );
}

export function MentorBulkDecisionButtons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        name="new_status"
        value="screening_passed"
        className="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Qua vòng hồ sơ
      </button>
      <button
        type="submit"
        name="new_status"
        value="needs_more_review"
        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
      >
        Cần review thêm
      </button>
      <button
        type="submit"
        name="new_status"
        value="rejected_or_not_fit"
        onClick={(event) => {
          if (!window.confirm("Xác nhận đánh dấu các hồ sơ đã chọn là Không phù hợp / từ chối?")) {
            event.preventDefault();
          }
        }}
        className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
      >
        Không phù hợp
      </button>
    </div>
  );
}
