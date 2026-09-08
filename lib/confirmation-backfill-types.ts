import type { BackfillSummary } from "@/lib/confirmation-backfill-core";

/**
 * Trạng thái dùng chung cho Server Action gửi bù thư xác nhận.
 *
 * Nằm đây chứ không nằm trong app/actions/confirmation-backfill.ts vì một file
 * "use server" chỉ được export hàm async — export một object khởi tạo từ đó sẽ
 * khiến Next.js từ chối module ngay lúc build. Cùng lý do với
 * lib/application-form-control-types.ts và lib/apply-types.ts.
 */
export type ConfirmationBackfillActionState = {
  ok: boolean;
  message: string | null;
  summary?: BackfillSummary;
};

export const initialConfirmationBackfillActionState: ConfirmationBackfillActionState = {
  ok: false,
  message: null
};
