/**
 * Trạng thái trả về của thao tác mời participant.
 *
 * Nằm ở `lib/` chứ không ở `app/actions/` vì file kia mang `"use server"`, và
 * một file như vậy CHỈ được export hàm async — Next dựng mỗi export thành một
 * điểm gọi từ trình duyệt, nên một object hằng ở đó là một điểm gọi vô nghĩa.
 *
 * Cùng khuôn với `lib/event-action-types.ts`.
 */
export type ParticipantInviteState = {
  ok: boolean;
  message: string | null;
};

export const initialParticipantInviteState: ParticipantInviteState = {
  ok: false,
  message: null
};
