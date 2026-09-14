import type { AiDoc } from "@/lib/doc-blocks";

/**
 * Trạng thái form của Công cụ AI.
 *
 * Nằm ngoài app/actions/ai-tools.ts vì file "use server" chỉ được xuất hàm async
 * (__tests__/use-server-export-contract.test.ts) — một hằng số initial state xuất từ
 * đó làm Next vỡ lúc chạy.
 */
export type AiState = {
  /** Kết quả dạng tài liệu có cấu trúc: màn hình, trang in và file Word dùng chung. */
  doc?: AiDoc;
  error?: string;
  /** true = câu trả lời dựa trên nguồn web thật; false = kiến thức chung. */
  grounded?: boolean;
  sourceCount?: number;
  /** Tên file bị từ chối kèm lý do — vẫn chạy AI với phần còn lại, chỉ báo để người dùng biết. */
  rejectedFiles?: string[];
};

export const initialAiState: AiState = {};
