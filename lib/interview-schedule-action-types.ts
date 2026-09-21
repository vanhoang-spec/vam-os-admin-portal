/**
 * lib/interview-schedule-action-types.ts
 *
 * Kiểu trạng thái form + hằng khởi tạo cho các action của bộ lịch phỏng vấn.
 * Tách khỏi file "use server" vì một module "use server" chỉ được export hàm
 * async (__tests__/use-server-export-contract.test.ts canh điều đó).
 */

/** Trạng thái form lưu giờ rảnh của interviewer. */
export type AvailabilityFormState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Các giờ xin gỡ nhưng vừa được mentor đặt — hiện cảnh báo riêng. */
  blockedRemovals: string[];
};

export const INITIAL_AVAILABILITY_STATE: AvailabilityFormState = {
  status: "idle",
  message: "",
  blockedRemovals: []
};
