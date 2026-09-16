/**
 * Migration cho phép đăng ký cả hai buổi — khẳng định cấu trúc.
 *
 * Hai cách làm hỏng: bỏ nhầm ràng buộc theo TỪNG BUỔI (mở đường cho hai dòng
 * trùng nhau của cùng một người trong cùng một buổi), và xoá dữ liệu thay vì chỉ
 * bỏ một chỉ số.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LF = String.fromCharCode(10);
const raw = readFileSync("supabase/migrations/20260916140000_series_registration_both_sessions.sql", "utf8");
const code = raw
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);

describe("1. bỏ ràng buộc một-email-một-chuỗi", () => {
  it("bỏ đúng chỉ số đã chặn buổi thứ hai, và chạy lại được", () => {
    expect(code).toContain("drop index if exists public.event_registrations_series_lower_email_active_uidx;");
  });

  it("giữ ràng buộc một-email-một-buổi — tự kiểm sẽ đỏ nếu nó biến mất", () => {
    const check = code.slice(code.indexOf("do $self_check$"), code.lastIndexOf("$self_check$"));
    expect(check).toContain("event_registrations_event_lower_email_active_uidx");
    expect(check).toContain("mất ràng buộc một-email-một-buổi");
    expect(check).toContain("lower(email)");
    expect(check).toContain("event_id");
  });

  it("không đụng tới dòng dữ liệu nào", () => {
    expect(code).not.toMatch(/insert +into|update +public[.]|delete +from|drop +table|truncate/i);
  });
});

describe("2. ghi lại cách lùi", () => {
  it("có câu lệnh dựng lại chỉ số, kèm điều kiện lùi được", () => {
    expect(raw).toContain("LÙI LẠI NẾU CẦN");
    expect(raw).toContain("create unique index event_registrations_series_lower_email_active_uidx");
  });
});

describe("3. transaction", () => {
  it("một transaction, nạp lại schema", () => {
    expect(code).toMatch(/^begin;$/m);
    expect(code).toMatch(/^commit;\s*$/m);
    expect(code).toContain("notify pgrst, 'reload schema';");
  });

  it("không có dấu gạch chéo ngược", () => {
    expect(raw.includes(String.fromCharCode(92))).toBe(false);
  });
});
