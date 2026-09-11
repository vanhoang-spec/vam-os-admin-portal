/**
 * Trạng thái trả về của các thao tác mời tài khoản mentor/mentee.
 *
 * Nằm ở `lib/` chứ không ở `app/actions/` vì file kia mang `"use server"`, và
 * một file như vậy CHỈ được export hàm async — Next dựng mỗi export thành một
 * điểm gọi từ trình duyệt, nên một object hằng ở đó là một điểm gọi vô nghĩa.
 *
 * Cùng khuôn với `lib/event-action-types.ts`.
 */

export const PARTICIPANT_ACCOUNTS_PATH = "/participant-accounts";

export type ParticipantInviteState = {
  ok: boolean;
  message: string | null;
  outcome: string | null;
  /**
   * Mốc máy chủ trả về cho mỗi lần bấm. Màn hình làm mới dữ liệu theo mốc này
   * chứ không theo nội dung lời báo: hai lần mời thành công liên tiếp cho ra
   * cùng một câu, và so theo câu thì lần thứ hai không làm mới gì cả.
   */
  at: number;
};

export const initialParticipantInviteState: ParticipantInviteState = {
  ok: false,
  message: null,
  outcome: null,
  at: 0
};

export type BulkInviteState = {
  ok: boolean;
  message: string | null;
  /** Tối đa 10 dòng "Tên: lý do". Không bao giờ chứa email. */
  problems: string[];
  /** Số người còn đủ điều kiện, ĐẾM LẠI từ database sau lượt vừa chạy. */
  remaining: number | null;
  canContinue: boolean;
  at: number;
};

export const initialBulkInviteState: BulkInviteState = {
  ok: false,
  message: null,
  problems: [],
  remaining: null,
  canContinue: false,
  at: 0
};
