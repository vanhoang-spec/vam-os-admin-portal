// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/app/login/login-form";

// We mock react-dom to control useFormStatus for pending states
let mockPending = false;
let mockState: { error: string | null } = { error: null };

vi.mock("react-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useFormState: (action: any, initialState: any) => [mockState, action],
    useFormStatus: () => ({ pending: mockPending }),
  };
});

vi.mock("@/app/login/actions", () => ({
  loginAction: vi.fn(),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    mockPending = false;
    mockState = { error: null };
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("renders email and password with autocomplete attributes", () => {
    render(<LoginForm next="/" />);
    const emailInput = screen.getByLabelText(/email/i, { selector: "input" });
    const passwordInput = screen.getByLabelText(/mật khẩu/i, { selector: "input" });
    
    expect(emailInput.getAttribute("autoComplete")).toBe("email");
    expect(passwordInput.getAttribute("autoComplete")).toBe("current-password");
  });

  it("normalizes email to lowercase and trims on blur", async () => {
    render(<LoginForm next="/" />);
    const emailInput = screen.getByLabelText(/email/i, { selector: "input" }) as HTMLInputElement;
    
    await userEvent.type(emailInput, "  USER@Example.COM  ");
    fireEvent.blur(emailInput);
    
    expect(emailInput.value).toBe("user@example.com");
  });

  it("toggles password visibility", async () => {
    render(<LoginForm next="/" />);
    const passwordInput = screen.getByLabelText(/mật khẩu/i, { selector: "input" });
    const toggleButton = screen.getByLabelText(/hiện mật khẩu/i);
    
    expect(passwordInput.getAttribute("type")).toBe("password");
    
    await userEvent.click(toggleButton);
    expect(passwordInput.getAttribute("type")).toBe("text");
    expect(screen.getByLabelText(/ẩn mật khẩu/i)).toBeDefined();
    
    await userEvent.click(screen.getByLabelText(/ẩn mật khẩu/i));
    expect(passwordInput.getAttribute("type")).toBe("password");
  });

  it("disables button and shows spinner when pending (preventing double submit)", () => {
    mockPending = true;
    render(<LoginForm next="/" />);
    
    const submitBtn = screen.getByRole("button", { name: /đang đăng nhập/i });
    expect(submitBtn.hasAttribute("disabled")).toBe(true);
  });

  it("shows error and preserves email after failure", () => {
    mockState = { error: "Mật khẩu không đúng" };
    render(<LoginForm next="/" />);
    
    expect(screen.getByRole("alert").textContent).toBe("Mật khẩu không đúng");
    const submitBtn = screen.getByRole("button", { name: /đăng nhập/i });
    expect(submitBtn.hasAttribute("disabled")).toBe(false);
  });
});
