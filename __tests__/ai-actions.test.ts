/**
 * Server action của Công cụ AI — cổng quyền, cổng cấu hình, và những gì chúng từ
 * chối. Một server action nhận được bất kỳ FormData nào gửi tới nó, nên mọi ca
 * "bị chặn" khẳng định luôn rằng không có gì được đọc hay gửi đi.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  aiChatJson: vi.fn(),
  isAiConfigured: vi.fn(),
  searchWeb: vi.fn(),
  isWebSearchConfigured: vi.fn(),
  extractTextFromFile: vi.fn(),
  loadExecutiveReportInput: vi.fn(),
  resolveSeasonContext: vi.fn(),
  getAdminScopeContext: vi.fn(),
  canReadSeason: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/ai/deepseek", () => ({ aiChatJson: mocks.aiChatJson, isAiConfigured: mocks.isAiConfigured }));
vi.mock("@/lib/ai/websearch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/websearch")>()),
  searchWeb: mocks.searchWeb,
  isWebSearchConfigured: mocks.isWebSearchConfigured
}));
vi.mock("@/lib/ai/extract-text", () => ({ extractTextFromFile: mocks.extractTextFromFile }));
vi.mock("@/lib/ai/executive-report", () => ({ loadExecutiveReportInput: mocks.loadExecutiveReportInput }));
vi.mock("@/lib/season-context", () => ({ resolveSeasonContext: mocks.resolveSeasonContext }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: mocks.getAdminScopeContext, canReadSeason: mocks.canReadSeason }));

import {
  askIndustryTrend,
  brainstormIdeas,
  draftDocument,
  generateCanvaBrief,
  generateExecutiveReport,
  writeContent
} from "@/app/actions/ai-tools";
import { initialAiState, type AiState } from "@/lib/ai-action-types";
import { AI_ERROR_MESSAGES } from "@/lib/ai/ai-core";
import type { ExecutiveReportInput } from "@/lib/ai/prompts";
import { AiError, type AiMessage } from "@/lib/ai/types";

const SEASON_ID = "00000000-0000-4000-8000-0000000000aa";
const DOC = { title: "Kết quả", blocks: [{ type: "paragraph", text: "Nội dung" }] };
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nx");
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const REPORT_INPUT: ExecutiveReportInput = {
  generatedAt: "14/09/2026 09:00",
  seasonCode: "UEHM-S12",
  seasonLabel: "Mùa 12",
  sections: [{ title: "Tuyển sinh và ghép cặp", unavailable: false, metrics: [{ label: "Hồ sơ ứng tuyển trong mùa", value: 321 }] }]
};

function form(fields: Record<string, string>, files: Array<[string, File]> = []) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const [key, file] of files) data.append(key, file);
  return data;
}

function signedInAs(role: string | null) {
  mocks.getCurrentAdminUser.mockResolvedValue(
    role ? { id: "admin-1", email: "a@vam.org", full_name: "A", role, status: "active", auth_user_id: null } : null
  );
}

/** Mỗi action với một FormData hợp lệ, có kèm file khi action nhận file. */
const ACTIONS: Array<[string, (previous: AiState, data: FormData) => Promise<AiState>, () => FormData]> = [
  ["brainstormIdeas", brainstormIdeas, () => form({ topic: "Networking", brief: "Mentee năm 3" }, [["files", new File([PDF_BYTES], "a.pdf")]])],
  ["writeContent", writeContent, () => form({ topic: "Mở đăng ký", brief: "Fanpage" }, [["files", new File([PDF_BYTES], "a.pdf")]])],
  ["generateCanvaBrief", generateCanvaBrief, () => form({ deliverable: "Backdrop" }, [["files", new File([PDF_BYTES], "a.pdf")]])],
  ["generateExecutiveReport", generateExecutiveReport, () => form({ season: "UEHM-S12" })],
  ["askIndustryTrend", askIndustryTrend, () => form({ question: "Ngành logistics?" })],
  ["draftDocument", draftDocument, () => form({ docType: "PROPOSAL", brief: "Kinh phí" }, [["reference", new File([PDF_BYTES], "mau.pdf")]])]
];

function nothingWasReadOrSent() {
  expect(mocks.aiChatJson).not.toHaveBeenCalled();
  expect(mocks.extractTextFromFile).not.toHaveBeenCalled();
  expect(mocks.searchWeb).not.toHaveBeenCalled();
  expect(mocks.loadExecutiveReportInput).not.toHaveBeenCalled();
  expect(mocks.resolveSeasonContext).not.toHaveBeenCalled();
}

function sentMessages(): AiMessage[] {
  expect(mocks.aiChatJson).toHaveBeenCalledTimes(1);
  return mocks.aiChatJson.mock.calls[0][0] as AiMessage[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  signedInAs("admin");
  mocks.isAiConfigured.mockReturnValue(true);
  mocks.aiChatJson.mockResolvedValue(DOC);
  mocks.isWebSearchConfigured.mockReturnValue(false);
  mocks.searchWeb.mockResolvedValue([]);
  mocks.extractTextFromFile.mockResolvedValue({ text: "chữ trong file đính kèm", truncated: false });
  mocks.resolveSeasonContext.mockResolvedValue({
    currentProgramId: "p1",
    selectedSeasonId: SEASON_ID,
    selectedSeasonCode: "UEHM-S12",
    availableSeasons: [{ id: SEASON_ID, code: "UEHM-S12", name: "UEH Mentoring Season 12", programId: "p1" }],
    effectiveScope: { allowedSeasonIds: [SEASON_ID] }
  });
  mocks.getAdminScopeContext.mockResolvedValue({ scopeError: null, isSuperAdmin: false });
  mocks.canReadSeason.mockResolvedValue(true);
  mocks.loadExecutiveReportInput.mockResolvedValue(REPORT_INPUT);
});

describe("cổng quyền", () => {
  describe.each(ACTIONS)("%s", (_name, action, validForm) => {
    it.each(["reviewer", "viewer"])("%s bị từ chối, không đọc gì, không gửi gì", async (role) => {
      signedInAs(role);
      expect(await action(initialAiState, validForm())).toEqual({ error: AI_ERROR_MESSAGES.NOT_ALLOWED });
      nothingWasReadOrSent();
    });

    it("chưa đăng nhập thì báo đăng nhập lại", async () => {
      signedInAs(null);
      expect(await action(initialAiState, validForm())).toEqual({ error: AI_ERROR_MESSAGES.NOT_LOGGED_IN });
      nothingWasReadOrSent();
    });

    it("lỗi hạ tầng khi đọc phiên không biến thành quyền", async () => {
      mocks.getCurrentAdminUser.mockRejectedValue(new Error("database down"));
      expect(await action(initialAiState, validForm())).toEqual({ error: AI_ERROR_MESSAGES.SESSION_CHECK_FAILED });
      nothingWasReadOrSent();
    });

    it("chưa cấu hình khoá thì dừng trước khi đọc file hay số liệu", async () => {
      mocks.isAiConfigured.mockReturnValue(false);
      expect(await action(initialAiState, validForm())).toEqual({ error: AI_ERROR_MESSAGES.NOT_CONFIGURED });
      nothingWasReadOrSent();
    });
  });

  it.each(["core_team", "support_team"])("%s dùng được năm công cụ, nhưng báo cáo bị từ chối mà không đọc số liệu", async (role) => {
    signedInAs(role);
    expect(await generateExecutiveReport(initialAiState, form({ season: "UEHM-S12" }))).toEqual({
      error: AI_ERROR_MESSAGES.REPORT_NOT_ALLOWED
    });
    nothingWasReadOrSent();

    expect(await brainstormIdeas(initialAiState, form({ topic: "Networking" }))).toEqual({ doc: DOC });
  });
});

describe("báo cáo Ban điều hành", () => {
  it("dùng đúng mùa màn hình gửi lên, kiểm quyền đọc mùa, rồi mới đọc số liệu", async () => {
    const state = await generateExecutiveReport(initialAiState, form({ season: "UEHM-S12" }));
    expect(mocks.resolveSeasonContext).toHaveBeenCalledWith("UEHM-S12");
    expect(mocks.canReadSeason).toHaveBeenCalledWith({ scopeError: null, isSuperAdmin: false }, SEASON_ID);
    expect(mocks.loadExecutiveReportInput).toHaveBeenCalledWith(expect.objectContaining({ selectedSeasonId: SEASON_ID }), "Mùa 12", "program_scoped");
    expect(sentMessages()[1].content).toContain("Hồ sơ ứng tuyển trong mùa: 321");
    expect(mocks.aiChatJson.mock.calls[0][1]).toEqual({ maxTokens: 6000, temperature: 0.25 });
    expect(state).toEqual({ doc: DOC });
  });

  it("không đọc được mùa, hoặc không có quyền đọc mùa, thì không đọc số liệu", async () => {
    mocks.canReadSeason.mockResolvedValue(false);
    expect(await generateExecutiveReport(initialAiState, form({ season: "UEHM-S12" }))).toEqual({ error: AI_ERROR_MESSAGES.SEASON_UNAVAILABLE });
    expect(mocks.loadExecutiveReportInput).not.toHaveBeenCalled();

    mocks.canReadSeason.mockResolvedValue(true);
    mocks.getAdminScopeContext.mockResolvedValue({ scopeError: "không đọc được phạm vi", isSuperAdmin: false });
    expect(await generateExecutiveReport(initialAiState, form({ season: "UEHM-S12" }))).toEqual({ error: AI_ERROR_MESSAGES.SEASON_UNAVAILABLE });

    mocks.resolveSeasonContext.mockRejectedValue(new Error("mùa không được cấp"));
    expect(await generateExecutiveReport(initialAiState, form({ season: "UEHM-S99" }))).toEqual({ error: AI_ERROR_MESSAGES.SEASON_UNAVAILABLE });
    expect(mocks.loadExecutiveReportInput).not.toHaveBeenCalled();
    expect(mocks.aiChatJson).not.toHaveBeenCalled();
  });

  it("không nguồn nào đọc được thì không gọi AI", async () => {
    mocks.loadExecutiveReportInput.mockResolvedValue({ ...REPORT_INPUT, sections: [{ title: "A", unavailable: true, metrics: [] }] });
    expect(await generateExecutiveReport(initialAiState, form({ season: "UEHM-S12" }))).toEqual({ error: AI_ERROR_MESSAGES.REPORT_DATA_UNAVAILABLE });
    expect(mocks.aiChatJson).not.toHaveBeenCalled();
  });
});

describe("kết quả AI", () => {
  it("output sai khuôn thành BAD_FORMAT, không bao giờ trả nguyên output", async () => {
    mocks.aiChatJson.mockResolvedValue({ title: "", blocks: [] });
    expect(await writeContent(initialAiState, form({ topic: "x" }))).toEqual({ error: AI_ERROR_MESSAGES.BAD_FORMAT });
  });

  it("lỗi của DeepSeek thành câu tiếng Việt, không mang chi tiết thô", async () => {
    mocks.aiChatJson.mockRejectedValue(new AiError("RATE_LIMIT", "402 Insufficient Balance"));
    const state = await brainstormIdeas(initialAiState, form({ topic: "x" }));
    expect(state).toEqual({ error: AI_ERROR_MESSAGES.RATE_LIMIT });
    expect(JSON.stringify(state)).not.toContain("Insufficient");

    mocks.aiChatJson.mockRejectedValue(new Error("boom"));
    expect(await brainstormIdeas(initialAiState, form({ topic: "x" }))).toEqual({ error: AI_ERROR_MESSAGES.UNKNOWN });
  });

  it.each([
    ["brainstormIdeas thiếu cả chủ đề lẫn brief", () => brainstormIdeas(initialAiState, form({ topic: " ", brief: "" }))],
    ["writeContent thiếu cả chủ đề lẫn brief", () => writeContent(initialAiState, form({}))],
    ["generateCanvaBrief thiếu hạng mục", () => generateCanvaBrief(initialAiState, form({ note: "x" }))],
    ["askIndustryTrend thiếu câu hỏi", () => askIndustryTrend(initialAiState, form({ question: "  " }))],
    ["draftDocument thiếu dữ kiện", () => draftDocument(initialAiState, form({ docType: "PROPOSAL" }))],
    ["draftDocument chọn loại đã bỏ", () => draftDocument(initialAiState, form({ docType: "FINANCE_MEMO", brief: "x" }))]
  ])("%s thì báo thiếu thông tin và không gọi AI", async (_label, run) => {
    expect(await run()).toEqual({ error: AI_ERROR_MESSAGES.MISSING_INPUT });
    expect(mocks.aiChatJson).not.toHaveBeenCalled();
  });

  it("tìm ý tưởng gửi temperature cao", async () => {
    await brainstormIdeas(initialAiState, form({ topic: "x" }));
    expect(mocks.aiChatJson.mock.calls[0][1]).toEqual({ maxTokens: 6000, temperature: 0.9 });
  });
});

describe("file đính kèm", () => {
  it("ảnh đội tên .pdf không tới bộ lấy chữ, được báo lại, và công cụ vẫn chạy không kèm tài liệu", async () => {
    const state = await brainstormIdeas(initialAiState, form({ topic: "Networking" }, [["files", new File([PNG_BYTES], "poster.pdf")]]));
    expect(mocks.extractTextFromFile).not.toHaveBeenCalled();
    expect(sentMessages()[1].content).not.toContain("TÀI LIỆU ĐÍNH KÈM");
    expect(state).toEqual({ doc: DOC, rejectedFiles: ["poster.pdf (không nhận file ảnh)"] });
  });

  it("chữ lấy từ file hợp lệ đi vào prompt", async () => {
    await generateCanvaBrief(initialAiState, form({ deliverable: "Backdrop" }, [["files", new File([PDF_BYTES], "brief.pdf")]]));
    expect(sentMessages()[1].content).toContain("--- brief.pdf ---\nchữ trong file đính kèm");
  });

  it("soạn thảo chỉ nhận một file mẫu, và ký tên đơn vị VAM", async () => {
    const state = await draftDocument(
      initialAiState,
      form({ docType: "PROPOSAL", brief: "Kinh phí" }, [
        ["reference", new File([PDF_BYTES], "mau-1.pdf")],
        ["reference", new File([PDF_BYTES], "mau-2.pdf")]
      ])
    );
    expect(mocks.extractTextFromFile).toHaveBeenCalledTimes(1);
    const [system, user] = sentMessages();
    expect(system.content).toContain("Vietnam Alumni Mentoring (VAM)");
    expect(user.content).toContain("FILE THAM CHIẾU (mau-1.pdf)");
    expect(state.rejectedFiles).toEqual(["mau-2.pdf (quá 1 file)"]);
  });
});

describe("xu hướng ngành", () => {
  const SOURCES = [
    { title: "A", url: "https://a.vn", content: "x", publishedDate: null },
    { title: "B", url: "https://b.vn", content: "y", publishedDate: null }
  ];

  it("có Tavily và tìm được nguồn thì dùng bản có nguồn và báo số nguồn", async () => {
    mocks.isWebSearchConfigured.mockReturnValue(true);
    mocks.searchWeb.mockResolvedValue(SOURCES);
    const state = await askIndustryTrend(initialAiState, form({ question: "ngành logistics" }));
    expect(mocks.searchWeb).toHaveBeenCalledWith("ngành logistics tại Việt Nam");
    expect(sentMessages()[1].content).toContain("URL: https://b.vn");
    expect(state).toEqual({ doc: DOC, grounded: true, sourceCount: 2 });
  });

  it("chưa có Tavily thì không tìm web và nói rõ là không có nguồn", async () => {
    const state = await askIndustryTrend(initialAiState, form({ question: "ngành logistics" }));
    expect(mocks.searchWeb).not.toHaveBeenCalled();
    expect(state).toEqual({ doc: DOC, grounded: false });
  });

  it("có Tavily mà không tìm ra nguồn thì rơi về kiến thức chung", async () => {
    mocks.isWebSearchConfigured.mockReturnValue(true);
    const state = await askIndustryTrend(initialAiState, form({ question: "ngành logistics" }));
    expect(sentMessages()[0].content).toContain("KHÔNG có kết nối internet");
    expect(state).toEqual({ doc: DOC, grounded: false });
  });

  it("AI lỗi thì không gắn nhãn nguồn lên câu báo lỗi", async () => {
    mocks.isWebSearchConfigured.mockReturnValue(true);
    mocks.searchWeb.mockResolvedValue(SOURCES);
    mocks.aiChatJson.mockRejectedValue(new AiError("TIMEOUT"));
    expect(await askIndustryTrend(initialAiState, form({ question: "q" }))).toEqual({ error: AI_ERROR_MESSAGES.TIMEOUT });
  });
});

describe("không ghi gì", () => {
  it("file action không chạm database hay lưu trữ", () => {
    const source = readFileSync(join(__dirname, "..", "app", "actions", "ai-tools.ts"), "utf8");
    expect(source).not.toMatch(/supabase|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|writeAdminAudit|revalidatePath/);
  });
});
