/** @vitest-environment jsdom */
/**
 * __tests__/login-password-reset-ui.test.tsx
 *
 * Nút "Đặt lại mật khẩu" trên trang đăng nhập.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN CA GIAO DIỆN RIÊNG
 * ---------------------------------------------------------------------------
 * Hành động máy chủ đã có ca riêng, nhưng nó không bao giờ thấy được lỗi tệ
 * nhất của màn hình này: ô email nằm ở BIỂU MẪU KHÁC. Người dùng gõ địa chỉ vào
 * form đăng nhập bên trên, còn nút đặt lại mật khẩu đứng trong một <form> thứ
 * ba — hai form không dùng chung được một action. Địa chỉ đi sang bằng một ô
 * ẩn, và nếu ô ẩn ấy không được nối thì nút vẫn bấm được, vẫn hiện câu "đã gửi
 * nếu email có tài khoản", và KHÔNG có thư nào đi cả.
 *
 * Đó là loại lỗi qua được cả bốn cổng và chỉ lộ ra khi một người thật ngồi đợi
 * một lá thư không tồn tại.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ error: null, sent: false }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("@/app/login/actions", () => ({
  loginAction: vi.fn(),
  requestMagicLinkAction: vi.fn(),
  requestPasswordResetAction: vi.fn()
}));

import { LoginForm } from "@/app/login/login-form";

afterEach(cleanup);

/** Ô ẩn `email` của form chứa đúng nút này. */
function hiddenEmailBesideButton(buttonLabel: string): HTMLInputElement | null {
  const button = screen.getByRole("button", { name: buttonLabel });
  const form = button.closest("form");
  return form?.querySelector('input[type="hidden"][name="email"]') ?? null;
}

describe("nút tự đặt lại mật khẩu", () => {
  it("có mặt, và không bắt người dùng liên hệ ban tổ chức nữa", () => {
    render(<LoginForm next="/" />);

    expect(screen.getByRole("button", { name: "Đặt lại mật khẩu" })).toBeTruthy();
    expect(screen.getByText(/tự đặt mật khẩu mới/i)).toBeTruthy();
    expect(screen.getByText(/Không cần nhờ ban tổ chức/i)).toBeTruthy();
  });

  it("mang theo địa chỉ người dùng vừa gõ ở ô đăng nhập bên trên", () => {
    render(<LoginForm next="/" />);

    const emailField = screen.getByLabelText("Email");
    fireEvent.change(emailField, { target: { value: "  Interviewer@Example.COM  " } });
    fireEvent.blur(emailField);

    // Ô ẩn phải nhận đúng địa chỉ ĐÃ CHUẨN HOÁ — cùng dạng mà phép tra tài
    // khoản dùng, không phải thứ người dùng gõ nguyên xi.
    const hidden = hiddenEmailBesideButton("Đặt lại mật khẩu");
    expect(hidden).not.toBeNull();
    expect(hidden?.value).toBe("interviewer@example.com");
  });

  it("vẫn giữ nút liên kết đăng nhập một lần — hai lựa chọn, không thay thế nhau", () => {
    render(<LoginForm next="/" />);

    const magic = screen.getByRole("button", { name: "Gửi liên kết đăng nhập qua email" });
    expect(magic).toBeTruthy();
    // Và nó cũng phải nhận được địa chỉ, qua ô ẩn của chính nó.
    expect(hiddenEmailBesideButton("Gửi liên kết đăng nhập qua email")).not.toBeNull();
  });

  /**
   * Ba <form> riêng biệt, không lồng nhau. Lồng form trong form là HTML không
   * hợp lệ: trình duyệt tự gỡ cái trong ra, và nút bên trong sẽ gửi form bên
   * ngoài — tức là bấm "Đặt lại mật khẩu" lại chạy phép đăng nhập.
   */
  it("ba biểu mẫu tách rời, không cái nào lồng trong cái nào", () => {
    const { container } = render(<LoginForm next="/" />);

    const forms = Array.from(container.querySelectorAll("form"));
    expect(forms).toHaveLength(3);
    for (const form of forms) {
      expect(form.querySelector("form")).toBeNull();
    }
  });
});
