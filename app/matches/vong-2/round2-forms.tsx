"use client";

import { useFormState, useFormStatus } from "react-dom";
import { classifyNewAction, setGroupAction } from "@/app/actions/matching-round2";
import { ROUND2_IDLE, type Round2ActionState } from "@/lib/matching-round2-action-types";
import { INDUSTRY_GROUPS } from "@/lib/matching-round2-groups-core";

function Message({ state }: { state: Round2ActionState }) {
  if (state.status === "idle") return null;
  return (
    <p role="status" className={`text-sm ${state.status === "ok" ? "text-green-700" : "text-red-600"}`}>
      {state.message}
    </p>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Nút "Phân loại người mới". Máy chủ tự tính lại từ dữ liệu hiện tại; form không gửi
 * nhóm nào lên. Người đã có nhóm giữ nguyên (khoá), chỉ ghi nhận nếu dữ liệu đổi.
 */
export function ClassifyPanel({ pendingMentors, pendingMentees }: { pendingMentors: number; pendingMentees: number }) {
  const [state, action] = useFormState(classifyNewAction, ROUND2_IDLE);
  const total = pendingMentors + pendingMentees;
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="classify-panel">
      <p className="text-sm text-slate-600">
        {total > 0
          ? `${pendingMentors} mentor và ${pendingMentees} mentee chưa có nhóm. Bấm để lưu nhóm đề xuất bên dưới — nhóm đã lưu bị khoá tới hết mùa, chỉ đổi được bằng ô “Đổi nhóm” (có lý do).`
          : "Mọi người đủ điều kiện đều đã có nhóm. Bấm lại sau khi có người mới (ví dụ mentee đạt đợt phỏng vấn sau)."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={total > 0 ? `Phân loại ${total} người mới` : "Kiểm tra người mới"} pendingLabel="Đang phân loại…" />
        <Message state={state} />
      </div>
    </form>
  );
}

/** Đổi hoặc xác nhận nhóm của một người. Giữ nguyên nhóm + ghi lý do = xác nhận (gỡ cờ). */
export function GroupEditForm({ assignmentId, currentGroup }: { assignmentId: string; currentGroup: number }) {
  const [state, action] = useFormState(setGroupAction, ROUND2_IDLE);
  return (
    <form action={action} className="mt-2 flex flex-col gap-2" data-testid="group-edit-form">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="expectedGroup" value={currentGroup} />
      <label className="text-xs text-slate-600">
        Nhóm
        <select
          name="newGroup"
          defaultValue={String(currentGroup)}
          className="mt-1 block w-full rounded-md border border-vam-line bg-white px-2 py-1 text-sm"
        >
          {INDUSTRY_GROUPS.map((g) => (
            <option key={g.code} value={g.code}>
              {g.code}. {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Lý do (bắt buộc)
        <input name="reason" required maxLength={500} className="mt-1 block w-full rounded-md border border-vam-line px-2 py-1 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton label="Lưu nhóm" pendingLabel="Đang lưu…" />
        <Message state={state} />
      </div>
    </form>
  );
}
