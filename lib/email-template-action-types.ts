/**
 * Trạng thái trả về của các thao tác trên mẫu thư.
 *
 * Nằm ở module riêng vì `app/actions/email-templates.ts` mang `"use server"`,
 * và `__tests__/use-server-export-contract.test.ts` chỉ cho phép những file đó
 * xuất ra hàm async.
 */
export type EmailTemplateActionState = {
  ok: boolean;
  message: string | null;
  /** Mẫu thư vừa được tạo hoặc vừa sửa, để màn hình mở đúng nó ra. */
  templateId: string | null;
  /**
   * Lời nhắc "thư chưa dùng ô này" — không chặn việc lưu, chỉ hiện lên để
   * người soạn nhìn lại.
   */
  warnings: string[];
};

export const initialEmailTemplateActionState: EmailTemplateActionState = {
  ok: false,
  message: null,
  templateId: null,
  warnings: []
};
