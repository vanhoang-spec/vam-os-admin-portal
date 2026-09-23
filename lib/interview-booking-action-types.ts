/**
 * lib/interview-booking-action-types.ts
 *
 * Kiểu trạng thái form của trang đặt lịch công khai /dat-lich/[token]. Tách
 * khỏi file "use server" của route vì module "use server" chỉ được export
 * hàm async (__tests__/use-server-export-contract.test.ts canh điều đó).
 */

export type BookingFormState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Nhãn buổi hẹn vừa giữ được — hiện trong thẻ xác nhận. */
  slotLabel: string | null;
};

export const INITIAL_BOOKING_FORM_STATE: BookingFormState = {
  status: "idle",
  message: "",
  slotLabel: null
};

/** Trạng thái form "giờ tôi rảnh" — chiều ngược, mentor tự khai chứ không giữ chỗ. */
export type MentorAvailabilityState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Giờ xin bỏ nhưng vừa được ghép mất — hiện lại để mentor không tưởng đã bỏ xong. */
  blockedRemovals: string[];
};

export const INITIAL_MENTOR_AVAILABILITY_STATE: MentorAvailabilityState = {
  status: "idle",
  message: "",
  blockedRemovals: []
};
