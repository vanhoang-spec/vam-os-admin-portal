/**
 * Route xuất Word: chặn người không có quyền, không tin payload gửi lên, và đặt
 * tên file tiếng Việt mà không làm header vỡ.
 */
import mammoth from "mammoth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentAdminUser = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser }));

import { POST } from "@/app/api/ai-doc/docx/route";
import { AI_RESULT_NOTE } from "@/lib/ai/ai-core";
import { DOCX_MIME } from "@/lib/docx-builder";

const DOC = { title: "Kế hoạch Mùa 12", blocks: [{ type: "paragraph", text: "Nội dung chính" }] };

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return POST(new Request("http://localhost/api/ai-doc/docx", { method: "POST", body }));
}

function signedInAs(role: string | null) {
  getCurrentAdminUser.mockResolvedValue(role ? { id: "u1", email: "a@vam.org", full_name: "A", role, status: "active", auth_user_id: null } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  signedInAs("support_team");
});

describe("cổng", () => {
  it("chưa đăng nhập thì 401", async () => {
    signedInAs(null);
    expect((await post({ doc: JSON.stringify(DOC) })).status).toBe(401);
  });

  it.each(["reviewer", "viewer"])("%s thì 403", async (role) => {
    signedInAs(role);
    expect((await post({ doc: JSON.stringify(DOC) })).status).toBe(403);
  });

  it("không đọc được phiên thì 503, không cho qua", async () => {
    getCurrentAdminUser.mockRejectedValue(new Error("database down"));
    expect((await post({ doc: JSON.stringify(DOC) })).status).toBe(503);
  });
});

describe("payload", () => {
  it.each([
    ["thiếu trường doc", {}],
    ["JSON hỏng", { doc: "{không phải json" }],
    ["sai khuôn tài liệu", { doc: JSON.stringify({ title: "T", blocks: [] }) }],
    ["quá lớn", { doc: " ".repeat(2_000_001) }]
  ])("%s thì 400", async (_label, fields) => {
    expect((await post(fields as Record<string, string>)).status).toBe(400);
  });
});

describe("file Word", () => {
  it("trả .docx đọc được, đóng dấu AI ở cuối, không nhận dòng ghi chú từ form", async () => {
    const response = await post({ doc: JSON.stringify(DOC), note: "CHÈN TỪ FORM" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(DOCX_MIME);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const buffer = Buffer.from(await response.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    expect(value).toContain("Kế hoạch Mùa 12");
    expect(value).toContain("Nội dung chính");
    expect(value).toContain(AI_RESULT_NOTE);
    expect(value).not.toContain("CHÈN TỪ FORM");
  });

  it("tên file có bản ASCII và bản UTF-8 theo RFC 6266", async () => {
    const response = await post({ doc: JSON.stringify(DOC) });
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"Ke hoach Mua 12.docx\"; filename*=UTF-8''Ke%20hoach%20Mua%2012.docx"
    );
  });

  it("ký tự ngoài ASCII và ký tự đặc biệt không làm header vỡ", async () => {
    const response = await post({ doc: JSON.stringify({ ...DOC, title: "Mentor's day (S12) 🎯" }) });
    const header = response.headers.get("Content-Disposition") ?? "";
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(header).toContain('filename="Mentor\'s day (S12) __.docx"');
    expect(header).toContain("filename*=UTF-8''Mentor%27s%20day%20%28S12%29%20%F0%9F%8E%AF.docx");
  });
});
