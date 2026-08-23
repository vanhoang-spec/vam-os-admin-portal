"use client";

import { useState } from "react";
import { useFormState } from "react-dom";

import {
  approvePostAction,
  generateWeekPlanAction,
  markPostedAction,
  rewritePostAction,
  saveWeekPlanAction,
  skipPostAction,
  updatePostAction
} from "@/app/actions/mkt";
import {
  initialMktActionState,
  initialMktWeekActionState
} from "@/lib/mkt-action-types";
import { CHANNEL_LABELS, type MktChannel } from "@/lib/mkt-core";
import { Feedback, Field, inputClass, SubmitButton } from "./mkt-ui";

/**
 * The week grid.
 *
 * One card per slot, and each card says who it is waiting on rather than
 * showing a raw status code. That label and the button under it both come from
 * `nextStep` on the server, so the sentence and the action can never disagree.
 */

export type WeekPostView = {
  id: string;
  channel: MktChannel;
  postDate: string;
  slotTime: string | null;
  pillar: string | null;
  idea: string | null;
  content: string | null;
  hashtags: string[];
  cta: string | null;
  assetUrls: string[];
  status: string;
  stepLabel: string;
  waitingOn: string;
  scheduledAt: string | null;
  postedUrl: string | null;
  briefText: string | null;
};

const WAITING_TONE: Record<string, string> = {
  ai: "bg-slate-100 text-slate-700",
  designer: "bg-amber-50 text-amber-800",
  approver: "bg-[#eef5f1] text-vam-green",
  publisher: "bg-blue-50 text-blue-800",
  done: "bg-emerald-50 text-emerald-700"
};

export function WeekToolbar({
  spaceId,
  weekStart,
  topic,
  focus,
  contentNotes,
  aiReady,
  aiReason,
  aiModel
}: {
  spaceId: string;
  weekStart: string;
  topic: string | null;
  focus: string | null;
  contentNotes: string | null;
  aiReady: boolean;
  aiReason?: string;
  aiModel?: string;
}) {
  const [genState, genAction] = useFormState(generateWeekPlanAction, initialMktWeekActionState);
  const [saveState, saveAction] = useFormState(saveWeekPlanAction, initialMktActionState);

  return (
    <section className="space-y-4 rounded-lg border border-vam-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-vam-ink">Định hướng tuần</h2>
          <p className="mt-1 max-w-2xl text-sm text-vam-muted">
            Nạp vào mọi lần AI viết bài trong tuần này. Bỏ trống thì mỗi bài sẽ đi một chủ đề
            riêng.
          </p>
        </div>

        {/* Whoever reads a post should be able to see where it came from. */}
        <span className="text-xs text-vam-muted">
          {aiReady ? `AI: DeepSeek ${aiModel ?? ""}`.trim() : `AI chưa bật — ${aiReason ?? ""}`}
        </span>
      </div>

      <form action={saveAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="space_id" value={spaceId} />
        <input type="hidden" name="week_start" value={weekStart} />

        <Field label="Chủ đề tuần">
          <input name="topic" defaultValue={topic ?? ""} maxLength={500} className={inputClass} />
        </Field>
        <Field label="Trọng tâm">
          <input name="focus" defaultValue={focus ?? ""} maxLength={500} className={inputClass} />
        </Field>
        <Field label="Định hướng nội dung">
          <input
            name="content_notes"
            defaultValue={contentNotes ?? ""}
            maxLength={4000}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-3 space-y-3">
          <Feedback state={saveState} />
          <SubmitButton label="Lưu định hướng" pendingLabel="Đang lưu…" tone="quiet" />
        </div>
      </form>

      <form action={genAction} className="space-y-3 border-t border-vam-line pt-4">
        <input type="hidden" name="space_id" value={spaceId} />
        <input type="hidden" name="week_start" value={weekStart} />

        <Feedback state={genState} />

        {genState.unplacedOrders && genState.unplacedOrders.length > 0 ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Chưa xếp được {genState.unplacedOrders.length} đề nghị vào tuần này. Xem tab Đề nghị để
            xử lý tay hoặc dời sang tuần sau.
          </p>
        ) : null}

        <SubmitButton
          label="Sinh plan tuần bằng AI"
          pendingLabel="Đang lập plan…"
          confirm="Sinh lại plan tuần? Bài đã duyệt hoặc đã có hình sẽ được giữ nguyên."
        />
      </form>
    </section>
  );
}

export function PostCard({ spaceId, post }: { spaceId: string; post: WeekPostView }) {
  const [open, setOpen] = useState(false);
  const [saveState, saveAction] = useFormState(updatePostAction, initialMktActionState);
  const [aiState, aiAction] = useFormState(rewritePostAction, initialMktActionState);
  const [approveState, approveAction] = useFormState(approvePostAction, initialMktActionState);
  const [postedState, postedAction] = useFormState(markPostedAction, initialMktActionState);
  const [skipState, skipAction] = useFormState(skipPostAction, initialMktActionState);

  const tone = WAITING_TONE[post.waitingOn] ?? "bg-slate-100 text-slate-700";

  return (
    <article className="rounded-lg border border-vam-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold text-vam-ink">
            {CHANNEL_LABELS[post.channel] ?? post.channel}
          </span>
          <span className="ml-2 text-sm text-vam-muted">
            {post.postDate}
            {post.slotTime ? ` · ${post.slotTime}` : ""}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
          {post.stepLabel}
        </span>
      </div>

      {post.pillar ? <p className="mt-2 text-xs text-vam-muted">Trụ cột: {post.pillar}</p> : null}
      {post.idea ? <p className="mt-1 text-sm text-vam-ink">{post.idea}</p> : null}

      {post.content ? (
        <p className="mt-2 whitespace-pre-line text-sm text-vam-muted line-clamp-6">
          {post.content}
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-vam-muted">Chưa có nội dung.</p>
      )}

      {post.hashtags.length ? (
        <p className="mt-2 text-xs text-vam-green">{post.hashtags.join(" ")}</p>
      ) : null}

      {post.briefText ? (
        <p className="mt-2 rounded-md bg-[#f7faf8] px-3 py-2 text-xs text-vam-muted">
          Brief thiết kế: {post.briefText}
        </p>
      ) : null}

      {post.assetUrls.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {post.assetUrls.map((url) => (
            <li key={url}>
              <a href={url} className="text-vam-green hover:underline" rel="noreferrer noopener" target="_blank">
                {url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {post.postedUrl ? (
        <p className="mt-2 text-xs">
          <a href={post.postedUrl} className="text-vam-green hover:underline" rel="noreferrer noopener" target="_blank">
            Xem bài đã đăng
          </a>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {post.waitingOn === "approver" ? (
          <form action={approveAction}>
            <input type="hidden" name="space_id" value={spaceId} />
            <input type="hidden" name="post_id" value={post.id} />
            <SubmitButton label="Duyệt" pendingLabel="Đang duyệt…" />
          </form>
        ) : null}

        {post.waitingOn === "publisher" ? (
          <form action={postedAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="space_id" value={spaceId} />
            <input type="hidden" name="post_id" value={post.id} />
            <input
              name="posted_url"
              type="url"
              required
              placeholder="Dán link bài đã đăng"
              className="w-56 rounded-md border border-vam-line px-3 py-2 text-sm"
            />
            <SubmitButton label="Đã đăng" pendingLabel="Đang ghi nhận…" />
          </form>
        ) : null}

        {post.status !== "posted" ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-ink"
          >
            {open ? "Đóng" : "Sửa"}
          </button>
        ) : null}
      </div>

      <Feedback state={approveState} />
      <Feedback state={postedState} />

      {open ? (
        <div className="mt-4 space-y-4 border-t border-vam-line pt-4">
          <form action={aiAction} className="space-y-2">
            <input type="hidden" name="space_id" value={spaceId} />
            <input type="hidden" name="post_id" value={post.id} />
            <Field
              label="Nhờ AI viết lại"
              hint="Bản viết lại luôn được nạp định hướng tháng và tuần, nên nó không đi lạc chủ đề."
            >
              <input
                name="instruction"
                placeholder="Ví dụ: ngắn hơn, mở bài bằng một câu hỏi"
                maxLength={1000}
                className={inputClass}
              />
            </Field>
            <Feedback state={aiState} />
            <SubmitButton label="Viết lại" pendingLabel="Đang viết…" tone="quiet" />
          </form>

          <form action={saveAction} className="space-y-3">
            <input type="hidden" name="space_id" value={spaceId} />
            <input type="hidden" name="post_id" value={post.id} />

            <Field label="Ý tưởng">
              <input name="idea" defaultValue={post.idea ?? ""} maxLength={1000} className={inputClass} />
            </Field>
            <Field label="Trụ cột">
              <input name="pillar" defaultValue={post.pillar ?? ""} maxLength={200} className={inputClass} />
            </Field>
            <Field label="Nội dung bài">
              <textarea
                name="content"
                rows={10}
                defaultValue={post.content ?? ""}
                maxLength={8000}
                className={inputClass}
              />
            </Field>
            <Field label="Hashtag" hint="Cách nhau bằng dấu cách.">
              <input name="hashtags" defaultValue={post.hashtags.join(" ")} className={inputClass} />
            </Field>
            <Field label="Kêu gọi hành động">
              <input name="cta" defaultValue={post.cta ?? ""} maxLength={300} className={inputClass} />
            </Field>
            <Field
              label="Link hình / video"
              hint="Mỗi link một dòng. Dán link Canva hoặc Drive — hệ thống không lưu file."
            >
              <textarea
                name="asset_urls"
                rows={3}
                defaultValue={post.assetUrls.join("\n")}
                className={inputClass}
              />
            </Field>

            <Feedback state={saveState} />
            <SubmitButton label="Lưu bài" pendingLabel="Đang lưu…" />
          </form>

          <form action={skipAction} className="space-y-2 border-t border-vam-line pt-4">
            <input type="hidden" name="space_id" value={spaceId} />
            <input type="hidden" name="post_id" value={post.id} />
            <Field label="Bỏ qua slot này" hint="Ghi lý do để tuần sau còn biết vì sao.">
              <input name="reason" required maxLength={500} className={inputClass} />
            </Field>
            <Feedback state={skipState} />
            <SubmitButton label="Bỏ qua" pendingLabel="Đang bỏ qua…" tone="danger" />
          </form>
        </div>
      ) : null}
    </article>
  );
}
