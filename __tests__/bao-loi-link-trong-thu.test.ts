/**
 * VAM00012 (31/10/2026): nút "Trả lời ngay" trong thư "Cần bạn bổ sung báo lỗi" mở ra `http:///bao-loi?...`.
 * Production không đặt VAM_OS_PUBLIC_BASE_URL, nên mọi thư có link phải được truyền địa chỉ của yêu cầu đang
 * chạy. Thư báo lỗi quên truyền, link thành đường dẫn tương đối, và trình đọc thư không mở được.
 * Thư xác nhận khi nộp đơn cũng quên, nút chọn giờ phỏng vấn của mentor rớt khỏi thư mà không báo gì.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentRows = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: () => null, getSupabaseServerClient: vi.fn() }));

import { buildBaoLoiHoiLaiEmail } from "@/lib/email-core";
import { sendBaoLoiHoiLai } from "@/lib/email";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const input = { toEmail: "vy@example.test", recipientName: "Vy", baoLoiId: "b1", ma: "VAM00009", tieuDe: "Form", cauHoi: "Bổ sung giúp mình?" };
const before = process.env.VAM_OS_PUBLIC_BASE_URL;

beforeEach(() => {
  delete process.env.VAM_OS_PUBLIC_BASE_URL;
  sentRows.fetch.mockReset();
  vi.stubGlobal("fetch", sentRows.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (before === undefined) delete process.env.VAM_OS_PUBLIC_BASE_URL;
  else process.env.VAM_OS_PUBLIC_BASE_URL = before;
});

describe("link trong thư hỏi lại báo lỗi", () => {
  it("không biết địa chỉ trang thì KHÔNG gửi thư mang link hỏng", async () => {
    const result = await sendBaoLoiHoiLai(input);
    expect(result.ok).toBe(false);
    expect(sentRows.fetch).not.toHaveBeenCalled();
  });
  it("thư dựng từ địa chỉ tuyệt đối có link mở được", () => {
    const built = buildBaoLoiHoiLaiEmail({ recipientName: "Vy", ma: "VAM00009", tieuDe: "Form", cauHoi: "?", replyUrl: "https://os.example.test/bao-loi?ticket=VAM00009" });
    expect(built.html).toContain('href="https://os.example.test/bao-loi?ticket=VAM00009"');
  });
  it("hàm hỏi lại truyền địa chỉ của yêu cầu đang chạy", () => {
    const code = source("lib/bao-loi.ts");
    const call = code.slice(code.indexOf("await sendBaoLoiHoiLai({"));
    expect(call.slice(0, call.indexOf("});"))).toContain("requestOrigin: await getPublicOrigin()");
  });
});

describe("thư xác nhận khi nộp đơn", () => {
  it("truyền địa chỉ trang để thư mentor giữ được nút chọn giờ phỏng vấn", () => {
    const code = source("app/actions/apply.ts");
    const call = code.slice(code.indexOf("await sendApplicationConfirmation({"));
    expect(call.slice(0, call.indexOf("});"))).toContain("requestOrigin: await getPublicOrigin()");
  });
});
