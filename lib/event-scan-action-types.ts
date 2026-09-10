/**
 * Trạng thái trả về của thao tác quét mã tại sự kiện.
 *
 * Module riêng vì `app/actions/event-scan.ts` mang `"use server"`, và
 * `__tests__/use-server-export-contract.test.ts` chỉ cho phép hàm async ở đó.
 */
export type ScanTone = "success" | "repeat" | "error";

export type ScanActionState = {
  ok: boolean;
  /**
   * Ba sắc thái, không phải hai.
   *
   * Quét lại cùng một người ở cùng một trạm KHÔNG phải lỗi — nó xảy ra suốt
   * khi camera không đọc được lần đầu. Người đứng quét cần phân biệt ngay
   * "người này vừa vào" với "người này vào rồi" với "có gì đó sai".
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
