/**
 * lib/mentee-session-admin-action-types.ts
 *
 * Kiểu trạng thái form của màn hình cấu hình ca phỏng vấn mentee. Tách khỏi
 * file "use server" vì module "use server" chỉ được export hàm async
 * (__tests__/use-server-export-contract.test.ts canh điều đó).
 */

export type SessionConfigState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Ca vừa lưu — để màn hình chỉ báo ở đúng dòng đó, không báo tràn cả trang. */
  sessionId: string | null;
};

export const INITIAL_SESSION_CONFIG_STATE: SessionConfigState = {
  status: "idle",
  message: "",
  sessionId: null
};

/** Kết quả một lần bấm "Gửi thư mời chọn ca". */
export type InviteDispatchState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const INITIAL_INVITE_DISPATCH_STATE: InviteDispatchState = {
  status: "idle",
  message: ""
};
