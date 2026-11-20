"use client";

import { useEffect, useRef, useState } from "react";

/** Câu báo cuối giữ tối đa bấy nhiêu dòng lỗi của cả lượt (mọi vòng), phần dư gộp một dòng. */
const PROBLEMS_KEPT = 50;
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AUTO_CONTINUE_END_WORDS,
  autoContinueStep,
  type AutoContinueStep
} from "@/lib/bulk-mail-core";
import { initialBulkMailActionState, type BulkMailActionState } from "@/lib/bulk-mail-action-types";
import { continueBulkSendAction } from "@/app/actions/bulk-mail";

function GuiTiepButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-semibold text-vam-ink transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang gửi…" : "Gửi tiếp"}
    </button>
  );
}

/**
 * Hai nút của một lô đang gửi dở: "Gửi tiếp" (một lần chạy) và "Gửi tiếp tới hết" (tự bấm lại).
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TỰ BẤM Ở TRÌNH DUYỆT, KHÔNG CHẠY NỀN TRÊN MÁY CHỦ
 * ---------------------------------------------------------------------------
 * Mỗi lần chạy vẫn là đúng một lệnh "Gửi tiếp" như bấm tay: cùng cổng quyền, cùng ngân sách thời
 * gian, cùng sổ thư để không ai nhận hai lá. Nút này chỉ bấm lại hộ, NỐI TIẾP — lần sau chỉ bắt đầu
 * khi lần trước đã trả lời — nên không bao giờ có hai lần chạy chồng lên nhau trên cùng một lô từ
 * tab này. Vì thế nút "Gửi tiếp" thường bị khoá trong lúc đang tự chạy. Đóng tab là dừng; phần còn
 * lại vẫn nằm trong lô.
 *
 * Khi nào dừng: xem `autoContinueStep` — chỉ đi tiếp khi lần vừa rồi chắc chắn tiến được. Component
 * bị gỡ (đổi trang trong app, hoặc lô xong và rời danh sách "đang gửi dở") cũng là lệnh dừng: không
 * có vòng nào chạy ngầm mà không còn nút Dừng.
 *
 * Mỗi vòng gửi `tu_dong=1` để máy chủ không vẽ lại trang sau từng lần chạy (phần vẽ lại ăn vào
 * thời gian của lần gửi); vòng tự làm mới trang MỘT lần khi dừng. Câu báo cuối đi lên `onEnd` vì
 * lô xong thì chính component này rời màn hình.
 */
export function GuiTiepControls({
  batchId,
  continueAction,
  onEnd
}: {
  batchId: string;
  continueAction: (formData: FormData) => void;
  /** Câu báo khi lượt tự gửi dừng — panel cha giữ nó lại sau khi lô rời danh sách. */
  onEnd?: (state: BulkMailActionState) => void;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [processedTotal, setProcessedTotal] = useState(0);
  const [last, setLast] = useState<BulkMailActionState | null>(null);
  const stopRequested = useRef(false);
  const busy = useRef(false);

  // Gỡ khỏi màn hình = dừng sau lần chạy đang dở.
  useEffect(
    () => () => {
      stopRequested.current = true;
    },
    []
  );

  // Đóng tab / tải lại trong lúc tự chạy: trình duyệt hỏi lại. Phần còn lại vẫn nằm trong lô.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function runToEnd() {
    // Chặn bấm đúp trước cả khi React kịp vẽ lại nút: hai vòng lặp song song là hai lần chạy chồng nhau.
    if (busy.current) return;
    busy.current = true;
    stopRequested.current = false;
    setRunning(true);
    setLast(null);
    // Xoá câu báo của lượt trước: đang chạy lượt mới mà vẫn hiện "Lô đã gửi xong" của lượt cũ là sai.
    onEnd?.(initialBulkMailActionState);
    setProcessedTotal(0);

    let total = 0;
    // Lỗi của MỌI vòng, không chỉ vòng cuối: vòng giữa có người lỗi mà vòng cuối sạch thì câu báo
    // cuối vẫn phải kể họ ra (bấm tay từng lần thì mỗi lần đều hiện).
    const problems: string[] = [];
    let moreProblems = 0;
    let endState: BulkMailActionState | null = null;
    let endStep: Exclude<AutoContinueStep, "continue"> = "error";
    try {
      for (let round = 0; ; round += 1) {
        const formData = new FormData();
        formData.set("batch_id", batchId);
        formData.set("tu_dong", "1");
        const result = await continueBulkSendAction(initialBulkMailActionState, formData);
        total += result.processed ?? 0;
        for (const problem of result.problems ?? []) {
          // Người lỗi điền ô quay lại ở mỗi vòng: kể một lần là đủ.
          if (problems.includes(problem)) continue;
          if (problems.length < PROBLEMS_KEPT) problems.push(problem);
          else moreProblems += 1;
        }
        setProcessedTotal(total);
        setLast(result);

        const step = autoContinueStep({
          ok: result.ok,
          remaining: result.remaining,
          processed: result.processed,
          rateLimited: result.rateLimited,
          providerTrouble: result.providerTrouble,
          configBlocked: result.configBlocked,
          stopRequested: stopRequested.current,
          round
        });
        if (step !== "continue") {
          endStep = step;
          endState = result;
          break;
        }
      }
    } catch (error) {
      console.error("[GuiTiepControls]", error);
      endStep = "error";
      endState = { ...initialBulkMailActionState, message: "Mất kết nối với máy chủ. Phần còn lại vẫn nằm trong lô." };
    } finally {
      busy.current = false;
      setRunning(false);
      onEnd?.({
        ok: endStep === "done",
        message: `${AUTO_CONTINUE_END_WORDS[endStep]} Lượt tự gửi đã xử lý ${total} thư.${
          endState?.message ? ` ${endState.message}` : ""
        }`,
        batchId,
        problems: moreProblems ? [...problems, `… và ${moreProblems} dòng khác (xem Nhật ký gửi)`] : problems
      });
      // Các vòng không vẽ lại trang (tu_dong=1): làm mới một lần để số trên lô và danh sách lô đúng.
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-2" data-testid={`gui-tiep-${batchId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <form action={continueAction}>
          <input type="hidden" name="batch_id" value={batchId} />
          <GuiTiepButton disabled={running} />
        </form>
        {running ? (
          <button
            type="button"
            onClick={() => {
              stopRequested.current = true;
            }}
            className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Dừng
          </button>
        ) : (
          <button
            type="button"
            onClick={runToEnd}
            className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90"
          >
            Gửi tiếp tới hết
          </button>
        )}
      </div>
      {running ? (
        <p role="status" className="max-w-md text-right text-xs text-slate-600" data-testid={`gui-tiep-trang-thai-${batchId}`}>
          {`Đang tự gửi tiếp… đã xử lý ${processedTotal} thư${
            typeof last?.remaining === "number" ? `, còn ${last.remaining}` : ""
          }. Giữ tab này mở; bấm “Dừng” thì dừng sau lần chạy đang dở.`}
        </p>
      ) : null}
    </div>
  );
}
