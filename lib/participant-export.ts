import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getFunctionAreas,
  getIndustries,
  getIntakeBatches,
  getMenteeProfiles,
  getMentorFunctionAreaLinks,
  getMentorIndustryLinks,
  getMentorProfiles,
  getMentorProgramParticipations,
  getPeople,
  getPrograms,
  getSeasons
} from "@/lib/data";
import { canExportParticipantProfiles } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSeasonCohortPersonIds } from "@/lib/season-cohort";
import { resolveSeasonContext, SeasonAccessDeniedError, SeasonContextError } from "@/lib/season-context";
import { vietnamDateKey } from "@/lib/utils";
import {
  PARTICIPANT_GROUP_ORDER,
  PARTICIPANT_SHEET_NAME,
  buildParticipantTable,
  participantGroupStyles,
  type ParticipantExportInput,
  type ParticipantRole
} from "@/lib/participant-export-core";
import { groupedTableXlsx } from "@/lib/xlsx-grouped-table";

/**
 * VAM00025 — đọc và dựng file Excel toàn bộ hồ sơ Mentor / Mentee cho nút trên /mentors và /mentees.
 *
 * TẬP NGƯỜI: đúng tập danh sách đang hiện cho người bấm — cùng mùa đang chọn trên trang (tham số `season`, nếu không có
 * thì cookie mùa như trang), cùng phạm vi chương trình/mùa (effectiveScope), cùng danh sách thành viên chính thức của
 * mùa (getSeasonCohortPersonIds), và cùng các hàm đọc lib/data mà trang dùng. Không tự viết lại phép chọn người: hai
 * cách chọn là hai cơ hội để file và màn hình nói khác nhau. Bộ lọc / ô tìm trên màn hình chạy ở trình duyệt nên KHÔNG
 * áp vào file — file là cả danh sách của mùa.
 *
 * QUYỀN (kiểm ở máy chủ, trước mọi phép đọc dữ liệu người): vai trò canExportParticipantProfiles (Super admin, Admin,
 * Core team — hẹp hơn quyền xem danh sách, vốn mở cả Support team) VÀ quyền vận hành mùa đang xuất (canOperateSeason).
 * Fail-closed: không xác minh được mùa hay phạm vi thì từ chối. Đọc thiếu một bảng thì báo lỗi, KHÔNG xuất file thiếu.
 *
 * Mọi phép đọc nhiều dòng trong lib/data đi qua readAllPages, nên vượt 1000 dòng của PostgREST vẫn đủ. Không ghi gì vào
 * database (chưa có sổ ghi lượt tải; thêm sổ cần migration — để việc sau).
 */

export type ParticipantExportFailure = { ok: false; status: 400 | 401 | 403 | 500; message: string };
export type ParticipantExportFile = { ok: true; bytes: Buffer; filename: string; count: number } | ParticipantExportFailure;

const DENIED: ParticipantExportFailure = {
  ok: false,
  status: 403,
  message: "Bạn chưa có quyền xuất file này. Chỉ Super admin, Admin và Core team có quyền vận hành mùa đang chọn mới xuất được."
};
const UNAVAILABLE: ParticipantExportFailure = { ok: false, status: 500, message: "Chưa đọc được đầy đủ dữ liệu nên chưa xuất file. Vui lòng thử lại sau ít phút." };

export type ParticipantExportDependencies = {
  getCurrentAdminUser: typeof getCurrentAdminUser;
  resolveSeasonContext: typeof resolveSeasonContext;
  getAdminScopeContext: typeof getAdminScopeContext;
  canOperateSeason: typeof canOperateSeason;
  getSeasonCohortPersonIds: typeof getSeasonCohortPersonIds;
  getMentorProfiles: typeof getMentorProfiles;
  getMenteeProfiles: typeof getMenteeProfiles;
  getPeople: typeof getPeople;
  getIntakeBatches: typeof getIntakeBatches;
  getSeasons: typeof getSeasons;
  getIndustries: typeof getIndustries;
  getFunctionAreas: typeof getFunctionAreas;
  getPrograms: typeof getPrograms;
  getMentorIndustryLinks: typeof getMentorIndustryLinks;
  getMentorFunctionAreaLinks: typeof getMentorFunctionAreaLinks;
  getMentorProgramParticipations: typeof getMentorProgramParticipations;
};

export const defaultParticipantExportDependencies: ParticipantExportDependencies = {
  getCurrentAdminUser,
  resolveSeasonContext,
  getAdminScopeContext,
  canOperateSeason,
  getSeasonCohortPersonIds,
  getMentorProfiles,
  getMenteeProfiles,
  getPeople,
  getIntakeBatches,
  getSeasons,
  getIndustries,
  getFunctionAreas,
  getPrograms,
  getMentorIndustryLinks,
  getMentorFunctionAreaLinks,
  getMentorProgramParticipations
};

export function parseParticipantRole(value: string | null): ParticipantRole | null {
  return value === "mentor" || value === "mentee" ? value : null;
}

/**
 * Có hiện nút xuất trên trang không — cùng hai điều kiện mà đường tải kiểm lại ở máy chủ. Nút ẩn chỉ để người không
 * tải được khỏi bấm vào một lỗi 403; nó không phải phép kiểm quyền.
 */
export async function canShowParticipantExport(
  role: string | null | undefined,
  scopeContext: Awaited<ReturnType<typeof getAdminScopeContext>>,
  seasonId: string
): Promise<boolean> {
  if (!canExportParticipantProfiles(role)) return false;
  try {
    return !scopeContext.scopeError && (await canOperateSeason(scopeContext, seasonId));
  } catch {
    return false;
  }
}

function failed(...results: Array<{ error: unknown }>) {
  return results.some((result) => Boolean(result.error));
}

export async function exportParticipantProfiles(
  role: ParticipantRole,
  seasonParam: string | null,
  deps: ParticipantExportDependencies = defaultParticipantExportDependencies
): Promise<ParticipantExportFile> {
  const actor = await deps.getCurrentAdminUser();
  if (!actor) return { ok: false, status: 401, message: "Bạn chưa đăng nhập." };
  if (!canExportParticipantProfiles(actor.role)) return DENIED;

  let seasonContext;
  try {
    seasonContext = await deps.resolveSeasonContext(seasonParam ?? undefined);
  } catch (error) {
    if (error instanceof SeasonAccessDeniedError) return DENIED;
    if (error instanceof SeasonContextError) return { ok: false, status: 400, message: "Mùa được yêu cầu không hợp lệ hoặc bạn không được cấp quyền mùa đó." };
    return UNAVAILABLE;
  }
  try {
    const scopeContext = await deps.getAdminScopeContext();
    // Không đọc được phạm vi thì KHÔNG cho tải: lỗi hạ tầng không được biến thành quyền.
    if (scopeContext.scopeError) return DENIED;
    if (!(await deps.canOperateSeason(scopeContext, seasonContext.selectedSeasonId))) return DENIED;
  } catch {
    return DENIED;
  }

  const scope = seasonContext.effectiveScope;
  const cohort = await deps.getSeasonCohortPersonIds(seasonContext.selectedSeasonId, role);
  if (cohort.error) return UNAVAILABLE;
  const profiles = role === "mentor" ? await deps.getMentorProfiles(scope, cohort.data) : await deps.getMenteeProfiles(scope, cohort.data);
  if (profiles.error) return UNAVAILABLE;
  const personIds = Array.from(new Set(profiles.data.map((profile) => String(profile.person_id ?? "")).filter(Boolean)));
  const profileIds = profiles.data.map((profile) => String(profile.id));

  // Cùng getPeople(scope) như trang, chỉ thu về đúng những người có hồ sơ trong file.
  const [people, intakeBatches, seasons] = await Promise.all([
    personIds.length ? deps.getPeople(scope, personIds) : Promise.resolve({ data: [], error: null }),
    deps.getIntakeBatches(scope),
    deps.getSeasons(scope)
  ]);
  if (failed(people, intakeBatches, seasons)) return UNAVAILABLE;

  let mentorCatalog: Pick<ParticipantExportInput, "industryLinks" | "industries" | "functionLinks" | "functionAreas" | "programLinks" | "programs"> = {};
  if (role === "mentor") {
    const [industryLinks, industries, functionLinks, functionAreas, programLinks, programs] = await Promise.all([
      deps.getMentorIndustryLinks(profileIds),
      deps.getIndustries(),
      deps.getMentorFunctionAreaLinks(profileIds),
      deps.getFunctionAreas(),
      deps.getMentorProgramParticipations(profileIds),
      deps.getPrograms(scope)
    ]);
    if (failed(industryLinks, industries, functionLinks, functionAreas, programLinks, programs)) return UNAVAILABLE;
    mentorCatalog = {
      industryLinks: industryLinks.data,
      industries: industries.data,
      functionLinks: functionLinks.data,
      functionAreas: functionAreas.data,
      programLinks: programLinks.data,
      programs: programs.data
    };
  }

  const table = buildParticipantTable({
    role,
    profiles: profiles.data,
    people: people.data,
    intakeBatches: intakeBatches.data,
    seasons: seasons.data,
    ...mentorCatalog
  });
  const bytes = groupedTableXlsx(table, {
    sheetName: PARTICIPANT_SHEET_NAME[role],
    groupOrder: PARTICIPANT_GROUP_ORDER,
    groups: participantGroupStyles(role),
    frozenColumns: 2
  });
  const seasonLabel = /S\d+$/i.exec(seasonContext.selectedSeasonCode)?.[0].toUpperCase() ?? "mua";
  const day = (vietnamDateKey(new Date()) ?? "").replace(/-/g, "");
  return { ok: true, bytes, filename: `ho-so-${role}-${seasonLabel}-${day}.xlsx`, count: table.rows.length };
}
