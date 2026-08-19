"use client";

import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  approveImportItemsAction,
  assignImportItemAction,
  skipImportItemsAction
} from "@/app/actions/recap-import";
import {
  initialRecapImportActionState,
  type RecapImportActionState
} from "@/lib/recap-import-action-types";
import type { ImportBatchRow, ImportItemRow, MenteeOption } from "@/lib/recap-import";

/**
 * Reviewing a collection run.
 *
 * Laid out by how much attention each row needs, not by when it was posted:
 * the ones the parser is confident about are a single checkbox list with one
 * approve button, and the ones it could not resolve each get their own small
 * decision. That way an organiser spends their time only on the hard cases.
 */

const MEETING_TYPE_LABELS: Record<string, string> = {
  "1on1_primary": "1-1 chính",
  "1on1_cross": "Cross mentoring",
  group: "Nhóm",
  online: "Online",
  offline: "Offline",
  unknown: "Chưa rõ"
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Chờ xử lý",
  matched: "Khớp tự động",
  needs_review: "Cần người quyết",
  imported: "Đã tạo recap",
  skipped: "Đã bỏ qua",
  duplicate: "Trùng"
};

function statusBadge(status: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "imported") return `${base} bg-green-100 text-green-800`;
  if (status === "matched") return `${base} bg-emerald-50 text-emerald-700`;
  if (status === "needs_review") return `${base} bg-amber-100 text-amber-800`;
  if (status === "skipped" || status === "duplicate") return `${base} bg-slate-100 text-slate-600`;
  return `${base} bg-slate-100 text-slate-700`;
}

function Feedback({ state }: { state: RecapImportActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

function batchLabel(batch: ImportBatchRow) {
  const period =
    batch.period_start && batch.period_end
      ? `${batch.period_start} → ${batch.period_end}`
      : "không ghi kỳ";
  const day = batch.created_at?.slice(0, 10) ?? "";
  return `${day} · ${batch.item_count} bài · ${period}`;
}

/** The first lines of a post, which is what tells a reviewer what they are looking at. */
function preview(content: string | null) {
  if (!content) return "(không đọc được nội dung)";
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 3).join(" · ").slice(0, 220);
}

function ItemSummary({ item }: { item: ImportItemRow }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-900">{item.author_name ?? "(không rõ người đăng)"}</span>
        {item.mssv_raw ? <span className="text-slate-500">{item.mssv_raw}</span> : null}
        <span className={statusBadge(item.status)}>{STATUS_LABELS[item.status] ?? item.status}</span>
        {item.content_truncated ? (
          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Nghi bị cắt ngắn
          </span>
        ) : null}
      </div>
      <div className="text-xs text-slate-500">
        {item.meeting_date ?? "chưa rõ ngày"} ·{" "}
        {MEETING_TYPE_LABELS[item.meeting_type ?? "unknown"] ?? item.meeting_type} ·{" "}
        {item.mentee_name ? `mentee: ${item.mentee_name}` : "chưa xác định mentee"}
        {item.mentor_name ? ` · mentor: ${item.mentor_name}` : ""}
      </div>
      {item.topic ? <div className="text-xs text-slate-600">{item.topic}</div> : null}
      <p className="text-xs text-slate-500">{preview(item.content_full)}</p>
      <a
        className="text-xs text-emerald-700 underline"
        href={item.permalink}
        target="_blank"
        rel="noreferrer noopener"
      >
        Mở bài gốc trên Facebook
      </a>
    </div>
  );
}

export function RecapImportClient({
  batches,
  selectedBatchId,
  items,
  menteeOptions,
  allowDecide
}: {
  batches: ImportBatchRow[];
  selectedBatchId: string | null;
  items: ImportItemRow[];
  menteeOptions: MenteeOption[];
  allowDecide: boolean;
}) {
  const router = useRouter();

  const [approveState, approveAction] = useFormState(
    approveImportItemsAction,
    initialRecapImportActionState
  );
  const [skipState, skipAction] = useFormState(skipImportItemsAction, initialRecapImportActionState);
  const [assignState, assignAction] = useFormState(
    assignImportItemAction,
    initialRecapImportActionState
  );

  const matched = useMemo(() => items.filter((item) => item.status === "matched"), [items]);
  const needsReview = useMemo(() => items.filter((item) => item.status === "needs_review"), [items]);
  const settled = useMemo(
    () => items.filter((item) => !["matched", "needs_review"].includes(item.status)),
    [items]
  );

  // Everything the parser was confident about starts ticked: the common action
  // is "yes, all of these", and unticking the odd one out is less work.
  const [selected, setSelected] = useState<string[]>(() => matched.map((item) => item.id));

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );

  return (
    <div className="grid gap-6">
      <Card>
        <div className="grid gap-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="batch">
            Lượt thu
          </label>
          <select
            id="batch"
            className="h-11 rounded-md border border-vam-line px-3 text-sm"
            value={selectedBatchId ?? ""}
            onChange={(event) =>
              router.push(`/operations/recap-import?batch_id=${event.target.value}`)
            }
          >
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batchLabel(batch)}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">
          Khớp tự động ({matched.length})
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Hệ thống đã tìm ra mentee theo MSSV trong bài. Bỏ tick những bài không muốn ghi, rồi bấm
          duyệt — mỗi bài được duyệt sẽ thành một recap kèm đường dẫn bài gốc.
        </p>

        {matched.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Không có bài nào trong nhóm này.</p>
        ) : (
          <form action={approveAction} className="mt-4 grid gap-4">
            <div className="grid gap-3">
              {matched.map((item) => (
                <label
                  key={item.id}
                  className="flex gap-3 rounded-md border border-vam-line p-3 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="item_ids"
                    value={item.id}
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 h-4 w-4"
                  />
                  <ItemSummary item={item} />
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton disabled={!allowDecide || selected.length === 0} pendingText="Đang tạo recap...">
                Duyệt {selected.length} bài thành recap
              </SubmitButton>
              <Feedback state={approveState} />
            </div>
          </form>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">
          Cần người quyết ({needsReview.length})
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Bài không ghi MSSV, ghi sai, hoặc mentee chưa có cặp ghép đang hoạt động. Chọn đúng mentee
          rồi lưu; bài sẽ chuyển sang nhóm trên để duyệt.
        </p>

        {needsReview.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Không còn bài nào chờ quyết định.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {needsReview.map((item) => (
              <div key={item.id} className="rounded-md border border-vam-line p-3">
                <ItemSummary item={item} />

                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <form action={assignAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="item_id" value={item.id} />
                    <div className="grid gap-1">
                      <label
                        className="text-xs font-medium text-slate-600"
                        htmlFor={`mentee-${item.id}`}
                      >
                        Mentee
                      </label>
                      <select
                        id={`mentee-${item.id}`}
                        name="mentee_person_id"
                        defaultValue={item.mentee_person_id ?? ""}
                        className="h-10 min-w-[16rem] rounded-md border border-vam-line px-2 text-sm"
                      >
                        <option value="">— chọn mentee —</option>
                        {menteeOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <SubmitButton variant="outline" disabled={!allowDecide} pendingText="Đang lưu...">
                      Gán mentee
                    </SubmitButton>
                  </form>

                  <form action={skipAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="item_ids" value={item.id} />
                    <div className="grid gap-1">
                      <label className="text-xs font-medium text-slate-600" htmlFor={`reason-${item.id}`}>
                        Lý do bỏ qua
                      </label>
                      <input
                        id={`reason-${item.id}`}
                        name="reason"
                        placeholder="Ví dụ: không phải bài recap"
                        className="h-10 min-w-[14rem] rounded-md border border-vam-line px-2 text-sm"
                      />
                    </div>
                    <SubmitButton variant="secondary" disabled={!allowDecide} pendingText="Đang lưu...">
                      Bỏ qua
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}

            <div className="grid gap-1">
              <Feedback state={assignState} />
              <Feedback state={skipState} />
            </div>
          </div>
        )}
      </Card>

      {settled.length > 0 ? (
        <Card>
          <h2 className="text-base font-semibold text-slate-900">Đã xử lý ({settled.length})</h2>
          <div className="mt-3 grid gap-3">
            {settled.map((item) => (
              <div key={item.id} className="rounded-md border border-vam-line p-3">
                <ItemSummary item={item} />
                {item.review_note ? (
                  <p className="mt-1 text-xs text-slate-500">Ghi chú: {item.review_note}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
