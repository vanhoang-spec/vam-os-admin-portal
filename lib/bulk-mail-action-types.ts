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
  /** Email ngoài VAM (VAM00027): không có hồ sơ, tên lấy từ chữ người bấm đưa vào (có thể trống). */
  external?: boolean;
};

/** Tóm tắt phần email ngoài VAM của một bản xem trước. */
export type CustomListExternalSummary = {
  /** Số người ngoài có mặt trong danh sách (đã bỏ trùng với nhau và với người lấy từ VAM). */
  count: number;
  /** Dòng lỗi, tối đa vài chục dòng. */
  problems: string[];
  /** Số dòng/địa chỉ không nhận vì sai định dạng. */
  invalidCount: number;
  /** Số địa chỉ lặp lại trong chính ô email ngoài. */
  duplicates: number;
  /** Số email ngoài đã có sẵn trong danh sách lấy từ VAM — gửi theo hồ sơ VAM, một lá. */
  overlap: number;
  /** Số người ngoài chưa có tên. */
  nameless: number;
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
  /** Có khi danh sách có email ngoài VAM. */
  external?: CustomListExternalSummary | null;
  /** Mẫu thư đang chọn dùng {{ten_nguoi_nhan}}: người ngoài trống tên thì không gửi được. */
  nameRequired?: boolean;
  /** Mẫu thư mà `nameRequired` được tính theo — đổi mẫu thì phải xem trước lại. */
  templateId?: string | null;
};

export const initialCustomListPreviewState: CustomListPreviewState = {
  ok: false,
  message: null,
  signature: null,
  label: null,
  rows: [],
  unreachable: [],
  unreachableCount: 0,
  external: null,
  nameRequired: false,
  templateId: null
};

/** Kết quả đọc một file Excel danh sách email ngoài VAM. */
export type ExternalFileState = {
  ok: boolean;
  message: string | null;
  /** Mỗi lần đọc một mã mới, để màn hình biết "Bỏ file" đang bỏ lần đọc nào. */
  token: string | null;
  fileName: string | null;
  /** Danh sách đã đọc, viết thành chữ của ô email ngoài: mỗi dòng `email<TAB>Họ tên`. */
  text: string;
  count: number;
  nameless: number;
  problems: string[];
  invalidCount: number;
  duplicates: number;
};

export const initialExternalFileState: ExternalFileState = {
  ok: false,
  message: null,
  token: null,
  fileName: null,
  text: "",
  count: 0,
  nameless: 0,
  problems: [],
  invalidCount: 0,
  duplicates: 0
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
