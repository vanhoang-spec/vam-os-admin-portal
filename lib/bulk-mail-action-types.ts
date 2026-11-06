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

/** Một dòng của bản xem trước danh sách tùy chỉnh. `key` là thứ duy nhất form gửi lại. */
export type CustomListPreviewRow = {
  key: string;
  fullName: string;
  email: string;
  roleWord: string;
};

export type CustomListPreviewState = {
  ok: boolean;
  message: string | null;
  /** Bộ nguồn mà bản xem trước này dựng từ — màn hình so với các ô đang tick. */
  signature: string | null;
  label: string | null;
  rows: CustomListPreviewRow[];
  /** Người không gửi được (thiếu email/họ tên), tối đa vài chục dòng để còn đọc nổi. */
  unreachable: string[];
  unreachableCount: number;
};

export const initialCustomListPreviewState: CustomListPreviewState = {
  ok: false,
  message: null,
  signature: null,
  label: null,
  rows: [],
  unreachable: [],
  unreachableCount: 0
};

export type CustomListPersonOption = {
  personId: string;
  fullName: string;
  email: string;
  memberCode: string | null;
  roleWord: string;
};

export type CustomListSearchState = {
  ok: boolean;
  message: string | null;
  results: CustomListPersonOption[];
};

export const initialCustomListSearchState: CustomListSearchState = {
  ok: false,
  message: null,
  results: []
};
