"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  BULK_AUDIENCE_LABELS,
  BULK_SEND_CHUNK,
  FIXED_BULK_AUDIENCES,
  type BulkAudience,
  type BulkEventOption,
  type FixedBulkAudience
} from "@/lib/bulk-mail-core";
import {
  initialBulkMailActionState,
  type BulkMailActionState
} from "@/lib/bulk-mail-action-types";
import {
  continueBulkSendAction,
  sendTestEmailAction,
  startBulkSendAction
} from "@/app/actions/bulk-mail";

export type SendableTemplate = { id: string; name: string; subject: string };

export type BatchSummary = {
  id: string;
  note: string | null;
  status: "running" | "completed" | "failed";
  requestedCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
};

/**
 * Số người nhận của từng nhóm cố định.
 *
 * Partial vì một nhóm có thể chưa được đếm (trang đọc lỗi, hoặc người xem không
 * gửi được). Thiếu thì hiện 0 — và nút gửi tắt ở 0 — chứ không vỡ màn hình.
 */
export type AudienceCounts = Partial<Record<FixedBulkAudience, { sendable: number; unreachable: number }>>;

const ZERO = { sendable: 0, unreachable: 0 };

function SubmitButton({
  label,
  busyLabel,
  tone = "primary",
  disabled
}: {
  label: string;
  busyLabel: string;
  tone?: "primary" | "quiet";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const base =
    tone === "primary"
      ? "bg-vam-green text-white hover:bg-vam-green/90"
      : "border border-vam-line bg-white text-vam-ink hover:bg-slate-50";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${base}`}
    >
      {pending ? busyLabel : label}
    </button>
  );
}

function Result({ state }: { state: BulkMailActionState }) {
  if (!state.message && !state.problems.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {state.message ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-vam-green/40 bg-vam-mint text-vam-ink"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {state.message}
        </p>
      ) : null}
      {state.problems.length ? (
        <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            {state.problems.length} người chưa nhận được thư
          </summary>
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

/**
 * Mở một lượt gửi hàng loạt.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO PHẢI GÕ LẠI CON SỐ
 * ---------------------------------------------------------------------------
 * Đây là nút có sức công phá lớn nhất trong app. Không có đường thu hồi một lá
 * thư đã vào hộp thư của một sinh viên, và một cú bấm nhầm là hàng trăm lá. Gõ
 * lại số người nhận buộc mắt nhìn vào quy mô của việc mình đang làm — cùng cách
 * mà lệnh duyệt bắt gõ lại tiêu đề.
 *
 * Bước gửi thử đứng trước, vì xem trước trên màn hình không trả lời được câu
 * hỏi thật: thư này trông thế nào trong Gmail, có rơi vào Spam không.
 */
export function SendPanel({
  templates,
  counts,
  eventOptions = [],
  batches,
  canSend
}: {
  templates: SendableTemplate[];
  counts: AudienceCounts;
  /** Sự kiện chọn được cho nhóm "người đã đăng ký một sự kiện". */
  eventOptions?: BulkEventOption[];
  batches: BatchSummary[];
  canSend: boolean;
}) {
  // Lưu Ý ĐỊNH của người dùng, rồi mới SUY RA giá trị thật từ danh sách hiện
  // có — không lưu thẳng giá trị.
  //
  // `useState(templates[0]?.id)` chỉ chạy ở lần dựng đầu tiên. Panel này được
  // dựng khi CHƯA có mẫu thư nào được duyệt, nên state khởi tạo bằng chuỗi
  // rỗng; sau khi duyệt xong và trang đọc lại, `templates` có dòng mới nhưng
  // component không dựng lại nên state vẫn rỗng. Một `<select value="">` không
  // khớp option nào thì trình duyệt TỰ hiển thị option đầu — ô chọn trông như
  // đã chọn, còn form gửi lên chuỗi rỗng.
  //
  // Suy ra thì cả trường hợp đó lẫn trường hợp mẫu đang chọn bị cất đi đều
  // rơi về một mẫu có thật, thay vì rơi về rỗng. Nhóm nhận thư và sự kiện đi
  // theo đúng lối đó, vì cùng một cái bẫy.
  const [templateChoice, setTemplateChoice] = useState("");
  const [audienceChoice, setAudienceChoice] = useState<BulkAudience>("mentee");
  const [eventChoice, setEventChoice] = useState("");
  const [coversSeries, setCoversSeries] = useState(true);

  const [testState, testAction] = useFormState(sendTestEmailAction, initialBulkMailActionState);
  const [sendState, sendAction] = useFormState(startBulkSendAction, initialBulkMailActionState);
  const [continueState, continueAction] = useFormState(
    continueBulkSendAction,
    initialBulkMailActionState
  );

  // Ý định của người dùng nếu nó còn hợp lệ, nếu không thì mẫu đầu tiên còn
  // lại. Đây là chỗ duy nhất quyết định "mẫu nào", và cả ô chọn lẫn form đều
  // đọc từ nó — nên thứ nhìn thấy và thứ gửi lên không thể lệch nhau.
  const selected = templates.find((row) => row.id === templateChoice) ?? templates[0] ?? null;
  const templateId = selected?.id ?? "";

  // Nhóm "sự kiện" mà không còn sự kiện nào chọn được thì rơi về nhóm đầu tiên,
  // chứ không để ô chọn hiện một nhóm còn form gửi lên nhóm khác.
  const audience: BulkAudience =
    audienceChoice === "event" && !eventOptions.length ? "mentee" : audienceChoice;
  const selectedEvent =
    eventOptions.find((row) => row.id === eventChoice) ?? eventOptions[0] ?? null;
  const seriesAvailable = Boolean(selectedEvent && selectedEvent.seriesSendable !== null);
  const useSeries = audience === "event" && seriesAvailable && coversSeries;

  const target =
    audience === "event"
      ? selectedEvent
        ? useSeries
          ? {
              sendable: selectedEvent.seriesSendable ?? 0,
              unreachable: selectedEvent.seriesUnreachable ?? 0
            }
          : { sendable: selectedEvent.sendable, unreachable: selectedEvent.unreachable }
        : ZERO
      : counts[audience] ?? ZERO;

  const audienceText =
    audience === "event"
      ? selectedEvent
        ? `người đã đăng ký ${selectedEvent.label}${useSeries ? " (cả chuỗi)" : ""}`
        : "người đã đăng ký sự kiện"
      : BULK_AUDIENCE_LABELS[audience].toLowerCase();

  const runningBatches = batches.filter((row) => row.status === "running");

  if (!canSend) {
    return (
      <section className="rounded-md border border-vam-line bg-white p-4">
        <h2 className="text-sm font-semibold text-vam-ink">Gửi hàng loạt</h2>
        <p className="mt-1 text-sm text-slate-600">
          Chỉ quản trị viên gửi được. Bạn soạn và lưu mẫu thư ở trên, rồi báo quản trị viên duyệt
          và gửi.
        </p>
      </section>
    );
  }

  if (!templates.length) {
    return (
      <section className="rounded-md border border-vam-line bg-white p-4">
        <h2 className="text-sm font-semibold text-vam-ink">Gửi hàng loạt</h2>
        <p className="mt-1 text-sm text-slate-600">
          Chưa có mẫu thư nào được duyệt. Duyệt một mẫu ở trên thì nó hiện ra ở đây.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5 rounded-md border border-vam-line bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-vam-ink">Gửi hàng loạt</h2>
        <p className="mt-1 text-xs text-slate-500">
          Chỉ mẫu thư đã duyệt mới gửi được. Mỗi lần chạy gửi tối đa {BULK_SEND_CHUNK} thư, phần
          còn lại đi tiếp bằng nút &ldquo;Gửi tiếp&rdquo;.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="send-template" className="mb-1 block text-sm font-medium text-vam-ink">
            Mẫu thư
          </label>
          <select
            id="send-template"
            value={templateId}
            onChange={(event) => setTemplateChoice(event.target.value)}
            className="w-full rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            {templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          {selected ? (
            <p className="mt-1 truncate text-xs text-slate-500">Tiêu đề: {selected.subject}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="send-audience" className="mb-1 block text-sm font-medium text-vam-ink">
            Gửi cho
          </label>
          <select
            id="send-audience"
            value={audience}
            onChange={(event) => setAudienceChoice(event.target.value as BulkAudience)}
            className="w-full rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            {FIXED_BULK_AUDIENCES.map((key) => (
              <option key={key} value={key}>
                {BULK_AUDIENCE_LABELS[key]} — {(counts[key] ?? ZERO).sendable} người
              </option>
            ))}
            {eventOptions.length ? (
              <option value="event">{BULK_AUDIENCE_LABELS.event}…</option>
            ) : null}
          </select>
          {target.unreachable > 0 ? (
            <p className="mt-1 text-xs text-amber-800">
              {target.unreachable} người không nhận được: thiếu email hoặc thiếu họ tên.
            </p>
          ) : null}
        </div>
      </div>

      {audience === "event" && selectedEvent ? (
        <div className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3">
          <div>
            <label htmlFor="send-event" className="mb-1 block text-sm font-medium text-vam-ink">
              Sự kiện
            </label>
            <select
              id="send-event"
              value={selectedEvent.id}
              onChange={(event) => setEventChoice(event.target.value)}
              className="w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              {eventOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label} — {row.sendable} người
                </option>
              ))}
            </select>
          </div>
          {seriesAvailable ? (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={coversSeries}
                onChange={(event) => setCoversSeries(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
              />
              <span>
                <span className="block font-medium">Gồm cả các buổi khác trong chuỗi</span>
                <span className="block text-xs text-slate-500">
                  {selectedEvent.seriesSendable} người đã đăng ký một buổi bất kỳ của chuỗi. Người
                  đăng ký hai buổi chỉ nhận một lá.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      <form action={testAction} className="flex flex-wrap items-center gap-3 border-t border-vam-line pt-4">
        <input type="hidden" name="template_id" value={templateId} />
        <SubmitButton label="Gửi thử cho tôi" busyLabel="Đang gửi thử…" tone="quiet" />
        <p className="text-xs text-slate-500">
          Gửi một bản dùng dữ liệu mẫu tới hộp thư của chính bạn. Không ai khác nhận.
        </p>
      </form>
      <Result state={testState} />

      <form action={sendAction} className="flex flex-col gap-3 border-t border-vam-line pt-4">
        <input type="hidden" name="template_id" value={templateId} />
        <input type="hidden" name="audience" value={audience} />
        <input
          type="hidden"
          name="event_id"
          value={audience === "event" && selectedEvent ? selectedEvent.id : ""}
        />
        <input type="hidden" name="covers_series" value={useSeries ? "true" : "false"} />

        <p className="text-sm text-vam-ink">
          Sắp gửi <strong className="text-vam-green">{target.sendable}</strong> lá thư cho{" "}
          <strong>{audienceText}</strong>. Thư đã gửi không thu hồi được.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="confirm-count" className="mb-1 block text-xs font-medium text-vam-ink">
              Gõ lại số {target.sendable} để xác nhận
            </label>
            <input
              id="confirm-count"
              name="confirm_count"
              inputMode="numeric"
              autoComplete="off"
              className="w-40 rounded-md border border-vam-line px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-vam-green"
            />
          </div>
          <SubmitButton
            label="Bắt đầu gửi"
            busyLabel="Đang gửi…"
            disabled={target.sendable === 0}
          />
        </div>
      </form>
      <Result state={sendState} />

      {runningBatches.length ? (
        <div className="border-t border-vam-line pt-4">
          <h3 className="text-sm font-semibold text-vam-ink">Lô đang gửi dở</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {runningBatches.map((batch) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-vam-line px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-vam-ink">
                    {batch.note ?? "Lô gửi"}
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    Đã gửi {batch.sentCount}/{batch.requestedCount}
                    {batch.failedCount ? ` · lỗi ${batch.failedCount}` : ""}
                    {batch.skippedCount ? ` · bỏ qua ${batch.skippedCount}` : ""}
                  </span>
                </span>
                <form action={continueAction}>
                  <input type="hidden" name="batch_id" value={batch.id} />
                  <SubmitButton label="Gửi tiếp" busyLabel="Đang gửi…" tone="quiet" />
                </form>
              </li>
            ))}
          </ul>
          <Result state={continueState} />
        </div>
      ) : null}

      {batches.length ? (
        <div className="border-t border-vam-line pt-4">
          <h3 className="text-sm font-semibold text-vam-ink">Các lượt gửi gần đây</h3>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
            {batches.slice(0, 8).map((batch) => (
              <li key={batch.id} className="flex flex-wrap justify-between gap-2">
                <span className="truncate">{batch.note ?? "Lô gửi"}</span>
                <span className="tabular-nums">
                  {batch.createdAt} · {batch.sentCount}/{batch.requestedCount}
                  {batch.status === "completed" ? " · xong" : " · đang chạy"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
