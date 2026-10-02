import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { readHandbookDocx } from "@/lib/ai/uploads";
import { getSeasons } from "@/lib/data";
import { sanitizeHandbookHtml } from "@/lib/handbook-html";
import {
  cleanRubricDraft,
  parseRubricInput,
  rubricDraftError,
  type InterviewGuide
} from "@/lib/mentee-interview-rubric-core";
import { offlineError } from "@/lib/mentee-offline-core";
import { canEditInterviewRubric } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/mentee-interview-rubric.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Màn hình "Phiếu chấm & hướng dẫn mentee": BTC sửa phiếu chấm phỏng vấn và tải
 * Handbook của từng mùa. Mùa chưa có phiếu riêng thì đang dùng phiếu lưu gần nhất;
 * lần lưu đầu tạo phiếu riêng (database chép cả Handbook sang).
 *
 * Quyền hai lớp: vai trò (canEditInterviewRubric) + vận hành đúng mùa
 * (canOperateSeason) ở đây, và vam084_operator_for_season trong RPC. Không đọc được
 * bảng quyền thì từ chối.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RubricSeasonOption = { id: string; code: string };
export type RubricEditorData =
  | { ok: true; seasons: RubricSeasonOption[]; seasonId: string; seasonCode: string; guide: InterviewGuide }
  | { ok: false; message: string };
export type RubricSaveResult = { ok: boolean; message: string };

function editorError(message: string): string {
  if (message.includes("ACCESS_DENIED")) return "Bạn không có quyền sửa phiếu chấm của mùa này.";
  return offlineError(message);
}

async function operableSeasons() {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false as const, message: "Cần đăng nhập." };
  if (!canEditInterviewRubric(actor.role)) {
    return { ok: false as const, message: "Bạn không có quyền sửa phiếu chấm phỏng vấn." };
  }
  const ctx = await getAdminScopeContext();
  const seasons = await getSeasons(await getScopeFilter(ctx));
  if (seasons.error) return { ok: false as const, message: SAFE_ERROR };
  // Mùa mới nhất lên đầu — cùng cách suy thứ tự từ mã mùa như bộ chọn mùa
  // (lib/season-context.ts sortSeasonOptions): bảng seasons không có cột thứ tự.
  const seasonNumber = (code: string) => Number(code.match(/-S(\d+)$/i)?.[1] ?? -1);
  const rows = seasons.data
    .filter((s) => s.id && s.code)
    .map((s) => ({ id: String(s.id), code: String(s.code) }))
    .sort((a, b) => seasonNumber(b.code) - seasonNumber(a.code) || a.code.localeCompare(b.code));
  const allowed: RubricSeasonOption[] = [];
  for (const season of rows) {
    if (await canOperateSeason(ctx, season.id)) allowed.push({ id: season.id, code: season.code });
  }
  return { ok: true as const, actorId: actor.id, ctx, seasons: allowed };
}

export async function getRubricEditorData(seasonParam?: string): Promise<RubricEditorData> {
  const access = await operableSeasons();
  if (!access.ok) return access;
  if (!access.seasons.length) return { ok: false, message: "Bạn chưa có quyền vận hành mùa nào." };
  const season =
    access.seasons.find((s) => s.id === seasonParam || s.code === seasonParam) ??
    access.seasons.find((s) => s.code === SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) ??
    access.seasons[0];

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const { data, error } = await client.rpc("vam106_interview_guide", {
    p_actor: access.actorId,
    p_season: season.id,
    p_include_handbook: true
  });
  if (error || !data) return { ok: false, message: error ? editorError(error.message) : SAFE_ERROR };
  const guide = data as InterviewGuide;
  if (guide.rubric?.handbookHtml) guide.rubric.handbookHtml = sanitizeHandbookHtml(guide.rubric.handbookHtml);
  return { ok: true, seasons: access.seasons, seasonId: season.id, seasonCode: season.code, guide };
}

async function requireSeasonEditor(seasonId: unknown) {
  const id = typeof seasonId === "string" ? seasonId.trim() : "";
  if (!UUID.test(id)) return { ok: false as const, message: "Không xác định được mùa cần sửa." };
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false as const, message: "Cần đăng nhập." };
  if (!canEditInterviewRubric(actor.role)) return { ok: false as const, message: "Bạn không có quyền sửa phiếu chấm phỏng vấn." };
  if (!(await canOperateSeason(await getAdminScopeContext(), id))) {
    return { ok: false as const, message: "Bạn không có quyền sửa phiếu chấm của mùa này." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false as const, message: SAFE_ERROR };
  return { ok: true as const, actorId: actor.id, client, seasonId: id };
}

export async function saveInterviewRubric(input: {
  seasonId: unknown;
  expectedVersion: unknown;
  criteria: unknown;
  guidance: unknown;
}): Promise<RubricSaveResult> {
  const access = await requireSeasonEditor(input.seasonId);
  if (!access.ok) return access;
  const expected = Number(input.expectedVersion);
  if (!Number.isInteger(expected) || expected < 0) return { ok: false, message: "Phiên bản phiếu không hợp lệ. Tải lại trang." };
  const parsed = parseRubricInput(input.criteria, input.guidance);
  if (!parsed) return { ok: false, message: "Dữ liệu phiếu không đúng dạng. Tải lại trang rồi sửa lại." };
  const draft = cleanRubricDraft(parsed.criteria, parsed.guidance);
  const problem = rubricDraftError(draft.criteria, draft.guidance);
  if (problem) return { ok: false, message: problem };

  const { data, error } = await access.client.rpc("vam106_save_interview_rubric", {
    p_actor: access.actorId,
    p_season: access.seasonId,
    p_expected_version: expected,
    p_criteria: draft.criteria,
    p_guidance: draft.guidance
  });
  if (error) return { ok: false, message: editorError(error.message) };
  if (!data?.ok) return { ok: false, message: SAFE_ERROR };
  return { ok: true, message: `Đã lưu phiếu chấm (phiên bản ${data.version}).` };
}

export async function saveInterviewHandbook(formData: FormData): Promise<RubricSaveResult> {
  const access = await requireSeasonEditor(formData.get("seasonId"));
  if (!access.ok) return access;
  const expected = Number(formData.get("expectedHandbookVersion"));
  if (!Number.isInteger(expected) || expected < 0) return { ok: false, message: "Phiên bản Handbook không hợp lệ. Tải lại trang." };
  const upload = await readHandbookDocx(formData, "handbook");
  if (!upload.ok) return { ok: false, message: upload.message };

  const { data, error } = await access.client.rpc("vam106_save_interview_handbook", {
    p_actor: access.actorId,
    p_season: access.seasonId,
    p_expected_handbook_version: expected,
    p_html: upload.html,
    p_file_name: upload.name
  });
  if (error) return { ok: false, message: editorError(error.message) };
  if (!data?.ok) return { ok: false, message: SAFE_ERROR };
  return { ok: true, message: `Đã tải Handbook "${upload.name}".` };
}
