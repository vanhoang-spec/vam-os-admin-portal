"use client";

import { useState } from "react";
// useFormState của react-dom, không phải useActionState: dự án chạy React 18.3.1 — xem CLAUDE.md.
import { useFormState, useFormStatus } from "react-dom";
import { SUPPORT_TEAM_IDLE, type SupportTeamActionState, type SupportTeamPanelState } from "@/lib/support-team-mark-core";

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50"
    >
      {pending ? "Đang lưu…" : "Lưu"}
    </button>
  );
}

/**
 * Khung "Support team" trên hồ sơ (BTC 13/10/2026): Support team / Core team / BTC tích rồi bấm Lưu,
 * người này thành mentee của mùa hiện tại NGAY, không qua phỏng vấn, không cần gửi thư.
 *
 * Cố ý hai bước (tích, rồi Lưu): một cú chạm nhầm trên điện thoại không được biến một người thành
 * mentee. Không có lệnh "bỏ tích": đã thành mentee rồi thì muốn ngừng, đổi tư cách ở phần
 * "Trạng thái tham gia" như mọi mentee khác.
 *
 * Ô tích chỉ là tiện dụng — quyền, mùa và mọi điều cản (đơn đã bị từ chối, tư cách đã ngừng, hồ sơ
 * trùng…) do máy chủ và hàm vam121_set_support_team kiểm lại, vì giá trị của ô là thứ người gửi tự đặt được.
 */
export function SupportTeamPanel({
  action,
  seasonCode,
  personName,
  state,
  sendCount
}: {
  action: (previous: SupportTeamActionState, formData: FormData) => Promise<SupportTeamActionState>;
  seasonCode: string;
  personName: string;
  state: SupportTeamPanelState;
  sendCount: number;
}) {
  const [result, formAction] = useFormState(action, SUPPORT_TEAM_IDLE);
  const [ticked, setTicked] = useState(false);
  const name = personName.trim() || "Bạn này";

  const message =
    result.status !== "idle" && result.message ? (
      <p role="status" className={`mt-2 text-sm ${result.status === "ok" ? "text-green-700" : "text-red-600"}`} data-testid="support-team-message">
        {result.message}
      </p>
    ) : null;

  if (state === "marked") {
    return (
      <div data-testid="support-team-panel" data-state="marked">
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <div className="text-sm font-semibold text-green-800" data-testid="support-team-marked">
            ✓ Là Support team mùa {seasonCode}
          </div>
          <p className="mt-1 text-xs text-green-800">
            {name} đã là mentee của mùa này, không qua phỏng vấn. Muốn ngừng, đổi tư cách mentee ở phần “Trạng thái tham gia” bên dưới.
          </p>
        </div>
        {message}
      </div>
    );
  }

  return (
    <div data-testid="support-team-panel" data-state={state}>
      <form action={formAction} data-testid="support-team-form">
        <label className="flex items-start gap-2 text-sm text-vam-ink">
          <input
            type="checkbox"
            name="support_team"
            checked={ticked}
            onChange={(event) => setTicked(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <strong>Là Support team</strong> của mùa {seasonCode}
          </span>
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Tích rồi bấm “Lưu”: {name} tự thành mentee của mùa {seasonCode} ngay — đơn được duyệt, có hồ sơ mentee và tư cách đang
          hoạt động — không qua phỏng vấn, không cần gửi thư.
        </p>
        {state === "listed" ? (
          <p className="mt-1 text-xs text-amber-700" data-testid="support-team-listed">
            {name} đang nằm trong danh sách thư mời đặc cách{sendCount > 0 ? ` (đã gửi ${sendCount} thư, chờ xác nhận)` : ""}. Tích ở đây là
            xác nhận luôn, không cần chờ bạn bấm link trong thư.
          </p>
        ) : null}
        <div className="mt-3">
          <SaveButton disabled={!ticked} />
        </div>
      </form>
      {message}
    </div>
  );
}
