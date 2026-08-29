import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { buildApplicationExportData, type ApplicationExportData } from "@/lib/application-export";
import {
  getAnswersForApplication,
  getApplication,
  getMenteeProfileByAuthorizedApplicationPersonId,
  getMentorProfileByAuthorizedApplicationPersonId,
  getPersonByAuthorizedApplicationPersonId,
  getSeasonByAuthorizedApplicationSeasonId
} from "@/lib/data";
import { getAdminScopeContext, getScopeFilter, type AdminScopeContext, type ScopeFilter } from "@/lib/program-scope";
import { canBrowseApplications } from "@/lib/read-access";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import type { Application, JsonRecord, MenteeProfile, MentorProfile, Person, Season } from "@/lib/types";

type ReadResult<T> = Promise<{ data: T; error: string | null }>;

export type ApplicationExportAccessDependencies = {
  getCurrentAdminUser: () => Promise<CurrentAdminUser | null>;
  canBrowseApplications: (role: CurrentAdminUser["role"]) => boolean;
  getAdminScopeContext: () => Promise<AdminScopeContext>;
  getScopeFilter: (context: AdminScopeContext) => Promise<ScopeFilter | undefined>;
  getApplication: (id: string, scope?: ScopeFilter) => ReadResult<Application | null>;
  getAnswersForApplication: (id: string) => ReadResult<JsonRecord[]>;
  getPersonByAuthorizedApplicationPersonId: (personId: string) => ReadResult<Person | null>;
  getMentorProfileByAuthorizedApplicationPersonId: (personId: string) => ReadResult<MentorProfile | null>;
  getMenteeProfileByAuthorizedApplicationPersonId: (personId: string) => ReadResult<MenteeProfile | null>;
  getSeasonByAuthorizedApplicationSeasonId: (seasonId: string) => ReadResult<Season | null>;
};

const defaultDependencies: ApplicationExportAccessDependencies = {
  getCurrentAdminUser,
  canBrowseApplications,
  getAdminScopeContext,
  getScopeFilter,
  getApplication,
  getAnswersForApplication,
  getPersonByAuthorizedApplicationPersonId,
  getMentorProfileByAuthorizedApplicationPersonId,
  getMenteeProfileByAuthorizedApplicationPersonId,
  getSeasonByAuthorizedApplicationSeasonId
};

export type ApplicationExportAccessResult =
  | { ok: true; data: ApplicationExportData }
  | { ok: false; status: 401 | 403 | 404 | 500 | 503; message: string };

const empty = <T>(data: T): ReadResult<T> => Promise.resolve({ data, error: null });

/**
 * Authorize the exact application before following any applicant relationship.
 * The post-authorization helpers are direct single-ID reads and must never be
 * moved ahead of getApplication(id, scope).
 */
export async function loadAuthorizedApplicationExport(
  applicationId: string,
  dependencies: ApplicationExportAccessDependencies = defaultDependencies
): Promise<ApplicationExportAccessResult> {
  try {
    const adminUser = await dependencies.getCurrentAdminUser();
    if (!adminUser) return { ok: false, status: 401, message: "Yêu cầu đăng nhập." };
    if (!dependencies.canBrowseApplications(adminUser.role)) {
      return { ok: false, status: 403, message: "Bạn không có quyền xem hồ sơ ứng tuyển." };
    }

    const scopeContext = await dependencies.getAdminScopeContext();
    if (scopeContext.scopeError) {
      return { ok: false, status: 503, message: "Không xác minh được phạm vi truy cập." };
    }
    const scope = await dependencies.getScopeFilter(scopeContext);
    const applicationResult = await dependencies.getApplication(applicationId, scope);
    if (applicationResult.error) {
      return { ok: false, status: 500, message: "Không thể tải hồ sơ ứng tuyển." };
    }
    if (!applicationResult.data) {
      // A miss and an out-of-scope object deliberately have the same response.
      return { ok: false, status: 404, message: "Không tìm thấy hồ sơ ứng tuyển." };
    }

    const application = applicationResult.data;
    const personId = application.person_id;
    const personPromise = personId
      ? dependencies.getPersonByAuthorizedApplicationPersonId(personId)
      : empty<Person | null>(null);
    const mentorPromise = personId && application.role_applied === "mentor"
      ? dependencies.getMentorProfileByAuthorizedApplicationPersonId(personId)
      : empty<MentorProfile | null>(null);
    const menteePromise = personId && application.role_applied === "mentee"
      ? dependencies.getMenteeProfileByAuthorizedApplicationPersonId(personId)
      : empty<MenteeProfile | null>(null);
    const seasonPromise = application.season_id
      ? dependencies.getSeasonByAuthorizedApplicationSeasonId(application.season_id)
      : empty<Season | null>(null);

    const [answers, person, mentorProfile, menteeProfile, season] = await Promise.all([
      dependencies.getAnswersForApplication(application.id),
      personPromise,
      mentorPromise,
      menteePromise,
      seasonPromise
    ]);
    const readError = answers.error || person.error || mentorProfile.error || menteeProfile.error || season.error;
    if (readError) {
      return { ok: false, status: 500, message: "Không thể tải đầy đủ dữ liệu hồ sơ." };
    }

    return {
      ok: true,
      data: buildApplicationExportData({
        application,
        answers: answers.data,
        person: person.data,
        mentorProfile: mentorProfile.data,
        menteeProfile: menteeProfile.data,
        season: season.data
      })
    };
  } catch (error) {
    console.error("[application-export] authorized export read failed", {
      applicationId,
      message: error instanceof Error ? error.message : String(error)
    });
    return { ok: false, status: 500, message: "Không thể xuất hồ sơ ứng tuyển." };
  }
}

export function privateExportHeaders(contentType?: string, filename?: string) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  if (contentType) headers.set("Content-Type", contentType);
  if (filename) headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return headers;
}
