"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { CsvExportButton } from "@/app/operations/intelligence/export-buttons";
import { grantExtraSlotsAction } from "@/app/actions/mentor-confirmations";
import {
  initialMentorConfirmationActionState,
  type MentorConfirmationActionState
} from "@/lib/mentor-confirmation-action-types";
import type {
  BlockedSelectionRow,
  MentorWithFreeSlots,
  UnmatchedMentee
} from "@/lib/matching-gaps";

/**
 * The three leftover lists, and the one action the organisers take from here:
 * granting a mentor the extra place they were refused.
 *
 * The grant writes an absolute number (current + 1), the same field the
 * confirmation roster edits, so both screens always agree.
 */

const STATUS_LABELS: Record<string, string> = {
  interview_completed: "Đã phỏng vấn",
  approved_as_mentee: "Đã duyệt làm mentee"
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function GrantSlotButton({
  row,
  onDone
}: {
  row: BlockedSelectionRow;
  onDone: () => void;
}) {
  const [state, formAction] = useFormState<MentorConfirmationActionState, FormData>(
    grantExtraSlotsAction,
    initialMentorConfirmationActionState
  );
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!state.ok || !state.message) return;
    if (refreshedFor.current === state.message) return;
    refreshedFor.current = state.message;
    onDone();
  }, [state.ok, state.message, onDone]);

  if (!row.confirmation_id) {
    return <span className="text-xs text-slate-400">Không tìm thấy bản xác nhận</span>;
  }

  const current = row.extra_slots ?? 0;
  if (current >= 3) {
    return <span className="text-xs text-slate-500">Đã cấp tối đa 3 suất bổ sung</span>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="confirmation_id" value={row.confirmation_id} />
      <input type="hidden" name="extra_slots" value={current + 1} />
      <input type="hidden" name="reason" value="Mentor xin thêm suất sau phỏng vấn" />
      <SubmitButton variant="outline" className="h-7 px-2 text-xs" pendingText="Đang cấp...">
        Cấp thêm 1 suất (→ {current + 1})
      </SubmitButton>
      {state.message ? (
        <span className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>
      ) : null}
    </form>
  );
}

export function UnmatchedClient({
  mentees,
  mentors,
  blocked,
  canOperate,
  seasonLabel
}: {
  mentees: UnmatchedMentee[];
  mentors: MentorWithFreeSlots[];
  blocked: BlockedSelectionRow[];
  canOperate: boolean;
  seasonLabel: string;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [tab, setTab] = useState<"mentees" | "mentors" | "requests">("mentees");

  const menteeCsv = useMemo(
    () =>
      mentees.map((row) => ({
        ho_ten: row.full_name ?? "",
        email: row.email_primary ?? "",
        trang_thai: STATUS_LABELS[row.status ?? ""] ?? row.status ?? "",
        diem_phong_van: row.interview_score ?? "",
        ma_ho_so: row.application_id
      })),
    [mentees]
  );

  const mentorCsv = useMemo(
    () =>
      mentors.map((row) => ({
        ho_ten: row.full_name ?? "",
        email: row.email_primary ?? "",
        han_muc: row.cap,
        da_nhan: row.active_count,
        con_trong: row.free_slots
      })),
    [mentors]
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {(
          [
            ["mentees", `Mentee chờ ghép (${mentees.length})`],
            ["mentors", `Mentor còn suất (${mentors.length})`],
            ["requests", `Xin thêm suất (${blocked.length})`]
          ] as Array<["mentees" | "mentors" | "requests", string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-full px-3 py-1 font-medium ${
              tab === value
                ? "bg-vam-green text-white"
                : "border border-vam-line bg-white text-slate-600 hover:bg-vam-mint"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto">
          {tab === "mentees" && mentees.length > 0 ? (
            <CsvExportButton
              rows={menteeCsv}
              filename={`vam-mentee-chua-ghep-${seasonLabel || "mua"}.csv`}
              label={`Xuất CSV (${mentees.length})`}
            />
          ) : null}
          {tab === "mentors" && mentors.length > 0 ? (
            <CsvExportButton
              rows={mentorCsv}
              filename={`vam-mentor-con-suat-${seasonLabel || "mua"}.csv`}
              label={`Xuất CSV (${mentors.length})`}
            />
          ) : null}
        </span>
      </div>

      {tab === "mentees" ? (
        <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
              <tr>
                <th className="px-3 py-2 font-semibold">Mentee</th>
                <th className="px-3 py-2 font-semibold">Trạng thái</th>
                <th className="px-3 py-2 font-semibold">Điểm phỏng vấn</th>
                <th className="px-3 py-2 font-semibold">Hồ sơ</th>
              </tr>
            </thead>
            <tbody>
              {mentees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                    Không còn mentee nào chờ ghép cặp.
                  </td>
                </tr>
              ) : (
                mentees.map((row) => (
                  <tr key={row.application_id} className="border-b border-vam-line">
                    <td className="px-3 py-2">
                      <div className="font-medium text-vam-ink">{row.full_name ?? "(chưa có tên)"}</div>
                      <div className="text-xs text-slate-500">{row.email_primary ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {STATUS_LABELS[row.status ?? ""] ?? row.status ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.interview_score ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <Link
                        href={`/applications/${row.application_id}`}
                        className="text-vam-green hover:underline"
                      >
                        Xem hồ sơ →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "mentors" ? (
        <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
              <tr>
                <th className="px-3 py-2 font-semibold">Mentor</th>
                <th className="px-3 py-2 font-semibold">Hạn mức</th>
                <th className="px-3 py-2 font-semibold">Đã nhận</th>
                <th className="px-3 py-2 font-semibold">Còn trống</th>
                <th className="px-3 py-2 font-semibold">Nhận phỏng vấn</th>
              </tr>
            </thead>
            <tbody>
              {mentors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    Không còn mentor nào trống suất.
                  </td>
                </tr>
              ) : (
                mentors.map((row) => (
                  <tr key={row.confirmation_id} className="border-b border-vam-line">
                    <td className="px-3 py-2">
                      <div className="font-medium text-vam-ink">{row.full_name ?? "(chưa có tên)"}</div>
                      <div className="text-xs text-slate-500">{row.email_primary ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.cap}
                      {row.extra_slots > 0 ? (
                        <span className="ml-1 text-xs text-slate-500">(+{row.extra_slots} bổ sung)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{row.active_count}</td>
                    <td className="px-3 py-2 tabular-nums font-medium text-vam-green">{row.free_slots}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {row.agree_to_interview === true ? "Có" : row.agree_to_interview === false ? "Không" : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "requests" ? (
        <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
              <tr>
                <th className="px-3 py-2 font-semibold">Thời điểm</th>
                <th className="px-3 py-2 font-semibold">Mentor</th>
                <th className="px-3 py-2 font-semibold">Muốn nhận</th>
                <th className="px-3 py-2 font-semibold">Lúc đó</th>
                <th className="px-3 py-2 font-semibold">Xử lý</th>
              </tr>
            </thead>
            <tbody>
              {blocked.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    Chưa có mentor nào bị chặn vì hết hạn mức.
                  </td>
                </tr>
              ) : (
                blocked.map((row) => (
                  <tr key={row.id} className="border-b border-vam-line">
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(row.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-vam-ink">{row.mentor_name ?? "(không xác định)"}</div>
                      <div className="text-xs text-slate-500">{row.mentor_email ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Link
                        href={`/applications/${row.application_id}`}
                        className="text-vam-green hover:underline"
                      >
                        {row.candidate_name ?? "Xem hồ sơ"} →
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-slate-600">
                      {row.active_count_at_decision ?? "—"}/{row.cap_at_decision ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {canOperate ? (
                        <GrantSlotButton row={row} onDone={refresh} />
                      ) : (
                        <span className="text-xs text-slate-500">Cần quyền vận hành mùa này</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
