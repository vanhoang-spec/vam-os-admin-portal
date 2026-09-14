/**
 * Migration các lần quét mã QR — khẳng định cấu trúc.
 *
 * Migration này dán tay vào Supabase trước khi merge. Nó phải khớp đúng mặc định
 * và giới hạn của `lib/event-checkin-steps.ts`: database mặc định một thứ còn mã
 * mặc định một thứ khác thì sự kiện tạo bằng đường không qua form (thêm buổi vào
 * chuỗi) mở máy quét ra với một lần quét mà form không biết.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKIN_STEPS, MAX_CHECKIN_STEPS } from "@/lib/event-checkin-steps";

const raw = readFileSync("supabase/migrations/20260914200000_event_checkin_steps.sql", "utf8");
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("cột", () => {
  it("text[] NOT NULL, mặc định đúng mặc định trong TypeScript", () => {
    expect(code).toContain(
      "add column if not exists checkin_steps text[] not null default array['entrance']::text[]"
    );
    expect(DEFAULT_CHECKIN_STEPS).toEqual(["entrance"]);
  });

  it("không đụng tới dữ liệu nào, không đụng bảng lịch sử quét", () => {
    expect(code).not.toMatch(/update +public[.]|delete +from|drop +(table|column)|truncate|alter table public[.]event_scans/i);
  });

  it("bọc trong transaction và nạp lại schema", () => {
    expect(code).toMatch(/begin;/);
    expect(code).toMatch(/commit;/);
    expect(code).toContain("notify pgrst, 'reload schema'");
  });
});

describe("ràng buộc", () => {
  const start = code.indexOf("add constraint events_checkin_steps_shape_check");
  const constraint = code.slice(start, code.indexOf(");", start));

  it("1–20 phần tử, khớp MAX_CHECKIN_STEPS, không phần tử null", () => {
    expect(start).toBeGreaterThan(-1);
    expect(constraint).toContain(`cardinality(checkin_steps) between 1 and ${MAX_CHECKIN_STEPS}`);
    expect(constraint).toContain("array_position(checkin_steps, null) is null");
  });

  it("không chép cứng danh sách mục vào CHECK", () => {
    // Thêm một mục mới về sau không được đòi viết lại ràng buộc.
    for (const purpose of ["gift_counter", "experience_counter", "talkshow", "seminar", "checkout"]) {
      expect(constraint, purpose).not.toContain(purpose);
    }
  });

  it("chỉ thêm khi chưa có — chạy lại vô hại", () => {
    const guard = code.lastIndexOf("if not exists (", start);
    expect(guard).toBeGreaterThan(-1);
    expect(code.slice(guard, start)).toContain("conname = 'events_checkin_steps_shape_check'");
  });
});

describe("tự kiểm", () => {
  const selfCheck = code.slice(code.indexOf("$self_check$"));

  it("kiểm kiểu, NOT NULL, mặc định lẫn ràng buộc đã có hiệu lực", () => {
    expect(selfCheck).toContain("v_type <> '_text'");
    expect(selfCheck).toContain("v_nullable <> 'NO'");
    expect(selfCheck).toContain("position('entrance' in coalesce(v_default, '')) = 0");
    expect(selfCheck).toContain("convalidated");
  });

  it("raise khi có sự kiện không có lần quét nào", () => {
    expect(selfCheck).toContain("where cardinality(checkin_steps) < 1");
    expect(selfCheck).toMatch(/raise exception[^;]*không có lần quét nào/);
  });
});
