"use client";

import { useFormState } from "react-dom";

import {
  approveMasterPlanAction,
  createOrderAction,
  declineOrderAction,
  generateMasterPlanAction,
  saveMasterPlanAction
} from "@/app/actions/mkt";
import { initialMktActionState } from "@/lib/mkt-action-types";
import { CHANNEL_LABELS, type MktChannel } from "@/lib/mkt-core";
import { Feedback, Field, inputClass, SubmitButton } from "./mkt-ui";

/**
 * The month, and the requests waiting to be planned into it.
 *
 * These two live on one screen because they are read together: somebody
 * deciding what September is about wants to see what people have already asked
 * for in September.
 */

export function MasterPlanPanel({
  spaceId,
  month,
  planId,
  theme,
  goals,
  weeklyFocus,
  contentNotes,
  notes,
  status,
  aiModel
}: {
  spaceId: string;
  month: string;
  planId: string | null;
  theme: string | null;
  goals: string[];
  weeklyFocus: Array<{ week_start?: string; focus?: string; topic?: string; note?: string }>;
  contentNotes: string | null;
  notes: string | null;
  status: string;
  aiModel: string | null;
}) {
  const [genState, genAction] = useFormState(generateMasterPlanAction, initialMktActionState);
  const [saveState, saveAction] = useFormState(saveMasterPlanAction, initialMktActionState);
  const [approveState, approveAction] = useFormState(approveMasterPlanAction, initialMktActionState);

  return (
    <section className="space-y-4 rounded-lg border border-vam-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-vam-ink">Master plan tháng {month}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
          }`}
        >
          {status === "approved" ? "Đã duyệt" : "Bản nháp"}
        </span>
      </div>

      <form action={genAction} className="space-y-2">
        <input type="hidden" name="space_id" value={spaceId} />
        <input type="hidden" name="month" value={month} />
        <Feedback state={genState} />
        <SubmitButton
          label="Sinh master plan bằng AI"
          pendingLabel="Đang lập plan…"
          tone="quiet"
          confirm="Sinh lại master plan tháng này? Bản nháp hiện tại sẽ bị thay."
        />
        {aiModel ? (
          <p className="text-xs text-vam-muted">Bản nháp gần nhất do {aiModel} viết.</p>
        ) : null}
      </form>

      <form action={saveAction} className="space-y-3 border-t border-vam-line pt-4">
        <input type="hidden" name="space_id" value={spaceId} />
        <input type="hidden" name="month" value={month} />

        <Field label="Chủ đề tháng" hint="Cũng chính là topic tháng, nạp vào mọi prompt.">
          <input name="theme" defaultValue={theme ?? ""} maxLength={500} className={inputClass} />
        </Field>

        <Field label="Định hướng nội dung cả tháng">
          <textarea
            name="content_notes"
            rows={4}
            defaultValue={contentNotes ?? ""}
            maxLength={4000}
            className={inputClass}
          />
        </Field>

        <Field label="Ghi chú">
          <textarea name="notes" rows={2} defaultValue={notes ?? ""} className={inputClass} />
        </Field>

        <Feedback state={saveState} />
        <SubmitButton label="Lưu master plan" pendingLabel="Đang lưu…" />
      </form>

      {goals.length ? (
        <div className="border-t border-vam-line pt-4">
          <h3 className="text-sm font-medium text-vam-ink">Mục tiêu tháng</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-vam-muted">
            {goals.map((goal, index) => (
              <li key={index}>{goal}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {weeklyFocus.length ? (
        <div className="border-t border-vam-line pt-4">
          <h3 className="text-sm font-medium text-vam-ink">Trọng tâm từng tuần</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {weeklyFocus.map((week, index) => (
              <li key={index} className="rounded-md bg-[#f7faf8] px-3 py-2">
                <span className="font-medium text-vam-ink">{week.week_start ?? `Tuần ${index + 1}`}</span>
                {week.topic ? <span className="ml-2 text-vam-ink">{week.topic}</span> : null}
                {week.focus ? <p className="text-vam-muted">{week.focus}</p> : null}
                {week.note ? <p className="text-vam-muted">{week.note}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {planId && status !== "approved" ? (
        <form action={approveAction} className="space-y-2 border-t border-vam-line pt-4">
          <input type="hidden" name="space_id" value={spaceId} />
          <input type="hidden" name="plan_id" value={planId} />
          <Feedback state={approveState} />
          <SubmitButton label="Duyệt master plan" pendingLabel="Đang duyệt…" />
        </form>
      ) : null}
    </section>
  );
}

export type OrderView = {
  id: string;
  title: string;
  purpose: string | null;
  body: string;
  wantedChannels: string[];
  neededBy: string | null;
  isUrgent: boolean;
  contentPriority: string;
  status: string;
  declineReason: string | null;
};

const PRIORITY_LABEL: Record<string, string> = {
  high: "Ưu tiên cao",
  priority: "Ưu tiên",
  normal: "Thường"
};

const STATUS_LABEL: Record<string, string> = {
  new: "Chờ xếp",
  planned: "Đã vào plan",
  done: "Đã đăng",
  declined: "Đã từ chối"
};

export function OrdersPanel({
  spaceId,
  orders,
  channels
}: {
  spaceId: string;
  orders: OrderView[];
  channels: MktChannel[];
}) {
  const [createState, createAction] = useFormState(createOrderAction, initialMktActionState);
  const [declineState, declineAction] = useFormState(declineOrderAction, initialMktActionState);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-vam-ink">Đề nghị đăng bài</h2>
        <p className="mt-1 max-w-2xl text-sm text-vam-muted">
          Ai cần thông báo gì thì gửi ở đây. Lần lập plan tuần tới, hệ thống đưa hết vào và báo lại
          từng đề nghị được xử lý thế nào — không đề nghị nào bị bỏ im lặng.
        </p>
      </div>

      {orders.length ? (
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id} className="rounded-lg border border-vam-line bg-white p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-vam-ink">{order.title}</span>
                <span className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-[#eef5f1] px-2 py-0.5 text-vam-green">
                    {PRIORITY_LABEL[order.contentPriority] ?? order.contentPriority}
                  </span>
                  {order.isUrgent ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                      gấp tiến độ
                    </span>
                  ) : null}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </span>
              </div>

              <p className="mt-2 whitespace-pre-line text-vam-muted">{order.body}</p>

              {order.neededBy ? (
                <p className="mt-1 text-xs text-vam-muted">Cần lên trước {order.neededBy}</p>
              ) : null}

              {order.declineReason ? (
                <p className="mt-2 rounded-md bg-[#fdf6ec] px-3 py-2 text-vam-ink">
                  Từ chối: {order.declineReason}
                </p>
              ) : null}

              {order.status === "new" ? (
                <form action={declineAction} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="space_id" value={spaceId} />
                  <input type="hidden" name="order_id" value={order.id} />
                  <input
                    name="reason"
                    required
                    placeholder="Lý do từ chối"
                    maxLength={1000}
                    className="w-64 rounded-md border border-vam-line px-3 py-2 text-sm"
                  />
                  <SubmitButton label="Từ chối" pendingLabel="Đang lưu…" tone="danger" />
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-muted">
          Chưa có đề nghị nào.
        </p>
      )}

      <Feedback state={declineState} />

      <form action={createAction} className="space-y-3 rounded-lg border border-vam-line bg-white p-4">
        <input type="hidden" name="space_id" value={spaceId} />

        <Field label="Tiêu đề">
          <input name="title" required minLength={3} maxLength={300} className={inputClass} />
        </Field>

        <Field label="Mục đích">
          <input name="purpose" maxLength={1000} className={inputClass} />
        </Field>

        <Field label="Nội dung cần đăng" hint="Ghi chi tiết thật: ngày, địa điểm, quyền lợi, hạn.">
          <textarea name="body" required rows={4} minLength={10} maxLength={4000} className={inputClass} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Cần lên trước ngày">
            <input name="needed_by" type="date" className={inputClass} />
          </Field>

          <Field label="Mức ưu tiên nội dung">
            <select name="content_priority" defaultValue="normal" className={inputClass}>
              <option value="normal">Thường</option>
              <option value="priority">Ưu tiên</option>
              <option value="high">Ưu tiên cao</option>
            </select>
          </Field>

          <Field label="Gấp về tiến độ">
            <label className="flex items-center gap-2 text-sm text-vam-ink">
              <input type="checkbox" name="is_urgent" value="true" />
              <span>Có</span>
            </label>
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-vam-ink">Kênh mong muốn</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {channels.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm text-vam-ink">
                <input type="checkbox" name="wanted_channels" value={channel} />
                <span>{CHANNEL_LABELS[channel] ?? channel}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Feedback state={createState} />
        <SubmitButton label="Gửi đề nghị" pendingLabel="Đang gửi…" />
      </form>
    </section>
  );
}
