/**
 * Migration cột `audience` — khẳng định cấu trúc, không chạy SQL.
 *
 * Cột này tồn tại vì một lô không gửi xong trong một lần chạy. Nếu đối tượng
 * nhận thư chỉ nằm trên màn hình rồi gửi kèm mỗi lần bấm, một lô mở cho mentor
 * có thể được bấm tiếp với mentee — và những người chưa từng nằm trong lô ấy
 * nhận thư như thể họ có.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BULK_AUDIENCES } from "@/lib/bulk-mail-core";

const ROOT = join(__dirname, "..");
const raw = readFileSync(
  join(ROOT, "supabase", "migrations", "20260910090000_email_batches_audience.sql"),
  "utf8"
);
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("khung transaction", () => {
  it("bọc trong một transaction và nạp lại schema", () => {
    expect(code).toMatch(/\bbegin;/);
    expect(code).toMatch(/\bcommit;/);
    expect(code).toMatch(/notify pgrst, 'reload schema'/);
  });

  it("dừng sớm khi bảng chưa tồn tại", () => {
    expect(code).toMatch(/PREREQ_MISSING/);
    expect(code).toMatch(/to_regclass\('public\.email_batches'\)/);
  });
});

describe("cột", () => {
  it("thêm cột mà không phá nếu đã có", () => {
    expect(code).toMatch(/add column if not exists audience text/);
  });

  it("cột nullable — bảng có thể đã tồn tại trước khi migration này chạy", () => {
    expect(code).not.toMatch(/add column if not exists audience text not null/);
  });

  it("ràng buộc nhận đúng ba giá trị mà TypeScript khai báo, và cho phép null", () => {
    // Trôi lệch ở đây nghĩa là mở một lô cho đối tượng hợp lệ mà database từ
    // chối, ném ra một lỗi CHECK khó hiểu ngay giữa thao tác gửi.
    const block = code.match(/check \(audience is null or audience in \(([\s\S]*?)\)\)/);
    expect(block).not.toBeNull();
    for (const audience of BULK_AUDIENCES) {
      expect(block?.[1]).toContain(`'${audience}'`);
    }
  });

  it("gắn ràng buộc bằng add constraint có bảo vệ, để chạy lại vô hại", () => {
    expect(code).toMatch(/conname = 'email_batches_audience_check'/);
    expect(code).toMatch(/add constraint email_batches_audience_check/);
  });
});

describe("không nới gì ra ngoài", () => {
  it("không tạo policy nào — bảng vẫn là server-only", () => {
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/email_batches lại có policy/);
  });

  it("không cấp thêm quyền cho ai", () => {
    expect(code).not.toMatch(/\bgrant\b/i);
  });

  it("không đụng bảng nào khác", () => {
    const altered = Array.from(code.matchAll(/alter table (public\.\w+)/g), (m) => m[1]);
    expect(Array.from(new Set(altered))).toEqual(["public.email_batches"]);
  });

  it("tự kiểm trong cùng transaction", () => {
    expect(code).toMatch(/SCHEMA_CONTRACT_VIOLATION/);
  });
});
