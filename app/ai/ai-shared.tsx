"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Copy, FileText, Loader2, Printer, Sparkles } from "lucide-react";
import { DocBlocksView } from "@/components/doc-blocks-view";
import type { AiState } from "@/lib/ai-action-types";
import { AI_RESULT_NOTE } from "@/lib/ai/ai-core";
import { docToPlainText } from "@/lib/doc-blocks";

/** Ô nhập: chữ 16px trên điện thoại, nếu không iOS Safari tự phóng to trang khi chạm vào. */
export const aiInputClass =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm";

export const aiLabelClass = "text-sm font-medium text-vam-ink";

export function ToolCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft sm:p-5">
      <h2 className="text-base font-semibold text-vam-ink">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function RunButton({ hasResult }: { hasResult: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
      {pending ? "Đang xử lý… (có thể mất tới 1 phút)" : hasResult ? "Chạy lại" : "Chạy trợ lý"}
    </button>
  );
}

/**
 * React 19 (bản Next dùng cho App Router) tự reset form sau khi action chạy xong — kể
 * cả khi action trả lỗi — nên brief vừa gõ biến mất đúng lúc người dùng muốn sửa một
 * chữ rồi bấm chạy lại. Chặn sự kiện reset giữ nguyên mọi ô nhập.
 */
export function keepFormValues(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

const toolbarButton =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-vam-line bg-white px-2.5 py-1.5 text-xs font-medium text-vam-ink hover:bg-vam-mint";

/**
 * Kết quả của một công cụ: báo lỗi, file bị từ chối, và tài liệu kèm ba nút.
 *
 * Tải PDF in ĐÚNG khối kết quả này: trang /ai có nhiều công cụ cùng lúc nên không thể
 * in cả trang. Đánh dấu phần tử rồi để CSS `body.ai-printing` (app/globals.css) ẩn mọi
 * thứ còn lại; gỡ dấu ở `afterprint` — người dùng bấm Huỷ thì trang phải trở lại bình
 * thường.
 */
export function AiResult({ state }: { state: AiState }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const printRef = useRef<HTMLDivElement | null>(null);
  const doc = state.doc;

  const printDoc = () => {
    const element = printRef.current;
    if (!element) return;
    const cleanup = () => {
      element.classList.remove("ai-print-target");
      document.body.classList.remove("ai-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    element.classList.add("ai-print-target");
    document.body.classList.add("ai-printing");
    window.print();
  };

  const copyDoc = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(docToPlainText(doc));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {state.rejectedFiles?.length ? (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Không dùng được các file sau:</p>
            <ul className="mt-1 list-disc pl-5">
              {state.rejectedFiles.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      {doc ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Đọc lại trước khi gửi đi hoặc dùng để ra quyết định.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Form POST chứ không fetch + blob: trình duyệt tự tải theo
                  Content-Disposition. Mở tab mới để một lỗi (phiên hết hạn) không
                  làm trang này điều hướng đi và mất kết quả đang xem. */}
              <form action="/api/ai-doc/docx" method="POST" target="_blank">
                <input type="hidden" name="doc" value={JSON.stringify(doc)} />
                <button type="submit" className={toolbarButton}>
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Tải Word
                </button>
              </form>
              <button type="button" onClick={printDoc} className={toolbarButton}>
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Tải PDF
              </button>
              <button type="button" onClick={copyDoc} className={toolbarButton}>
                {copied === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied === "done" ? "Đã sao chép" : copied === "failed" ? "Không sao chép được" : "Sao chép"}
              </button>
            </div>
          </div>
          <div ref={printRef} className="mt-2 max-h-[70vh] overflow-y-auto rounded-md border border-vam-line bg-slate-50 p-4">
            <DocBlocksView doc={doc} />
            <p className="mt-4 border-t border-vam-line pt-2 text-xs italic text-slate-500">{AI_RESULT_NOTE}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
