/**
 * Trạng thái trả về của hai server action trên màn hình "Thư tự động".
 *
 * File riêng, không nằm trong `app/actions/*`: một client component import kiểu
 * từ một file `"use server"` thì Next kéo cả module đó vào bó client.
 *
 * `slotId` có mặt để dải thông báo hiện đúng ở lá thư vừa bấm — màn hình có 17
 * lá mở cùng lúc, và một câu "Đã lưu" không biết mình thuộc về ai thì hiện ở
 * mọi chỗ hoặc không chỗ nào.
 */
export type AutomationActionState = {
  ok: boolean;
  message: string;
  slotId: string | null;
};

export const EMPTY_AUTOMATION_STATE: AutomationActionState = {
  ok: false,
  message: "",
  slotId: null
};
