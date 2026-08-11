import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { mapAuthError, getSafeAuthErrorType, safeNext } from "../lib/auth-error-messages";

describe("Login Error Taxonomy & Safety", () => {
  it("maps invalid credentials securely", () => {
    const errorType = getSafeAuthErrorType({
      message: "Invalid login credentials",
      status: 400
    });
    expect(errorType).toBe("invalid_credentials");
    const msg = mapAuthError(errorType);
    expect(msg).toBe("Sai email hoặc mật khẩu");
    expect(msg).not.toContain("supabase.co");
    expect(msg).not.toContain("sb_publishable");
  });

  it("maps unauthorized admin errors securely", () => {
    const msg = mapAuthError("unauthorized_admin");
    expect(msg).toBe("Sai email hoặc mật khẩu");
    expect(msg).not.toContain("admin_users");
  });

  it("maps network unavailability securely", () => {
    const errorType = getSafeAuthErrorType({
      name: "AuthRetryableFetchError",
      message: "fetch failed"
    });
    expect(errorType).toBe("network_unavailable");
    const msg = mapAuthError(errorType);
    expect(msg).toBe("VAM OS đang tạm thời không thể kết nối. Vui lòng thử lại sau.");
  });

  it("maps unknown errors to generic message", () => {
    const errorType = getSafeAuthErrorType({
      message: "some weird random error"
    });
    expect(errorType).toBe("unknown");
    const msg = mapAuthError(errorType);
    expect(msg).toBe("Đăng nhập không thành công. Vui lòng thử lại.");
    expect(msg).not.toContain("weird random error");
  });

  it("does not leak passwords in error or normal operations", () => {
    const errorType = getSafeAuthErrorType({ message: "Password 'MySecret123' is wrong" });
    expect(errorType).toBe("unknown");
    const msg = mapAuthError(errorType);
    expect(msg).not.toContain("MySecret123");
  });
});

describe("safeNext function for Open Redirects", () => {
  it("allows safe internal paths", () => {
    expect(safeNext("/operations/intelligence")).toBe("/operations/intelligence");
    expect(safeNext("/admin")).toBe("/admin");
  });

  it("rejects open redirects (external URLs)", () => {
    expect(safeNext("https://evil.com")).toBe("/operations");
    expect(safeNext("http://malicious.org")).toBe("/operations");
  });

  it("rejects protocol-relative open redirects", () => {
    expect(safeNext("//evil.com")).toBe("/operations");
  });

  it("rejects backslash-disguised protocol-relative redirects", () => {
    expect(safeNext("/\\evil.com")).toBe("/operations");
    expect(safeNext("/\\\\evil.com")).toBe("/operations");
  });

  it("rejects paths with control characters (CRLF injection)", () => {
    expect(safeNext("/admin\r\n//evil.com")).toBe("/operations");
    expect(safeNext("/admin\n//evil.com")).toBe("/operations");
    expect(safeNext("/admin\x00evil")).toBe("/operations");
  });

  it("rejects loop redirects back to login/unlock (exact and sub-path)", () => {
    expect(safeNext("/login")).toBe("/operations");
    expect(safeNext("/login?next=/admin")).toBe("/operations");
    expect(safeNext("/login/reset")).toBe("/operations");
    expect(safeNext("/unlock")).toBe("/operations");
    expect(safeNext("/unlock/reset")).toBe("/operations");
    expect(safeNext("/unlock?token=abc")).toBe("/operations");
  });

  it("does not block paths that merely start with the same characters as loop routes", () => {
    // /login-report is not a VAM OS route, but the function must not over-block on prefix alone
    expect(safeNext("/login-report")).toBe("/login-report");
    expect(safeNext("/unlock-page")).toBe("/unlock-page");
  });

  it("defaults to /operations when empty or null", () => {
    expect(safeNext("")).toBe("/operations");
    expect(safeNext(null)).toBe("/operations");
  });

  it("allows valid internal paths with query strings and fragments", () => {
    expect(safeNext("/operations?month=2026-07")).toBe("/operations?month=2026-07");
    expect(safeNext("/admin?tab=data-issues")).toBe("/admin?tab=data-issues");
    expect(safeNext("/operations/monthly#section")).toBe("/operations/monthly#section");
  });
});

describe("Login page — no technical metadata visible to unauthenticated users", () => {
  const loginPageSrc = readFileSync(join(__dirname, "../app/login/page.tsx"), "utf-8");

  it("does not mention internal table names in user-visible copy", () => {
    expect(loginPageSrc).not.toContain("bảng admin_users");
  });

  it("does not mention the auth provider dashboard in user-visible copy", () => {
    expect(loginPageSrc).not.toContain("Supabase Auth Dashboard");
  });

  it("does not mention internal sprint names in user-visible copy", () => {
    expect(loginPageSrc).not.toContain("Sprint 1A");
  });
});
