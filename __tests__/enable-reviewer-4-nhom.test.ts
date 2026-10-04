/**
 * Cấp / thu bốn nhóm quyền phía máy chủ (BTC 04/10/2026): hai nhóm mentor chỉ Ban
 * điều hành — Support bị chặn TRƯỚC khi chạm database (database chặn thêm lần nữa:
 * vam084_grant… "Mentor recruitment participation requires core team"). Lỗi database
 * được dịch sang tiếng Việt cho người bấm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "os.alumni-mentoring.edu.vn" }) }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ canOperateSeason: vi.fn(), getAdminScopeContext: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendReviewerInvite: vi.fn() }));
vi.mock("@/lib/outbound-emails", () => ({ hasRecentSentEmail: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { enableMentorAsReviewer, revokeMentorRecruitmentParticipation } from "@/lib/enable-reviewer";

const input = (participationRole: any) => ({
  personId: "11111111-1111-1111-1111-111111111111",
  seasonId: "22222222-2222-2222-2222-222222222222",
  participationRole
});
const actor = (role: string) => vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role, email: "a@example.com" } as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminScopeContext).mockResolvedValue({} as any);
  vi.mocked(canOperateSeason).mockResolvedValue(true as any);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("hai nhóm mentor chỉ Ban điều hành", () => {
  for (const role of ["mentor_reviewer", "mentor_interviewer"]) {
    it(`Support cấp ${role}: bị chặn, không đọc / ghi database`, async () => {
      actor("support_team");
      const result = await enableMentorAsReviewer(input(role));
      expect(result).toEqual({ ok: false, message: "Chỉ Ban điều hành cấp / thu quyền chấm hồ sơ và phỏng vấn mentor." });
      expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    });

    it(`Support thu ${role}: bị chặn, không gọi RPC thu quyền`, async () => {
      actor("support_team");
      const result = await revokeMentorRecruitmentParticipation(input(role));
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Chỉ Ban điều hành");
      expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    });
  }

  it("Support thu nhóm mentee: được đi tiếp tới database", async () => {
    actor("support_team");
    const rpc = vi.fn().mockResolvedValue({ data: "admin-9", error: null });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc } as any);
    const result = await revokeMentorRecruitmentParticipation(input("interviewer"));
    expect(result).toMatchObject({ ok: true, message: "Đã thu hồi quyền phỏng vấn mentee trong đúng mùa." });
    expect(rpc).toHaveBeenCalledWith("vam084_revoke_recruitment_participation", expect.objectContaining({ p_participation_role: "interviewer" }));
  });

  it("Core team thu nhóm mentor: gửi đúng nhóm; lỗi database dịch sang tiếng Việt", async () => {
    actor("core_team");
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Mentor recruitment participation requires core team" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc } as any);
    const result = await revokeMentorRecruitmentParticipation(input("mentor_interviewer"));
    expect(rpc).toHaveBeenCalledWith("vam084_revoke_recruitment_participation", expect.objectContaining({ p_participation_role: "mentor_interviewer" }));
    expect(result).toEqual({ ok: false, message: "Chỉ Ban điều hành cấp / thu quyền chấm hồ sơ và phỏng vấn mentor." });
  });
});
