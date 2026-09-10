"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  TEMPLATE_KINDS,
  TEMPLATE_SPECS,
  TEMPLATE_STATUS_LABELS,
  type TemplateKind
} from "@/lib/email-templates-core";
import { TemplateEditor, type EditableTemplate } from "./template-editor";

export type MailTemplateSummary = EditableTemplate & {
  updatedAt: string;
  approverName: string | null;
};

function StatusBadge({ status }: { status: EditableTemplate["status"] }) {
  const tone =
    status === "approved"
      ? "border-vam-green/40 bg-vam-mint text-vam-ink"
      : status === "draft"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {TEMPLATE_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Danh sách mẫu thư và trình soạn, cạnh nhau.
 *
 * Chọn một mẫu để sửa, hoặc bấm "Soạn thư mới". Trình soạn được `key` theo id
 * mẫu thư đang mở: đổi mẫu là dựng lại component, nên nội dung của mẫu trước
 * không dính lại trong ô của mẫu sau.
 */
export function MailClient({
  templates,
  canApprove,
  seasonCode
}: {
  templates: MailTemplateSummary[];
  canApprove: boolean;
  seasonCode: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [composingKind, setComposingKind] = useState<TemplateKind | null>(null);

  const open = templates.find((row) => row.id === openId) ?? null;

  // Lưu xong thì đọc lại danh sách từ máy chủ. `router.refresh` giữ nguyên chỗ
  // đang đứng, khác với việc điều hướng lại — người soạn không bị hất về đầu
  // trang sau mỗi lần lưu.
  const handleDone = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-vam-line bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-vam-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-vam-ink">Mẫu thư của {seasonCode}</h2>
            <p className="text-xs text-slate-500">
              Mẫu thư phải được quản trị viên duyệt trước khi dùng cho một lượt gửi hàng loạt.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setOpenId(null);
                  setComposingKind(kind);
                }}
                className="rounded-md border border-vam-green bg-white px-3 py-1.5 text-sm font-medium text-vam-green transition-colors hover:bg-vam-mint"
              >
                Soạn {TEMPLATE_SPECS[kind].label.toLowerCase()}
              </button>
            ))}
          </div>
        </header>

        {templates.length ? (
          <ul className="divide-y divide-vam-line">
            {templates.map((row) => {
              const isOpen = row.id === openId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setComposingKind(null);
                      setOpenId(isOpen ? null : row.id);
                    }}
                    className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                      isOpen ? "bg-vam-mint/40" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-vam-ink">{row.name}</span>
                        <StatusBadge status={row.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {TEMPLATE_SPECS[row.kind].label} · {row.subject}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {row.status === "approved" && row.approverName
                        ? `Duyệt bởi ${row.approverName}`
                        : `Sửa lần cuối ${row.updatedAt}`}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="border-t border-vam-line bg-slate-50/60 px-4 py-5">
                      <TemplateEditor
                        key={row.id}
                        kind={row.kind}
                        template={row}
                        canApprove={canApprove}
                        onDone={handleDone}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-slate-500">
            Chưa có mẫu thư nào cho mùa này. Bấm &ldquo;Soạn thông báo chung&rdquo; để bắt đầu.
          </p>
        )}
      </section>

      {composingKind && !open ? (
        <section className="rounded-md border border-vam-line bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-vam-ink">
              Thư mới — {TEMPLATE_SPECS[composingKind].label}
            </h2>
            <button
              type="button"
              onClick={() => setComposingKind(null)}
              className="text-sm text-slate-500 hover:text-vam-ink hover:underline"
            >
              Huỷ
            </button>
          </div>
          <TemplateEditor
            key={`new-${composingKind}`}
            kind={composingKind}
            template={null}
            canApprove={canApprove}
            onDone={handleDone}
          />
        </section>
      ) : null}
    </div>
  );
}
