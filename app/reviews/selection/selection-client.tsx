"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { CsvExportButton } from "@/app/operations/intelligence/export-buttons";
import {
  applySelectionRunAction,
  createSelectionRunAction,
  discardSelectionRunAction,
  promoteReserveApplicationAction
} from "@/app/actions/selection";
import {
  initialSelectionActionState,
  type SelectionActionState
} from "@/lib/selection-action-types";
import type { SelectionRunItemView, SelectionRunRow, SelectionSummary } from "@/lib/selection";

/**
 * The operator surface for one selection run.
 *
 * The list is shown before it is applied, because the point of the screen is to
 * let a human check the cut — especially the rows immediately either side of it
 * — before invitations go out.
 */

const GROUP_LABEL: Record<string, string> = {
  main: "Chính thức",
  reserve: "Dự phòng",
  below: "Dưới ngưỡng"
};

function groupBadge(group: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (group === "main") return `${base} bg-green-100 text-green-800`;
  if (group === "reserve") return `${base} bg-amber-100 text-amber-800`;
  return `${base} bg-slate-100 text-slate-600`;
}

function Feedback({ state }: { state: SelectionActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

function PromoteButton({
  runId,
  applicationId,
  onDone
}: {
  runId: string;
  applicationId: string;
  onDone: () => void;
}) {
  const [state, formAction] = useFormState<SelectionActionState, FormData>(
    promoteReserveApplicationAction,
    initialSelectionActionState
  );
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!state.ok || !state.message) return;
    if (refreshedFor.current === state.message) return;
    refreshedFor.current = state.message;
    onDone();
  }, [state.ok, state.message, onDone]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="application_id" value={applicationId} />
      <SubmitButton variant="outline" className="h-7 px-2 text-xs" pendingText="Đang đôn...">
        Đôn lên phỏng vấn
      </SubmitButton>
      {state.message && !state.ok ? <span className="text-xs text-red-700">{state.message}</span> : null}
    </form>
  );
}

export function SelectionClient({
  intakeBatchId,
  roleApplied,
  run,
  items,
  summary,
  capacityTotal,
  canOperate
}: {
  intakeBatchId: string;
  roleApplied: string;
  run: SelectionRunRow | null;
  items: SelectionRunItemView[];
  summary: SelectionSummary | null;
  capacityTotal: number;
  canOperate: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  const [createState, createAction] = useFormState<SelectionActionState, FormData>(
    createSelectionRunAction,
    initialSelectionActionState
  );
  const [applyState, applyAction] = useFormState<SelectionActionState, FormData>(
    applySelectionRunAction,
    initialSelectionActionState
  );
  const [discardState, discardAction] = useFormState<SelectionActionState, FormData>(
    discardSelectionRunAction,
    initialSelectionActionState
  );

  const [groupFilter, setGroupFilter] = useState<"all" | "main" | "reserve" | "below">("all");

  const refreshedFor = useRef<string | null>(null);
  const successKey = [
    createState.ok && createState.message,
    applyState.ok && applyState.message,
    discardState.ok && discardState.message
  ]
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!successKey) return;
    if (refreshedFor.current === successKey) return;
    refreshedFor.current = successKey;
    refresh();
  }, [successKey, refresh]);

  const visible = useMemo(
    () => (groupFilter === "all" ? items : items.filter((item) => item.selection_group === groupFilter)),
    [items, groupFilter]
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      main: items.filter((item) => item.selection_group === "main").length,
      reserve: items.filter((item) => item.selection_group === "reserve").length,
      below: items.filter((item) => item.selection_group === "below").length
    }),
    [items]
  );

  const csvRows = useMemo(
    () =>
      items.map((item) => ({
        thu_hang: item.rank,
        nhom: GROUP_LABEL[item.selection_group] ?? item.selection_group,
        ho_ten: item.full_name ?? "",
        email: item.email_primary ?? "",
        diem_trung_binh: item.total_score ?? "",
        so_luot_cham: item.review_count,
        trang_thai_ho_so: item.application_status ?? "",
        ghi_chu: item.tie_break_note ?? ""
      })),
    [items]
  );

  const isDraft = run?.status === "draft";
  const isApplied = run?.status === "applied";

  return (
    <div className="grid gap-4">
      {/* Actions */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        {!run || run.status !== "draft" ? (
          <form action={createAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intake_batch_id" value={intakeBatchId} />
            <input type="hidden" name="role_applied" value={roleApplied} />
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Tỉ lệ dự phòng (%)
              <input
                type="number"
                name="reserve_pct"
                min={0}
                max={100}
                defaultValue={10}
                className="h-9 w-24 rounded-md border border-vam-line px-2 text-sm"
              />
            </label>
            <SubmitButton pendingText="Đang tính..." disabled={!canOperate}>
              Tính danh sách
            </SubmitButton>
            {!canOperate ? (
              <span className="text-xs text-slate-500">Cần quyền vận hành mùa này.</span>
            ) : null}
          </form>
        ) : null}

        {isDraft ? (
          <>
            <form
              action={applyAction}
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    `Áp dụng danh sách này?\n\n${run?.main_count} hồ sơ sẽ được mời phỏng vấn, ${run?.reserve_count} hồ sơ vào nhóm dự phòng.`
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="run_id" value={run.id} />
              <SubmitButton pendingText="Đang áp dụng..." disabled={!canOperate || !summary?.canApply}>
                Áp dụng danh sách
              </SubmitButton>
            </form>
            <form action={discardAction}>
              <input type="hidden" name="run_id" value={run.id} />
              <SubmitButton variant="outline" pendingText="Đang huỷ..." disabled={!canOperate}>
                Huỷ bản tính
              </SubmitButton>
            </form>
          </>
        ) : null}

        {items.length > 0 ? (
          <CsvExportButton
            rows={csvRows}
            filename={`vam-selection-${roleApplied}-${intakeBatchId}.csv`}
            label={`Xuất CSV (${items.length})`}
          />
        ) : null}

        <div className="w-full space-y-1">
          <Feedback state={createState} />
          <Feedback state={applyState} />
          <Feedback state={discardState} />
          {summary?.blockReason ? (
            <p className="text-sm text-amber-700">{summary.blockReason}</p>
          ) : null}
        </div>
      </div>

      {!run ? (
        <div className="rounded-lg border border-dashed border-vam-line px-4 py-8 text-center text-sm text-slate-500">
          Chưa có bản tính nào cho đợt này. Số suất hiện tại: <strong>{capacityTotal}</strong> mentee.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>
              Bản tính {isApplied ? "đã áp dụng" : isDraft ? "đang là nháp" : "đã huỷ"} · {run.capacity_total} suất ·{" "}
              dự phòng {run.reserve_pct}%
            </span>
            {(
              [
                ["all", "Tất cả"],
                ["main", "Chính thức"],
                ["reserve", "Dự phòng"],
                ["below", "Dưới ngưỡng"]
              ] as Array<["all" | "main" | "reserve" | "below", string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setGroupFilter(value)}
                className={`rounded-full px-3 py-1 font-medium ${
                  groupFilter === value
                    ? "bg-vam-green text-white"
                    : "border border-vam-line bg-white text-slate-600 hover:bg-vam-mint"
                }`}
              >
                {label} ({counts[value]})
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Ứng viên</th>
                  <th className="px-3 py-2 font-semibold">Điểm TB</th>
                  <th className="px-3 py-2 font-semibold">Lượt chấm</th>
                  <th className="px-3 py-2 font-semibold">Nhóm</th>
                  <th className="px-3 py-2 font-semibold">Trạng thái hồ sơ</th>
                  <th className="px-3 py-2 font-semibold">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                      Không có hồ sơ nào trong nhóm này.
                    </td>
                  </tr>
                ) : (
                  visible.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-b border-vam-line ${
                        item.selection_group === "main" && item.rank === run.main_count
                          ? "border-b-2 border-b-vam-green"
                          : ""
                      }`}
                    >
                      <td className="px-3 py-2 tabular-nums text-slate-500">{item.rank}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-vam-ink">{item.full_name ?? "(chưa có tên)"}</div>
                        <div className="text-xs text-slate-500">{item.email_primary ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{item.total_score ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{item.review_count}</td>
                      <td className="px-3 py-2">
                        <span className={groupBadge(item.selection_group)}>
                          {GROUP_LABEL[item.selection_group] ?? item.selection_group}
                        </span>
                        {item.promoted_at ? (
                          <div className="mt-1 text-xs text-vam-green">Đã đôn lên</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{item.application_status ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {item.tie_break_note ?? ""}
                        {isApplied && item.selection_group === "reserve" && !item.promoted_at && canOperate ? (
                          <div className="mt-1">
                            <PromoteButton
                              runId={run.id}
                              applicationId={item.application_id}
                              onDone={refresh}
                            />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
