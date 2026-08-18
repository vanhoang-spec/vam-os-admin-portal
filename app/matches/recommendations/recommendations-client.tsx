"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { CsvExportButton } from "@/app/operations/intelligence/export-buttons";
import {
  approveRecommendationAction,
  discardRecommendationRunAction,
  rejectRecommendationAction,
  runMatchRecommendationsAction
} from "@/app/actions/ai-matching";
import {
  initialAiMatchingActionState,
  type AiMatchingActionState
} from "@/lib/ai-matching-action-types";
import { DEFAULT_MENTEE_BATCH_SIZE, DEFAULT_SHORTLIST_SIZE, MAX_ROUNDS } from "@/lib/ai-matching-core";
import type { RecommendationRunRow, RecommendationView } from "@/lib/ai-matching";

/**
 * The proposal, and the two decisions an organiser can take on each row.
 *
 * Approving is one click per pair on purpose: the point of the screen is that a
 * person looks at each suggestion. There is no "approve everything" button.
 */

const STATUS_LABELS: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã bỏ qua",
  superseded: "Bị thay thế"
};

const RUN_STATUS_LABELS: Record<string, string> = {
  running: "Đang chạy",
  completed: "Đã xong",
  failed: "Thất bại",
  discarded: "Đã huỷ"
};

function statusBadge(status: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "approved") return `${base} bg-green-100 text-green-800`;
  if (status === "pending") return `${base} bg-amber-100 text-amber-800`;
  if (status === "rejected") return `${base} bg-red-100 text-red-700`;
  return `${base} bg-slate-100 text-slate-600`;
}

function Feedback({ state }: { state: AiMatchingActionState }) {
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

function DecisionButtons({
  recommendationId,
  onDone
}: {
  recommendationId: string;
  onDone: () => void;
}) {
  const [approveState, approveAction] = useFormState<AiMatchingActionState, FormData>(
    approveRecommendationAction,
    initialAiMatchingActionState
  );
  const [rejectState, rejectAction] = useFormState<AiMatchingActionState, FormData>(
    rejectRecommendationAction,
    initialAiMatchingActionState
  );

  const refreshedFor = useRef<string | null>(null);
  const successKey = [approveState.ok && approveState.message, rejectState.ok && rejectState.message]
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!successKey) return;
    if (refreshedFor.current === successKey) return;
    refreshedFor.current = successKey;
    onDone();
  }, [successKey, onDone]);

  const error = (!approveState.ok && approveState.message) || (!rejectState.ok && rejectState.message);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <form action={approveAction}>
          <input type="hidden" name="recommendation_id" value={recommendationId} />
          <SubmitButton className="h-7 px-2 text-xs" pendingText="Đang duyệt...">
            Duyệt & tạo cặp
          </SubmitButton>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="recommendation_id" value={recommendationId} />
          <SubmitButton variant="outline" className="h-7 px-2 text-xs" pendingText="Đang bỏ qua...">
            Bỏ qua
          </SubmitButton>
        </form>
      </div>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}

export function RecommendationsClient({
  seasonId,
  intakeBatchId,
  run,
  rows,
  canOperate,
  canRun
}: {
  seasonId: string;
  intakeBatchId: string | null;
  run: RecommendationRunRow | null;
  rows: RecommendationView[];
  canOperate: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  const [runState, runAction] = useFormState<AiMatchingActionState, FormData>(
    runMatchRecommendationsAction,
    initialAiMatchingActionState
  );
  const [discardState, discardAction] = useFormState<AiMatchingActionState, FormData>(
    discardRecommendationRunAction,
    initialAiMatchingActionState
  );

  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");

  const refreshedFor = useRef<string | null>(null);
  const successKey = [runState.ok && runState.message, discardState.ok && discardState.message]
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!successKey) return;
    if (refreshedFor.current === successKey) return;
    refreshedFor.current = successKey;
    refresh();
  }, [successKey, refresh]);

  const visible = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((row) => row.status === "pending")),
    [rows, statusFilter]
  );

  const csvRows = useMemo(
    () =>
      rows.map((row) => ({
        mentee: row.mentee_name ?? "",
        email_mentee: row.mentee_email ?? "",
        mentor: row.mentor_name ?? "",
        email_mentor: row.mentor_email ?? "",
        vong: row.round,
        diem: row.score ?? "",
        ly_do: row.rationale ?? "",
        trang_thai: STATUS_LABELS[row.status] ?? row.status
      })),
    [rows]
  );

  const isRunning = run?.status === "running";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <form action={runAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="season_id" value={seasonId} />
          {intakeBatchId ? <input type="hidden" name="intake_batch_id" value={intakeBatchId} /> : null}
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Số vòng
            <input
              type="number"
              name="rounds"
              min={1}
              max={MAX_ROUNDS}
              defaultValue={MAX_ROUNDS}
              className="h-9 w-20 rounded-md border border-vam-line px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Mentor gợi ý mỗi mentee
            <input
              type="number"
              name="shortlist_size"
              min={1}
              max={20}
              defaultValue={DEFAULT_SHORTLIST_SIZE}
              className="h-9 w-24 rounded-md border border-vam-line px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Mentee mỗi lượt hỏi
            <input
              type="number"
              name="batch_size"
              min={1}
              max={10}
              defaultValue={DEFAULT_MENTEE_BATCH_SIZE}
              className="h-9 w-24 rounded-md border border-vam-line px-2 text-sm"
            />
          </label>
          <SubmitButton pendingText="Đang chạy, có thể mất vài phút..." disabled={!canOperate || !canRun || isRunning}>
            Chạy đề xuất
          </SubmitButton>
        </form>

        {run && run.status !== "discarded" ? (
          <form
            action={discardAction}
            onSubmit={(event) => {
              if (!window.confirm("Huỷ danh sách đề xuất này? Các cặp chờ duyệt sẽ bị bỏ.")) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="run_id" value={run.id} />
            <SubmitButton variant="outline" pendingText="Đang huỷ..." disabled={!canOperate}>
              Huỷ danh sách
            </SubmitButton>
          </form>
        ) : null}

        {rows.length > 0 ? (
          <CsvExportButton
            rows={csvRows}
            filename={`vam-de-xuat-ghep-${seasonId}.csv`}
            label={`Xuất CSV (${rows.length})`}
          />
        ) : null}

        <div className="w-full space-y-1">
          {!canOperate ? (
            <p className="text-xs text-slate-500">Cần quyền vận hành mùa này để chạy và duyệt.</p>
          ) : null}
          <Feedback state={runState} />
          <Feedback state={discardState} />
        </div>
      </div>

      {!run ? (
        <div className="rounded-lg border border-dashed border-vam-line px-4 py-8 text-center text-sm text-slate-500">
          Chưa có lần chạy nào cho mùa này. Bấm <strong>Chạy đề xuất</strong> để hệ thống gợi ý các cặp
          còn lại — bạn vẫn phải duyệt từng cặp.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span>
              Lần chạy {RUN_STATUS_LABELS[run.status] ?? run.status} · {run.pair_count} đề xuất /{" "}
              {run.mentee_count} mentee · {run.mentor_count} mentor · {run.round_count} vòng
            </span>
            <span className="text-slate-400">
              {run.provider}/{run.model} · {run.prompt_version}
              {run.prompt_tokens !== null || run.completion_tokens !== null
                ? ` · ${(run.prompt_tokens ?? 0) + (run.completion_tokens ?? 0)} token`
                : ""}
            </span>
            <div className="ml-auto flex gap-2">
              {(
                [
                  ["pending", "Chờ duyệt"],
                  ["all", "Tất cả"]
                ] as Array<["pending" | "all", string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`rounded-full px-3 py-1 font-medium ${
                    statusFilter === value
                      ? "bg-vam-green text-white"
                      : "border border-vam-line bg-white text-slate-600 hover:bg-vam-mint"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {run.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {run.error}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
                <tr>
                  <th className="px-3 py-2 font-semibold">Mentee</th>
                  <th className="px-3 py-2 font-semibold">Mentor đề xuất</th>
                  <th className="px-3 py-2 font-semibold">Vòng</th>
                  <th className="px-3 py-2 font-semibold">Điểm</th>
                  <th className="px-3 py-2 font-semibold">Lý do</th>
                  <th className="px-3 py-2 font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                      Không có đề xuất nào trong nhóm này.
                    </td>
                  </tr>
                ) : (
                  visible.map((row) => (
                    <tr key={row.id} className="border-b border-vam-line align-top">
                      <td className="px-3 py-2">
                        <Link
                          href={`/applications/${row.mentee_application_id}`}
                          className="font-medium text-vam-ink hover:text-vam-green hover:underline"
                        >
                          {row.mentee_name ?? "(chưa có tên)"}
                        </Link>
                        <div className="text-xs text-slate-500">{row.mentee_email ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-vam-ink">{row.mentor_name ?? "(chưa có tên)"}</div>
                        <div className="text-xs text-slate-500">{row.mentor_email ?? "—"}</div>
                        {row.mentor_free_slots !== null ? (
                          <div
                            className={`text-xs ${
                              row.mentor_free_slots > 0 ? "text-slate-500" : "text-red-700"
                            }`}
                          >
                            Còn {row.mentor_free_slots} suất
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{row.round}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {row.score !== null ? row.score.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{row.rationale ?? ""}</td>
                      <td className="px-3 py-2">
                        <span className={statusBadge(row.status)}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {row.status === "pending" && canOperate ? (
                          <DecisionButtons recommendationId={row.id} onDone={refresh} />
                        ) : row.match_id ? (
                          <Link
                            href={`/matches/${row.match_id}`}
                            className="text-xs text-vam-green hover:underline"
                          >
                            Xem cặp ghép →
                          </Link>
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
