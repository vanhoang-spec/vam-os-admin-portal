/**
 * Link đặt mật khẩu mà VAM OS tự dựng — dựng và đọc lại.
 *
 * Hai tính chất đáng khoá: mã nằm sau dấu # (không lên máy chủ, không vào log),
 * và trang chỉ nhận đúng hai loại link. Một trang đặt mật khẩu nhận cả link đổi
 * email là một cửa để đổi email của người khác.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPasswordLinkUrl,
  mapPasswordUpdateError,
  parsePasswordLinkHash,
  passwordLinkCopy,
  validateNewPassword
} from "@/lib/password-link-core";

describe("dựng link", () => {
  it("mã nằm sau #, không nằm trong query string, và đọc lại được y nguyên", () => {
    const url = buildPasswordLinkUrl("https://os.example.org/", { tokenHash: "ab+c/d=", type: "invite" });
    expect(url).toBe("https://os.example.org/reset-password#token_hash=ab%2Bc%2Fd%3D&type=invite");

    const parsed = new URL(String(url));
    expect(parsed.search).toBe("");
    expect(parsed.pathname).toBe("/reset-password");
    expect(parsePasswordLinkHash(parsed.hash)).toEqual({ status: "ok", tokenHash: "ab+c/d=", type: "invite" });
  });

  it("không dựng link http cho máy chủ thật; localhost thì được", () => {
    expect(buildPasswordLinkUrl("http://os.example.org", { tokenHash: "abc", type: "invite" })).toBeNull();
    expect(buildPasswordLinkUrl("http://localhost:3000", { tokenHash: "abc", type: "recovery" })).toBe(
      "http://localhost:3000/reset-password#token_hash=abc&type=recovery"
    );
  });

  it("mã rỗng, có khoảng trắng, hoặc loại link lạ thì không dựng", () => {
    expect(buildPasswordLinkUrl("https://os.example.org", { tokenHash: "", type: "invite" })).toBeNull();
    expect(buildPasswordLinkUrl("https://os.example.org", { tokenHash: "a b", type: "invite" })).toBeNull();
    expect(buildPasswordLinkUrl("https://os.example.org", { tokenHash: "abc", type: "magiclink" as never })).toBeNull();
  });
});

describe("đọc link", () => {
  it("không có token_hash là link khôi phục của nhân sự — để nguyên luồng cũ", () => {
    expect(parsePasswordLinkHash("")).toEqual({ status: "none" });
    expect(parsePasswordLinkHash("#access_token=x&refresh_token=y&type=recovery")).toEqual({ status: "none" });
  });

  it("chỉ nhận invite và recovery", () => {
    for (const type of ["email_change", "signup", "magiclink", ""]) {
      expect(parsePasswordLinkHash(`#token_hash=abc&type=${type}`), type).toEqual({ status: "invalid" });
    }
  });

  it("mã rỗng là link hỏng", () => {
    expect(parsePasswordLinkHash("#token_hash=&type=invite")).toEqual({ status: "invalid" });
  });
});

describe("mật khẩu", () => {
  it("ít nhất 8 ký tự, và hai lần nhập phải khớp", () => {
    expect(validateNewPassword("1234567", "1234567")).toContain("8");
    expect(validateNewPassword("12345678", "12345679")).toContain("không khớp");
    expect(validateNewPassword("12345678", "12345678")).toBeNull();
  });

  it("lỗi của Supabase không bao giờ ra màn hình nguyên văn", () => {
    const english = "Password should contain at least one character of each: abc";
    for (const error of [
      { code: "weak_password", message: english },
      { code: "same_password", message: english },
      { code: "session_not_found", message: english },
      { status: 401, message: english },
      { code: "unexpected_failure", message: english },
      null
    ]) {
      expect(mapPasswordUpdateError(error).message).not.toBe(english);
      expect(mapPasswordUpdateError(error).message).not.toContain("Password");
    }
  });

  it("phiên hết hạn thì báo là hết hạn", () => {
    expect(mapPasswordUpdateError({ code: "session_not_found" }).expired).toBe(true);
    expect(mapPasswordUpdateError({ status: 403 }).expired).toBe(true);
    expect(mapPasswordUpdateError({ code: "weak_password" }).expired).toBe(false);
  });
});

describe("lời hiển thị", () => {
  it("link mời và link khôi phục mang tiêu đề khác nhau", () => {
    expect(passwordLinkCopy("invite").title).not.toBe(passwordLinkCopy("recovery").title);
  });

  it("module dùng được ở trình duyệt: không import gì của máy chủ", () => {
    const source = readFileSync(join(__dirname, "..", "lib", "password-link-core.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](server-only|next\/)/);
    expect(source).not.toMatch(/import\s+["']server-only["']/);
  });
});
