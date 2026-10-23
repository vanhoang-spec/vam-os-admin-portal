/** Kết quả một vòng của chế độ gửi liên tục. Tách khỏi file "use server", nơi chỉ được xuất hàm async. */
export type MatchResultBatchResult = {
  ok: boolean;
  message: string;
  sent: number;
  failed: number;
  /** Người còn chờ thư sau vòng này. */
  left: number;
  /** Người lỗi ở vòng này — trình duyệt gửi lại ở các vòng sau để máy chủ bỏ qua. */
  failedKeys: string[];
  /** Gửi tiếp vòng sau được không. false: xong, chạm hạn mức, bị 429, hoặc có lỗi cần người xem. */
  more: boolean;
};
