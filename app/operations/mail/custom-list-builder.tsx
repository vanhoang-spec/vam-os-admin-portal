"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { BulkEventOption } from "@/lib/bulk-mail-core";
import {
  EVENT_CHECKIN_FILTERS,
  EVENT_CHECKIN_FILTER_LABELS,
  customListSignature,
  type CustomListSpec,
  type EventCheckinFilter
} from "@/lib/bulk-mail-custom-core";
import {
  initialBulkMailActionState,
  initialCustomListPreviewState,
  initialCustomListSearchState,
  type BulkMailActionState,
  type CustomListPersonOption
} from "@/lib/bulk-mail-action-types";
import {
  previewCustomListAction,
  searchCustomListPeopleAction,
  startCustomBulkSendAction
} from "@/app/actions/bulk-mail";

function Button({ label, busyLabel, disabled, quiet }: { label: string; busyLabel: string; disabled?: boolean; quiet?: boolean }) {
  const { pending } = useFormStatus();
  const tone = quiet
    ? "border border-vam-line bg-white text-vam-ink hover:bg-slate-50"
    : "bg-vam-green text-white hover:bg-vam-green/90";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
    >
      {pending ? busyLabel : label}
    </button>
  );
}

function Message({ ok, text }: { ok: boolean; text: string | null }) {
  if (!text) return null;
  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        ok ? "border-vam-green/40 bg-vam-mint text-vam-ink" : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {text}
    </p>
  );
}

/**
 * Nguồn của danh sách, viết thành các ô ẩn. Bản xem trước và lệnh gửi nhận ĐÚNG cùng một bộ
 * ô này, vì máy chủ dựng lại tập ứng viên từ chúng ở cả hai lần — lệch nhau là lệnh gửi từ
 * chối danh sách người bấm vừa xem.
 */
function SpecFields({ spec, signature }: { spec: CustomListSpec; signature: string }) {
  return (
    <>
      <input type="hidden" name="signature" value={signature} />
      <input type="hidden" name="src_mentor" value={spec.mentor ? "true" : "false"} />
      <input type="hidden" name="src_mentee" value={spec.mentee ? "true" : "false"} />
      <input type="hidden" name="src_staff" value={spec.staff ? "true" : "false"} />
      <input type="hidden" name="src_event_id" value={spec.event?.eventId ?? ""} />
      <input type="hidden" name="src_event_series" value={spec.event?.coversSeries ? "true" : "false"} />
      <input type="hidden" name="src_event_checkin" value={spec.event?.checkin ?? "all"} />
      {spec.addedPersonIds.map((id) => (
        <input key={id} type="hidden" name="added_person_id" value={id} />
      ))}
    </>
  );
}

const checkboxClass = "mt-0.5 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green";

/**
 * Danh sách tùy chỉnh (VAM00026): tick nguồn, thêm tay người trong hệ thống, xem trước, bỏ tick
 * người không gửi, rồi gõ lại số người để gửi.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐỔI NGUỒN LÀ PHẢI XEM TRƯỚC LẠI
 * ---------------------------------------------------------------------------
 * Danh sách gửi đi là đúng danh sách đang hiện, và máy chủ kiểm từng dòng với các nguồn đã
 * tick. Đổi một ô mà vẫn giữ bản xem trước cũ thì thứ trên màn hình và thứ máy chủ dựng lại
 * khác nhau — nên nút gửi ẩn đi cho tới khi bấm "Xem danh sách người nhận" lại.
 */
export function CustomListBuilder({
  templateId,
  eventOptions
}: {
  templateId: string;
  eventOptions: BulkEventOption[];
}) {
  const [mentor, setMentor] = useState(false);
  const [mentee, setMentee] = useState(false);
  const [staff, setStaff] = useState(false);
  const [eventOn, setEventOn] = useState(false);
  const [eventChoice, setEventChoice] = useState("");
  const [coversSeries, setCoversSeries] = useState(false);
  const [checkin, setCheckin] = useState<EventCheckinFilter>("all");
  const [added, setAdded] = useState<CustomListPersonOption[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());

  const [searchState, searchAction] = useFormState(searchCustomListPeopleAction, initialCustomListSearchState);
  const [previewState, previewAction] = useFormState(previewCustomListAction, initialCustomListPreviewState);
  const [sendState, sendAction] = useFormState(startCustomBulkSendAction, initialBulkMailActionState);

  // Sự kiện suy ra từ danh sách hiện có, như ô chọn sự kiện của nhóm cũ: một id không còn
  // trong danh sách rơi về sự kiện đầu, không rơi về rỗng.
  const selectedEvent = eventOptions.find((row) => row.id === eventChoice) ?? eventOptions[0] ?? null;
  const seriesAvailable = Boolean(selectedEvent && selectedEvent.seriesSendable !== null);

  const spec: CustomListSpec = {
    mentor,
    mentee,
    staff,
    event:
      eventOn && selectedEvent
        ? { eventId: selectedEvent.id, coversSeries: seriesAvailable && coversSeries, checkin }
        : null,
    addedPersonIds: added.map((row) => row.personId)
  };
  const signature = customListSignature(spec);
  const hasSource = mentor || mentee || staff || Boolean(spec.event) || added.length > 0;

  const fresh = previewState.ok && previewState.signature === signature;
  const included = fresh ? previewState.rows.filter((row) => !excluded.has(row.key)) : [];
  const stale = previewState.ok && !fresh;

  const toggle = (key: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addedIds = new Set(added.map((row) => row.personId));

  return (
    <div className="flex flex-col gap-4 rounded-md border border-vam-line bg-slate-50 p-3" data-testid="custom-list-builder">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-vam-ink">1. Lấy người nhận từ (tick một hoặc nhiều)</legend>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className={checkboxClass} checked={mentor} onChange={(e) => setMentor(e.target.checked)} />
          Mentor đang tham gia mùa này
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className={checkboxClass} checked={mentee} onChange={(e) => setMentee(e.target.checked)} />
          Mentee đang tham gia mùa này
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className={checkboxClass} checked={staff} onChange={(e) => setStaff(e.target.checked)} />
          Ban tổ chức (admin, core team, support team)
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={eventOn}
            disabled={!eventOptions.length}
            onChange={(e) => setEventOn(e.target.checked)}
          />
          <span>
            Người đăng ký một sự kiện
            {!eventOptions.length ? (
              <span className="block text-xs text-slate-500">Mùa này chưa có sự kiện nào có người đăng ký.</span>
            ) : null}
          </span>
        </label>
        {eventOn && selectedEvent ? (
          <div className="ml-6 grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="custom-event" className="mb-1 block text-xs font-medium text-vam-ink">
                Sự kiện
              </label>
              <select
                id="custom-event"
                value={selectedEvent.id}
                onChange={(e) => setEventChoice(e.target.value)}
                className="w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm"
              >
                {eventOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="custom-checkin" className="mb-1 block text-xs font-medium text-vam-ink">
                Check-in
              </label>
              <select
                id="custom-checkin"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value as EventCheckinFilter)}
                className="w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm"
              >
                {EVENT_CHECKIN_FILTERS.map((key) => (
                  <option key={key} value={key}>
                    {EVENT_CHECKIN_FILTER_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            {seriesAvailable ? (
              <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={coversSeries}
                  onChange={(e) => setCoversSeries(e.target.checked)}
                />
                Gồm cả các buổi khác trong chuỗi
              </label>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <div className="grid gap-2">
        <p className="text-sm font-medium text-vam-ink">2. Thêm tay người đã có trong VAM OS (không bắt buộc)</p>
        <form action={searchAction} className="flex flex-wrap items-center gap-2">
          <input
            name="q"
            aria-label="Tìm người theo tên, email hoặc mã thành viên"
            placeholder="Tên, email hoặc mã thành viên"
            autoComplete="off"
            className="w-64 rounded-md border border-vam-line bg-white px-3 py-2 text-sm"
          />
          <Button label="Tìm" busyLabel="Đang tìm…" quiet />
        </form>
        <p className="text-xs text-slate-500">
          Chỉ tìm được người thuộc mùa này (có tư cách, có đơn trong mùa) hoặc thuộc Ban tổ chức. Không gõ được email ngoài hệ thống.
        </p>
        {searchState.message ? <p className="text-xs text-slate-600">{searchState.message}</p> : null}
        {searchState.results.length ? (
          <ul className="flex flex-col gap-1" data-testid="custom-search-results">
            {searchState.results.map((person) => (
              <li key={person.personId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-vam-line bg-white px-2 py-1 text-sm">
                <span>
                  {person.fullName} · {person.email}
                  {person.memberCode ? ` · ${person.memberCode}` : ""} · {person.roleWord}
                </span>
                <button
                  type="button"
                  disabled={addedIds.has(person.personId)}
                  onClick={() => setAdded((current) => [...current, person])}
                  className="rounded border border-vam-line px-2 py-0.5 text-xs font-medium disabled:opacity-50"
                >
                  {addedIds.has(person.personId) ? "Đã thêm" : `Thêm ${person.fullName}`}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {added.length ? (
          <ul className="flex flex-wrap gap-2" data-testid="custom-added">
            {added.map((person) => (
              <li key={person.personId} className="flex items-center gap-1 rounded-full border border-vam-line bg-white px-2 py-0.5 text-xs">
                {person.fullName}
                <button
                  type="button"
                  aria-label={`Bỏ ${person.fullName} khỏi danh sách thêm tay`}
                  onClick={() => setAdded((current) => current.filter((row) => row.personId !== person.personId))}
                  className="text-slate-500 hover:text-red-700"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <form action={previewAction} className="flex flex-wrap items-center gap-3">
        <SpecFields spec={spec} signature={signature} />
        <Button label="Xem danh sách người nhận" busyLabel="Đang dựng danh sách…" quiet disabled={!hasSource} />
        {stale ? (
          <span className="text-xs text-amber-800" data-testid="custom-stale">
            Bạn vừa đổi nguồn hoặc người thêm tay — bấm “Xem danh sách người nhận” để cập nhật.
          </span>
        ) : null}
      </form>
      {!previewState.ok ? <Message ok={false} text={previewState.message} /> : null}

      {fresh ? (
        <div className="grid gap-3" data-testid="custom-preview">
          <p className="text-sm text-vam-ink">
            3. Danh sách cuối cùng: <strong data-testid="custom-count">{included.length}</strong> / {previewState.rows.length} người
            (mỗi email một lá). Bỏ tick người không gửi.
          </p>
          {previewState.unreachableCount ? (
            <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <summary className="cursor-pointer">{previewState.unreachableCount} người không nhận được: thiếu email hoặc họ tên</summary>
              <ul className="mt-1">
                {previewState.unreachable.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="vam-table-frame max-h-96 rounded-md border border-vam-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-1">Gửi</th>
                  <th className="px-2 py-1">Họ tên</th>
                  <th className="px-2 py-1">Email</th>
                  <th className="px-2 py-1">Vai trò</th>
                </tr>
              </thead>
              <tbody>
                {previewState.rows.map((row) => (
                  <tr key={row.key} className="border-t border-vam-line">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        aria-label={`Gửi cho ${row.fullName}`}
                        checked={!excluded.has(row.key)}
                        onChange={() => toggle(row.key)}
                      />
                    </td>
                    <td className="px-2 py-1">{row.fullName}</td>
                    <td className="px-2 py-1">{row.email}</td>
                    <td className="px-2 py-1">{row.roleWord}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={sendAction} className="flex flex-col gap-3 border-t border-vam-line pt-3" data-testid="custom-send-form">
            <input type="hidden" name="template_id" value={templateId} />
            <input type="hidden" name="audience" value="custom" />
            <SpecFields spec={spec} signature={signature} />
            {included.map((row) => (
              <input key={row.key} type="hidden" name="recipient_key" value={row.key} />
            ))}
            <p className="text-sm text-vam-ink">
              Sắp gửi <strong className="text-vam-green">{included.length}</strong> lá thư cho danh sách tùy chỉnh. Danh sách
              này được chốt vào lô: “Gửi tiếp” chỉ gửi cho đúng những người trên. Thư đã gửi không thu hồi được.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="custom-confirm-count" className="mb-1 block text-xs font-medium text-vam-ink">
                  Gõ lại số {included.length} để xác nhận
                </label>
                <input
                  id="custom-confirm-count"
                  name="confirm_count"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-40 rounded-md border border-vam-line bg-white px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <Button label="Bắt đầu gửi" busyLabel="Đang gửi…" disabled={included.length === 0} />
            </div>
          </form>
        </div>
      ) : null}
      <SendResult state={sendState} />
    </div>
  );
}

function SendResult({ state }: { state: BulkMailActionState }) {
  if (!state.message && !state.problems.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <Message ok={state.ok} text={state.message} />
      {state.problems.length ? (
        <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">{state.problems.length} người chưa nhận được thư</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {state.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
