import "server-only";

import { approveApplication } from "@/lib/application-approvals";
import { requiredCheckboxAcknowledgements } from "@/lib/application-commitments";
import {
  evaluateRenewalInviteGate,
  mintRenewalInviteToken,
  renewalBindingFromInvite,
  safeHashRenewalInviteToken,
  type RenewalGateDecision,
  type RenewalInviteRow
} from "@/lib/renewal-invite-token";
import {
  buildRenewalProfileDiff,
  buildRenewalProfileRefresh,
  renewalProfileUpdateFromDiff,
  type RenewalProfileDiffEntry
} from "@/lib/renewal-profile-safety";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { validateSelectionWithOther } from "@/lib/application-form-validation";
import {
  carryOverRenewalProfile,
  RENEWAL_ONE_CLICK_MODE,
  RENEWAL_ONE_CLICK_NOTICE
} from "@/lib/renewal-one-click-core";
import { MENTOR_FUNCTION_OPTIONS, MENTOR_PROGRAM_OPTIONS, MENTOR_INDUSTRY_OPTIONS } from "@/lib/mentor-intake-content";
import {
  isRenewalMenteeCapacity,
  RENEWAL_MAX_EXPERIENCE_YEARS,
  RENEWAL_MENTEE_CAPACITY_CHOICES,
  type RenewalAdminActionState,
  type RenewalConfirmationIntent,
  type RenewalMentorProfile,
  type RenewalPerson,
  type RenewalPublicDisplayDto,
  type RenewalPublicActionState
} from "@/lib/renewal-types";

export type {
  RenewalAdminActionState,
  RenewalConfirmationIntent,
  RenewalMentorProfile,
  RenewalPerson,
  RenewalPublicDisplayDto,
  RenewalPublicActionState
} from "@/lib/renewal-types";

const SAFE_PUBLIC_FAILURE =
  "Không thể ghi nhận phản hồi gia hạn. Vui lòng tải lại trang hoặc liên hệ Ban Tổ chức.";
const SAFE_ADMIN_FAILURE =
  "Không thể hoàn tất thao tác gia hạn an toàn. Vui lòng tải lại và thử lại.";

type DbClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

export type RenewalPageData =
  | { status: "denied"; message: string }
  | {
      status: "completed";
      outcome: "accepted" | "declined";
      displayName: string | null;
    }
  | {
      status: "renewable";
      display: RenewalPublicDisplayDto;
    };

function safeLog(scope: string, error: unknown) {
  const candidate = error as { code?: string } | null;
  // Never log request payloads, RPC params, URLs, or raw tokens here.
  console.error("[renewal-runtime]", scope, { code: candidate?.code ?? "UNKNOWN" });
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function nonBlank(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function selectedValues(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((value) => String(value).trim()).filter(Boolean);
}

/** Ngành/chức năng phụ đã chọn, bỏ giá trị lặp; không chọn gì thì trả undefined để khoá bị bỏ. */
function secondarySelections(formData: FormData): string[] | undefined {
  const values = Array.from(new Set(selectedValues(formData, "secondary_industries_functions")));
  return values.length ? values : undefined;
}

/**
 * P0 submission envelope supplied to M071. Identity and binding fields are
 * intentionally impossible to add here; M071 obtains them from the invite.
 * Blank values are omitted, preserving canonical profile columns.
 *
 * Gia hạn một nút (BTC 13/10/2026). Hàm này chỉ được gọi khi người giữ link đã bấm
 * nút đứng ngay dưới RENEWAL_ONE_CLICK_NOTICE. Form không còn ô cam kết, câu xác nhận
 * gõ tay hay ô đồng ý lưu dữ liệu nào, nên phần đó không đọc gì từ formData: payload
 * ghi lại đúng điều đã xảy ra — đồng ý bằng một lần bấm, kèm nguyên văn câu họ thấy.
 *
 * Ghi `true` cho từng cam kết chứ không bỏ trống: đó là nội dung câu thông báo ("đồng ý
 * với các cam kết của mentor liệt kê bên dưới"), và mọi nơi đọc đơn gia hạn — bảng của
 * BTC, file xuất — vẫn hỏi đúng các khoá đó. `acceptance_mode` là thứ phân biệt đơn này
 * với các đơn trước 13/10, nơi từng ô được tick tay.
 */
export function renewalPayloadFromFormData(formData: FormData): Record<string, unknown> {
  const commitments: Record<string, boolean> = {};
  for (const entry of requiredCheckboxAcknowledgements("mentor")) commitments[entry.key] = true;

  const programs = Array.from(new Set(selectedValues(formData, "programs_willing_to_join")));

  const payload: Record<string, unknown> = {
    participation_confirmed: true,
    acceptance_mode: RENEWAL_ONE_CLICK_MODE,
    acceptance_notice: RENEWAL_ONE_CLICK_NOTICE,
    commitments,
    commitments_completed: true,
    core_team_note: nonBlank(formData, "core_team_note"),
    university: nonBlank(formData, "university"),
    university_other: nonBlank(formData, "university_other"),
    programs_willing_to_join: programs.length ? programs : undefined,
    // Lĩnh vực mentor chọn thêm ngoài ngành/chức năng chính (BTC 11/10/2026). Không chọn
    // gì thì KHÔNG ghi khoá này.
    secondary_industries_functions: secondarySelections(formData),
    secondary_industries_functions_other: nonBlank(formData, "secondary_industries_functions_other")
  };

  for (const key of [
    "company_current",
    "title_current",
    "function_primary",
    "function_primary_other",
    "industry_primary",
    "industry_primary_other",
    "mentor_total_work_years",
    "mentor_people_management_years",
    "mentoring_capacity_total",
    "mentoring_topics"
  ]) {
    const value = nonBlank(formData, key);
    if (value === undefined) continue;
    // Number("") is 0 and Number("abc") is NaN; nonBlank has already removed
    // the empty case, and the acceptance gate bounds every numeric value before
    // anything reaches M071.
    payload[key] = [
      "mentor_total_work_years",
      "mentor_people_management_years",
      "mentoring_capacity_total"
    ].includes(key)
      ? Number(value)
      : value;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }
  return payload;
}

export async function loadRenewalInviteByHash(
  client: DbClient,
  tokenHash: string
): Promise<{ ok: true; invite: RenewalInviteRow | null } | { ok: false }> {
  const { data, error } = await client
    .from("person_season_invites")
    .select(
      "id,token_hash,person_id,program_id,season_id,role,expires_at,revoked_at,submitted_at,outcome,application_id"
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    safeLog("invite lookup failed", error);
    return { ok: false };
  }
  return { ok: true, invite: (data as RenewalInviteRow | null) ?? null };
}

export async function resolveRenewalGate(
  rawToken: unknown,
  intent: "render" | "submit",
  client = getSupabaseServiceRoleClient()
): Promise<RenewalGateDecision> {
  if (!client) {
    return evaluateRenewalInviteGate(rawToken, intent, async () => ({ ok: false }));
  }
  return evaluateRenewalInviteGate(rawToken, intent, (hash) => loadRenewalInviteByHash(client, hash));
}

async function loadPersonAndProfile(client: DbClient, personId: string) {
  const [personResult, profileResult] = await Promise.all([
    client
      .from("people")
      .select("id,full_name,email_primary,phone_primary")
      .eq("id", personId)
      .maybeSingle(),
    client
      .from("mentor_profiles")
      .select(
        "id,person_id,mentor_code,company_current,title_current,years_experience_min,years_experience_text,capacity_target,industry,function_area,first_vam_season"
      )
      .eq("person_id", personId)
      .maybeSingle()
  ]);
  if (personResult.error || profileResult.error || !personResult.data || !profileResult.data) {
    safeLog("canonical renewal profile lookup failed", personResult.error ?? profileResult.error);
    return null;
  }
  return {
    person: personResult.data as RenewalPerson,
    profile: profileResult.data as RenewalMentorProfile
  };
}

export function buildRenewalPublicDisplayDto(
  person: RenewalPerson,
  profile: RenewalMentorProfile
): RenewalPublicDisplayDto {
  return {
    fullName: person.full_name,
    emailPrimary: person.email_primary,
    phonePrimary: person.phone_primary,
    mentorCode: profile.mentor_code,
    firstVamSeason: profile.first_vam_season ?? null,
    companyCurrent: profile.company_current,
    titleCurrent: profile.title_current,
    yearsExperienceMin: profile.years_experience_min,
    yearsExperienceText: profile.years_experience_text,
    capacityTarget: profile.capacity_target,
    industry: profile.industry,
    functionArea: profile.function_area
  };
}

/** Shared page render path. The same gate is called by both submit actions. */
export async function loadRenewalPage(
  rawToken: unknown,
  client = getSupabaseServiceRoleClient()
): Promise<RenewalPageData> {
  const decision = await resolveRenewalGate(rawToken, "render", client);
  if (decision.status === "denied") return { status: "denied", message: decision.reason };
  if (!client) return { status: "denied", message: SAFE_PUBLIC_FAILURE };

  if (decision.status === "completed") {
    const { data } = await client
      .from("people")
      .select("full_name")
      .eq("id", decision.invite.person_id)
      .maybeSingle();
    return {
      status: "completed",
      outcome: decision.outcome,
      displayName: String((data as { full_name?: unknown } | null)?.full_name ?? "").trim() || null
    };
  }

  const canonical = await loadPersonAndProfile(client, decision.invite.person_id);
  if (!canonical) return { status: "denied", message: SAFE_PUBLIC_FAILURE };
  return {
    status: "renewable",
    display: buildRenewalPublicDisplayDto(canonical.person, canonical.profile)
  };
}

/**
 * Normalised optional free text from the public renewal form.
 *
 * "" and whitespace-only mean the mentor chose not to say anything, and that is
 * NULL rather than an empty string: a column holding '' and a column holding
 * NULL would render identically in the console while comparing differently in
 * every query written later.
 */
export function normalizeOptionalFeedback(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type RenewalAcceptanceValidation =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * P0-RT-12. The server-side acceptance gate.
 *
 * The submission arrives at a server action, and a direct POST never renders
 * the form at all — so whatever the form marks or pre-selects is worth nothing
 * here. Fails CLOSED and BEFORE M071: a submission that does not satisfy every
 * condition never reaches the trusted RPC, so no invite is claimed, no
 * applications row is written and the invite stays usable for a corrected
 * resubmission.
 *
 * Gia hạn một nút (BTC 13/10/2026) đổi NỘI DUNG của cổng này, không đổi vị trí của nó:
 *
 *   - Còn bắt buộc đúng một thứ: số mentee nhận mùa này. Form luôn gửi nó (mặc định 1),
 *     nên thiếu nghĩa là một lần POST thẳng — và đó là cam kết của từng mùa, không có
 *     giá trị nào trong hồ sơ để giữ nguyên thay.
 *   - Mọi ô hồ sơ khác KHÔNG bắt buộc. Để trống là giữ hồ sơ mùa trước. Nhưng ô nào đã
 *     gửi lên thì phải hợp lệ: một lựa chọn không có trong danh sách, hay "Khác" mà
 *     không ghi rõ, vẫn bị từ chối như trước.
 *   - Cam kết, câu xác nhận gõ tay và ô đồng ý lưu dữ liệu không còn được kiểm ở đây,
 *     vì form không còn hỏi: bấm nút dưới RENEWAL_ONE_CLICK_NOTICE là đồng ý. Điều đó
 *     được GHI vào payload (renewalPayloadFromFormData), không phải đọc từ formData.
 *   - Ngành / chức năng phụ không còn trần 3 lựa chọn.
 */
export function validateRenewalAcceptance(formData: FormData): RenewalAcceptanceValidation {
  const payload = renewalPayloadFromFormData(formData);

  if (!isRenewalMenteeCapacity(payload.mentoring_capacity_total)) {
    return {
      ok: false,
      message: `Vui lòng chọn số mentee có thể đồng hành: ${RENEWAL_MENTEE_CAPACITY_CHOICES.join(", ")}.`
    };
  }

  if (payload.function_primary === undefined) {
    // Câu ghi rõ "Khác" không đi một mình: không chọn chức năng thì không có gì để ghi rõ.
    delete payload.function_primary_other;
  } else {
    const allowedFunctions = new Set(MENTOR_FUNCTION_OPTIONS.map((option) => option.value));
    const functionPrimary = String(payload.function_primary);
    if (!allowedFunctions.has(functionPrimary)) {
      return { ok: false, message: "Vui lòng chọn chức năng/chuyên môn chính hợp lệ." };
    }
    if (functionPrimary === "other") {
      const functionPrimaryOther = String(payload.function_primary_other ?? "").trim();
      if (!functionPrimaryOther) {
        return { ok: false, message: "Vui lòng ghi rõ chức năng/chuyên môn chính khác." };
      }
      payload.function_primary_other = functionPrimaryOther;
    } else {
      delete payload.function_primary_other;
    }
  }

  if (payload.industry_primary === undefined) {
    delete payload.industry_primary_other;
  } else {
    const allowedIndustries = new Set(MENTOR_INDUSTRY_OPTIONS.map((option) => option.value));
    const industryPrimary = String(payload.industry_primary);
    if (!allowedIndustries.has(industryPrimary)) {
      return { ok: false, message: "Vui lòng chọn ngành nghề chính hợp lệ." };
    }
    if (industryPrimary === "other") {
      const industryPrimaryOther = String(payload.industry_primary_other ?? "").trim();
      if (!industryPrimaryOther) {
        return { ok: false, message: "Vui lòng ghi rõ ngành nghề chính khác." };
      }
      payload.industry_primary_other = industryPrimaryOther;
    } else {
      delete payload.industry_primary_other;
    }
  }

  // Ngành/chức năng phụ: không bắt buộc và không giới hạn số lượng (BTC 13/10/2026),
  // nhưng đã gửi lên thì phải là lựa chọn có thật trong danh sách, và "Khác" phải kèm
  // nội dung — cùng luật với form đăng ký mentor mới (validateSelectionWithOther).
  const secondary = Array.isArray(payload.secondary_industries_functions)
    ? payload.secondary_industries_functions.map(String)
    : [];
  const allowedSecondary = new Set(
    [...MENTOR_INDUSTRY_OPTIONS, ...MENTOR_FUNCTION_OPTIONS].map((option) => option.value)
  );
  if (secondary.some((value) => !allowedSecondary.has(value))) {
    return { ok: false, message: "Vui lòng chọn ngành/chức năng phụ hợp lệ." };
  }
  const secondaryCheck = validateSelectionWithOther({
    values: secondary,
    otherText: String(payload.secondary_industries_functions_other ?? ""),
    fieldName: "secondary_industries_functions",
    fieldLabel: "Ngành / chức năng phụ"
  });
  if (!secondaryCheck.ok) {
    return { ok: false, message: `Ngành / chức năng phụ: ${secondaryCheck.message}` };
  }
  // Chữ "Khác" còn sót lại sau khi đã bỏ chọn "Khác" thì không lưu.
  if (!secondary.includes("other")) delete payload.secondary_industries_functions_other;

  const hasWorkYears = payload.mentor_total_work_years !== undefined;
  const workYears = Number(payload.mentor_total_work_years);
  if (hasWorkYears && (!Number.isInteger(workYears) || workYears < 0 || workYears > RENEWAL_MAX_EXPERIENCE_YEARS)) {
    return {
      ok: false,
      message: `Số năm kinh nghiệm phải là số nguyên từ 0 đến ${RENEWAL_MAX_EXPERIENCE_YEARS}.`
    };
  }
  if (payload.mentor_people_management_years !== undefined) {
    const managementYears = Number(payload.mentor_people_management_years);
    // So với số năm kinh nghiệm khi mentor có gửi nó; không thì chỉ còn trần chung.
    const ceiling = hasWorkYears ? workYears : RENEWAL_MAX_EXPERIENCE_YEARS;
    if (!Number.isInteger(managementYears) || managementYears < 0 || managementYears > ceiling) {
      return {
        ok: false,
        message: `Số năm kinh nghiệm quản lý phải là số nguyên từ 0 đến ${ceiling}.`
      };
    }
  }
  if (payload.mentoring_topics !== undefined && String(payload.mentoring_topics).length > 2000) {
    return { ok: false, message: "Chủ đề mentoring không được vượt quá 2.000 ký tự." };
  }

  if (payload.university === undefined) {
    delete payload.university_other;
  } else {
    const university = String(payload.university);
    if (!["UEH", "OTHER"].includes(university)) {
      return { ok: false, message: "Vui lòng chọn trường đại học đã tốt nghiệp." };
    }
    if (university === "OTHER" && !String(payload.university_other ?? "").trim()) {
      return { ok: false, message: "Vui lòng nhập tên trường đại học." };
    }
    if (university !== "OTHER") delete payload.university_other;
  }

  if (payload.programs_willing_to_join !== undefined) {
    const allowedPrograms = new Set(MENTOR_PROGRAM_OPTIONS.map((option) => option.value));
    const programs = (payload.programs_willing_to_join as unknown[]).map(String);
    if (programs.some((program) => !allowedPrograms.has(program))) {
      return { ok: false, message: "Vui lòng chọn chương trình sẵn sàng tham gia hợp lệ." };
    }
  }

  return { ok: true, payload };
}

/**
 * Chương trình ghi cho một đơn gia hạn không khai chương trình nào. Link gia hạn này là
 * của UEH Mentoring Season 12, nên bấm Gia hạn chính là nhận lời với chương trình đó.
 */
export const RENEWAL_DEFAULT_PROGRAM = "UEHM";

export async function submitRenewalAccepted(
  rawToken: unknown,
  formData: FormData,
  client = getSupabaseServiceRoleClient()
): Promise<RenewalPublicActionState> {
  const validation = validateRenewalAcceptance(formData);
  if (!validation.ok) return { ok: false, message: validation.message };

  const decision = await resolveRenewalGate(rawToken, "submit", client);
  if (decision.status !== "renewable" || !client) {
    return { ok: false, message: decision.status === "denied" ? decision.reason : SAFE_PUBLIC_FAILURE };
  }
  const tokenHash = safeHashRenewalInviteToken(rawToken);
  if (!tokenHash) return { ok: false, message: SAFE_PUBLIC_FAILURE };

  // Hồ sơ mùa trước đi cùng đơn: ô nào mentor không tự điền thì chép từ hồ sơ đang lưu.
  // Đọc hồ sơ theo người của CHÍNH lời mời, không theo bất cứ thứ gì trong form. Không
  // đọc được thì dừng trước khi ghi — lời mời còn nguyên, bấm lại là được; ghi tiếp với
  // một đơn thiếu nửa hồ sơ thì không có lần sửa nào về sau.
  const canonical = await loadPersonAndProfile(client, decision.invite.person_id);
  if (!canonical) return { ok: false, message: SAFE_PUBLIC_FAILURE };
  const carried = carryOverRenewalProfile(validation.payload, canonical.profile, {
    industries: MENTOR_INDUSTRY_OPTIONS,
    functions: MENTOR_FUNCTION_OPTIONS
  });
  const payload = carried.payload;
  const filled = [...carried.filled];
  if (payload.programs_willing_to_join === undefined) {
    payload.programs_willing_to_join = [RENEWAL_DEFAULT_PROGRAM];
    filled.push("programs_willing_to_join");
  }
  // Ghi rõ ô nào do hệ thống điền: về sau phân biệt được "mentor khai lại" với "giữ nguyên".
  if (filled.length) payload.system_filled_fields = filled;

  const { data, error } = await client.rpc("vam071_submit_renewal_accepted", {
    p_token_hash: tokenHash,
    p_raw_payload: payload,
    p_consent_data_storage: true
  });
  if (error) {
    safeLog("accepted submission refused", error);
    return { ok: false, message: SAFE_PUBLIC_FAILURE };
  }
  const result = firstRow(data);
  if (result?.outcome_status !== "accepted") {
    return { ok: false, message: SAFE_PUBLIC_FAILURE };
  }
  return {
    ok: true,
    outcome: "accepted",
    message: "Ban Tổ chức đã nhận xác nhận tiếp tục đồng hành của anh/chị. Xin cảm ơn!"
  };
}

export async function submitRenewalDeclined(
  rawToken: unknown,
  formData?: FormData,
  client = getSupabaseServiceRoleClient()
): Promise<RenewalPublicActionState> {
  const decision = await resolveRenewalGate(rawToken, "submit", client);
  if (decision.status !== "renewable" || !client) {
    return { ok: false, message: decision.status === "denied" ? decision.reason : SAFE_PUBLIC_FAILURE };
  }
  const tokenHash = safeHashRenewalInviteToken(rawToken);
  if (!tokenHash) return { ok: false, message: SAFE_PUBLIC_FAILURE };

  // M073. The feedback is a parameter of the same trusted call that claims the
  // invite, so it is written by the single winner UPDATE or not at all. There
  // is deliberately no second statement here: the previous implementation
  // followed the RPC with an unlinked applications INSERT, which M070's
  // application-binding constraint makes permanently orphanable and which the
  // applications_status_check refused outright.
  const { data, error } = await client.rpc("vam071_submit_renewal_declined", {
    p_token_hash: tokenHash,
    p_decline_feedback: normalizeOptionalFeedback(formData?.get("decline_feedback"))
  });
  if (error) {
    safeLog("declined submission refused", error);
    return { ok: false, message: SAFE_PUBLIC_FAILURE };
  }
  const result = firstRow(data);
  if (result?.outcome_status !== "declined") {
    return { ok: false, message: SAFE_PUBLIC_FAILURE };
  }

  // `deferred_actor_unauthorized` is deliberately not exposed to the bearer.
  // The durable invite+membership state makes it prominent in the admin list.
  return {
    ok: true,
    outcome: "declined",
    message: "Ban Tổ chức đã ghi nhận anh/chị không tiếp tục đồng hành trong Season 12. Xin cảm ơn!"
  };
}

export type MembershipReconciliationResult =
  | { ok: true; outcome: "created" | "noop" | "reactivated"; membershipId?: string }
  | { ok: false; status: string; message: string };

/** P0-RT-10 exact status mapping. No other status is auto-reactivated. */
export async function reconcileRenewalMembership(
  client: DbClient,
  input: {
    actorAdminUserId: string;
    personId: string;
    programId: string;
    seasonId: string;
    role: "mentor";
  }
): Promise<MembershipReconciliationResult> {
  const { data, error } = await client
    .from("person_season_memberships")
    .select("id,status")
    .eq("person_id", input.personId)
    .eq("season_id", input.seasonId)
    .eq("role", input.role)
    .maybeSingle();
  if (error) return { ok: false, status: "unknown", message: SAFE_ADMIN_FAILURE };

  const membership = data as { id: string; status: string } | null;
  if (!membership) {
    const rpc = await client.rpc("vam063_add_membership_role", {
      p_actor_admin_user_id: input.actorAdminUserId,
      p_person_id: input.personId,
      p_program_id: input.programId,
      p_season_id: input.seasonId,
      p_role: input.role,
      p_reason: "Season 12 returning mentor renewal confirmed"
    });
    const result = firstRow(rpc.data);
    if (rpc.error || !["created", "noop"].includes(String(result?.outcome_status ?? ""))) {
      return { ok: false, status: "none", message: SAFE_ADMIN_FAILURE };
    }
    return {
      ok: true,
      outcome: result?.outcome_status === "created" ? "created" : "noop",
      membershipId: String(result?.membership_id ?? "") || undefined
    };
  }

  const status = String(membership.status ?? "").trim().toLowerCase();
  if (status === "active") return { ok: true, outcome: "noop", membershipId: membership.id };
  if (status === "opted_out") {
    const rpc = await client.rpc("vam063_reactivate_membership", {
      p_actor_admin_user_id: input.actorAdminUserId,
      p_membership_id: membership.id,
      p_reason: "Season 12 returning mentor renewal confirmed"
    });
    const result = firstRow(rpc.data);
    if (rpc.error || !["transitioned", "noop"].includes(String(result?.outcome_status ?? ""))) {
      return { ok: false, status, message: SAFE_ADMIN_FAILURE };
    }
    return { ok: true, outcome: "reactivated", membershipId: membership.id };
  }

  return {
    ok: false,
    status: status || "unknown",
    message: `Membership đang ở trạng thái ${status || "không xác định"}; quy trình gia hạn tự động đã dừng trước bước duyệt đơn.`
  };
}

export type RenewalConfirmationSnapshot = {
  invite: RenewalInviteRow;
  application: Record<string, unknown>;
  person: RenewalPerson;
  profile: RenewalMentorProfile;
  diff: RenewalProfileDiffEntry[];
  expectedProfile: Record<string, string | number | null>;
  profileUpdate: Record<string, string | number>;
};

export async function loadRenewalConfirmationSnapshot(
  client: DbClient,
  applicationId: string
): Promise<RenewalConfirmationSnapshot | null> {
  const [inviteResult, applicationResult] = await Promise.all([
    client
      .from("person_season_invites")
      .select(
        "id,token_hash,person_id,program_id,season_id,role,expires_at,revoked_at,submitted_at,outcome,application_id"
      )
      .eq("application_id", applicationId)
      .maybeSingle(),
    client
      .from("applications")
      .select(
        "id,person_id,season_id,role_applied,status,source,full_name,email_primary,phone_primary,gender,intake_batch_id,raw_payload"
      )
      .eq("id", applicationId)
      .maybeSingle()
  ]);
  if (inviteResult.error || applicationResult.error || !inviteResult.data || !applicationResult.data) {
    return null;
  }
  const invite = inviteResult.data as RenewalInviteRow;
  const application = applicationResult.data as Record<string, unknown>;
  if (
    invite.outcome !== "accepted" ||
    invite.application_id !== applicationId ||
    application.source !== "s12_mentor_renewal" ||
    application.person_id !== invite.person_id ||
    application.season_id !== invite.season_id ||
    invite.role !== "mentor"
  ) {
    return null;
  }
  const canonical = await loadPersonAndProfile(client, invite.person_id);
  if (!canonical) return null;
  const rawPayload = application.raw_payload as Record<string, unknown> | null;
  const renewalPayload =
    rawPayload?.renewal && typeof rawPayload.renewal === "object" && !Array.isArray(rawPayload.renewal)
      ? (rawPayload.renewal as Record<string, unknown>)
      : {};
  const candidate = buildRenewalProfileRefresh(renewalPayload);
  const diff = buildRenewalProfileDiff(canonical.profile, candidate);
  const expectedProfile: Record<string, string | number | null> = {};
  for (const entry of diff) expectedProfile[entry.field] = entry.before;
  return {
    invite,
    application,
    ...canonical,
    diff,
    expectedProfile,
    profileUpdate: renewalProfileUpdateFromDiff(diff)
  };
}

export async function confirmRenewalAndApprove(
  input: {
    applicationId: string;
    actorAdminUserId: string;
    actorName: string | null;
    reviewed: RenewalConfirmationIntent;
  },
  client = getSupabaseServiceRoleClient()
): Promise<RenewalAdminActionState> {
  if (!client) return { ok: false, message: SAFE_ADMIN_FAILURE };

  // 1. Fresh read of application, invite and canonical profile.
  const snapshot = await loadRenewalConfirmationSnapshot(client, input.applicationId);
  if (!snapshot) return { ok: false, message: "Dữ liệu gia hạn không còn hợp lệ. Vui lòng tải lại." };
  const binding = renewalBindingFromInvite(snapshot.invite);

  // A response retry after approval is already durably complete. Return before
  // the confirm RPC so no duplicate confirm_renewal audit can be appended.
  // Incomplete applications still pass through the full drift check below.
  if (snapshot.application.status === "approved_as_mentor") {
    return {
      ok: true,
      outcome: "renewal_already_complete",
      message: "Gia hạn đã hoàn tất trước đó; không tạo thêm mutation hoặc log trùng."
    };
  }

  // The reviewed snapshot is bound to the Server Action by the Server
  // Component that rendered the table. Next encrypts bound Server Action
  // arguments, so the browser cannot replace CURRENT/PROPOSED values. Validate
  // its internal consistency again before it reaches M071.
  const reviewed = input.reviewed;
  const reviewedFields = reviewed.diff.map((entry) => entry.field).sort();
  const expectedFields = Object.keys(reviewed.expectedProfile).sort();
  const updateFields = Object.keys(reviewed.profileUpdate).sort();
  const intentIsConsistent =
    reviewed.applicationId === input.applicationId &&
    JSON.stringify(reviewedFields) === JSON.stringify(expectedFields) &&
    JSON.stringify(reviewedFields) === JSON.stringify(updateFields) &&
    reviewed.diff.every(
      (entry) =>
        reviewed.expectedProfile[entry.field] === entry.before &&
        reviewed.profileUpdate[entry.field] === entry.after
    ) &&
    updateFields.every(
      (field) =>
        (buildRenewalProfileRefresh(
          ((snapshot.application.raw_payload as Record<string, unknown> | null)?.renewal as Record<string, unknown> | undefined) ?? {}
        ) as Record<string, unknown>)[field] === reviewed.profileUpdate[field]
    );
  if (!intentIsConsistent) {
    return { ok: false, outcome: "confirmation_intent_invalid", message: "Diff xác nhận không hợp lệ. Vui lòng tải lại." };
  }

  // 4. (Steps 2–3 are UI review and this submitted admin action.)
  const confirmation = await client.rpc("vam071_confirm_renewal_profile", {
    p_actor_admin_user_id: input.actorAdminUserId,
    p_application_id: input.applicationId,
    p_expected_profile: reviewed.expectedProfile,
    p_profile_update: reviewed.profileUpdate,
    p_diff: reviewed.diff
  });
  const confirmationResult = firstRow(confirmation.data);
  if (
    confirmation.error ||
    !["applied", "noop"].includes(String(confirmationResult?.outcome_status ?? ""))
  ) {
    safeLog("profile confirmation refused", confirmation.error);
    return {
      ok: false,
      outcome: "profile_confirmation_refused",
      message: "Hồ sơ đã thay đổi hoặc xác nhận không còn hợp lệ. Hãy tải lại diff và kiểm tra lại."
    };
  }

  // 5. Membership reconciliation. A failure is intentionally not compensated;
  // retry re-enters the idempotent M071 confirmation and converges.
  const membership = await reconcileRenewalMembership(client, {
    actorAdminUserId: input.actorAdminUserId,
    personId: binding.personId,
    programId: binding.programId,
    seasonId: binding.seasonId,
    role: "mentor"
  });
  if (!membership.ok) {
    return {
      ok: false,
      outcome: "profile_confirmed_membership_refused",
      message: `Hồ sơ đã được xác nhận nhưng chưa duyệt đơn. ${membership.message} Có thể thử lại sau khi xử lý membership.`
    };
  }

  // 6. Shared approval boundary re-checks the durable confirm_renewal audit.
  const app = snapshot.application;
  const approval = await approveApplication({
    applicationId: input.applicationId,
    approvedByAdminUserId: input.actorAdminUserId,
    approvedByName: input.actorName,
    fullName: String(app.full_name ?? snapshot.person.full_name ?? "").trim() || null,
    emailPrimary: String(app.email_primary ?? snapshot.person.email_primary ?? "").trim() || null,
    phonePrimary: String(app.phone_primary ?? snapshot.person.phone_primary ?? "").trim() || null,
    gender: String(app.gender ?? "").trim() || null,
    seasonCode: "UEHM-S12",
    intakeBatchId: null,
    targetRole: "mentor",
    previousStatus: String(app.status ?? "").trim() || null
  });
  if (!approval.ok) {
    return {
      ok: false,
      outcome: "profile_and_membership_confirmed_approval_failed",
      message: `Hồ sơ và membership đã được xử lý nhưng đơn chưa được duyệt. ${approval.message} Có thể thử lại an toàn.`
    };
  }

  return {
    ok: true,
    outcome: "renewal_complete",
    message: "Đã xác nhận hồ sơ, đối soát membership và duyệt gia hạn thành công."
  };
}

export function mintRenewalPath() {
  const minted = mintRenewalInviteToken();
  return { tokenHash: minted.tokenHash, renewalPath: `/renew/${minted.token}` };
}

export async function createRenewalInvite(
  input: {
    actorAdminUserId: string;
    personId: string;
    programId: string;
    seasonId: string;
    expiresAt: string;
  },
  client = getSupabaseServiceRoleClient()
): Promise<RenewalAdminActionState> {
  if (!client) return { ok: false, message: SAFE_ADMIN_FAILURE };
  // Mint only after authorization/shape checks performed by the server action.
  // The raw half remains only in this stack frame and the one-time response.
  const minted = mintRenewalPath();
  const { data, error } = await client.rpc("vam071_create_renewal_invite", {
    p_actor_admin_user_id: input.actorAdminUserId,
    p_person_id: input.personId,
    p_program_id: input.programId,
    p_season_id: input.seasonId,
    p_role: "mentor",
    p_token_hash: minted.tokenHash,
    p_expires_at: input.expiresAt
  });
  const result = firstRow(data);
  if (error || result?.outcome_status !== "created") {
    safeLog("invite creation refused", error);
    return { ok: false, message: SAFE_ADMIN_FAILURE };
  }
  return {
    ok: true,
    outcome: "created",
    message: "Đã tạo link gia hạn. Link chỉ hiển thị trong phản hồi này; hãy sao chép ngay.",
    renewalPath: minted.renewalPath
  };
}

export async function revokeRenewalInvite(
  input: { actorAdminUserId: string; inviteId: string; reason?: string | null },
  client = getSupabaseServiceRoleClient()
): Promise<RenewalAdminActionState> {
  if (!client) return { ok: false, message: SAFE_ADMIN_FAILURE };
  const { data, error } = await client.rpc("vam071_revoke_renewal_invite", {
    p_actor_admin_user_id: input.actorAdminUserId,
    p_invite_id: input.inviteId,
    p_reason: input.reason?.trim() || null
  });
  const result = firstRow(data);
  const outcome = String(result?.outcome_status ?? "");
  if (error || !["revoked", "noop"].includes(outcome)) {
    safeLog("invite revocation refused", error);
    return { ok: false, message: SAFE_ADMIN_FAILURE };
  }
  return {
    ok: true,
    outcome,
    message: outcome === "noop" ? "Link đã được thu hồi trước đó." : "Đã thu hồi link gia hạn."
  };
}

export async function regenerateRenewalInvite(
  input: { actorAdminUserId: string; inviteId: string; expiresAt: string },
  client = getSupabaseServiceRoleClient()
): Promise<RenewalAdminActionState> {
  if (!client) return { ok: false, message: SAFE_ADMIN_FAILURE };
  const { data: invite, error } = await client
    .from("person_season_invites")
    .select("id,person_id,program_id,season_id,role,submitted_at")
    .eq("id", input.inviteId)
    .maybeSingle();
  if (error || !invite || invite.role !== "mentor" || invite.submitted_at !== null) {
    return { ok: false, message: "Chỉ có thể tạo lại link mentor chưa được trả lời." };
  }

  // Contractual order: revoke the old invite, then create a new one. If create
  // fails, the old link stays safely revoked and the operator gets an explicit
  // partial-failure message. No compensating un-revoke exists or is attempted.
  const revoked = await revokeRenewalInvite(
    {
      actorAdminUserId: input.actorAdminUserId,
      inviteId: input.inviteId,
      reason: "Regenerated from admin renewal console"
    },
    client
  );
  if (!revoked.ok) return revoked;
  const created = await createRenewalInvite(
    {
      actorAdminUserId: input.actorAdminUserId,
      personId: String(invite.person_id),
      programId: String(invite.program_id),
      seasonId: String(invite.season_id),
      expiresAt: input.expiresAt
    },
    client
  );
  if (!created.ok) {
    return {
      ok: false,
      outcome: "old_invite_revoked_new_invite_failed",
      message: "Link cũ đã được thu hồi nhưng chưa tạo được link mới. Có thể thử tạo lại an toàn."
    };
  }
  return { ...created, outcome: "regenerated", message: "Đã thu hồi link cũ và tạo link mới. Hãy sao chép ngay." };
}

/**
 * Mở lại link gia hạn cho mentor đã bấm "Từ chối" rồi đổi ý (BTC 08/10/2026 — chị
 * Đặng Thụy Thanh Lan; trường hợp này sẽ còn lặp lại).
 *
 * Đây là lối tắt trên dòng "Từ chối" của ĐÚNG đường mời lại từng người đã có (khung
 * "Tạo link gia hạn cá nhân", M076): cùng createRenewalInvite, cùng
 * vam071_create_renewal_invite. Lời mời đã từ chối được GIỮ NGUYÊN làm lịch sử —
 * không thu hồi, vì nó đã được trả lời và không còn là link sống. Database tự chặn
 * nếu người này đã đồng ý hoặc đang có một link sống.
 *
 * Khi mentor đồng ý qua link mới, bước "Xác nhận & hoàn tất" kích hoạt lại tư cách
 * mùa đang ở opted_out (reconcileRenewalMembership) — lời từ chối cũ không chặn gì.
 */
export async function reopenDeclinedRenewalInvite(
  input: { actorAdminUserId: string; inviteId: string; expiresAt: string },
  client = getSupabaseServiceRoleClient()
): Promise<RenewalAdminActionState> {
  if (!client) return { ok: false, message: SAFE_ADMIN_FAILURE };
  const { data: invite, error } = await client
    .from("person_season_invites")
    .select("id,person_id,program_id,season_id,role,outcome")
    .eq("id", input.inviteId)
    .maybeSingle();
  if (error || !invite || invite.role !== "mentor" || invite.outcome !== "declined") {
    return { ok: false, message: "Chỉ mở lại được link của mentor đã bấm Từ chối." };
  }
  const created = await createRenewalInvite(
    {
      actorAdminUserId: input.actorAdminUserId,
      personId: String(invite.person_id),
      programId: String(invite.program_id),
      seasonId: String(invite.season_id),
      expiresAt: input.expiresAt
    },
    client
  );
  if (!created.ok) {
    return {
      ok: false,
      message: "Chưa tạo được link mới — mentor này có thể đã có một link đang hiệu lực hoặc đã đồng ý. Tải lại trang để xem."
    };
  }
  return { ...created, outcome: "reopened", message: "Đã mở lại: tạo link gia hạn mới. Link chỉ hiện một lần — hãy sao chép và gửi cho mentor ngay." };
}
