"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import {
  approveEmailTemplateAction,
  draftEmailTemplateAction,
  ensureSeasonTemplatesAction,
  saveEmailTemplateAction
} from "@/app/actions/email-templates";
import {
  initialEmailTemplateActionState,
  type EmailTemplateActionState
} from "@/lib/email-template-action-types";
import {
  MAX_BODY_LENGTH,
  renderTemplate,
  sampleValues,
  TEMPLATE_SPECS,
  type TemplateKind
} from "@/lib/email-templates-core";
import type { EmailTemplateRow } from "@/lib/email-templates";

/**
 * Writing the four letters.
 *
 * The preview is the important part of this screen: it fills the placeholders
 * with sample values and shows the message as a recipient would read it, so an
 * organiser can see a forgotten `{{ten_mentee}}` before three hundred students
 * do.
 */

const STATUS_LABELS: Record<string, string> = {
  draft: "Bản nháp",
  approved: "Đã duyệt",
  archived: "Đã lưu trữ"
};

function statusBadge(status: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "approved") return `${base} bg-green-100 text-green-800`;
  if (status === "archived") return `${base} bg-slate-100 text-slate-600`;
  return `${base} bg-amber-100 text-amber-800`;
}

function Feedback({ state }: { state: EmailTemplateActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

function TemplateEditor({
  template,
  canOperate,
  canDraftWithAi,
  onDone
}: {
  template: EmailTemplateRow;
  canOperate: boolean;
  canDraftWithAi: boolean;
  onDone: () => void;
}) {
  const spec = TEMPLATE_SPECS[template.kind as TemplateKind];

  const [saveState, saveAction] = useFormState<EmailTemplateActionState, FormData>(
    saveEmailTemplateAction,
    initialEmailTemplateActionState
  );
  const [approveState, approveAction] = useFormState<EmailTemplateActionState, FormData>(
    approveEmailTemplateAction,
    initialEmailTemplateActionState
  );
  const [draftState, draftAction] = useFormState<EmailTemplateActionState, FormData>(
    draftEmailTemplateAction,
    initialEmailTemplateActionState
  );

  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body ?? "");

  const refreshedFor = useRef<string | null>(null);
  const successKey = [
    saveState.ok && saveState.message,
    approveState.ok && approveState.message,
    draftState.ok && draftState.message
  ]
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!successKey) return;
    if (refreshedFor.current === successKey) return;
    refreshedFor.current = successKey;
    onDone();
  }, [successKey, onDone]);

  const preview = useMemo(
    () =>
      renderTemplate({
        kind: template.kind as TemplateKind,
        subject,
        body,
        values: sampleValues(template.kind as TemplateKind)
      }),
    [template.kind, subject, body]
  );

  return (
    <div className="grid gap-3 border-t border-vam-line pt-4">
      <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-600">{spec?.purpose}</p>
        <p className="mt-2 text-xs text-slate-500">
          Các ô điền dùng được:{" "}
          {spec?.placeholders.map((placeholder) => (
            <code key={placeholder.key} className="mr-1 rounded bg-white px-1 text-[11px] text-vam-ink">
              {`{{${placeholder.key}}}`}
            </code>
          ))}
        </p>
      </div>

      {canDraftWithAi && template.status !== "approved" ? (
        <form action={draftAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="template_id" value={template.id} />
          <SubmitButton variant="outline" pendingText="Đang soạn nháp..." disabled={!canOperate}>
            AI soạn nháp
          </SubmitButton>
          <span className="text-xs text-slate-500">
            AI chỉ nhận mục đích thư và tên các ô điền — không nhận tên hay dữ liệu của bất kỳ ai.
          </span>
          <Feedback state={draftState} />
        </form>
      ) : null}

      <form action={saveAction} className="grid gap-3">
        <input type="hidden" name="template_id" value={template.id} />

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Tiêu đề thư
          <input
            type="text"
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={200}
            className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Nội dung thư
          <textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={14}
            maxLength={MAX_BODY_LENGTH}
            className="rounded-md border border-vam-line px-3 py-2 text-[13px] leading-6 text-vam-ink"
          />
          <span className="text-[11px] text-slate-400">
            {body.length.toLocaleString("vi-VN")}/{MAX_BODY_LENGTH.toLocaleString("vi-VN")} ký tự
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Đang lưu..." disabled={!canOperate}>
            Lưu bản nháp
          </SubmitButton>
          {template.status === "approved" ? (
            <span className="text-xs text-amber-700">
              Mẫu này đã duyệt — lưu thay đổi sẽ đưa về bản nháp và cần duyệt lại.
            </span>
          ) : null}
        </div>

        <Feedback state={saveState} />
      </form>

      <div className="rounded-md border border-vam-line bg-white p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Xem trước với dữ liệu mẫu
        </p>
        {preview.ok ? (
          <>
            <p className="text-sm font-semibold text-vam-ink">{preview.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{preview.body}</p>
          </>
        ) : (
          <p className="text-sm text-red-700">{preview.message}</p>
        )}
      </div>

      <form action={approveAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="template_id" value={template.id} />
        <SubmitButton
          pendingText="Đang duyệt..."
          disabled={!canOperate || template.status === "approved" || !template.body?.trim()}
        >
          {template.status === "approved" ? "Đã duyệt" : "Duyệt mẫu thư này"}
        </SubmitButton>
        <span className="text-xs text-slate-500">
          Duyệt xong mới dùng để gửi hàng loạt được.
        </span>
        <Feedback state={approveState} />
      </form>
    </div>
  );
}

export function TemplatesClient({
  seasonId,
  templates,
  canOperate,
  canDraftWithAi
}: {
  seasonId: string;
  templates: EmailTemplateRow[];
  canOperate: boolean;
  canDraftWithAi: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [openId, setOpenId] = useState<string | null>(null);

  const [ensureState, ensureAction] = useFormState<EmailTemplateActionState, FormData>(
    ensureSeasonTemplatesAction,
    initialEmailTemplateActionState
  );

  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ensureState.ok || !ensureState.message) return;
    if (refreshedFor.current === ensureState.message) return;
    refreshedFor.current = ensureState.message;
    refresh();
  }, [ensureState.ok, ensureState.message, refresh]);

  if (!templates.length) {
    return (
      <div className="grid gap-3 rounded-lg border border-dashed border-vam-line px-4 py-8 text-center">
        <p className="text-sm text-slate-600">
          Mùa này chưa có mẫu thư nào. Tạo 4 mẫu trống rồi soạn nội dung cho từng mẫu.
        </p>
        <form action={ensureAction} className="flex justify-center">
          <input type="hidden" name="season_id" value={seasonId} />
          <SubmitButton pendingText="Đang tạo..." disabled={!canOperate || !seasonId}>
            Tạo 4 mẫu thư trống
          </SubmitButton>
        </form>
        <Feedback state={ensureState} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {templates.length < 4 ? (
        <form action={ensureAction} className="flex items-center gap-3">
          <input type="hidden" name="season_id" value={seasonId} />
          <SubmitButton variant="outline" pendingText="Đang tạo..." disabled={!canOperate}>
            Tạo nốt mẫu thư còn thiếu
          </SubmitButton>
          <Feedback state={ensureState} />
        </form>
      ) : null}

      {templates.map((template) => {
        const spec = TEMPLATE_SPECS[template.kind as TemplateKind];
        const isOpen = openId === template.id;
        const isEmpty = !String(template.body ?? "").trim();
        return (
          <div key={template.id} className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-vam-ink">
                    {spec?.label ?? template.kind}
                  </h3>
                  <span className={statusBadge(template.status)}>
                    {STATUS_LABELS[template.status] ?? template.status}
                  </span>
                  {isEmpty ? (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Chưa có nội dung
                    </span>
                  ) : null}
                  {template.ai_generated ? (
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      Nháp do AI
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {template.subject || "(chưa có tiêu đề)"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : template.id)}
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-vam-mint"
              >
                {isOpen ? "Đóng" : "Soạn thư"}
              </button>
            </div>

            {isOpen ? (
              <TemplateEditor
                template={template}
                canOperate={canOperate}
                canDraftWithAi={canDraftWithAi}
                onDone={refresh}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
