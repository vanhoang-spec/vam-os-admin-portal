/** Trạng thái form của trang Vòng 2. Tách khỏi file "use server", nơi chỉ được xuất hàm async. */
export type Round2ActionState = { status: "idle" | "ok" | "error"; message: string };

export const ROUND2_IDLE: Round2ActionState = { status: "idle", message: "" };

/** Trạng thái nút Chọn / Bỏ chọn trên trang mentor (/chon-mentee/[token]). */
export type Round2PickState = Round2ActionState;
export const ROUND2_PICK_IDLE: Round2PickState = ROUND2_IDLE;
