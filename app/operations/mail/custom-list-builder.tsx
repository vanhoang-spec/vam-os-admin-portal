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
  EXTERNAL_CONFIRM_FIELD,
  EXTERNAL_MAX_PER_BATCH,
  EXTERNAL_RECIPIENTS_FIELD
} from "@/lib/bulk-mail-external-core";
import {
  initialBulkMailActionState,
  initialCustomListPreviewState,
  initialCustomListSearchState,
  initialExternalFileState,
  type BulkMailActionState,
  type CustomListPersonOption
} from "@/lib/bulk-mail-action-types";
import {
  previewCustomListAction,
  readExternalEmailFileAction,
  searchCustomListPeopleAction,
  startCustomBulkSendAction
} from "@/app/actions/bulk-mail";
import { ExternalEmailFileForm } from "./external-email-file";

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
function SpecFields({ spec, signature, externalText }: { spec: CustomListSpec; signature: string; externalText: string }) {
  return (
    <>
      {externalText ? <input type="hidden" name={EXTERNAL_RECIPIENTS_FIELD} value={externalText} /> : null}
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
  const [externalTyped, setExternalTyped] = useState("");
  const [dismissedFile, setDismissedFile] = useState<string | null>(null);

  const [searchState, searchAction] = useFormState(searchCustomListPeopleAction, initialCustomListSearchState);
  const [previewState, previewAction] = useFormState(previewCustomListAction, initialCustomListPreviewState);
  const [sendState, sendAction] = useFormState(startCustomBulkSendAction, initialBulkMailActionState);
  const [fileState, fileAction] = useFormState(readExternalEmailFileAction, initialExternalFileState);

  // Email ngoài VAM (VAM00027) = chữ gõ tay + danh sách đọc từ file Excel gần nhất (chưa bị bỏ).
  // Máy chủ đọc lại ĐÚNG chữ này ở cả bước xem trước và bước gửi.
  const fileActive = fileState.ok && Boolean(fileState.token) && fileState.token !== dismissedFile;
  const externalText = [externalTyped.trim(), fileActive ? fileState.text : ""].filter(Boolean).join("\n");

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
  const signature = customListSignature(spec, externalText);
  const hasSource = mentor || mentee || staff || Boolean(spec.event) || added.length > 0 || Boolean(externalText);

  // Có người ngoài thì bản xem trước còn gắn với mẫu thư (mẫu có dùng ô tên không): đổi mẫu là xem lại.
  const templateMatches = !previewState.external || (previewState.templateId ?? null) === (templateId || null);
  const fresh = previewState.ok && previewState.signature === signature && templateMatches;
  const included = fresh ? previewState.rows.filter((row) => !excluded.has(row.key)) : [];
  const stale = previewState.ok && !fresh;
  const includedExternal = included.filter((row) => row.external).length;
  const blockedNameless = previewState.nameRequired ? included.filter((row) => row.external && !row.fullName.trim()).length : 0;
  // Ô xác nhận người ngoài gắn với ĐÚNG danh sách lúc tick: đổi nguồn hay bỏ tick ai thì phải tick lại.
  const externalCheckKey = `${signature}|${included.map((row) => row.key).join(",")}`;
  const [externalCheckedFor, setExternalCheckedFor] = useState<string | null>(null);
  const externalChecked = externalCheckedFor === externalCheckKey;

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
          Chỉ tìm được người thuộc mùa này (có tư cách, có đơn trong mùa) hoặc thuộc Ban tổ chức. Người chưa có trong VAM OS thì thêm ở mục 3.
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

      <div className="grid gap-2" data-testid="custom-external">
        <p className="text-sm font-medium text-vam-ink">3. Email ngoài VAM — chưa có hồ sơ trong VAM OS (không bắt buộc)</p>
        <label htmlFor="custom-external-text" className="text-xs text-slate-600">
          Mỗi dòng một người: <code>email</code>, <code>email, Họ tên</code> hoặc <code>Họ tên &lt;email&gt;</code>. Không tạo hồ sơ
          thành viên. Tối đa {EXTERNAL_MAX_PER_BATCH} email ngoài VAM một lô.
        </label>
        <textarea
          id="custom-external-text"
          aria-label="Email ngoài VAM, mỗi dòng một người"
          value={externalTyped}
          onChange={(e) => setExternalTyped(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full rounded-md border border-vam-line bg-white px-3 py-2 font-mono text-xs"
          placeholder={"khach@congty.vn, Nguyễn Văn A\nban@truong.edu.vn"}
        />
        <p className="text-xs text-slate-600">
          Hoặc tải file Excel (.xlsx, tối đa 2MB): sheet đầu, dòng đầu là tiêu đề có cột “Email” (và “Họ tên” nếu có). Không có
          tiêu đề thì mỗi dòng lấy ô đầu tiên có dấu @, tên để trống.
        </p>
        <ExternalEmailFileForm action={fileAction} />
        {fileState.message && (!fileState.ok || fileActive) ? <Message ok={fileState.ok} text={fileState.message} /> : null}
        {fileActive ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700" data-testid="external-file-summary">
            <span>
              Từ file {fileState.fileName}: {fileState.count} email
              {fileState.nameless ? `, ${fileState.nameless} người chưa có tên` : ""}
              {fileState.duplicates ? `, ${fileState.duplicates} dòng trùng đã gộp` : ""}.
            </span>
            <button
              type="button"
              onClick={() => setDismissedFile(fileState.token)}
              className="rounded border border-vam-line bg-white px-2 py-0.5 font-medium hover:text-red-700"
            >
              Bỏ danh sách từ file
            </button>
          </div>
        ) : null}
        {fileState.problems.length && (!fileState.ok || fileActive) ? (
          <ProblemList
            title={`${fileState.invalidCount} dòng trong file không nhận`}
            lines={fileState.problems}
            testId="external-file-problems"
          />
        ) : null}
      </div>

      <form action={previewAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="template_id" value={templateId} />
        <SpecFields spec={spec} signature={signature} externalText={externalText} />
        <Button label="Xem danh sách người nhận" busyLabel="Đang dựng danh sách…" quiet disabled={!hasSource} />
        {stale ? (
          <span className="text-xs text-amber-800" data-testid="custom-stale">
            Bạn vừa đổi nguồn, người thêm tay, email ngoài VAM hoặc mẫu thư — bấm “Xem danh sách người nhận” để cập nhật.
          </span>
        ) : null}
      </form>
      {!previewState.ok ? <Message ok={false} text={previewState.message} /> : null}

      {fresh ? (
        <div className="grid gap-3" data-testid="custom-preview">
          <p className="text-sm text-vam-ink">
            4. Danh sách cuối cùng: <strong data-testid="custom-count">{included.length}</strong> / {previewState.rows.length} người
            (mỗi email một lá). Bỏ tick người không gửi.
          </p>
          {previewState.external ? <ExternalSummary preview={previewState} /> : null}
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
                        aria-label={`Gửi cho ${row.fullName || row.email}`}
                        checked={!excluded.has(row.key)}
                        onChange={() => toggle(row.key)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {row.fullName ||
                        (row.external ? (
                          <span className={previewState.nameRequired ? "font-medium text-red-700" : "text-slate-500"}>(chưa có tên)</span>
                        ) : null)}
                    </td>
                    <td className="px-2 py-1">{row.email}</td>
                    <td className="px-2 py-1">
                      {row.roleWord}
                      {row.external ? (
                        <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">ngoài VAM</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={sendAction} className="flex flex-col gap-3 border-t border-vam-line pt-3" data-testid="custom-send-form">
            <input type="hidden" name="template_id" value={templateId} />
            <input type="hidden" name="audience" value="custom" />
            <SpecFields spec={spec} signature={signature} externalText={externalText} />
            {included.map((row) => (
              <input key={row.key} type="hidden" name="recipient_key" value={row.key} />
            ))}
            <p className="text-sm text-vam-ink">
              Sắp gửi <strong className="text-vam-green">{included.length}</strong> lá thư cho danh sách tùy chỉnh. Danh sách
              này được chốt vào lô: “Gửi tiếp” chỉ gửi cho đúng những người trên. Thư đã gửi không thu hồi được.
            </p>
            {blockedNameless ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="custom-nameless-block">
                {blockedNameless} email ngoài VAM chưa có tên, mà mẫu thư dùng ô Tên người nhận. Thêm tên (“email, Họ tên” hoặc cột
                “Họ tên” trong Excel), bỏ tick họ, hoặc chọn mẫu thư không có ô tên.
              </p>
            ) : null}
            {includedExternal ? (
              <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  name={EXTERNAL_CONFIRM_FIELD}
                  value={String(includedExternal)}
                  checked={externalChecked}
                  onChange={(e) => setExternalCheckedFor(e.target.checked ? externalCheckKey : null)}
                  className={checkboxClass}
                />
                <span>
                  Tôi đã kiểm <strong>{includedExternal}</strong> email ngoài VAM ở bảng trên. Đây là người không có hồ sơ trong VAM
                  OS — thư gửi nhầm cho người lạ không rút lại được.
                </span>
              </label>
            ) : null}
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
              <Button
                label="Bắt đầu gửi"
                busyLabel="Đang gửi…"
                disabled={included.length === 0 || blockedNameless > 0 || (includedExternal > 0 && !externalChecked)}
              />
            </div>
          </form>
        </div>
      ) : null}
      <SendResult state={sendState} />
    </div>
  );
}

function ProblemList({ title, lines, testId }: { title: string; lines: string[]; testId: string }) {
  return (
    <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid={testId} open>
      <summary className="cursor-pointer font-medium">{title}</summary>
      <ul className="mt-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/** Phần email ngoài VAM của bản xem trước: bao nhiêu người, ai sai, ai trùng, ai chưa có tên. */
function ExternalSummary({ preview }: { preview: typeof initialCustomListPreviewState }) {
  const external = preview.external;
  if (!external) return null;
  const notes: string[] = [`${external.count} email ngoài VAM (không có hồ sơ, vai trò “khách mời”, không có mã thành viên).`];
  if (external.overlap) notes.push(`${external.overlap} email ngoài đã có trong danh sách lấy từ VAM — gửi theo hồ sơ VAM, một lá.`);
  if (external.duplicates) notes.push(`${external.duplicates} email nhập lặp lại — chỉ gửi một lá.`);
  if (external.nameless) {
    notes.push(
      preview.nameRequired
        ? `${external.nameless} người chưa có tên: mẫu thư dùng ô Tên người nhận nên KHÔNG gửi được cho họ.`
        : `${external.nameless} người chưa có tên: mẫu thư không dùng ô Tên người nhận, thư vẫn gửi được.`
    );
  }
  return (
    <div className="grid gap-2" data-testid="custom-external-summary">
      <ul className="rounded-md border border-vam-line bg-white px-3 py-2 text-xs text-slate-700">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {external.problems.length ? (
        <ProblemList
          title={`${external.invalidCount} dòng email ngoài VAM không hợp lệ — sẽ không gửi`}
          lines={external.problems}
          testId="custom-external-problems"
        />
      ) : null}
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
