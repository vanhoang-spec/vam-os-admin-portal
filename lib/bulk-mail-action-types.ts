/**
 * Trạng thái trả về của các thao tác gửi hàng loạt.
 *
 * Module riêng vì `app/actions/bulk-mail.ts` mang `"use server"`, và
 * `__tests__/use-server-export-contract.test.ts` chỉ cho phép những file đó
 * xuất ra hàm async.
 */
export type BulkMailActionState = {
  ok: boolean;
  message: string | null;
  /** Lô vừa mở hoặc vừa chạy tiếp, để màn hình mở đúng nó ra. */
  batchId: string | null;
  /** Người không nhận được thư, kèm lý do — mỗi dòng một người. */
  problems: string[];
};

export const initialBulkMailActionState: BulkMailActionState = {
  ok: false,
  message: null,
  batchId: null,
  problems: []
};
