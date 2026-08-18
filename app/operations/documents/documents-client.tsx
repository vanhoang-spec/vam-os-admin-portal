"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import {
  ensureSeasonDocumentsAction,
  saveProgramDocumentAction,
  setDocumentStatusAction
} from "@/app/actions/program-documents";
import {
  initialProgramDocumentActionState,
  type ProgramDocumentActionState
} from "@/lib/program-documents-action-types";
import {
  AUDIENCE_LABELS,
  KIND_LABELS,
  MAX_BODY_LENGTH,
  renderDocumentHtml,
  type DocumentAudience,
  type DocumentKind
} from "@/lib/program-documents-core";
import type { ProgramDocumentRow } from "@/lib/program-documents";

/**
 * Writing the four documents.
 *
 * One editor open at a time, with a live preview of exactly what the public
 * page will render — including the fact that typed HTML stays visible as text
 * rather than becoming markup.
 */

const STATUS_LABELS: Record<string, string> = {
  draft: "Bản nháp",
  published: "Đã phát hành",
  archived: "Đã lưu trữ"
};

function statusBadge(status: string) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "published") return `${base} bg-green-100 text-green-800`;
  if (status === "archived") return `${base} bg-slate-100 text-slate-600`;
  return `${base} bg-amber-100 text-amber-800`;
}

function Feedback({ state }: { state: ProgramDocumentActionState }) {
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

function DocumentEditor({
  document,
  baseUrl,
  canOperate,
  onDone
}: {
  document: ProgramDocumentRow;
  baseUrl: string;
  canOperate: boolean;
  onDone: () => void;
}) {
  const [saveState, saveAction] = useFormState<ProgramDocumentActionState, FormData>(
    saveProgramDocumentAction,
    initialProgramDocumentActionState
  );
  const [statusState, statusAction] = useFormState<ProgramDocumentActionState, FormData>(
    setDocumentStatusAction,
    initialProgramDocumentActionState
  );

  const [body, setBody] = useState(document.body ?? "");
  const [showPreview, setShowPreview] = useState(false);

  const refreshedFor = useRef<string | null>(null);
  const successKey = [saveState.ok && saveState.message, statusState.ok && statusState.message]
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!successKey) return;
    if (refreshedFor.current === successKey) return;
    refreshedFor.current = successKey;
    onDone();
  }, [successKey, onDone]);

  const publicUrl = baseUrl ? `${baseUrl}/documents/${document.slug}` : `/documents/${document.slug}`;
  const isEmpty = !body.trim();

  return (
    <div className="grid gap-3 border-t border-vam-line pt-4">
      <form action={saveAction} className="grid gap-3">
        <input type="hidden" name="document_id" value={document.id} />
        <input type="hidden" name="slug" value={document.slug} />

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Tiêu đề
          <input
            type="text"
            name="title"
            defaultValue={document.title}
            maxLength={160}
            className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Nội dung
          <textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={16}
            maxLength={MAX_BODY_LENGTH}
            placeholder={"# Tiêu đề mục\n\nĐoạn văn bình thường.\n\n- Gạch đầu dòng\n- Gạch đầu dòng\n\n**In đậm**, *in nghiêng*, [đường dẫn](https://vam.edu.vn)"}
            className="rounded-md border border-vam-line px-3 py-2 font-mono text-[13px] leading-6 text-vam-ink"
          />
          <span className="text-[11px] text-slate-400">
            Dán thẳng nội dung từ Word hoặc Google Docs. Dùng # cho tiêu đề mục, gạch đầu dòng bằng -,
            **in đậm**. {body.length.toLocaleString("vi-VN")}/{MAX_BODY_LENGTH.toLocaleString("vi-VN")} ký tự.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Đang lưu..." disabled={!canOperate}>
            Lưu nội dung
          </SubmitButton>
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            className="rounded-md border border-vam-line px-3 py-1.5 text-sm text-slate-600 hover:bg-vam-mint"
          >
            {showPreview ? "Ẩn xem trước" : "Xem trước"}
          </button>
          <span className="text-xs text-slate-500">Phiên bản {document.version}</span>
        </div>

        <Feedback state={saveState} />
      </form>

      {showPreview ? (
        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Người đọc sẽ thấy
          </p>
          {isEmpty ? (
            <p className="text-sm text-slate-500">Chưa có nội dung.</p>
          ) : (
            <article
              className="vam-document text-sm leading-6 text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderDocumentHtml(body) }}
            />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <form action={statusAction} className="flex items-center gap-2">
          <input type="hidden" name="document_id" value={document.id} />
          <input type="hidden" name="slug" value={document.slug} />
          <input
            type="hidden"
            name="status"
            value={document.status === "published" ? "draft" : "published"}
          />
          <SubmitButton
            variant={document.status === "published" ? "outline" : "primary"}
            pendingText="Đang xử lý..."
            disabled={!canOperate || (document.status !== "published" && !document.body?.trim())}
          >
            {document.status === "published" ? "Ngừng phát hành" : "Phát hành"}
          </SubmitButton>
        </form>

        {document.status === "published" ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-vam-green hover:underline"
          >
            Mở trang công khai →
          </a>
        ) : (
          <span className="text-xs text-slate-500">
            Đường dẫn sau khi phát hành: <code className="text-slate-600">{publicUrl}</code>
          </span>
        )}

        <Feedback state={statusState} />
      </div>
    </div>
  );
}

export function DocumentsClient({
  seasonId,
  documents,
  baseUrl,
  canOperate
}: {
  seasonId: string;
  documents: ProgramDocumentRow[];
  baseUrl: string;
  canOperate: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [openId, setOpenId] = useState<string | null>(null);

  const [ensureState, ensureAction] = useFormState<ProgramDocumentActionState, FormData>(
    ensureSeasonDocumentsAction,
    initialProgramDocumentActionState
  );

  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ensureState.ok || !ensureState.message) return;
    if (refreshedFor.current === ensureState.message) return;
    refreshedFor.current = ensureState.message;
    refresh();
  }, [ensureState.ok, ensureState.message, refresh]);

  if (!documents.length) {
    return (
      <div className="grid gap-3 rounded-lg border border-dashed border-vam-line px-4 py-8 text-center">
        <p className="text-sm text-slate-600">
          Mùa này chưa có tài liệu nào. Tạo 4 tài liệu trống (quy tắc ứng xử và cẩm nang, cho mentee và
          mentor) rồi dán nội dung vào.
        </p>
        <form action={ensureAction} className="flex justify-center">
          <input type="hidden" name="season_id" value={seasonId} />
          <SubmitButton pendingText="Đang tạo..." disabled={!canOperate || !seasonId}>
            Tạo 4 tài liệu trống
          </SubmitButton>
        </form>
        <Feedback state={ensureState} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {documents.length < 4 ? (
        <form action={ensureAction} className="flex items-center gap-3">
          <input type="hidden" name="season_id" value={seasonId} />
          <SubmitButton variant="outline" pendingText="Đang tạo..." disabled={!canOperate}>
            Tạo nốt tài liệu còn thiếu
          </SubmitButton>
          <Feedback state={ensureState} />
        </form>
      ) : null}

      {documents.map((document) => {
        const isOpen = openId === document.id;
        const isEmpty = !String(document.body ?? "").trim();
        return (
          <div key={document.id} className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-vam-ink">{document.title}</h3>
                  <span className={statusBadge(document.status)}>
                    {STATUS_LABELS[document.status] ?? document.status}
                  </span>
                  {isEmpty ? (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Chưa có nội dung
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {KIND_LABELS[document.kind as DocumentKind] ?? document.kind} ·{" "}
                  {AUDIENCE_LABELS[document.audience as DocumentAudience] ?? document.audience} ·{" "}
                  <code>{document.slug}</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : document.id)}
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-vam-mint"
              >
                {isOpen ? "Đóng" : "Soạn nội dung"}
              </button>
            </div>

            {isOpen ? (
              <DocumentEditor
                document={document}
                baseUrl={baseUrl}
                canOperate={canOperate}
                onDone={refresh}
              />
            ) : null}
          </div>
        );
      })}

      <style>{`
        .vam-document h2 { font-size: 1.1rem; font-weight: 600; color: #14352a; margin: 1.2rem 0 .5rem; }
        .vam-document h3 { font-size: 1rem; font-weight: 600; color: #14352a; margin: 1rem 0 .4rem; }
        .vam-document h4 { font-size: .95rem; font-weight: 600; color: #14352a; margin: .9rem 0 .3rem; }
        .vam-document p { margin: 0 0 .7rem; }
        .vam-document ul, .vam-document ol { margin: 0 0 .8rem; padding-left: 1.3rem; }
        .vam-document li { margin-bottom: .3rem; }
        .vam-document ul { list-style: disc; }
        .vam-document ol { list-style: decimal; }
        .vam-document a { color: #16834c; text-decoration: underline; }
        .vam-document strong { font-weight: 600; color: #14352a; }
      `}</style>
    </div>
  );
}
