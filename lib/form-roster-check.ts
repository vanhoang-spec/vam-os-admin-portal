import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import type { CustomFormDetail, FormsResult } from "@/lib/custom-forms";
import { listCustomFormResponses } from "@/lib/custom-forms";
import {
  checkFormAgainstRoster,
  normalizeMatchEmail,
  normalizeMatchPhone,
  submissionIdentity,
  type RosterCheckResult,
  type RosterCheckRole,
  type RosterPerson
} from "@/lib/form-roster-check-core";
import { readAllPagesIn } from "@/lib/paged-read";
import { canBrowseParticipants } from "@/lib/read-access";
import { getSeasonCohortRoleMap } from "@/lib/season-cohort";
import { resolveSeasonContext, SeasonAccessDeniedError } from "@/lib/season-context";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/form-roster-check.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc dữ liệu cho trang /forms/[id]/doi-chieu: câu trả lời của form + danh sách mentee/mentor chính
 * thức của mùa (`lib/season-cohort.ts` — cùng nguồn với trang Mentee/Mentor).
 *
 * Một phép đọc hỏng thì trả lỗi, không trả danh sách thiếu: thiếu email trên đơn là báo "chưa nộp"
 * cho người đã nộp, và Support team nhắc nhầm người.
 */

const DENIED = "Bạn không có quyền xem danh sách thành viên của mùa này.";
const SAFE_ERROR = "Không đọc được đầy đủ dữ liệu để đối chiếu. Trang không hiện số liệu để tránh báo sai — vui lòng tải lại.";

export type FormRosterCheck = {
  form: CustomFormDetail;
  seasonCode: string;
  result: RosterCheckResult;
};

export function parseRosterRole(value: unknown): RosterCheckRole {
  return value === "mentor" ? "mentor" : "mentee";
}

export async function checkFormRoster(
  formId: string,
  input: { role: RosterCheckRole; season?: string | string[] }
): Promise<FormsResult<FormRosterCheck>> {
  const admin = await getCurrentAdminUser();
  if (!admin || !canBrowseParticipants(admin.role)) return { ok: false, message: DENIED };

  // Cổng của form (đang hoạt động, quyền vận hành form) nằm trong listCustomFormResponses.
  const responses = await listCustomFormResponses(formId);
  if (!responses.ok) return responses;
  const { form } = responses.data;

  let season: Awaited<ReturnType<typeof resolveSeasonContext>>;
  try {
    season = await resolveSeasonContext(input.season);
  } catch (error) {
    if (error instanceof SeasonAccessDeniedError) return { ok: false, message: DENIED };
    console.error("[form-roster-check] season", error instanceof Error ? error.message : error);
    return { ok: false, message: SAFE_ERROR };
  }

  const cohort = await getSeasonCohortRoleMap(season.selectedSeasonId);
  if (cohort.error) return { ok: false, message: SAFE_ERROR };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const ids = Array.from(cohort.data.keys());
  const [people, apps] = await Promise.all([
    readAllPagesIn<{ id: string; full_name: string | null; email_primary: string | null; phone_primary: string | null }>(
      client,
      "people",
      "id",
      ids,
      "id, full_name, email_primary, phone_primary"
    ),
    readAllPagesIn<{ id: string; person_id: string | null; email_primary: string | null; phone_primary: string | null }>(
      client,
      "applications",
      "person_id",
      ids,
      "id, person_id, email_primary, phone_primary",
      (query) => query.eq("season_id", season.selectedSeasonId)
    )
  ]);
  if (people.error || apps.error) {
    console.error("[form-roster-check] read", people.error ?? apps.error);
    return { ok: false, message: SAFE_ERROR };
  }

  const appsByPerson = new Map<string, Array<{ email_primary: string | null; phone_primary: string | null }>>();
  for (const app of apps.data) {
    const key = String(app.person_id ?? "");
    appsByPerson.set(key, [...(appsByPerson.get(key) ?? []), app]);
  }
  const peopleById = new Map(people.data.map((p) => [String(p.id), p]));
  const roster: RosterPerson[] = ids.map((personId) => {
    const p = peopleById.get(personId);
    const extra = appsByPerson.get(personId) ?? [];
    const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
    return {
      personId,
      name: String(p?.full_name ?? "").trim(),
      emails: uniq([normalizeMatchEmail(p?.email_primary), ...extra.map((a) => normalizeMatchEmail(a.email_primary))]),
      phones: uniq([normalizeMatchPhone(p?.phone_primary), ...extra.map((a) => normalizeMatchPhone(a.phone_primary))]),
      roles: cohort.data.get(personId) ?? []
    };
  });

  const result = checkFormAgainstRoster({
    role: input.role,
    people: roster,
    submissions: responses.data.responses.map((r) => submissionIdentity(form.fields, r))
  });
  return { ok: true, data: { form, seasonCode: season.selectedSeasonCode, result } };
}
