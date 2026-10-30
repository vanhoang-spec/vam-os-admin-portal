"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { confirmMenteeGroupsAction, confirmMentorGroupsAction, confirmRound2GroupsAction } from "@/app/actions/matching-round2";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";
import { MAX_BULK_APPROVALS, type GroupApproval } from "@/lib/matching-round2-bulk-core";
import { industryGroupLabel } from "@/lib/matching-round2-groups-core";

/** needsReview chỉ để HIỆN trong hộp xác nhận (người còn cờ "Cần BTC xem"); không đi lên máy chủ. */
type Item = GroupApproval & { name: string; needsReview?: boolean; role?: "mentor" | "mentee" };
/** "all": đang xem cả hai vai trò, duyệt chung một lượt (VAM00005) — mỗi dòng phải mang role của mình. */
export type BulkRole = "mentor" | "mentee" | "all";
const Selection = createContext<{ selected: Item[]; toggle: (item: Item) => void } | null>(null);

export function ReviewCheckbox({ item }: { item: Item }) {
  const context = useContext(Selection);
  if (!context) return null;
  return <input type="checkbox" data-round2-approve={item.assignmentId}
    aria-label={`Duyệt nhóm của ${item.name}`}
    checked={context.selected.some((r) => r.assignmentId === item.assignmentId)}
    onChange={() => context.toggle(item)} className="h-4 w-4 accent-vam-green" />;
}

/** Hai vai trò dùng chung một ô tick: nhãn nói tên người, không nói vai trò. */
export const MentorReviewCheckbox = ReviewCheckbox;
export const MenteeReviewCheckbox = ReviewCheckbox;

function ConfirmationButtons({ cancel }: { cancel: () => void }) {
  const { pending } = useFormStatus();
  return <div className="mt-4 flex gap-3">
    <button type="button" disabled={pending} onClick={cancel} className="rounded-md border px-4 py-2">Quay lại</button>
    <button type="submit" disabled={pending} className="rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-60">
      {pending ? "Đang duyệt…" : "Xác nhận duyệt"}
    </button>
  </div>;
}

export function BulkGroupReview({ items, children, enabled = true, role = "mentor", note }: { items: Item[]; children: React.ReactNode; enabled?: boolean; role?: BulkRole; note?: string }) {
  const noun = role === "all" ? "mentor/mentee" : role === "mentee" ? "mentee" : "mentor";
  const Noun = role === "all" ? "Mentor/Mentee" : role === "mentee" ? "Mentee" : "Mentor";
  const [selected, setSelected] = useState<Item[]>([]);
  const [confirmation, setConfirmation] = useState<Item[] | null>(null);
  const [state, action] = useFormState(role === "all" ? confirmRound2GroupsAction : role === "mentee" ? confirmMenteeGroupsAction : confirmMentorGroupsAction, ROUND2_IDLE);
  const root = useRef<HTMLDivElement>(null);
  const all = useRef<HTMLInputElement>(null);
  const dialogForm = useRef<HTMLFormElement>(null);
  const [visibleIds, setVisibleIds] = useState<string[]>(items.map((i) => i.assignmentId));
  const visible = items.filter((item) => visibleIds.includes(item.assignmentId));
  const chosen = selected.filter((item) => visibleIds.includes(item.assignmentId));
  // Một lượt chỉ nhận tối đa MAX_BULK_APPROVALS người: nhiều hơn thì "chọn tất cả" lấy phần đầu danh sách,
  // phần còn lại vẫn nằm trên bảng để duyệt ở lượt sau (không để người dùng bấm xong mới gặp lỗi).
  const batch = visible.slice(0, MAX_BULK_APPROVALS);
  const overCap = visible.length > batch.length;
  const allSelected = batch.length > 0 && chosen.length === batch.length;

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const sync = () => {
      const ids = Array.from(container.querySelectorAll<HTMLInputElement>('tbody tr:not([data-search-hidden]) input[data-round2-approve]'))
        .map((input) => input.dataset.round2Approve!);
      setVisibleIds((old) => old.join() === ids.join() ? old : ids);
      setSelected((old) => old.every((item) => ids.includes(item.assignmentId)) ? old : old.filter((item) => ids.includes(item.assignmentId)));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-search-hidden"] });
    return () => observer.disconnect();
  }, [items]);
  useEffect(() => { if (all.current) all.current.indeterminate = chosen.length > 0 && !allSelected; }, [chosen.length, allSelected]);
  useEffect(() => {
    if (state.status === "ok") { setSelected([]); setConfirmation(null); }
  }, [state]);
  useEffect(() => {
    if (!confirmation) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogForm.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [confirmation]);

  return <Selection.Provider value={{ selected, toggle: (item) => setSelected((old) => old.some((r) => r.assignmentId === item.assignmentId)
    ? old.filter((r) => r.assignmentId !== item.assignmentId) : old.length >= MAX_BULK_APPROVALS ? old : [...old, item]) }}>
    <div ref={root}>
      {enabled ? <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input ref={all} type="checkbox" checked={allSelected} disabled={!visible.length || confirmation !== null}
            onChange={() => setSelected(allSelected ? [] : batch)} className="h-4 w-4 accent-vam-green" />
          {overCap ? `Chọn ${batch.length} ${noun} đầu tiên trong ${visible.length} đang hiện` : `Chọn tất cả ${noun} chưa duyệt đang hiện (${visible.length})`}
        </label>
        <button type="button" disabled={!chosen.length || confirmation !== null} onClick={() => setConfirmation([...chosen])}
          className="rounded-md bg-vam-green px-4 py-2 text-sm text-white disabled:opacity-50">Duyệt {chosen.length} {noun} đã chọn</button>
        {selected.length ? <button type="button" onClick={() => setSelected([])} disabled={confirmation !== null} className="text-sm text-slate-600">Bỏ chọn</button> : null}
        <p className="w-full text-xs text-slate-500">Duyệt là xác nhận nhóm hiện tại sau khi rà hồ sơ. {Noun} đã duyệt có nhãn “BTC đã duyệt”.</p>
        {overCap ? <p className="w-full text-xs text-amber-700" data-testid="bulk-cap-note">Mỗi lượt duyệt tối đa {MAX_BULK_APPROVALS} người. Duyệt xong, {visible.length - batch.length} người còn lại vẫn ở trên bảng — chọn tiếp để duyệt lượt sau.</p> : null}
        {note ? <p className="w-full text-xs text-amber-700" data-testid="bulk-note">{note}</p> : null}
        {state.status !== "idle" ? <p role="status" className={state.status === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}>{state.message}</p> : null}
      </div> : null}
      {children}
      {confirmation ? <div role="dialog" aria-modal="true" aria-labelledby="bulk-review-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <form ref={dialogForm} action={action} onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }} className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
          <h2 id="bulk-review-title" className="text-lg font-semibold">Xác nhận duyệt nhóm cho {confirmation.length} {noun}</h2>
          <p className="my-2 text-sm text-slate-600">Các {noun} sau sẽ được ghi nhận “BTC đã duyệt” theo nhóm đang hiển thị.</p>
          {confirmation.some((item) => item.needsReview) ? <p className="mb-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800" data-testid="bulk-flagged-warning">
            {confirmation.filter((item) => item.needsReview).length} người trong danh sách đang có cờ “Cần BTC xem” (hệ thống chưa chắc nhóm). Chỉ duyệt khi bạn đã rà hồ sơ của họ.</p> : null}
          <input type="hidden" name="confirmed" value="yes" />
          <input type="hidden" name="rows" value={JSON.stringify(confirmation.map(({ assignmentId, expectedGroup, expectedDrift, role: itemRole }) =>
            role === "all" ? { assignmentId, expectedGroup, expectedDrift, role: itemRole } : { assignmentId, expectedGroup, expectedDrift }))} />
          <div className="vam-table-frame overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="p-2">{Noun}</th><th className="p-2">Nhóm được xác nhận</th></tr></thead>
            <tbody>{confirmation.map((item) => <tr key={item.assignmentId} className="border-b"><td className="p-2">{item.name}
              {item.needsReview ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Cần BTC xem</span> : null}</td><td className="p-2">{industryGroupLabel(item.expectedGroup)}
              {item.expectedDrift ? <div className="text-xs text-amber-700">Dữ liệu mới gợi ý: {industryGroupLabel(item.expectedDrift)}</div> : null}
            </td></tr>)}</tbody>
            <tfoot><tr><td className="p-2 font-semibold" colSpan={2}>Tổng: {confirmation.length} {noun}</td></tr></tfoot>
          </table></div>
          {state.status === "error" ? <p role="alert" className="mt-3 text-sm text-red-600">{state.message}</p> : null}
          <ConfirmationButtons cancel={() => setConfirmation(null)} />
        </form>
      </div> : null}
    </div>
  </Selection.Provider>;
}
