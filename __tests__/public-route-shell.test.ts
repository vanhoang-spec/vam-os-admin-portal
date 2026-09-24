/**
 * Đường công khai phải đi khung trần, không đi khung của ban tổ chức.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * 13/09/2026: người đăng ký bấm "Mở vé trên trình duyệt" trong thư xác nhận và
 * thấy "Cần đăng nhập — Vui lòng đăng nhập bằng tài khoản admin" thay cho tấm
 * vé. Middleware đã cho `/ve/<mã>` đi qua và gắn nhãn "ticket", nhưng
 * `app/layout.tsx` chỉ nhận bốn nhãn register/checkin/renewal/blog, nên trang
 * vé rơi xuống AppShell — và AppShell không có tài khoản admin thì vẽ khung
 * đăng nhập thay cho nội dung.
 *
 * Hai danh sách nhãn nằm ở hai file và đã lệch nhau. Bộ test này canh cả hai
 * phía: mọi nhãn middleware gắn đều được layout nhận, và layout thật sự trả
 * khung trần cho từng nhãn — không gọi AppShell, không đọc tài khoản admin.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValues = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (name: string) => headerValues.get(name.toLowerCase()) ?? null }))
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: vi.fn(() => createElement("div", null, "KHUNG-BAN-TO-CHUC"))
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => null) }));
vi.mock("@/components/preview-environment-banner", () => ({ PreviewEnvironmentBanner: () => null }));
vi.mock("@/components/participant-shell", () => ({ ParticipantShell: vi.fn(() => null) }));
vi.mock("@/lib/participant-person", () => ({ getParticipantDisplayName: vi.fn(async () => null) }));
vi.mock("../app/globals.css", () => ({}));

import RootLayout from "@/app/layout";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";

/** Các nhãn middleware gắn cho đường công khai, đọc thẳng từ mã nguồn. */
function middlewarePublicLabels() {
  const source = readFileSync("middleware.ts", "utf8");
  const start = source.indexOf("const publicRoute =");
  const end = source.indexOf('requestHeaders.set("x-vam-public-route"', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // Chuỗi không có dấu "/" là nhãn; chuỗi có "/" là đường dẫn đem ra so.
  const labels = Array.from(source.slice(start, end).matchAll(/"([a-z_]+)"/g)).map((match) => match[1]);
  return Array.from(new Set(labels));
}

async function renderWith(label: string | null) {
  headerValues.clear();
  if (label) headerValues.set("x-vam-public-route", label);
  const tree = await RootLayout({ children: createElement("p", null, "NOI-DUNG-TRANG") });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("1. hai danh sách nhãn không được lệch nhau", () => {
  it("đọc ra đủ các nhãn middleware đang gắn, trong đó có vé", () => {
    const labels = middlewarePublicLabels();
    expect(labels).toEqual(
      expect.arrayContaining(["register", "checkin", "ticket", "renewal", "blog", "survey", "interview_booking", "mentee_session_booking"])
    );
  });

  it("mọi nhãn middleware gắn đều được layout nhận làm khung trần", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    for (const label of middlewarePublicLabels()) {
      expect(layout, `layout thiếu nhãn "${label}" mà middleware đang gắn`).toContain(`publicRoute === "${label}"`);
    }
  });
});

describe("2. layout thật sự trả khung trần", () => {
  it.each(["register", "checkin", "ticket", "renewal", "blog", "survey", "interview_booking", "mentee_session_booking"])(
    "nhãn %s: hiện nội dung trang, không vẽ khung ban tổ chức, không đọc tài khoản admin",
    async (label) => {
      const html = await renderWith(label);

      expect(html).toContain("NOI-DUNG-TRANG");
      expect(html).not.toContain("KHUNG-BAN-TO-CHUC");
      expect(AppShell).not.toHaveBeenCalled();
      expect(getCurrentAdminUser).not.toHaveBeenCalled();
    }
  );

  it("đường không mang nhãn công khai vẫn đi khung ban tổ chức — bản giả ở trên có tác dụng thật", async () => {
    const html = await renderWith(null);

    expect(html).toContain("KHUNG-BAN-TO-CHUC");
    expect(AppShell).toHaveBeenCalled();
  });

  it("nhãn lạ do ai đó tự đặt không mở được khung trần", async () => {
    const html = await renderWith("admin");

    expect(html).toContain("KHUNG-BAN-TO-CHUC");
  });
});
