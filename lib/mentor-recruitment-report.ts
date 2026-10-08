import "server-only";

/**
 * Báo cáo tuyển mentor — đọc bảng, dựng đầu vào cho lib/mentor-recruitment-report-core.ts.
 * Chỉ đọc, không ghi gì.
 *
 * Cổng: vai trò BTC (canBrowseOperations) VÀ quyền vận hành mùa — trang có họ tên, chức
 * danh, công ty của mọi người nộp đơn, kể cả người không đạt. Hai cổng đều fail-closed.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { applicantPayload } from "@/lib/matching-quick-view-core";
import {
  buildMentorRecruitmentReport,
  type DecisionInput,
  type InviteInput,
  type MentorApplicationInput,
  type MentorRecruitmentReport,
  type ReportScope,
  type ReviewInput
} from "@/lib/mentor-recruitment-report-core";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { canBrowseOperations } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { Application } from "@/lib/types";

type Row = Record<string, any>;

export type MentorReportResult =
  | { ok: true; seasonCode: string; report: MentorRecruitmentReport; generatedAt: string }
  | { ok: false; message: string };

const DENIED = "Trang này dành cho BTC (Core team, Support team) có quyền vận hành mùa hiện tại.";
const UNREADABLE = "Chưa đọc được dữ liệu tuyển mentor. Thử tải lại trang; nếu vẫn lỗi, báo quản trị viên.";

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export async function getMentorRecruitmentReport(scope: ReportScope): Promise<MentorReportResult> {
  const admin = await getCurrentAdminUser();
  if (!admin?.id || !canBrowseOperations(admin.role)) return { ok: false, message: DENIED };
  try {
    const client = getSupabaseServiceRoleClient();
    if (!client) return { ok: false, message: UNREADABLE };
    const seasonCode = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
    const season = await client.from("seasons").select("id").eq("code", seasonCode).maybeSingle();
    if (season.error || !season.data) return { ok: false, message: UNREADABLE };
    const seasonId = String(season.data.id);
    if (!(await canOperateSeason(await getAdminScopeContext(), seasonId))) return { ok: false, message: DENIED };

    const apps = await readAllPages<Row>(
      "applications",
      "id,person_id,full_name,email_primary,role_applied,status,source,submitted_at,raw_payload",
      (columns) => client.from("applications").select(columns).eq("season_id", seasonId).eq("role_applied", "mentor")
    );
    if (apps.error) throw new Error("READ_FAILED");
    const appIds = apps.data.map((a) => String(a.id));

    const [reviews, decisions, assignments, invites] = await Promise.all([
      readAllPagesIn<Row>(client, "application_reviews", "application_id", appIds, "id,application_id,review_round,status,recommendation,submitted_at"),
      readAllPagesIn<Row>(client, "application_decisions", "application_id", appIds, "id,application_id,decision,new_status,previous_status,created_at"),
      readAllPages<Row>("matching_industry_assignments", "id,person_id,group_code", (columns) =>
        client.from("matching_industry_assignments").select(columns).eq("season_id", seasonId).eq("role", "mentor")
      ),
      readAllPages<Row>("person_season_invites", "id,person_id,outcome,revoked_at,expires_at", (columns) =>
        client.from("person_season_invites").select(columns).eq("season_id", seasonId).eq("role", "mentor")
      )
    ]);
    for (const read of [reviews, decisions, assignments, invites]) {
      if (read.error) throw new Error("READ_FAILED");
    }

    const applications: MentorApplicationInput[] = apps.data.map((a) => ({
      id: String(a.id),
      personId: text(a.person_id),
      fullName: text(a.full_name),
      email: text(a.email_primary),
      source: text(a.source),
      status: String(a.status ?? ""),
      submittedAt: text(a.submitted_at),
      payload: applicantPayload(a as unknown as Application)
    }));
    const reviewRows: ReviewInput[] = reviews.data.map((r) => ({
      applicationId: String(r.application_id),
      round: String(r.review_round ?? ""),
      status: String(r.status ?? ""),
      recommendation: text(r.recommendation),
      submittedAt: text(r.submitted_at)
    }));
    const decisionRows: DecisionInput[] = decisions.data.map((d) => ({
      applicationId: String(d.application_id),
      decision: d.decision,
      new_status: d.new_status,
      previous_status: d.previous_status,
      created_at: d.created_at
    }));
    const savedGroups = new Map<string, number>(assignments.data.map((a) => [String(a.person_id), Number(a.group_code)]));
    const inviteRows: InviteInput[] = invites.data.map((i) => ({
      personId: String(i.person_id),
      outcome: text(i.outcome),
      revokedAt: text(i.revoked_at),
      expiresAt: text(i.expires_at)
    }));

    const generatedAt = new Date().toISOString();
    const report = buildMentorRecruitmentReport(
      { applications, reviews: reviewRows, decisions: decisionRows, savedGroups, invites: inviteRows, now: generatedAt },
      scope
    );
    return { ok: true, seasonCode, report, generatedAt };
  } catch (error) {
    console.error("[mentor-recruitment-report] load failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: UNREADABLE };
  }
}
