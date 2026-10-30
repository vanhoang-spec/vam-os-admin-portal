/**
 * @vitest-environment jsdom
 */
/**
 * Banner và logo của form (VAM00009 mục 4.1). Đường dẫn ảnh đến từ trình duyệt là thứ người gửi tự đặt được:
 * chỉ nhận đường dẫn đúng thư mục của chính form đó, đúng loại ảnh.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { isFormImagePath, newFormImagePath, parseFormSettings } from "@/lib/custom-form-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
vi.mock("server-only", () => ({}));

import { FormHeader } from "@/app/f/[code]/form-header";

const FORM = "31c72fc5-01e2-40db-821a-d17d0e6a6688";
const OTHER = "11111111-1111-4111-8111-111111111111";
const UUID = "22222222-2222-4222-8222-222222222222";
afterEach(cleanup);

describe("đường dẫn ảnh", () => {
  it("nhận đúng thư mục form, đúng loại", () => {
    const banner = newFormImagePath(FORM, "banner", UUID);
    expect(isFormImagePath(FORM, banner, "banner")).toBe(true);
    expect(isFormImagePath(FORM, banner)).toBe(true);
    expect(isFormImagePath(FORM, banner, "logo")).toBe(false);
  });
  it("từ chối ảnh của form khác, đường dẫn lạ, và kiểu nhảy thư mục", () => {
    expect(isFormImagePath(OTHER, newFormImagePath(FORM, "logo", UUID))).toBe(false);
    expect(isFormImagePath(FORM, `${FORM}/../${OTHER}/logo-${UUID}`)).toBe(false);
    expect(isFormImagePath(FORM, `${FORM}/logo-${UUID}/x`)).toBe(false);
    expect(isFormImagePath(FORM, `${FORM}/anh.svg`)).toBe(false);
    expect(isFormImagePath(FORM, "")).toBe(false);
    expect(isFormImagePath(FORM, null)).toBe(false);
  });
});

describe("cài đặt vị trí logo", () => {
  const base = { title: "T", description: "", programId: "", thankYou: "", onePerEmail: false, opensAt: null, closesAt: null };
  it("mặc định bên trái, nhận ba vị trí, từ chối giá trị lạ", () => {
    const none = parseFormSettings(base);
    expect(none.ok && none.settings.logoPosition).toBe("left");
    const center = parseFormSettings({ ...base, logoPosition: "center" });
    expect(center.ok && center.settings.logoPosition).toBe("center");
    expect(parseFormSettings({ ...base, logoPosition: "top;x" }).ok).toBe(false);
  });
});

describe("phần đầu form", () => {
  const props = { title: "Form", description: "", closesAt: null };
  it("không có ảnh thì không có thẻ img nào", () => {
    const { container } = render(<FormHeader {...props} />);
    expect(container.querySelector("img")).toBeNull();
  });
  it("hiện banner, logo đúng link và đúng vị trí", () => {
    const { container } = render(<FormHeader {...props} bannerUrl="https://kho/banner" logoUrl="https://kho/logo" logoPosition="right" />);
    expect(container.querySelector('[data-testid="form-banner"]')?.getAttribute("src")).toBe("https://kho/banner");
    expect(container.querySelector('[data-testid="form-logo"]')?.getAttribute("src")).toBe("https://kho/logo");
    expect(container.querySelector('[data-testid="form-logo-row"]')?.className).toContain("justify-end");
    cleanup();
    const centered = render(<FormHeader {...props} logoUrl="https://kho/logo" logoPosition="center" />);
    expect(centered.container.querySelector('[data-testid="form-logo-row"]')?.className).toContain("justify-center");
  });
});
