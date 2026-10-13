/**
 * @vitest-environment jsdom
 */
/**
 * Khung "Support team" trên TRANG HỒ SƠ THẬT (BTC 13/10/2026).
 *
 * Các test khác khoá luật ghi và khung riêng lẻ; ở đây khoá phần nối: khung có mặt trên trang khi
 * người xem được tích, ẩn hẳn khi không, nằm TRƯỚC khung "Trạng thái tham gia", phản ánh đúng trạng
 * thái đọc được, và hành động được gắn mã người từ ĐƯỜNG DẪN (không từ ô ẩn của biểu mẫu).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() })
}));
vi.mock("next/link", () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock("react-dom", () => ({ useFormState: () => [{ status: "idle", message: null }, vi.fn()], useFormStatus: () => ({ pending: false }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));

import { getAdminScopeContext } from "@/lib/program-scope";
import { getSupportTeamPanel } from "@/lib/support-team-mark";
import { markSupportTeamAction } from "@/app/actions/support-team";

vi.mock("@/lib/program-scope", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getAdminScopeContext: vi.fn(),
    getScopeFilter: vi.fn(async () => undefined),
    canOperateAnyScope: vi.fn(() => true)
  };
});

vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => ({ id: "1", role: "Admin" })) }));

// Hai module của tính năng bị thay bằng bản giả: khung đã được test riêng; ở đây chỉ xem trang nối thế nào.
vi.mock("@/lib/support-team-mark", () => ({ getSupportTeamPanel: vi.fn() }));
const bound = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/support-team", () => ({ markSupportTeamAction: { bind: vi.fn(() => bound) } }));

vi.mock("@/lib/data", () => ({
  getPerson: vi.fn(async () => ({ data: { id: "1", full_name: "Test" } })),
  getPeople: vi.fn(async () => ({ data: [] })),
  getMentorProfiles: vi.fn(async () => ({ data: [] })),
  getMenteeProfiles: vi.fn(async () => ({ data: [] })),
  getApplications: vi.fn(async () => ({ data: [] })),
  getMatches: vi.fn(async () => ({ data: [] })),
  getSeasons: vi.fn(async () => ({ data: [{ id: "season-1", code: "UEHM-S12", program_id: "prog-1", name: "UEHM Season 12" }] })),
  getEvents: vi.fn(async () => ({ data: [] })),
  getOperationalTeamAssignmentsByPerson: vi.fn(async () => ({ data: [] })),
  getPrograms: vi.fn(async () => ({ data: [{ id: "prog-1", code: "UEHM", name: "UEHM" }] })),
  getIndustries: vi.fn(async () => ({ data: [] })),
  getFunctionAreas: vi.fn(async () => ({ data: [] })),
  getMentorProgramParticipations: vi.fn(async () => ({ data: [] })),
  getMentorIndustryLinks: vi.fn(async () => ({ data: [] })),
  getMentorFunctionAreaLinks: vi.fn(async () => ({ data: [] })),
  getEventParticipationsByPersonId: vi.fn(async () => ({ data: [] })),
  getMentoringRecapsByMenteePersonId: vi.fn(async () => ({ data: [] })),
  getMentoringRecapsByMentorPersonId: vi.fn(async () => ({ data: [] })),
  keyById: vi.fn((arr) => new Map(arr.map((x: any) => [x.id, x])))
}));

vi.mock("@/lib/lifecycle-crm", () => ({
  getPersonSeasonMemberships: vi.fn(async () => ({ data: [] })),
  getCrmNotesByPerson: vi.fn(async () => ({ data: [] })),
  createCrmNoteFormAction: vi.fn()
}));

import PersonDetailPage from "@/app/people/[id]/page";

async function renderPage() {
  vi.mocked(getAdminScopeContext).mockResolvedValue({
    isSuperAdmin: false,
    adminUser: { id: "1", role: "admin" } as any,
    programScopes: [{ scopeLevel: "operations", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
  } as any);
  const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
  return render(page);
}

describe("khung Support team trên trang hồ sơ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("người xem không được tích (dữ liệu khung = null): không có khung nào trên trang", async () => {
    vi.mocked(getSupportTeamPanel).mockResolvedValue(null);
    const { container } = await renderPage();
    expect(container.querySelector('[data-testid="support-team-panel"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("h2")).map((h) => h.textContent)).not.toContain("Support team");
    // Phần còn lại của trang vẫn dựng bình thường.
    expect(Array.from(container.querySelectorAll("h2")).map((h) => h.textContent)).toContain("Trạng thái tham gia");
  });

  it("đọc khung bằng ĐÚNG mã người của đường dẫn", async () => {
    vi.mocked(getSupportTeamPanel).mockResolvedValue(null);
    await renderPage();
    expect(getSupportTeamPanel).toHaveBeenCalledTimes(1);
    expect(getSupportTeamPanel).toHaveBeenCalledWith("1");
  });

  it("chưa là Support team: hiện khung có ô tích, ngay TRƯỚC khung 'Trạng thái tham gia'", async () => {
    vi.mocked(getSupportTeamPanel).mockResolvedValue({ seasonCode: "UEHM-S12", state: "unmarked", sendCount: 0 });
    const { container } = await renderPage();

    const panel = container.querySelector('[data-testid="support-team-panel"]');
    expect(panel?.getAttribute("data-state")).toBe("unmarked");
    expect(panel?.querySelector('input[type="checkbox"][name="support_team"]')).not.toBeNull();
    expect(panel?.textContent).toContain("UEHM-S12");
    expect(panel?.textContent).toContain("Test tự thành mentee");

    const headings = Array.from(container.querySelectorAll("h2"));
    const support = headings.find((h) => h.textContent === "Support team");
    const participation = headings.find((h) => h.textContent === "Trạng thái tham gia");
    expect(support).toBeDefined();
    expect(participation).toBeDefined();
    expect(support!.compareDocumentPosition(participation!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("đã là Support team: khung ở trạng thái marked, không còn ô tích", async () => {
    vi.mocked(getSupportTeamPanel).mockResolvedValue({ seasonCode: "UEHM-S12", state: "marked", sendCount: 0 });
    const { container } = await renderPage();
    const panel = container.querySelector('[data-testid="support-team-panel"]');
    expect(panel?.getAttribute("data-state")).toBe("marked");
    expect(panel?.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("đang trong danh sách thư mời: hiện ghi chú kèm số thư đã gửi", async () => {
    vi.mocked(getSupportTeamPanel).mockResolvedValue({ seasonCode: "UEHM-S12", state: "listed", sendCount: 3 });
    const { container } = await renderPage();
    expect(container.querySelector('[data-testid="support-team-listed"]')?.textContent).toContain("đã gửi 3 thư");
  });

  it("hành động được gắn mã người từ ĐƯỜNG DẪN ở phía máy chủ, không từ ô ẩn của biểu mẫu", async () => {
    vi.mocked(getSupportTeamPanel).mockResolvedValue({ seasonCode: "UEHM-S12", state: "unmarked", sendCount: 0 });
    const { container } = await renderPage();
    expect(vi.mocked(markSupportTeamAction.bind)).toHaveBeenCalledWith(null, "1");
    expect(container.querySelector('[data-testid="support-team-form"] input[type="hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="support-team-form"] input[name="person_id"]')).toBeNull();
  });
});
