"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { createRenewalInviteBatchAction } from "@/app/actions/renewals";
import { SubmitButton } from "@/components/submit-button";
import { matchesMentorQuery } from "@/lib/renewal-search";
import {
  RENEWAL_BATCH_MAX_SIZE,
  RENEWAL_BATCH_OUTCOME_LABEL,
  initialRenewalBatchState,
  type RenewalBatchRow
} from "@/lib/renewal-types";
import type { RenewalMentorOption } from "@/lib/renewal-console";

/**
 * How many matching mentors are rendered at once.
 *
 * The console loads roughly 500 mentors. Painting 500 rows — each with a
 * checkbox, so each a tab stop — is both slow and hostile to keyboard users.
 * The list renders the first slice of matches and tells the operator how many
 * more exist, which turns "scroll for a while" into "type two more letters".
 * Selected mentors are always shown separately, so narrowing the query can
 * never hide what is already selected.
 */
const VISIBLE_LIMIT = 50;

const STATUS_BADGE: Record<RenewalMentorOption["status"], { label: string; className: string } | null> = {
  eligible: null,
  has_live_invite: { label: "Đã có link", className: "border-amber-300 bg-amber-50 text-amber-800" },
  renewal_accepted: { label: "Đã gia hạn", className: "border-green-300 bg-green-50 text-green-800" }
};

const OUTCOME_CLASS: Record<RenewalBatchRow["outcome"], string> = {
  created: "text-green-800",
  skipped_live_invite: "text-amber-800",
  not_eligible: "text-slate-600",
  failed: "text-red-700"
};

/** RFC 4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function CopyButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Sao chép đường link gia hạn:", url);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Sao chép link gia hạn của ${label}`}
      className="rounded-md border border-vam-line bg-white px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-slate-50"
    >
      {copied ? "Đã sao chép" : "Sao chép"}
    </button>
  );
}

export function BatchRenewalInviteForm({
  mentors,
  programId,
  seasonId
}: {
  mentors: RenewalMentorOption[];
  programId: string;
  seasonId: string;
}) {
  const [state, action] = useFormState(createRenewalInviteBatchAction, initialRenewalBatchState);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const lastResultsRef = useRef<RenewalBatchRow[] | null>(null);

  const selectableCount = useMemo(() => mentors.filter((m) => m.selectable).length, [mentors]);

  const matches = useMemo(() => mentors.filter((mentor) => matchesMentorQuery(mentor, query)), [mentors, query]);
  const visible = matches.slice(0, VISIBLE_LIMIT);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const byId = useMemo(() => new Map(mentors.map((m) => [m.personId, m])), [mentors]);

  // Once a batch reports success, drop the mentors that received a link from
  // the selection. Leaving them selected invites a second submit that the
  // database would refuse anyway, and the operator would have to work out which
  // rows were already done.
  useEffect(() => {
    if (state.results === lastResultsRef.current) return;
    lastResultsRef.current = state.results;
    const created = state.results.filter((row) => row.outcome === "created").map((row) => row.personId);
    if (created.length) setSelected((prev) => prev.filter((id) => !created.includes(id)));
  }, [state.results]);

  function toggle(personId: string) {
    setSelected((prev) => {
      if (prev.includes(personId)) return prev.filter((id) => id !== personId);
      // Selecting is guarded HERE, not only by the checkbox's `disabled`
      // attribute. A disabled input is a rendering detail: it stops a mouse in a
      // real browser, but it is not a rule, and anything that reaches this
      // function by another route (a stray synthetic event, a future keyboard
      // shortcut) must obey the same eligibility. The batch ceiling is enforced
      // in the same place for the same reason. The server re-derives both
      // independently and remains the actual authority.
      const mentor = byId.get(personId);
      if (!mentor?.selectable) return prev;
      if (prev.length >= RENEWAL_BATCH_MAX_SIZE) return prev;
      return [...prev, personId];
    });
  }

  const remainingSlots = RENEWAL_BATCH_MAX_SIZE - selected.length;
  const selectableMatches = matches.filter((m) => m.selectable && !selectedSet.has(m.personId));
  const canSelectAllFiltered = selectableMatches.length > 0 && remainingSlots > 0;

  function selectAllFiltered() {
    // Deliberately "all CURRENTLY FILTERED and selectable", never "all mentors
    // in the database", and never more than the batch ceiling.
    setSelected((prev) => [...prev, ...selectableMatches.slice(0, remainingSlots).map((m) => m.personId)]);
  }

  function downloadCsv() {
    // Built entirely from the result the browser is already holding. Nothing is
    // requested from the server, nothing is written to a table, and no file
    // exists anywhere until the operator saves it.
    const origin = window.location.origin;
    const header = ["mentor_name", "mentor_code", "email", "renewal_url", "expires_at", "result"];
    const lines = [header.join(",")];
    for (const row of state.results) {
      lines.push(
        [
          csvCell(row.fullName),
          csvCell(row.mentorCode),
          csvCell(row.email),
          csvCell(row.renewalPath ? `${origin}${row.renewalPath}` : ""),
          csvCell(row.expiresAt),
          csvCell(RENEWAL_BATCH_OUTCOME_LABEL[row.outcome])
        ].join(",")
      );
    }
    // BOM so Excel opens Vietnamese names in UTF-8 rather than mojibake.
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `renewal-links-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="grid gap-4 rounded-lg border border-vam-line bg-white p-5 shadow-soft">
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">Tạo link gia hạn hàng loạt</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tìm mentor theo tên, mã mentor hoặc email. Chọn nhiều mentor rồi tạo link một lượt — tối đa{" "}
          {RENEWAL_BATCH_MAX_SIZE} mentor mỗi lần. Link vẫn được gửi thủ công.
        </p>
      </div>

      <label className="text-sm font-medium text-vam-ink">
        Tìm mentor
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ví dụ: Validation, VM-002, mentor02@"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
        />
      </label>

      <p aria-live="polite" className="text-sm text-slate-600">
        {matches.length === 0
          ? "Không tìm thấy mentor phù hợp."
          : `${matches.length} mentor phù hợp${matches.length > VISIBLE_LIMIT ? ` — đang hiển thị ${VISIBLE_LIMIT} kết quả đầu, hãy nhập thêm để thu hẹp` : ""}.`}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-vam-ink">Đã chọn {selected.length} mentor</span>
        {canSelectAllFiltered ? (
          <button
            type="button"
            onClick={selectAllFiltered}
            className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-xs font-medium text-vam-green hover:bg-slate-50"
          >
            Chọn tất cả kết quả đang lọc ({Math.min(selectableMatches.length, remainingSlots)})
          </button>
        ) : null}
        {selected.length ? (
          <button
            type="button"
            onClick={() => setSelected([])}
            className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Bỏ chọn tất cả
          </button>
        ) : null}
        {remainingSlots <= 0 ? (
          <span className="text-xs font-medium text-amber-800">Đã đạt giới hạn {RENEWAL_BATCH_MAX_SIZE} mentor.</span>
        ) : null}
      </div>

      {selected.length ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-vam-line bg-slate-50 p-3">
          {selected.map((personId) => {
            const mentor = byId.get(personId);
            return (
              <span
                key={personId}
                className="inline-flex items-center gap-2 rounded-full border border-vam-line bg-white px-3 py-1 text-xs"
              >
                {mentor?.fullName ?? personId}
                {mentor?.mentorCode ? <span className="text-slate-500">{mentor.mentorCode}</span> : null}
                <button
                  type="button"
                  onClick={() => toggle(personId)}
                  aria-label={`Bỏ chọn ${mentor?.fullName ?? personId}`}
                  className="text-slate-500 hover:text-red-700"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <fieldset className="grid gap-1 rounded-md border border-vam-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase text-slate-500">Kết quả tìm kiếm</legend>
        {visible.map((mentor) => {
          const badge = STATUS_BADGE[mentor.status];
          const checked = selectedSet.has(mentor.personId);
          const blockedByLimit = !checked && remainingSlots <= 0;
          const disabled = !mentor.selectable || blockedByLimit;
          return (
            <label
              key={mentor.personId}
              className={`flex items-start gap-3 rounded-md px-2 py-2 text-sm ${disabled ? "opacity-60" : "hover:bg-slate-50"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(mentor.personId)}
                className="mt-1 h-4 w-4"
              />
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-vam-ink">{mentor.fullName}</span>
                  {mentor.mentorCode ? <span className="text-xs text-slate-500">{mentor.mentorCode}</span> : null}
                  {badge ? (
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-slate-500">{mentor.email ?? "—"}</span>
              </span>
            </label>
          );
        })}
        {!visible.length ? <p className="px-2 py-2 text-sm text-slate-500">Không có kết quả.</p> : null}
      </fieldset>

      <form action={action} className="grid gap-3 sm:grid-cols-[150px_auto] sm:items-end">
        <input type="hidden" name="program_id" value={programId} />
        <input type="hidden" name="season_id" value={seasonId} />
        <input type="hidden" name="person_ids" value={JSON.stringify(selected)} />
        <label className="text-sm font-medium text-vam-ink">
          Hiệu lực (ngày)
          <input
            name="expires_days"
            type="number"
            min="1"
            max="60"
            step="1"
            defaultValue="14"
            className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
          />
        </label>
        <SubmitButton disabled={!selected.length} pendingText="Đang tạo link...">
          {selected.length ? `Tạo link cho ${selected.length} mentor` : "Tạo link hàng loạt"}
        </SubmitButton>
      </form>

      {!selectableCount ? (
        <p className="text-sm text-slate-500">Không có mentor đủ điều kiện chưa có link live/renewal accepted.</p>
      ) : null}

      {state.message ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      {state.results.length ? (
        <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-amber-800">Link chỉ hiển thị một lần</p>
              <p className="mt-1 text-sm text-amber-900">
                Tải lại trang sẽ mất toàn bộ link thô — hệ thống không lưu và không thể tạo lại chúng từ cơ sở dữ liệu.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Tải CSV
            </button>
          </div>
          <div className="overflow-x-auto rounded-md border border-amber-200 bg-white">
            <table className="min-w-full divide-y divide-vam-line text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mentor</th>
                  <th className="px-3 py-2">Mã</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Hết hạn</th>
                  <th className="px-3 py-2">Link</th>
                  <th className="px-3 py-2">Kết quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {state.results.map((row) => (
                  <tr key={row.personId}>
                    <td className="px-3 py-2 font-medium text-vam-ink">{row.fullName}</td>
                    <td className="px-3 py-2 text-slate-600">{row.mentorCode ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{row.email ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString("vi-VN") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.renewalPath ? (
                        <div className="flex items-center gap-2">
                          <code className="break-all font-mono text-xs text-slate-700">{row.renewalPath}</code>
                          <CopyButton
                            url={`${typeof window === "undefined" ? "" : window.location.origin}${row.renewalPath}`}
                            label={row.fullName}
                          />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`px-3 py-2 font-medium ${OUTCOME_CLASS[row.outcome]}`}>
                      {RENEWAL_BATCH_OUTCOME_LABEL[row.outcome]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
