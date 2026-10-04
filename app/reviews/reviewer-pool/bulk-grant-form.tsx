"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { PARTICIPATION_GROUPS, type ParticipationRole } from "@/lib/recruitment-permissions-core";
import { useRouter } from "next/navigation";
import { bulkEnableMentorsAsReviewersAction } from "@/app/actions/enable-reviewer-bulk";
import {
  initialBulkGrantActionState,
  type BulkGrantActionState
} from "@/lib/enable-reviewer-bulk-action-types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Đang xử lý…" : "Cấp quyền + gửi thư cho danh sách này"}
    </button>
  );
}

function ResultSummary({ state }: { state: BulkGrantActionState }) {
  if (!state.message) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <p className={state.ok ? "text-green-700" : "text-red-600"}>{state.ok ? "✓" : "✗"} {state.message}</p>
      {state.granted.length > 0 ? (
        <details className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-green-800">
            Đã xử lý xong {state.granted.length} người
          </summary>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-green-800">
            {state.granted.map((row) => (
              <li key={row.email}>{row.email} — {row.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {state.failed.length > 0 ? (
        <details open className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-red-700">
            {state.failed.length} người cấp quyền thất bại
          </summary>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-red-700">
            {state.failed.map((row) => (
              <li key={row.email}>{row.email} — {row.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {state.notFound.length > 0 ? (
        <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-amber-800">
            {state.notFound.length} email không khớp mentor nào của đợt tuyển này
          </summary>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-amber-800">
            {state.notFound.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {state.skippedDueToQuota.length > 0 ? (
        <details open className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-amber-800">
            {state.skippedDueToQuota.length} người CHƯA xử lý — dán lại đúng danh sách này và bấm tiếp sau
          </summary>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-amber-800">
            {state.skippedDueToQuota.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function BulkGrantForm({ intakeBatchId, canGrantMentor }: { intakeBatchId: string | null; canGrantMentor: boolean }) {
  const router = useRouter();
  const [state, formAction] = useFormState<BulkGrantActionState, FormData>(
    bulkEnableMentorsAsReviewersAction,
    initialBulkGrantActionState
  );
  const [participationRole, setParticipationRole] = useState<"" | ParticipationRole>("");
  // Support chỉ cấp được hai nhóm mentee; database cũng chặn lại (vam084_grant…).
  const groups = PARTICIPATION_GROUPS.filter((g) => canGrantMentor || !g.coreOnly);

  const lastMsg = useRef("");
  useEffect(() => {
    if (state.ok && state.message && state.message !== lastMsg.current && (state.granted.length > 0 || state.failed.length > 0)) {
      lastMsg.current = state.message ?? "";
      router.refresh();
    }
  }, [router, state.ok, state.message, state.granted.length, state.failed.length]);

  if (!intakeBatchId) {
    return (
      <p className="text-sm text-slate-500">Chọn đợt tuyển ở trên để cấp quyền hàng loạt.</p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="intake_batch_id" value={intakeBatchId} />

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500">
          Danh sách email — mỗi dòng một email, đúng email mentor dùng lúc nộp đơn trên VAM OS
        </label>
        <textarea
          name="emails"
          required
          rows={6}
          placeholder={"vana@example.com\nvanb@example.com\n…"}
          className="rounded-md border border-vam-line px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-vam-green"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Cấp quyền gì</label>
          <select
            name="participation_role"
            required
            value={participationRole}
            onChange={(e) => setParticipationRole(e.target.value as typeof participationRole)}
            className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="">-- Chọn --</option>
            {groups.map((g) => (
              <option key={g.role} value={g.role}>{g.label}</option>
            ))}
          </select>
        </div>
        <SubmitButton />
      </div>

      <p className="text-xs text-slate-500">
        Mỗi lượt bấm xử lý tối đa một số người nhất định — hạn mức thư Brevo dùng chung cả hệ thống
        (300/24 giờ). Còn người chưa xử lý thì dán lại đúng danh sách này và bấm tiếp lượt sau, cách
        nhau ít nhất vài giờ.
      </p>

      <ResultSummary state={state} />
    </form>
  );
}
