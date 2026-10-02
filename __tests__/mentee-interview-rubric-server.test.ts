/**
 * Cổng quyền của màn hình "Phiếu chấm & hướng dẫn mentee" (lib/mentee-interview-rubric.ts).
 *
 * Phiếu chấm quyết định cách chấm hàng trăm mentee, nên cổng phải đóng khi có
 * nghi ngờ: sai vai trò, không vận hành mùa, id mùa lạ, phiếu sai hình dạng —
 * tất cả dừng TRƯỚC khi gọi database. Ca "không gọi gì cả" quan trọng ngang ca
 * "gọi đúng" (CLAUDE.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SEASON = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  canOperateSeason: vi.fn(),
  getSeasons: vi.fn(),
  rpc: vi.fn(),
  readHandbookDocx: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/program-scope", () => ({
  canOperateSeason: mocks.canOperateSeason,
  getAdminScopeContext: vi.fn(async () => ({})),
  getScopeFilter: vi.fn(async () => ({}))
}));
vi.mock("@/lib/data", () => ({ getSeasons: mocks.getSeasons }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/ai/uploads", () => ({ readHandbookDocx: mocks.readHandbookDocx }));

import { getRubricEditorData, saveInterviewHandbook, saveInterviewRubric } from "@/lib/mentee-interview-rubric";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";

const validInput = () => ({ seasonId: SEASON, expectedVersion: 1, criteria: S12_INTERVIEW_CRITERIA, guidance: S12_INTERVIEW_GUIDANCE });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "btc", role: "core_team" });
  mocks.canOperateSeason.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { ok: true, version: 2 }, error: null });
  mocks.getSeasons.mockResolvedValue({ data: [{ id: OTHER, code: "UEHM-S11" }, { id: SEASON, code: "UEHM-S12" }], error: null });
});

describe("1. lưu phiếu — cổng đóng thì không chạm database", () => {
  it.each(["reviewer", "support_team", "viewer", "mentor"])("vai trò %s bị từ chối, không gọi RPC", async (role) => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "x", role });
    const result = await saveInterviewRubric(validInput());
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("chưa đăng nhập bị từ chối", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(null);
    expect((await saveInterviewRubric(validInput())).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("Core Team nhưng không vận hành mùa đó bị từ chối", async () => {
    mocks.canOperateSeason.mockResolvedValue(false);
    const result = await saveInterviewRubric(validInput());
    expect(result).toEqual({ ok: false, message: "Bạn không có quyền sửa phiếu chấm của mùa này." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("id mùa không phải uuid, phiên bản âm, phiếu sai hình dạng, tổng ≠ 100: không gọi RPC", async () => {
    expect((await saveInterviewRubric({ ...validInput(), seasonId: "'; drop table --" })).ok).toBe(false);
    expect((await saveInterviewRubric({ ...validInput(), expectedVersion: -1 })).ok).toBe(false);
    expect((await saveInterviewRubric({ ...validInput(), criteria: "x" })).ok).toBe(false);
    const heavy = S12_INTERVIEW_CRITERIA.map((c, i) => (i === 0 ? { ...c, weight: 40 } : c));
    const result = await saveInterviewRubric({ ...validInput(), criteria: heavy });
    expect(result.message).toContain("110%");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("hợp lệ: gửi đúng mùa, đúng phiên bản, phiếu đã làm gọn", async () => {
    const result = await saveInterviewRubric({ ...validInput(), guidance: { motto: "  M  ", note: "", reminder: "" } });
    expect(result).toEqual({ ok: true, message: "Đã lưu phiếu chấm (phiên bản 2)." });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("vam106_save_interview_rubric");
    expect(args).toMatchObject({ p_actor: "btc", p_season: SEASON, p_expected_version: 1, p_guidance: { motto: "M" } });
    expect(args.p_criteria).toHaveLength(4);
    expect(args.p_criteria[0]).toEqual(S12_INTERVIEW_CRITERIA[0]);
  });
  it("lỗi từ database được nói bằng tiếng Việt", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });
    expect((await saveInterviewRubric(validInput())).message).toContain("vừa được người khác lưu");
  });
});

describe("2. tải Handbook — chỉ đọc file qua readHandbookDocx", () => {
  const fd = (expected = "0") => {
    const f = new FormData();
    f.append("seasonId", SEASON);
    f.append("expectedHandbookVersion", expected);
    return f;
  };
  it("support_team bị từ chối, không đọc file, không gọi RPC", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "s", role: "support_team" });
    expect((await saveInterviewHandbook(fd())).ok).toBe(false);
    expect(mocks.readHandbookDocx).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("file bị từ chối thì báo nguyên lý do, không gọi RPC", async () => {
    mocks.readHandbookDocx.mockResolvedValue({ ok: false, message: "a.pdf (chỉ nhận file Word .docx)" });
    expect(await saveInterviewHandbook(fd())).toEqual({ ok: false, message: "a.pdf (chỉ nhận file Word .docx)" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("hợp lệ: gửi HTML đã lọc + tên file + đúng phiên bản Handbook", async () => {
    mocks.readHandbookDocx.mockResolvedValue({ ok: true, name: "VAM_Handbook_S12.docx", html: "<p>x</p>" });
    mocks.rpc.mockResolvedValue({ data: { ok: true, handbookVersion: 3 }, error: null });
    expect((await saveInterviewHandbook(fd("2"))).ok).toBe(true);
    expect(mocks.readHandbookDocx).toHaveBeenCalledWith(expect.any(FormData), "handbook");
    expect(mocks.rpc).toHaveBeenCalledWith("vam106_save_interview_handbook", {
      p_actor: "btc", p_season: SEASON, p_expected_handbook_version: 2, p_html: "<p>x</p>", p_file_name: "VAM_Handbook_S12.docx"
    });
  });
});

describe("3. đọc màn hình — chỉ những mùa được vận hành", () => {
  it("mùa không vận hành được bị ẩn khỏi danh sách; mặc định là mùa hiện hành", async () => {
    mocks.canOperateSeason.mockImplementation(async (_ctx: unknown, id: string) => id === SEASON);
    mocks.rpc.mockResolvedValue({ data: { rubric: null, submittedCount: 0 }, error: null });
    const result = await getRubricEditorData();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seasons).toEqual([{ id: SEASON, code: "UEHM-S12" }]);
    expect(result.seasonCode).toBe("UEHM-S12");
    expect(mocks.rpc).toHaveBeenCalledWith("vam106_interview_guide", { p_actor: "btc", p_season: SEASON, p_include_handbook: true });
  });
  it("Handbook đọc từ database được lọc lại trước khi trả ra", async () => {
    mocks.rpc.mockResolvedValue({ data: { rubric: { handbookHtml: '<p>x</p><script>alert(1)</script>' }, submittedCount: 0 }, error: null });
    const result = await getRubricEditorData("UEHM-S12");
    expect(result.ok && result.guide.rubric?.handbookHtml).toBe("<p>x</p>");
  });
  it("support_team không mở được màn hình sửa phiếu", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "s", role: "support_team" });
    expect((await getRubricEditorData()).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
