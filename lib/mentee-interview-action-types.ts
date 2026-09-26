/**
 * lib/mentee-interview-action-types.ts
 *
 * Kiểu trạng thái form của trang đặt ca công khai /dat-ca/[token]. Tách khỏi
 * file "use server" của route vì module "use server" chỉ được export hàm async
 * (__tests__/use-server-export-contract.test.ts canh điều đó).
 */

export type SessionBookingState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Nhãn ca vừa giữ được — hiện trong thẻ xác nhận. */
  sessionLabel: string | null;
};

export const INITIAL_SESSION_BOOKING_STATE: SessionBookingState = {
  status: "idle",
  message: "",
  sessionLabel: null
};
