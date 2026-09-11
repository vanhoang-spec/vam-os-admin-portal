/**
 * Trang /participant-accounts: ai vào được, và KHÔNG đọc danh sách trước khi
 * biết người xem được vận hành đúng mùa này.
 *
 * Danh sách mang email của hàng trăm người. Đọc trước rồi mới kiểm là đã để
 * dữ liệu đi qua một chỗ không nên đi qua.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const h = vi.hoisted(() => ({
  user: null as any,
  access: { ok: true, actor: { id: "admin-1" } } as any,
  roster: null as any,
  redirects: [] as string[]
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    h.redirects.push(url);
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;push;${url};307;`;
    throw error;
  })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/season-context", () => {
  class SeasonContextError extends Error {}
  class SeasonAccessDeniedError extends Error {}
  const seasonId = "11111111-1111-4111-8111-111111111111";
  return {
    SEASON_CONTEXT_ERROR_MESSAGE: "Không thể xác minh mùa vận hành được yêu cầu.",
    SeasonContextError,
    SeasonAccessDeniedError,
    resolveSeasonContext: vi.fn(async () => ({
      currentProgramId: "prog",
      selectedSeasonId: seasonId,
      selectedSeasonCode: "UEHM-S12",
      availableSeasons: [{ id: seasonId, code: "UEHM-S12", name: "UEH Mentoring Mùa 12", programId: "prog" }],
      effectiveScope: {}
    }))
  };
});
vi.mock("@/lib/participant-invites", () => ({ authorizeParticipantInvites: vi.fn(async () => h.access) }));
vi.mock("@/lib/login-invite-roster", () => ({ loadLoginInviteRoster: vi.fn(async () => h.roster) }));
vi.mock("@/app/participant-accounts/bulk-invite-panel", async () => {
  const react = await import("react");
  return {
    BulkInvitePanel: (props: { eligible: number; gateOpen: boolean }) =>
      react.createElement("div", { "data-testid": "bulk", "data-eligible": props.eligible, "data-gate": String(props.gateOpen) })
  };
});
vi.mock("@/app/participant-accounts/roster-client", async () => {
  const react = await import("react");
  return {
    RosterClient: (props: { rows: unknown[] }) =>
      react.createElement("div", { "data-testid": "roster", "data-rows": props.rows.length })
  };
});

import ParticipantAccountsPage, { dynamic, maxDuration } from "@/app/participant-accounts/page";
import { loadLoginInviteRoster } from "@/lib/login-invite-roster";
import { summarizeRoster, type RosterRow } from "@/lib/participant-invite-core";
import { authorizeParticipantInvites } from "@/lib/participant-invites";

const SEASON = "11111111-1111-4111-8111-111111111111";

const user = (role: string) => ({ id: "u-1", email: "u@vam.org", full_name: "U", role, status: "active", auth_user_id: null });

function row(n: number, overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    personId: `p-${n}`,
    fullName: `Người ${n}`,
    email: `p${n}@example.com`,
    roles: ["mentor"],
    status: "not_invited",
    blockReason: null,
    inFlight: false,
    everSent: false,
    lastSentAt: null,
    latest: null,
    activatedAt: null,
    ...overrides
  };
}

async function renderPage() {
  return renderToStaticMarkup(await ParticipantAccountsPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.redirects.length = 0;
  h.user = user("admin");
  h.access = { ok: true, actor: { id: "u-1" } };
  const rows = [row(1), row(2), row(3, { status: "active", activatedAt: "2026-09-01T00:00:00Z" })];
  h.roster = { ok: true, rows, summary: summarizeRoster(rows), sentLast24h: 12, budgetLeft: 228, gateOpen: true };
});

describe("ai vào được", () => {
  it("chưa đăng nhập thì về trang đăng nhập", async () => {
    h.user = null;
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/login"]);
  });

  it.each(["viewer", "reviewer"])("%s bị đưa về trang chủ, không đọc gì", async (role) => {
    h.user = user(role);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/"]);
    expect(authorizeParticipantInvites).not.toHaveBeenCalled();
    expect(loadLoginInviteRoster).not.toHaveBeenCalled();
  });

  it("support_team không có quyền vận hành mùa: nói rõ, và KHÔNG đọc danh sách", async () => {
    h.user = user("support_team");
    h.access = { ok: false, code: "season_forbidden", message: "Bạn không có quyền vận hành mùa này." };

    const html = await renderPage();

    expect(html).toContain("Bạn cần quyền vận hành Mùa 12 để xem và mời tài khoản.");
    expect(authorizeParticipantInvites).toHaveBeenCalledWith(SEASON);
    expect(loadLoginInviteRoster).not.toHaveBeenCalled();
    expect(html).not.toContain('data-testid="bulk"');
    expect(html).not.toContain('data-testid="roster"');
  });
});

describe("dữ liệu", () => {
  it("đọc đúng mùa đã chọn", async () => {
    await renderPage();
    expect(loadLoginInviteRoster).toHaveBeenCalledWith(SEASON, expect.any(Number));
  });

  it("đọc hỏng thì chỉ có hộp lỗi — không số liệu, không nút mời", async () => {
    h.roster = { ok: false, error: "Không đọc được trạng thái tài khoản của mùa này." };

    const html = await renderPage();

    expect(html).toContain("Không đọc được trạng thái tài khoản của mùa này.");
    expect(html).not.toContain("Đã gửi thư, chưa vào");
    expect(html).not.toContain('data-testid="bulk"');
    expect(html).not.toContain('data-testid="roster"');
  });

  it("đọc được thì có số liệu, khung mời hàng loạt đếm đúng người đủ điều kiện, và đủ các dòng", async () => {
    const html = await renderPage();

    expect(html).toContain("Đã gửi thư, chưa vào");
    expect(html).toContain("12/300");
    expect(html).toContain('data-eligible="2"');
    expect(html).toContain('data-rows="3"');
  });

  it("trang chạy động và đủ thời gian cho một lượt mời", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });
});
