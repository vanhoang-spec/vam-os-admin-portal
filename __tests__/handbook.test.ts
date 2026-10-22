/**
 * Handbook mentee/mentor lưu trên VAM OS (BTC 22/10/2026) — file cố định trong kho mã, phát ở
 * /tai-lieu/…, thư kết quả ghép cặp lấy link từ đây.
 *
 * Điều phải đúng: không bao giờ gửi link tới một file chưa có (ready ⇔ file có thật trong kho); đường
 * dẫn mở được khi chưa đăng nhập, nhưng chỉ đúng tiền tố đó; chưa có file thì trả "đang cập nhật"
 * thay vì làm build đỏ.
 */
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));

import { HANDBOOKS, handbookUrl } from "@/lib/handbook";
import { ROUND2_GUIDE_PDF_SOURCE } from "@/lib/matching-round2-link-core";
import { GET as menteeRoute } from "@/app/tai-lieu/handbook-mentee.pdf/route";
import { GET as mentorRoute } from "@/app/tai-lieu/handbook-mentor.pdf/route";
import { middleware } from "@/middleware";

const REAL = JSON.parse(JSON.stringify(HANDBOOKS)) as typeof HANDBOOKS;
afterEach(() => {
  for (const role of ["mentee", "mentor"] as const) Object.assign(HANDBOOKS[role], REAL[role]);
});

describe("1. danh mục Handbook", () => {
  it.each(["mentee", "mentor"] as const)("%s: bật ready khi và chỉ khi file có thật trong kho", (role) => {
    expect(REAL[role].ready).toBe(existsSync(REAL[role].source));
  });

  it("đường dẫn cố định dưới /tai-lieu/, mỗi vai một file", () => {
    expect(HANDBOOKS.mentee.path).toBe("/tai-lieu/handbook-mentee.pdf");
    expect(HANDBOOKS.mentor.path).toBe("/tai-lieu/handbook-mentor.pdf");
    // Route nằm đúng chỗ đường dẫn nói.
    for (const role of ["mentee", "mentor"] as const) expect(existsSync(`app${HANDBOOKS[role].path}/route.ts`)).toBe(true);
  });

  it("file không nằm trong public/ (thư mục bị cấm có chủ ý)", () => {
    for (const role of ["mentee", "mentor"] as const) expect(HANDBOOKS[role].source.startsWith("public/")).toBe(false);
  });

  it("link trên VAM OS khi có file; null khi chưa có — thư không bao giờ mang link tới file chưa có", () => {
    HANDBOOKS.mentee.ready = true;
    HANDBOOKS.mentor.ready = false;
    expect(handbookUrl("https://os.alumni-mentoring.edu.vn/", "mentee")).toBe("https://os.alumni-mentoring.edu.vn/tai-lieu/handbook-mentee.pdf");
    expect(handbookUrl("https://os.alumni-mentoring.edu.vn", "mentor")).toBeNull();
  });
});

describe("2. đường dẫn file", () => {
  it("chưa có file: 404 kèm câu “đang cập nhật”, không đọc đĩa", async () => {
    HANDBOOKS.mentee.ready = false;
    HANDBOOKS.mentee.source = "docs/handbook/khong-ton-tai.pdf";
    const res = await menteeRoute();
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("đang được Ban Tổ chức cập nhật");
  });

  it("có file: trả đúng byte của file, kiểu PDF, mở ngay trong trình duyệt", async () => {
    HANDBOOKS.mentor.ready = true;
    HANDBOOKS.mentor.source = ROUND2_GUIDE_PDF_SOURCE;
    const res = await mentorRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect(res.headers.get("Content-Disposition")).toContain(HANDBOOKS.mentor.filename);
    expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(ROUND2_GUIDE_PDF_SOURCE))).toBe(true);
  });

  it("route dựng sẵn lúc build (force-static): production không đọc đĩa", () => {
    for (const role of ["mentee", "mentor"] as const) {
      expect(readFileSync(`app${HANDBOOKS[role].path}/route.ts`, "utf8")).toMatch(/export const dynamic = "force-static"/);
    }
  });
});

describe("3. mở được khi chưa đăng nhập — chỉ đúng tiền tố /tai-lieu/", () => {
  const request = (path: string) => new NextRequest(`https://os.test${path}`);

  it.each(["/tai-lieu/handbook-mentee.pdf", "/tai-lieu/handbook-mentor.pdf"])("%s: không bị đưa về trang đăng nhập", async (path) => {
    const res = await middleware(request(path));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-vam-public-route")).toBe("document");
  });

  it.each(["/tai-lieu", "/tai-lieux/handbook-mentee.pdf", "/handbook-mentee.pdf"])("%s: vẫn đòi đăng nhập", async (path) => {
    const res = await middleware(request(path));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("layout nhận nhãn này làm khung trần", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('publicRoute === "document"');
  });
});
