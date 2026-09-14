/**
 * Trạng thái trả về của thao tác quét mã tại sự kiện.
 *
 * Module riêng vì `app/actions/event-scan.ts` mang `"use server"`, và
 * `__tests__/use-server-export-contract.test.ts` chỉ cho phép hàm async ở đó.
 */
export type ScanTone = "success" | "repeat" | "warning" | "error";

/** Câu nhắc khi quét một lần khác mà người đó chưa qua lần Check in nào. */
export const MISSING_CHECK_IN_NOTE = "Người này chưa được quét Check in.";

export type ScanActionState = {
  ok: boolean;
  /**
   * Bốn sắc thái, không phải hai.
   *
   * Quét lại cùng một người ở cùng một lần quét KHÔNG phải lỗi — nó xảy ra suốt
   * khi camera không đọc được lần đầu. Người đứng quét cần phân biệt ngay
   * "người này vừa qua" với "người này qua rồi" với "ghi nhận rồi, nhưng người
   * này chưa Check in" với "có gì đó sai".
   */
  tone: ScanTone;
  message: string | null;
  /** Tên người vừa quét, để người đứng quét đối chiếu với khuôn mặt trước mặt. */
  fullName: string | null;
  /** Nhãn các trạm người đó đã đi qua. */
  badges: string[];
};

export const initialScanActionState: ScanActionState = {
  ok: false,
  tone: "error",
  message: null,
  fullName: null,
  badges: []
};
