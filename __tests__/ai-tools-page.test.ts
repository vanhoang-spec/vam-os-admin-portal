/**
 * Trang /ai: ai vào được, thẻ báo cáo hiện cho ai, và một mùa không xác định được
 * chỉ tắt đúng thẻ báo cáo.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  redirect: vi.fn(),
  resolveSeasonContext: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/season-context", () => ({ resolveSeasonContext: mocks.resolveSeasonContext }));
vi.mock("@/app/ai/ai-tools", () => ({
  BrainstormTool: () => React.createElement("div", null, "tool:brainstorm"),
  ContentTool: () => React.createElement("div", null, "tool:content"),
  CanvaBriefTool: () => React.createElement("div", null, "tool:canva"),
  ExecutiveReportTool: (props: { seasonCode: string; seasonName: string }) =>
    React.createElement("div", null, `tool:report:${props.seasonCode}:${props.seasonName}`),
  TrendTool: (props: { webSearchOn: boolean }) => React.createElement("div", null, `tool:trend:${props.webSearchOn}`),
  DocumentTool: () => React.createElement("div", null, "tool:document")
}));

import AiToolsPage from "@/app/ai/page";

const SEASON_ID = "00000000-0000-4000-8000-0000000000aa";

function signedInAs(role: string | null) {
  mocks.getCurrentAdminUser.mockResolvedValue(role ? { id: "u1", email: "a@vam.org", full_name: "A", role, status: "active", auth_user_id: null } : null);
}

async function render() {
  return renderToStaticMarkup(await AiToolsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.resolveSeasonContext.mockResolvedValue({
    currentProgramId: "p1",
    selectedSeasonId: SEASON_ID,
    selectedSeasonCode: "UEHM-S12",
    availableSeasons: [{ id: SEASON_ID, code: "UEHM-S12", name: "UEH Mentoring Season 12", programId: "p1" }],
    effectiveScope: { allowedSeasonIds: [SEASON_ID] }
  });
  vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
  vi.stubEnv("TAVILY_API_KEY", "");
});

describe("cổng trang", () => {
  it("chưa đăng nhập thì về /login", async () => {
    signedInAs(null);
    await expect(render()).rejects.toThrow("redirect:/login");
  });

  it.each(["reviewer", "viewer"])("%s thì về trang chủ", async (role) => {
    signedInAs(role);
    await expect(render()).rejects.toThrow("redirect:/");
  });
});

describe("công cụ theo vai trò", () => {
  it.each(["core_team", "support_team"])("%s thấy năm công cụ, không thấy báo cáo, không đọc mùa", async (role) => {
    signedInAs(role);
    const html = await render();
    for (const tool of ["brainstorm", "content", "canva", "trend:false", "document"]) expect(html).toContain(`tool:${tool}`);
    expect(html).not.toContain("tool:report");
    expect(html).not.toContain("/ai/status");
    expect(mocks.resolveSeasonContext).not.toHaveBeenCalled();
  });

  it.each(["super_admin", "admin"])("%s thấy báo cáo của mùa đang chọn và link trạng thái", async (role) => {
    signedInAs(role);
    const html = await render();
    expect(html).toContain("tool:report:UEHM-S12:Mùa 12");
    expect(html).toContain('href="/ai/status"');
  });

  it("không xác định được mùa thì chỉ thẻ báo cáo báo lỗi, các công cụ khác vẫn còn", async () => {
    signedInAs("admin");
    mocks.resolveSeasonContext.mockRejectedValue(new Error("không có mùa"));
    const html = await render();
    expect(html).not.toContain("tool:report");
    expect(html).toContain("không xác định được mùa bạn được cấp quyền");
    expect(html).toContain("tool:brainstorm");
  });
});

describe("trạng thái cấu hình", () => {
  it("chưa có khoá DeepSeek thì hiện băng cảnh báo", async () => {
    signedInAs("core_team");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(await render()).toContain("chưa được cấu hình khoá API DeepSeek");
  });

  it("có khoá thì không hiện băng, và Tavily bật thì công cụ xu hướng biết", async () => {
    signedInAs("core_team");
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    const html = await render();
    expect(html).not.toContain("chưa được cấu hình khoá API DeepSeek");
    expect(html).toContain("tool:trend:true");
  });

  it("trang không bao giờ in khoá ra", async () => {
    signedInAs("admin");
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-bi-mat-123");
    expect(await render()).not.toContain("sk-bi-mat-123");
  });
});
