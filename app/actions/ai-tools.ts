"use server";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import type { AiState } from "@/lib/ai-action-types";
import {
  AI_ATTACHMENT_CHARS,
  AI_INPUT_LIMITS,
  aiErrorMessage,
  clampText,
  type AiActionErrorCode
} from "@/lib/ai/ai-core";
import { aiChatJson, isAiConfigured } from "@/lib/ai/deepseek";
import { withDocFormat } from "@/lib/ai/doc-format";
import { documentDraftPrompt } from "@/lib/ai/document-prompts";
import { MAX_DOCUMENT_BRIEF, MAX_DOCUMENT_REF_CHARS, resolveDocumentType } from "@/lib/ai/document-types";
import { loadExecutiveReportInput } from "@/lib/ai/executive-report";
import { hasAnyReportData } from "@/lib/ai/executive-report-core";
import {
  brainstormPrompt,
  canvaBriefPrompt,
  contentWriterPrompt,
  executiveReportPrompt,
  industryTrendGroundedPrompt,
  industryTrendPrompt
} from "@/lib/ai/prompts";
import { AiError, type AiErrorCode, type AiMessage, type ChatOptions } from "@/lib/ai/types";
import { readAiUploads, uploadsToPromptText } from "@/lib/ai/uploads";
import { VAM_ORG_NAME } from "@/lib/ai/vam-context";
import { buildIndustryQuery, isWebSearchConfigured, searchWeb } from "@/lib/ai/websearch";
import { parseAiDoc } from "@/lib/doc-blocks";
import { canRunAiExecutiveReport, canUseAiTools } from "@/lib/permissions";
import { canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { resolveSeasonContext } from "@/lib/season-context";
import { seasonLabel } from "@/lib/season-labels";

/**
 * Server action của Công cụ AI.
 *
 * Mọi action:
 *  - kiểm quyền ở CÂU LỆNH ĐẦU TIÊN (authorize). Ẩn thẻ công cụ trên màn hình chỉ để
 *    gọn; một server action nhận được bất kỳ FormData nào gửi tới nó.
 *  - kiểm khoá API TRƯỚC khi đọc file hay số liệu: chưa cấu hình thì không làm gì cả.
 *  - không ghi database, không lưu file, không lưu kết quả. Người dùng phải tự tải về.
 *  - chỉ trả câu báo lỗi tiếng Việt; chi tiết kỹ thuật chỉ vào log server.
 */

function fail(code: AiErrorCode | AiActionErrorCode): AiState {
  return { error: aiErrorMessage(code) };
}

type Actor = { ok: true; role: string } | { ok: false; state: AiState };

async function authorize(): Promise<Actor> {
  let adminUser: Awaited<ReturnType<typeof getCurrentAdminUser>>;
  try {
    adminUser = await getCurrentAdminUser();
  } catch (error) {
    // Lỗi hạ tầng khi đọc phiên không được biến thành quyền.
    console.error("[AI] không đọc được người dùng hiện tại:", error);
    return { ok: false, state: fail("SESSION_CHECK_FAILED") };
  }
  if (!adminUser?.id) return { ok: false, state: fail("NOT_LOGGED_IN") };
  if (!canUseAiTools(adminUser.role)) return { ok: false, state: fail("NOT_ALLOWED") };
  if (!isAiConfigured()) return { ok: false, state: fail("NOT_CONFIGURED") };
  return { ok: true, role: adminUser.role };
}

function toFailure(error: unknown): AiState {
  if (error instanceof AiError) {
    if (error.detail) console.error(`[AI] ${error.code}:`, error.detail.slice(0, 500));
    return fail(error.code);
  }
  console.error("[AI] lỗi không xác định:", error);
  return fail("UNKNOWN");
}

/** Gọi DeepSeek với khuôn tài liệu, rồi kiểm output bằng Zod — không bao giờ tin thẳng output AI. */
async function generate(messages: AiMessage[], options: Omit<ChatOptions, "json">): Promise<AiState> {
  try {
    const raw = await aiChatJson<unknown>(withDocFormat(messages), { maxTokens: 6000, ...options });
    const doc = parseAiDoc(raw);
    return doc ? { doc } : fail("BAD_FORMAT");
  } catch (error) {
    return toFailure(error);
  }
}

function withRejected(state: AiState, rejected: string[]): AiState {
  return rejected.length ? { ...state, rejectedFiles: rejected } : state;
}

// ───────────────────────── Tìm ý tưởng hoạt động ─────────────────────────

export async function brainstormIdeas(_previous: AiState, formData: FormData): Promise<AiState> {
  const actor = await authorize();
  if (!actor.ok) return actor.state;

  const topic = clampText(formData.get("topic"), AI_INPUT_LIMITS.topic);
  const brief = clampText(formData.get("brief"), AI_INPUT_LIMITS.brief);
  if (!topic && !brief) return fail("MISSING_INPUT");

  const uploads = await readAiUploads(formData, "files", { maxChars: AI_ATTACHMENT_CHARS });
  // temperature cao: tìm ý tưởng cần đa dạng.
  const state = await generate(
    brainstormPrompt({ topic, brief, attachmentsText: uploadsToPromptText(uploads.files) }),
    { temperature: 0.9 }
  );
  return withRejected(state, uploads.rejected);
}

// ───────────────────────── Viết content ─────────────────────────

export async function writeContent(_previous: AiState, formData: FormData): Promise<AiState> {
  const actor = await authorize();
  if (!actor.ok) return actor.state;

  const topic = clampText(formData.get("topic"), AI_INPUT_LIMITS.topic);
  const brief = clampText(formData.get("brief"), AI_INPUT_LIMITS.brief);
  if (!topic && !brief) return fail("MISSING_INPUT");

  const uploads = await readAiUploads(formData, "files", { maxChars: AI_ATTACHMENT_CHARS });
  const state = await generate(
    contentWriterPrompt({ topic, brief, attachmentsText: uploadsToPromptText(uploads.files) }),
    { temperature: 0.7 }
  );
  return withRejected(state, uploads.rejected);
}

// ───────────────────────── Brief thiết kế Canva ─────────────────────────

export async function generateCanvaBrief(_previous: AiState, formData: FormData): Promise<AiState> {
  const actor = await authorize();
  if (!actor.ok) return actor.state;

  const deliverable = clampText(formData.get("deliverable"), AI_INPUT_LIMITS.deliverable);
  const note = clampText(formData.get("note"), AI_INPUT_LIMITS.note) || null;
  if (!deliverable) return fail("MISSING_INPUT");

  const uploads = await readAiUploads(formData, "files", { maxChars: AI_ATTACHMENT_CHARS });
  const state = await generate(
    canvaBriefPrompt({ deliverable, note, attachmentsText: uploadsToPromptText(uploads.files) }),
    { temperature: 0.6 }
  );
  return withRejected(state, uploads.rejected);
}

// ───────────────────────── Báo cáo Ban điều hành ─────────────────────────

/**
 * Công cụ duy nhất đọc dữ liệu chương trình. Chỉ số đếm của một mùa, không tên người.
 *
 * Mùa lấy qua resolveSeasonContext, hàm chỉ chấp nhận mùa người dùng được cấp quyền;
 * canReadSeason kiểm lại lần nữa ngay trước khi đọc, vì mã mùa đến từ FormData.
 */
export async function generateExecutiveReport(_previous: AiState, formData: FormData): Promise<AiState> {
  const actor = await authorize();
  if (!actor.ok) return actor.state;
  if (!canRunAiExecutiveReport(actor.role)) return fail("REPORT_NOT_ALLOWED");

  let input;
  try {
    const requestedSeason = clampText(formData.get("season"), 64);
    const context = await resolveSeasonContext(requestedSeason || undefined);
    const scopeContext = await getAdminScopeContext();
    if (scopeContext.scopeError || !(await canReadSeason(scopeContext, context.selectedSeasonId))) {
      return fail("SEASON_UNAVAILABLE");
    }
    const selected = context.availableSeasons.find((season) => season.id === context.selectedSeasonId);
    input = await loadExecutiveReportInput(
      context,
      seasonLabel(context.selectedSeasonCode, selected?.name ?? null),
      scopeContext.isSuperAdmin ? "global" : "program_scoped"
    );
  } catch (error) {
    console.error("[AI] báo cáo Ban điều hành: không xác định được mùa", error);
    return fail("SEASON_UNAVAILABLE");
  }

  if (!hasAnyReportData(input)) return fail("REPORT_DATA_UNAVAILABLE");
  // temperature thấp: tổng hợp số liệu, không cần sáng tạo.
  return generate(executiveReportPrompt(input), { temperature: 0.25 });
}

// ───────────────────────── Xu hướng ngành ─────────────────────────

export async function askIndustryTrend(_previous: AiState, formData: FormData): Promise<AiState> {
  const actor = await authorize();
  if (!actor.ok) return actor.state;

  const question = clampText(formData.get("question"), AI_INPUT_LIMITS.question);
  if (!question) return fail("MISSING_INPUT");

  // Có Tavily → đọc nguồn thật trước, model chỉ tổng hợp và phải dẫn link.
  // Không có (hoặc tìm không ra) → kiến thức chung, màn hình nói rõ là không có nguồn.
  const sources = isWebSearchConfigured() ? await searchWeb(buildIndustryQuery(question)) : [];
  if (sources.length > 0) {
    const state = await generate(industryTrendGroundedPrompt(question, sources), { temperature: 0.3 });
    return state.doc ? { ...state, grounded: true, sourceCount: sources.length } : state;
  }
  const state = await generate(industryTrendPrompt(question), { temperature: 0.7 });
  return state.doc ? { ...state, grounded: false } : state;
}

// ───────────────────────── Soạn thảo văn bản ─────────────────────────

/**
 * File mẫu tham chiếu đọc trong bộ nhớ rồi bỏ; bản soạn không lưu ở đâu cả. Nội dung
 * VẪN đi sang DeepSeek — "không lưu trong app" khác "không rời khỏi chương trình", và
 * form nói rõ điều đó.
 */
export async function draftDocument(_previous: AiState, formData: FormData): Promise<AiState> {
  const actor = await authorize();
  if (!actor.ok) return actor.state;

  const type = resolveDocumentType(clampText(formData.get("docType"), 40));
  const brief = clampText(formData.get("brief"), MAX_DOCUMENT_BRIEF);
  if (!type || !brief) return fail("MISSING_INPUT");
  const subject = clampText(formData.get("subject"), AI_INPUT_LIMITS.subject) || null;

  const uploads = await readAiUploads(formData, "reference", { maxChars: MAX_DOCUMENT_REF_CHARS, maxFiles: 1 });
  const reference = uploads.files[0] ?? null;
  // temperature thấp: văn bản hành chính cần đúng khuôn, không cần sáng tạo.
  const state = await generate(
    documentDraftPrompt({
      type,
      subject,
      brief,
      referenceText: reference?.text ?? null,
      referenceName: reference?.name ?? null,
      orgName: VAM_ORG_NAME
    }),
    { temperature: 0.3 }
  );
  return withRejected(state, uploads.rejected);
}
