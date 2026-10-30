/**
 * Kiểu kết quả của các lệnh Form tùy chỉnh. Tách khỏi file "use server": file đó chỉ được xuất hàm
 * async, và trang ở trình duyệt cần kiểu này mà không kéo theo mã máy chủ.
 */
export type CustomFormAdminResult = { ok: boolean; message: string };

export type CustomFormSubmitResult = {
  ok: boolean;
  message: string;
  /** Lỗi theo mã trường — trang hiện ngay dưới đúng ô. */
  errors: Record<string, string>;
};

/** Cái trình tạo form gửi lên khi bấm "Lưu". Máy chủ kiểm lại từng thứ (lib/custom-form-core.ts). */
export type CustomFormSavePayload = {
  title: string;
  description: string;
  programId: string;
  thankYou: string;
  onePerEmail: boolean;
  /** Thư tự động gửi người điền (BTC 15/10/2026). */
  autoReply: boolean;
  autoReplySubject: string;
  autoReplyBody: string;
  /** `YYYY-MM-DDTHH:mm` giờ Việt Nam, hoặc chuỗi rỗng. */
  opensAt: string;
  closesAt: string;
  fields: unknown;
  /** Sự kiện liên kết (VAM00008), hoặc chuỗi rỗng. */
  eventId?: string;
  /** Giới hạn số đăng ký riêng của form, hoặc chuỗi rỗng. */
  registrationLimit?: string;
  /** Chỉ nhận người đã có trên hệ thống (VAM00009). */
  requireKnownPerson?: boolean;
  /** Màu chủ đạo #rrggbb, hoặc chuỗi rỗng (VAM00009). */
  themeColor?: string;
};
