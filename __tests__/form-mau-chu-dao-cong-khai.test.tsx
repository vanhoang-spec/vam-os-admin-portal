/**
 * @vitest-environment jsdom
 */
/**
 * VAM00034: màu chủ đạo của Form tùy chỉnh phải lên nút trên trang công khai /f/<mã>, không chỉ ở bản xem thử.
 * Trước bản sửa, trang công khai không truyền `themeColor` vào `PublicForm`, nên nút "Gửi" / "Tiếp" giữ màu mặc định.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import type { CustomFormField } from "@/lib/custom-form-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = vi.hoisted(() => ({ getPublic: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/custom-forms", () => ({ getPublicCustomForm: h.getPublic }));
vi.mock("@/app/f/[code]/actions", () => ({ submitCustomFormAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));

import CustomFormPublicPage from "@/app/f/[code]/page";

const CODE = "a1b2c3d4e5f6";
const field = (id: string, type: CustomFormField["type"], extra: Partial<CustomFormField> = {}): CustomFormField => ({
  id,
  type,
  label: `Câu ${id}`,
  help: "",
  required: false,
  hidden: false,
  options: [],
  ...extra
});

function readyForm(themeColor: string | null, fields: CustomFormField[]) {
  return {
    state: "ready" as const,
    availability: "open" as const,
    title: "Form thử",
    description: "",
    fields,
    opensAt: null,
    closesAt: null,
    themeColor,
    bannerUrl: "",
    logoUrl: "",
    logoPosition: "left" as const
  };
}

async function renderPage() {
  const ui = await CustomFormPublicPage({ params: Promise.resolve({ code: CODE }) });
  return render(ui);
}

afterEach(() => {
  cleanup();
  h.getPublic.mockReset();
});

describe("Trang công khai /f/<mã> dùng màu chủ đạo của form (VAM00034)", () => {
  it("nút Gửi mang màu chủ đạo", async () => {
    h.getPublic.mockResolvedValue(readyForm("#7c3aed", [field("f_nameaaaa", "short_text")]));
    const { container } = await renderPage();
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="form-submit"]');
    expect(submit).not.toBeNull();
    expect(submit!.style.backgroundColor).toBe("rgb(124, 58, 237)");
  });

  it("nút Tiếp của form nhiều trang cũng mang màu chủ đạo", async () => {
    h.getPublic.mockResolvedValue(
      readyForm("#0f766e", [field("f_nameaaaa", "short_text"), field("f_brkaaaaa", "page_break"), field("f_noteaaaa", "short_text")])
    );
    const { container } = await renderPage();
    const next = container.querySelector<HTMLButtonElement>('[data-testid="page-next"]');
    expect(next).not.toBeNull();
    expect(next!.style.backgroundColor).toBe("rgb(15, 118, 110)");
  });

  it("form không chọn màu thì nút giữ màu mặc định (không có style nền)", async () => {
    h.getPublic.mockResolvedValue(readyForm(null, [field("f_nameaaaa", "short_text")]));
    const { container } = await renderPage();
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="form-submit"]');
    expect(submit!.style.backgroundColor).toBe("");
  });
});
