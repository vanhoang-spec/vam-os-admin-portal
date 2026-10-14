"use client";

import { createContext } from "react";

export type PickReportMessage = { status: "ok" | "error"; message: string };

/**
 * Nút chọn báo kết quả lên đầu danh sách (BTC 14/10/2026): sau mỗi lượt chọn trang làm mới,
 * thẻ của bạn vừa được chọn — hoặc vừa bị người khác chọn trước — biến mất, mang theo câu báo
 * nằm trong thẻ. Câu báo ở đầu danh sách thì còn lại.
 */
export const PickReport = createContext<((report: PickReportMessage) => void) | null>(null);
