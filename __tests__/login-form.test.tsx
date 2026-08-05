// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/app/login/login-form";

let mockPending = false;
let updateSubscribers: (() => void)[] = [];

vi.mock("react-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  const React = await import("react");
  return {
    ...actual,
    useFormState: (action: any, initialState: any) => {
      const [state, setState] = React.useState(initialState);
      const dispatch = async (payload: any) => {
        mockPending = true;
        updateSubscribers.forEach(s => s());
        const res = await action(state, payload);
        setState(res);
        mockPending = false;
        updateSubscribers.forEach(s => s());
      };
      return [state, dispatch];
    },
    useFormStatus: () => {
      const [, forceRender] = React.useState(0);
      React.useEffect(() => {
        const handler = () => forceRender(x => x + 1);
        updateSubscribers.push(handler);
        return () => { updateSubscribers = updateSubscribers.filter(s => s !== handler); };
      }, []);
      return { pending: mockPending };
    }
  };
});

const mockLoginAction = vi.fn();

vi.mock("@/app/login/actions", () => ({
  loginAction: (state: any, formData: FormData) => mockLoginAction(state, formData),
}));

describe("LoginForm", () => {
  beforeEach(() => {
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

  it("submits exactly once on physical click and shows pending state", async () => {
    let resolveAction!: (v: any) => void;
    mockLoginAction.mockImplementation(() => new Promise(r => { resolveAction = r; }));

    render(<LoginForm next="/" />);
    const emailInput = screen.getByLabelText(/email/i, { selector: "input" });
    const passwordInput = screen.getByLabelText(/mật khẩu/i, { selector: "input" });
    const submitBtn = screen.getByRole("button", { name: /đăng nhập/i });

    await userEvent.type(emailInput, "test@example.com");
    await userEvent.type(passwordInput, "password123");

    // Click submit
    await userEvent.click(submitBtn);

    // Expect action to be called once
    expect(mockLoginAction).toHaveBeenCalledTimes(1);

    // Button should be in pending state
    const pendingBtn = screen.getByRole("button", { name: /đang đăng nhập/i });
    expect(pendingBtn.hasAttribute("disabled")).toBe(true);

    // Rapid double-click while pending should NOT invoke action again
    await userEvent.click(pendingBtn);
    expect(mockLoginAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAction({ error: null });
    });
  });

  it("submits exactly once on Enter from email input and prevents repeated Enters", async () => {
    let resolveAction!: (v: any) => void;
    mockLoginAction.mockImplementation(() => new Promise(r => { resolveAction = r; }));

    render(<LoginForm next="/" />);
    const emailInput = screen.getByLabelText(/email/i, { selector: "input" });
    const passwordInput = screen.getByLabelText(/mật khẩu/i, { selector: "input" });

    await userEvent.type(emailInput, "test@example.com");
    await userEvent.type(passwordInput, "password123");

    // Press Enter on email input
    await userEvent.type(emailInput, "{enter}");
    expect(mockLoginAction).toHaveBeenCalledTimes(1);

    // Press Enter again while pending
    await userEvent.type(emailInput, "{enter}");
    expect(mockLoginAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAction({ error: null });
    });
  });

  it("submits exactly once on Enter from password input and allows retry after failure", async () => {
    let resolveAction!: (v: any) => void;
    mockLoginAction.mockImplementation(() => new Promise(r => { resolveAction = r; }));

    render(<LoginForm next="/" />);
    const emailInput = screen.getByLabelText(/email/i, { selector: "input" }) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/mật khẩu/i, { selector: "input" });

    await userEvent.type(emailInput, "test@example.com");
    await userEvent.type(passwordInput, "password123");

    // Press Enter on password input
    await userEvent.type(passwordInput, "{enter}");
    expect(mockLoginAction).toHaveBeenCalledTimes(1);

    // Fail the login
    await act(async () => {
      resolveAction({ error: "Mật khẩu không đúng" });
    });

    // Error is shown
    expect(screen.getByRole("alert").textContent).toBe("Mật khẩu không đúng");

    // Button is restored
    const restoredBtn = screen.getByRole("button", { name: /đăng nhập/i });
    expect(restoredBtn.hasAttribute("disabled")).toBe(false);

    // Email is preserved
    expect(emailInput.value).toBe("test@example.com");

    // Retry should work
    mockLoginAction.mockImplementation(() => Promise.resolve({ error: null }));
    await userEvent.click(restoredBtn);
    expect(mockLoginAction).toHaveBeenCalledTimes(2);
  });
});
