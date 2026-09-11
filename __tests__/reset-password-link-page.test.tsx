/** @vitest-environment jsdom */
/**
 * /reset-password — trang người được mời bấm vào từ thư.
 *
 * Tính chất quan trọng nhất: mở trang KHÔNG tiêu mã. Máy quét thư của công ty
 * mở thử mọi link; nếu trang xác thực ngay lúc tải, người nhận bấm vào chỉ còn
 * gặp "đã hết hạn".
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  authCallback: null as null | ((event: string) => void)
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement("a", { href, className }, children)
}));

import ResetPasswordPage from "@/app/reset-password/page";

function openAt(hash: string) {
  window.history.replaceState(null, "", `/reset-password${hash}`);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  h.authCallback = null;
  h.verifyOtp.mockReset();
  h.updateUser.mockReset();
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.onAuthStateChange.mockReset().mockImplementation((callback: (event: string) => void) => {
    h.authCallback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  h.createClient.mockReset().mockImplementation(() => ({
    auth: {
      verifyOtp: h.verifyOtp,
      updateUser: h.updateUser,
      signOut: h.signOut,
      onAuthStateChange: h.onAuthStateChange
    }
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("link mời: mở trang không tiêu mã", () => {
  it("không gọi Supabase khi tải, kể cả sau vài giây; gỡ mã khỏi thanh địa chỉ", () => {
    vi.useFakeTimers();
    openAt("#token_hash=abc&type=invite");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(React.createElement(ResetPasswordPage));
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.verifyOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeTruthy();
    expect(screen.queryByText("Link không hợp lệ")).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/reset-password");
    expect(window.location.hash).toBe("");
  });

  it("bấm hai lần liền tay chỉ xác thực một lần, với client không tự đọc URL", async () => {
    openAt("#token_hash=abc&type=invite");
    h.verifyOtp.mockReturnValue(new Promise(() => {}));
    render(React.createElement(ResetPasswordPage));
    const button = screen.getByRole("button", { name: "Tiếp tục" });

    act(() => {
      button.click();
      button.click();
    });

    expect(h.verifyOtp).toHaveBeenCalledTimes(1);
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
    expect(h.createClient.mock.calls[0][2]).toMatchObject({ auth: { detectSessionInUrl: false } });
  });

  it("mã đã dùng hoặc hết hạn: nói liên hệ ban tổ chức, không hiện biểu mẫu", async () => {
    openAt("#token_hash=abc&type=invite");
    h.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: { message: "Token has expired" } });
    render(React.createElement(ResetPasswordPage));

    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(await screen.findByText(/ban tổ chức/)).toBeTruthy();
    expect(screen.queryByLabelText("Mật khẩu mới")).toBeNull();
    expect(screen.queryByText("Token has expired")).toBeNull();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("xác thực xong: đặt mật khẩu, đăng xuất, rồi chỉ đường về trang đăng nhập", async () => {
    openAt("#token_hash=abc&type=invite");
    h.verifyOtp.mockResolvedValue({
      data: { session: { access_token: "t" }, user: { email: "an@example.com" } },
      error: null
    });
    h.updateUser.mockResolvedValue({ error: null });
    render(React.createElement(ResetPasswordPage));

    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    const password = await screen.findByLabelText("Mật khẩu mới");

    fireEvent.change(password, { target: { value: "1234" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "1234" } });
    fireEvent.submit(password.closest("form") as HTMLFormElement);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(h.updateUser).not.toHaveBeenCalled();

    fireEvent.change(password, { target: { value: "mat-khau-moi-1" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "mat-khau-moi-1" } });
    fireEvent.submit(password.closest("form") as HTMLFormElement);

    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
    expect(h.updateUser).toHaveBeenCalledWith({ password: "mat-khau-moi-1" });
    expect(h.updateUser.mock.invocationCallOrder[0]).toBeLessThan(h.signOut.mock.invocationCallOrder[0]);
    expect(await screen.findByText("an@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Đăng nhập" }).getAttribute("href")).toBe("/login");
  });

  it("link đổi email không bao giờ được nhận", () => {
    openAt("#token_hash=abc&type=email_change");
    render(React.createElement(ResetPasswordPage));

    expect(screen.getByText("Link không hợp lệ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tiếp tục" })).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
  });
});

describe("link khôi phục của nhân sự: luồng cũ vẫn chạy", () => {
  it("không có token_hash thì để Supabase tự đọc URL và chờ sự kiện khôi phục", () => {
    openAt("#access_token=x&refresh_token=y&type=recovery");
    render(React.createElement(ResetPasswordPage));

    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.createClient.mock.calls[0][2]).toMatchObject({ auth: { detectSessionInUrl: true } });
    expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);

    act(() => h.authCallback?.("PASSWORD_RECOVERY"));

    expect(screen.getByRole("button", { name: "Đặt lại mật khẩu" })).toBeTruthy();
  });
});
