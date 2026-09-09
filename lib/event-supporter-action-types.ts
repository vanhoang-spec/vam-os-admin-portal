/**
 * Trạng thái trả về của các thao tác trên danh sách người hỗ trợ.
 *
 * Module riêng vì `app/actions/event-supporters.ts` mang `"use server"`.
 */
export type EventSupporterActionState = {
  ok: boolean;
  message: string | null;
};

export const initialEventSupporterActionState: EventSupporterActionState = {
  ok: false,
  message: null
};
