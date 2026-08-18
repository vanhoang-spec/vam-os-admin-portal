"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { CsvExportButton } from "@/app/operations/intelligence/export-buttons";
import {
  generateConfirmationLinksAction,
  grantExtraSlotsAction,
  recordMentorConfirmationAction,
  reissueConfirmationLinkAction,
  sendConfirmationLinksAction
} from "@/app/actions/mentor-confirmations";
import {
  initialMentorConfirmationActionState,
  initialMentorConfirmationBatchActionState,
  type MentorConfirmationActionState,
  type MentorConfirmationBatchActionState
} from "@/lib/mentor-confirmation-action-types";
import type { MentorConfirmationListRow } from "@/lib/mentor-confirmations";

/**
 * The operator surface for mentor season confirmations.
 *
 * Deliberately a hand-rolled table rather than FilterableTable: every row needs
 * its own form (record by phone, grant a slot, re-issue the link), which the
 * shared declarative table cannot express.
 */

type StatusFilter = "all" | "pending" | "confirmed" | "declined" | "attention";

const STATUS_LABEL: Record<string, string> = {
  pending: "Chưa phản hồi",
  confirmed: "Tiếp tục",
  declined: "Không tiếp tục"
};

const SOURCE_LABEL: Record<string, string> = {
  form: "Mentor tự điền",
  manual: "Ghi tay",
  phone: "Gọi điện",
  application: "Từ đơn đăng ký"
};

function statusBadge(status: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "confirmed") return `${base} bg-green-100 text-green-800`;
  if (status === "declined") return `${base} bg-slate-100 text-slate-600`;
  return `${base} bg-amber-100 text-amber-800`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN");
}

/** A mentor holding more matches than their confirmed capacity allows. */
function isOverCap(row: MentorConfirmationListRow) {
  return row.active_match_count > row.effective_cap;
}

function InlineMessage({ state }: { state: MentorConfirmationActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`mt-1 text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-md border border-vam-line px-2 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
    >
      {copied ? "Đã sao chép" : "Sao chép link"}
    </button>
  );
}

function RecordRow({
  row,
  canOperate,
  onDone
}: {
  row: MentorConfirmationListRow;
  canOperate: boolean;
  onDone: () => void;
}) {
  const [state, formAction] = useFormState<MentorConfirmationActionState, FormData>(
    recordMentorConfirmationAction,
    initialMentorConfirmationActionState
  );
  const [slotState, slotAction] = useFormState<MentorConfirmationActionState, FormData>(
    grantExtraSlotsAction,
    initialMentorConfirmationActionState
  );
  const [linkState, linkAction] = useFormState<MentorConfirmationActionState, FormData>(
    reissueConfirmationLinkAction,
    initialMentorConfirmationActionState
  );
  const [decision, setDecision] = useState<string>(
    row.status === "confirmed" || row.status === "declined" ? row.status : ""
  );

  // Refresh the server component once per successful write so the row shows the
  // stored values. The ref guard is what stops refresh → re-render → refresh:
  // the action state stays `ok` after the refresh, so without it this would loop.
  const refreshedFor = useRef<string | null>(null);
  const successKey = [state.ok && state.message, slotState.ok && slotState.message, linkState.ok && linkState.message]
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!successKey) return;
    if (refreshedFor.current === successKey) return;
    refreshedFor.current = successKey;
    onDone();
  }, [successKey, onDone]);

  return (
    <tr className="border-b border-vam-line align-top">
      <td className="px-3 py-3">
        <div className="font-medium text-vam-ink">{row.full_name ?? "(chưa có tên)"}</div>
        <div className="text-xs text-slate-500">{row.email_primary ?? "chưa có email"}</div>
        {row.mentor_code ? <div className="text-xs text-slate-400">{row.mentor_code}</div> : null}
      </td>

      <td className="px-3 py-3">
        <span className={statusBadge(row.status)}>{STATUS_LABEL[row.status] ?? row.status}</span>
        <div className="mt-1 text-xs text-slate-500">
          {row.response_source ? SOURCE_LABEL[row.response_source] ?? row.response_source : "—"}
        </div>
        <div className="text-xs text-slate-400">{formatDate(row.responded_at)}</div>
      </td>

      <td className="px-3 py-3">
        <div className={isOverCap(row) ? "font-medium text-red-700" : "text-vam-ink"}>
          {row.active_match_count}/{row.effective_cap}
        </div>
        {isOverCap(row) ? (
          <div className="text-xs text-red-700">Vượt hạn mức</div>
        ) : row.extra_slots > 0 ? (
          <div className="text-xs text-slate-500">+{row.extra_slots} slot bổ sung</div>
        ) : null}
        {row.status === "confirmed" ? (
          <div className="mt-1 text-xs text-slate-500">
            {row.agree_to_review ? "Chấm hồ sơ · " : ""}
            {row.agree_to_interview ? "Phỏng vấn" : ""}
          </div>
        ) : null}
      </td>

      <td className="px-3 py-3">
        <div className="text-xs text-slate-500">
          {row.link_sent_at ? `Đã gửi ${formatDate(row.link_sent_at)}` : "Chưa gửi email"}
        </div>
        {row.link_send_error ? (
          <div className="text-xs text-red-700">{row.link_send_error}</div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {row.confirm_url ? <CopyLinkButton url={row.confirm_url} /> : null}
          {canOperate ? (
            <form action={linkAction}>
              <input type="hidden" name="confirmation_id" value={row.id} />
              <input type="hidden" name="mode" value="extend" />
              <SubmitButton
                variant="outline"
                className="h-7 px-2 text-xs"
                pendingText="Đang gia hạn..."
              >
                Gia hạn
              </SubmitButton>
            </form>
          ) : null}
        </div>
        <InlineMessage state={linkState} />
      </td>

      <td className="px-3 py-3">
        {canOperate ? (
          <form action={formAction} className="grid gap-2">
            <input type="hidden" name="confirmation_id" value={row.id} />
            <input type="hidden" name="expected_status" value={row.status} />
            <input type="hidden" name="source" value="phone" />

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="decision"
                  value="confirmed"
                  required
                  checked={decision === "confirmed"}
                  onChange={() => setDecision("confirmed")}
                  className="h-3.5 w-3.5"
                />
                Tiếp tục
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="decision"
                  value="declined"
                  checked={decision === "declined"}
                  onChange={() => setDecision("declined")}
                  className="h-3.5 w-3.5"
                />
                Không
              </label>

              {decision === "confirmed" ? (
                <select
                  name="max_mentees"
                  defaultValue={row.max_mentees ? String(row.max_mentees) : "1"}
                  className="h-7 rounded border border-vam-line px-1 text-xs"
                  aria-label="Số mentee tối đa"
                >
                  <option value="1">1 mentee</option>
                  <option value="2">2 mentee</option>
                  <option value="3">3 mentee</option>
                </select>
              ) : null}
            </div>

            {decision === "confirmed" ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="agree_to_review"
                    defaultChecked={row.agree_to_review === true}
                    className="h-3.5 w-3.5"
                  />
                  Chấm hồ sơ
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="agree_to_interview"
                    defaultChecked={row.agree_to_interview === true}
                    className="h-3.5 w-3.5"
                  />
                  Phỏng vấn
                </label>
              </div>
            ) : null}

            <input
              type="text"
              name="note"
              maxLength={1000}
              defaultValue={row.note ?? ""}
              placeholder="Ghi chú cuộc gọi"
              className="h-7 rounded border border-vam-line px-2 text-xs"
            />

            <div className="flex items-center gap-2">
              <SubmitButton className="h-7 px-2 text-xs" pendingText="Đang lưu...">
                Ghi nhận
              </SubmitButton>
            </div>
            <InlineMessage state={state} />
          </form>
        ) : (
          <span className="text-xs text-slate-400">Chỉ đọc</span>
        )}

        {canOperate && row.status === "confirmed" ? (
          <form action={slotAction} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="confirmation_id" value={row.id} />
            <label className="text-xs text-slate-500">
              Slot bổ sung
              <select
                name="extra_slots"
                defaultValue={String(row.extra_slots)}
                className="ml-1 h-7 rounded border border-vam-line px-1 text-xs"
              >
                <option value="0">0</option>
                <option value="1">+1</option>
                <option value="2">+2</option>
                <option value="3">+3</option>
              </select>
            </label>
            <SubmitButton variant="outline" className="h-7 px-2 text-xs" pendingText="Đang lưu...">
              Cập nhật
            </SubmitButton>
            <InlineMessage state={slotState} />
          </form>
        ) : null}
      </td>
    </tr>
  );
}

export function SeasonConfirmationsClient({
  rows,
  seasonCode,
  sourceSeasonCode,
  baseUrl,
  canOperate
}: {
  rows: MentorConfirmationListRow[];
  seasonCode: string;
  sourceSeasonCode: string;
  baseUrl: string;
  canOperate: boolean;
}) {
  const router = useRouter();
  const refreshRoster = useCallback(() => router.refresh(), [router]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const [generateState, generateAction] = useFormState<MentorConfirmationBatchActionState, FormData>(
    generateConfirmationLinksAction,
    initialMentorConfirmationBatchActionState
  );
  const [sendState, sendAction] = useFormState<MentorConfirmationBatchActionState, FormData>(
    sendConfirmationLinksAction,
    initialMentorConfirmationBatchActionState
  );

  const counts = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((row) => row.status === "pending").length,
      confirmed: rows.filter((row) => row.status === "confirmed").length,
      declined: rows.filter((row) => row.status === "declined").length,
      attention: rows.filter((row) => isOverCap(row) || (row.status === "declined" && row.active_match_count > 0))
        .length
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "attention") {
        if (!isOverCap(row) && !(row.status === "declined" && row.active_match_count > 0)) return false;
      } else if (filter !== "all" && row.status !== filter) {
        return false;
      }
      if (!needle) return true;
      return [row.full_name, row.email_primary, row.mentor_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, search, filter]);

  /** Mail-merge export: name, email and the personal link, nothing else. */
  const csvRows = useMemo(
    () =>
      rows
        .filter((row) => row.status === "pending")
        .map((row) => ({
          ho_ten: row.full_name ?? "",
          email: row.email_primary ?? "",
          ma_mentor: row.mentor_code ?? "",
          link_xac_nhan: row.confirm_url ?? "",
          da_gui_email: row.link_sent_at ? "roi" : "chua"
        })),
    [rows]
  );

  return (
    <div className="grid gap-4">
      {canOperate ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-vam-line bg-white p-4 shadow-soft">
          <form action={generateAction} className="flex items-end gap-2">
            <input type="hidden" name="season" value={seasonCode} />
            <input type="hidden" name="source_season" value={sourceSeasonCode} />
            <SubmitButton variant="outline" pendingText="Đang tạo...">
              Tạo link cho mentor còn thiếu
            </SubmitButton>
          </form>

          <form action={sendAction} className="flex items-end gap-2">
            <input type="hidden" name="season" value={seasonCode} />
            <input type="hidden" name="base_url" value={baseUrl} />
            <label className="text-xs text-slate-500">
              Số email mỗi đợt
              <input
                type="number"
                name="limit"
                min={1}
                max={50}
                defaultValue={50}
                className="ml-1 h-9 w-20 rounded border border-vam-line px-2 text-sm"
              />
            </label>
            <SubmitButton pendingText="Đang gửi...">Gửi email đợt tiếp theo</SubmitButton>
          </form>

          <CsvExportButton
            rows={csvRows}
            filename={`vam-mentor-confirmations-${seasonCode}.csv`}
            label={`Xuất CSV mail-merge (${csvRows.length})`}
          />

          <div className="w-full text-xs">
            {generateState.message ? (
              <p role="status" className={generateState.ok ? "text-green-700" : "text-red-700"}>
                {generateState.message}
              </p>
            ) : null}
            {sendState.message ? (
              <p role="status" className={sendState.ok ? "text-green-700" : "text-red-700"}>
                {sendState.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên, email hoặc mã mentor"
          className="h-10 w-full max-w-sm rounded-md border border-vam-line px-3 text-sm outline-none focus:border-vam-green"
        />
        {(
          [
            ["all", "Tất cả"],
            ["pending", "Chưa phản hồi"],
            ["confirmed", "Tiếp tục"],
            ["declined", "Không tiếp tục"],
            ["attention", "Cần xử lý"]
          ] as Array<[StatusFilter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === value
                ? "bg-vam-green text-white"
                : "border border-vam-line bg-white text-slate-600 hover:bg-vam-mint"
            }`}
          >
            {label} ({counts[value]})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
            <tr>
              <th className="px-3 py-2 font-semibold">Mentor</th>
              <th className="px-3 py-2 font-semibold">Trạng thái</th>
              <th className="px-3 py-2 font-semibold">Mentee hiện tại / tối đa</th>
              <th className="px-3 py-2 font-semibold">Link cá nhân</th>
              <th className="px-3 py-2 font-semibold">Ghi nhận qua điện thoại</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  Chưa có mentor nào khớp bộ lọc. Nếu danh sách trống hoàn toàn, hãy bấm “Tạo link cho
                  mentor còn thiếu”.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <RecordRow
                  key={row.id}
                  row={row}
                  canOperate={canOperate}
                  onDone={refreshRoster}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
