"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import {
  createRenewalInviteAction,
  regenerateRenewalInviteAction,
  revokeRenewalInviteAction
} from "@/app/actions/renewals";
import { SubmitButton } from "@/components/submit-button";
import { initialRenewalAdminActionState, type RenewalAdminActionState } from "@/lib/renewal-types";
import type { RenewalConsoleRow, RenewalMentorOption } from "@/lib/renewal-console";

function Feedback({ state }: { state: RenewalAdminActionState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`mt-3 rounded-md border px-3 py-2 text-sm ${state.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
      {state.message}
    </p>
  );
}

function OneTimeLink({ path }: { path?: string }) {
  const [copied, setCopied] = useState(false);
  if (!path) return null;
  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Sao chép đường link gia hạn:", url);
    }
  }
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-semibold uppercase text-amber-800">Link chỉ hiển thị một lần</p>
      <p className="mt-1 break-all font-mono text-xs text-amber-900">{path}</p>
      <button type="button" onClick={copy} className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
        {copied ? "Đã sao chép" : "Sao chép link đầy đủ"}
      </button>
    </div>
  );
}

export function CreateRenewalInviteForm({
  mentors,
  programId,
  seasonId
}: {
  mentors: RenewalMentorOption[];
  programId: string;
  seasonId: string;
}) {
  const [state, action] = useFormState(createRenewalInviteAction, initialRenewalAdminActionState);
  return (
    <form action={action} className="grid gap-4 rounded-lg border border-vam-line bg-white p-5 shadow-soft">
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">Tạo link gia hạn cá nhân</h2>
        <p className="mt-1 text-sm text-slate-600">P0 giao link thủ công qua Gmail/Zalo. Hệ thống không tự gửi email.</p>
      </div>
      <input type="hidden" name="program_id" value={programId} />
      <input type="hidden" name="season_id" value={seasonId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end">
        <label className="text-sm font-medium text-vam-ink">
          Mentor
          <select name="person_id" required className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm">
            <option value="">Chọn mentor…</option>
            {mentors.map((mentor) => <option key={mentor.personId} value={mentor.personId}>{mentor.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-vam-ink">
          Hiệu lực (ngày)
          <input name="expires_days" type="number" min="1" max="60" step="1" defaultValue="14" className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm" />
        </label>
        <SubmitButton disabled={!mentors.length} pendingText="Đang tạo...">Tạo link</SubmitButton>
      </div>
      {!mentors.length ? <p className="text-sm text-slate-500">Không có mentor đủ điều kiện chưa có link live/renewal accepted.</p> : null}
      <Feedback state={state} />
      <OneTimeLink path={state.renewalPath} />
    </form>
  );
}

export function RenewalInviteActions({
  row,
  confirmAction
}: {
  row: RenewalConsoleRow;
  confirmAction: (state: RenewalAdminActionState, formData: FormData) => Promise<RenewalAdminActionState>;
}) {
  const [revokeState, revokeAction] = useFormState(revokeRenewalInviteAction, initialRenewalAdminActionState);
  const [regenerateState, regenerateAction] = useFormState(regenerateRenewalInviteAction, initialRenewalAdminActionState);
  const [confirmState, confirmFormAction] = useFormState(confirmAction, initialRenewalAdminActionState);
  const canReplace = ["live", "expired", "revoked"].includes(row.inviteState);
  const canRevoke = row.inviteState === "live" || row.inviteState === "expired";
  const canConfirm = row.inviteState === "accepted" && Boolean(row.applicationId) && !String(row.applicationStatus ?? "").startsWith("approved_as_");

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {canRevoke ? (
          <form action={revokeAction}>
            <input type="hidden" name="invite_id" value={row.id} />
            <SubmitButton variant="danger" pendingText="Đang thu hồi..." onClick={(event) => { if (!window.confirm("Thu hồi link gia hạn này?")) event.preventDefault(); }}>
              Thu hồi
            </SubmitButton>
          </form>
        ) : null}
        {canReplace ? (
          <form action={regenerateAction} className="flex items-end gap-2">
            <input type="hidden" name="invite_id" value={row.id} />
            <label className="text-xs text-slate-600">Ngày
              <input name="expires_days" type="number" min="1" max="60" defaultValue="14" className="ml-1 w-16 rounded border border-vam-line px-2 py-1.5" />
            </label>
            <SubmitButton variant="outline" pendingText="Đang tạo lại..." onClick={(event) => { if (!window.confirm("Thu hồi link cũ và tạo link mới?")) event.preventDefault(); }}>
              Tạo lại
            </SubmitButton>
          </form>
        ) : null}
        {canConfirm ? (
          <form action={confirmFormAction}>
            <SubmitButton pendingText="Đang xác nhận..." onClick={(event) => { if (!window.confirm("Xác nhận đúng diff bên dưới, đối soát membership và duyệt gia hạn?")) event.preventDefault(); }}>
              Xác nhận & hoàn tất
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <Feedback state={revokeState} />
      <Feedback state={regenerateState} />
      <Feedback state={confirmState} />
      <OneTimeLink path={regenerateState.renewalPath} />
    </div>
  );
}
