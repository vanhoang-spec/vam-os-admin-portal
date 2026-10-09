"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { confirmMentorGroupsAction } from "@/app/actions/matching-round2";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";
import type { GroupApproval } from "@/lib/matching-round2-bulk-core";
import { industryGroupLabel } from "@/lib/matching-round2-groups-core";

type Item = GroupApproval & { name: string };
const Selection = createContext<{ selected: Item[]; toggle: (item: Item) => void } | null>(null);

export function MentorReviewCheckbox({ item }: { item: Item }) {
  const context = useContext(Selection);
  if (!context) return null;
  return <input type="checkbox" data-round2-approve={item.assignmentId}
    aria-label={`Duyệt nhóm của ${item.name}`}
    checked={context.selected.some((r) => r.assignmentId === item.assignmentId)}
    onChange={() => context.toggle(item)} className="h-4 w-4 accent-vam-green" />;
}

function ConfirmationButtons({ cancel }: { cancel: () => void }) {
  const { pending } = useFormStatus();
  return <div className="mt-4 flex gap-3">
    <button type="button" disabled={pending} onClick={cancel} className="rounded-md border px-4 py-2">Quay lại</button>
    <button type="submit" disabled={pending} className="rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-60">
      {pending ? "Đang duyệt…" : "Xác nhận duyệt"}
    </button>
  </div>;
}

export function BulkGroupReview({ items, children, enabled = true }: { items: Item[]; children: React.ReactNode; enabled?: boolean }) {
  const [selected, setSelected] = useState<Item[]>([]);
  const [confirmation, setConfirmation] = useState<Item[] | null>(null);
  const [state, action] = useFormState(confirmMentorGroupsAction, ROUND2_IDLE);
  const root = useRef<HTMLDivElement>(null);
  const all = useRef<HTMLInputElement>(null);
  const dialogForm = useRef<HTMLFormElement>(null);
  const [visibleIds, setVisibleIds] = useState<string[]>(items.map((i) => i.assignmentId));
  const visible = items.filter((item) => visibleIds.includes(item.assignmentId));
  const chosen = selected.filter((item) => visibleIds.includes(item.assignmentId));
  const allSelected = visible.length > 0 && chosen.length === visible.length;

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
    ? old.filter((r) => r.assignmentId !== item.assignmentId) : [...old, item]) }}>
    <div ref={root}>
      {enabled ? <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input ref={all} type="checkbox" checked={allSelected} disabled={!visible.length || confirmation !== null}
            onChange={() => setSelected(allSelected ? [] : visible)} className="h-4 w-4 accent-vam-green" />
          Chọn tất cả mentor chưa duyệt đang hiện ({visible.length})
        </label>
        <button type="button" disabled={!chosen.length || confirmation !== null} onClick={() => setConfirmation([...chosen])}
          className="rounded-md bg-vam-green px-4 py-2 text-sm text-white disabled:opacity-50">Duyệt {chosen.length} mentor đã chọn</button>
        {selected.length ? <button type="button" onClick={() => setSelected([])} disabled={confirmation !== null} className="text-sm text-slate-600">Bỏ chọn</button> : null}
        <p className="w-full text-xs text-slate-500">Duyệt là xác nhận nhóm hiện tại sau khi rà hồ sơ. Mentor đã duyệt có nhãn “BTC đã duyệt”.</p>
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
          <h2 id="bulk-review-title" className="text-lg font-semibold">Xác nhận duyệt nhóm cho {confirmation.length} mentor</h2>
          <p className="my-2 text-sm text-slate-600">Các mentor sau sẽ được ghi nhận “BTC đã duyệt” theo nhóm đang hiển thị.</p>
          <input type="hidden" name="confirmed" value="yes" />
          <input type="hidden" name="rows" value={JSON.stringify(confirmation.map(({ assignmentId, expectedGroup, expectedDrift }) => ({ assignmentId, expectedGroup, expectedDrift })))} />
          <div className="vam-table-frame overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Mentor</th><th className="p-2">Nhóm được xác nhận</th></tr></thead>
            <tbody>{confirmation.map((item) => <tr key={item.assignmentId} className="border-b"><td className="p-2">{item.name}</td><td className="p-2">{industryGroupLabel(item.expectedGroup)}
              {item.expectedDrift ? <div className="text-xs text-amber-700">Dữ liệu mới gợi ý: {industryGroupLabel(item.expectedDrift)}</div> : null}
            </td></tr>)}</tbody>
            <tfoot><tr><td className="p-2 font-semibold" colSpan={2}>Tổng: {confirmation.length} mentor</td></tr></tfoot>
          </table></div>
          {state.status === "error" ? <p role="alert" className="mt-3 text-sm text-red-600">{state.message}</p> : null}
          <ConfirmationButtons cancel={() => setConfirmation(null)} />
        </form>
      </div> : null}
    </div>
  </Selection.Provider>;
}
