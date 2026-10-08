/** @vitest-environment jsdom */
/**
 * Mở lại link gia hạn cho mentor đã bấm "Từ chối" rồi đổi ý (BTC 08/10/2026).
 *
 * Soát: nút chỉ hiện trên lời từ chối MỚI NHẤT của người chưa đồng ý và chưa có link
 * sống; bấm thì tạo đúng MỘT lời mời mới cho đúng người/chương trình/mùa và KHÔNG thu
 * hồi gì; mọi lời mời không phải "Từ chối" bị từ chối trước khi gọi database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/renewals", () => ({
  createRenewalInviteAction: vi.fn(),
  regenerateRenewalInviteAction: vi.fn(),
  reopenDeclinedRenewalInviteAction: vi.fn(),
  revokeRenewalInviteAction: vi.fn(),
  confirmRenewalAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: (action: unknown, initial: unknown) => [initial, action], useFormStatus: () => ({ pending: false }) };
});

import { reopenableDeclinedInviteIds, type RenewalConsoleRow } from "@/lib/renewal-console";
import { reopenDeclinedRenewalInvite } from "@/lib/renewal-runtime";
import { RenewalInviteActions } from "@/app/admin/renewals/renewal-controls";

const NOW = Date.parse("2026-10-08T09:00:00.000Z");
const FUTURE = "2026-10-20T00:00:00.000Z";
const PAST = "2026-09-12T04:30:41.916Z";
const IDS = {
  invite: "00000000-0000-4000-8000-000000000001",
  person: "00000000-0000-4000-8000-000000000002",
  program: "00000000-0000-4000-8000-000000000003",
  season: "00000000-0000-4000-8000-000000000004"
};

const inv = (id: string, person: string, created: string, extra: Record<string, unknown> = {}) => ({
  id, person_id: person, created_at: created, expires_at: PAST, revoked_at: null, outcome: null, ...extra
});

afterEach(cleanup);

describe("dòng nào được mở lại", () => {
  it("lời từ chối của người chưa được mời lại: mở lại được (đúng ca chị Thanh Lan: từ chối 06/09, link cũ hết hạn 12/09)", () => {
    const ids = reopenableDeclinedInviteIds([inv("lan", "p-lan", "2026-08-29T04:30:44Z", { outcome: "declined" })], NOW);
    expect(Array.from(ids)).toEqual(["lan"]);
  });

  it("từ chối hai lần: chỉ lời từ chối MỚI NHẤT mang nút", () => {
    const ids = reopenableDeclinedInviteIds([
      inv("cu", "p1", "2026-08-29T00:00:00Z", { outcome: "declined" }),
      inv("moi", "p1", "2026-09-20T00:00:00Z", { outcome: "declined" })
    ], NOW);
    expect(Array.from(ids)).toEqual(["moi"]);
  });

  it("đã được mời lại và link còn sống, hoặc đã đồng ý: không còn nút", () => {
    const ids = reopenableDeclinedInviteIds([
      inv("tc-live", "p-live", "2026-08-29T00:00:00Z", { outcome: "declined" }),
      inv("live", "p-live", "2026-10-08T00:00:00Z", { expires_at: FUTURE }),
      inv("tc-ok", "p-ok", "2026-08-29T00:00:00Z", { outcome: "declined" }),
      inv("ok", "p-ok", "2026-10-01T00:00:00Z", { outcome: "accepted" })
    ], NOW);
    expect(ids.size).toBe(0);
  });

  it("được mời lại nhưng link mới đã hết hạn hoặc bị thu hồi: lại mở được", () => {
    const ids = reopenableDeclinedInviteIds([
      inv("tc1", "p1", "2026-08-29T00:00:00Z", { outcome: "declined" }),
      inv("het-han", "p1", "2026-09-20T00:00:00Z"),
      inv("tc2", "p2", "2026-08-29T00:00:00Z", { outcome: "declined" }),
      inv("thu-hoi", "p2", "2026-09-20T00:00:00Z", { expires_at: FUTURE, revoked_at: "2026-09-21T00:00:00Z" })
    ], NOW);
    expect(Array.from(ids).sort()).toEqual(["tc1", "tc2"]);
  });

  it("lời mời chưa trả lời hay đã đồng ý không bao giờ mang nút này", () => {
    const ids = reopenableDeclinedInviteIds([inv("a", "p1", "2026-08-29T00:00:00Z"), inv("b", "p2", "2026-08-29T00:00:00Z", { outcome: "accepted" })], NOW);
    expect(ids.size).toBe(0);
  });
});

function query(data: unknown) {
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return chain;
}

describe("mở lại phía máy chủ", () => {
  const declined = { id: IDS.invite, person_id: IDS.person, program_id: IDS.program, season_id: IDS.season, role: "mentor", outcome: "declined" };

  it("tạo đúng MỘT lời mời mới cho đúng người/chương trình/mùa, không thu hồi gì, trả link hiện một lần", async () => {
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "created", invite_id: "new" }], error: null }));
    const from = vi.fn(() => query(declined));
    const result = await reopenDeclinedRenewalInvite({ actorAdminUserId: "admin-1", inviteId: IDS.invite, expiresAt: FUTURE }, { from, rpc } as any);
    expect(result).toMatchObject({ ok: true, outcome: "reopened" });
    expect(result.renewalPath).toMatch(/^\/renew\/[A-Za-z0-9_-]{43}$/);
    expect(rpc.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["vam071_create_renewal_invite"]);
    expect((rpc.mock.calls[0] as unknown[])[1]).toMatchObject({
      p_person_id: IDS.person, p_program_id: IDS.program, p_season_id: IDS.season, p_role: "mentor", p_expires_at: FUTURE
    });
  });

  for (const [label, row] of [
    ["chưa trả lời", { ...declined, outcome: null }],
    ["đã đồng ý", { ...declined, outcome: "accepted" }],
    ["lời mời mentee", { ...declined, role: "mentee" }],
    ["không tìm thấy", null]
  ] as const) {
    it(`lời mời ${label}: từ chối, không gọi database tạo gì`, async () => {
      const rpc = vi.fn();
      const result = await reopenDeclinedRenewalInvite({ actorAdminUserId: "admin-1", inviteId: IDS.invite, expiresAt: FUTURE }, { from: vi.fn(() => query(row)), rpc } as any);
      expect(result.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("database từ chối (đã có link sống / đã đồng ý): báo rõ, không có link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({ data: null, error: { code: "23505" } }));
    const result = await reopenDeclinedRenewalInvite({ actorAdminUserId: "admin-1", inviteId: IDS.invite, expiresAt: FUTURE }, { from: vi.fn(() => query(declined)), rpc } as any);
    expect(result.ok).toBe(false);
    expect(result.renewalPath).toBeUndefined();
    expect(result.message).toContain("đã có một link đang hiệu lực hoặc đã đồng ý");
  });
});

describe("nút trên dòng 'Từ chối'", () => {
  const row = (over: Partial<RenewalConsoleRow>): RenewalConsoleRow => ({
    id: IDS.invite, personId: IDS.person, personName: "Đặng Thụy Thanh Lan", personEmail: "lan@example.test", mentorCode: null,
    inviteSource: "s11_renewal", seasonCode: "UEHM-S12", inviteState: "declined", expiresAt: PAST, createdAt: "2026-08-29T04:30:44Z",
    applicationId: null, applicationStatus: null, renewalOutcome: "declined", membershipStatus: null, needsAttention: false,
    attentionReason: null, diff: [], coreTeamNote: null, declineFeedback: null, commitmentsCompleted: null, canReopen: true, ...over
  });

  it("dòng mở lại được: có nút 'Mở lại link gia hạn' mang đúng invite_id, không có nút Tạo lại/Thu hồi", () => {
    render(<RenewalInviteActions row={row({})} />);
    const form = screen.getByTestId("renewal-reopen");
    expect(screen.getByRole("button", { name: "Mở lại link gia hạn" })).toBeTruthy();
    expect((form.querySelector('input[name="invite_id"]') as HTMLInputElement).value).toBe(IDS.invite);
    expect(screen.queryByRole("button", { name: "Tạo lại" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Thu hồi" })).toBeNull();
  });

  it("dòng từ chối cũ / người đã được mời lại: không có nút", () => {
    render(<RenewalInviteActions row={row({ canReopen: false })} />);
    expect(screen.queryByRole("button", { name: "Mở lại link gia hạn" })).toBeNull();
  });
});
