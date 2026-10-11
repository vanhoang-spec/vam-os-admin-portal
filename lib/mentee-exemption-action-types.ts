/**
 * Kiểu và hằng dùng chung giữa server action và component của màn hình "Mentee đặc cách".
 * Đặt ngoài file "use server": file đó chỉ được export hàm async.
 */
export type ExemptionActionState = { status: "idle" | "ok" | "error"; message: string };

export const EXEMPTION_IDLE: ExemptionActionState = { status: "idle", message: "" };

/** Trang BTC quản lý danh sách đặc cách. */
export const MENTEE_EXEMPTION_PATH = "/applications/mentee-dac-cach";
