/**
 * Trang có mã riêng trong URL: chính sách referrer phải là same-origin, KHÔNG phải no-referrer
 * (15/10/2026).
 *
 * no-referrer giấu mã khỏi trang ngoài, nhưng theo chuẩn Fetch nó cũng khiến trình duyệt gửi
 * "Origin: null" cho mọi POST — kể cả lệnh gửi về chính trang mình. Next 15 đọc Origin bằng
 * new URL(origin); với chuỗi "null" thì văng lỗi, và mọi server action trên trang hỏng. Chrome vẫn
 * gửi Origin thật nên phần lớn người dùng không gặp; trình duyệt làm đúng chuẩn thì gặp. Ngày
 * 15/10 có 3 mentor bấm chọn mentee liên tục không được (log: TypeError Invalid URL, input 'null').
 *
 * same-origin: trang ngoài (link CV, Zalo…) vẫn không nhận được đường dẫn có mã; lệnh gửi về chính
 * trang mình mang Origin thật.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));

import { middleware } from "@/middleware";

const TOKEN = "aaaaaaaa-0000-4000-8000-00000000000a";
const TOKEN_ROUTES = ["/chon-mentee/", "/renew/", "/ve/", "/dat-lich/", "/dat-ca/", "/xac-nhan-mentee/"];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("trang có mã riêng trong URL: Referrer-Policy same-origin", () => {
  it.each(TOKEN_ROUTES)("%s: same-origin (không lộ mã ra trang ngoài, POST về trang mình vẫn mang Origin thật)", async (prefix) => {
    const response = await middleware(new NextRequest(`https://os.test${prefix}${TOKEN}`));
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("không trang nào trong app/ và middleware tự đặt no-referrer — thẻ meta của trang đè lên header", () => {
    const offenders = [...files("app"), "middleware.ts"].filter((file) => {
      const code = readFileSync(file, "utf8");
      return /referrer:\s*["']no-referrer["']/.test(code) || /["']Referrer-Policy["']\s*,\s*["']no-referrer["']/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
