import "server-only";

import { evaluateApplyGate } from "@/lib/apply-gate";
import { S12_BINDING } from "@/lib/application-form-controls";
import { emailsEqual, escapeIlikePattern, isValidEmail, normalizeEmail } from "@/lib/identity";
import { getSupabaseServiceRoleClient, getSupabaseServiceRoleEnvStatus } from "@/lib/supabase-server";
import type { JsonRecord } from "@/lib/types";

export type ApplicationRole = "mentor" | "mentee";

export type ApplicationSubmissionInput = {
  role: ApplicationRole;
  seasonCode: string; // e.g. "UEHM-S12"
  intakeBatchCode: string; // e.g. "UEHM-S12-B1"
  /**
   * The pilot token the applicant's page carried, if any. Used ONLY to
   * evaluate the gate. Never logged, never written to any table.
   */
  applyToken?: string | null;
  fullName: string;
  emailPrimary: string;
  phonePrimary: string;
  gender?: string | null;
  consentDataStorage: boolean;
  /** Everything else from the form goes here verbatim. */
  rawPayload: JsonRecord;
  /** Structured, auditable answers written after the application row. */
  answers?: Array<{
    questionKey: string;
    questionLabel: string;
    valueText: string;
    acceptedAt?: string;
  }>;
};

/**
 * A machine-readable tag for refusals the applicant-facing form must explain
 * differently. It never widens what the server discloses: it is set only on a
 * refusal the caller's own submission already produced.
 */
export type ApplicationSubmissionReason = "returning_mentor";

export type ApplicationSubmissionResult =
  | { ok: true; applicationId: string }
  | {
      ok: false;
      code: "config" | "duplicate" | "season_missing" | "batch_missing" | "validation" | "db" | "incomplete_submission";
      message: string;
      reason?: ApplicationSubmissionReason;
    };

const SAFE_ERROR =
  "Không thể ghi đơn ứng tuyển. Vui lòng thử lại sau hoặc liên hệ ban tổ chức nếu vấn đề tiếp diễn.";

/**
 * One message for every gate refusal. The gate's own `code` distinguishes
 * "closed", "wrong token" and "lookup failed" for the server log, but the
 * applicant sees a single string: telling an anonymous caller which of those
 * it hit is free reconnaissance on the token and on the season binding.
 */
const GATE_CLOSED_MESSAGE =
  "Đơn đăng ký cho vai trò này hiện chưa được mở. Vui lòng chờ thông báo chính thức.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[applications-create]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error(
      "[applications-create] service-role client unavailable",
      getSupabaseServiceRoleEnvStatus()
    );
    return {
      client: null,
      error:
        "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server. Pilot form không thể ghi đơn cho đến khi cấu hình lại."
    } as const;
  }
  const envStatus = getSupabaseServiceRoleEnvStatus();
  if (envStatus.sameAsAnonKey) {
    console.error(
      "[applications-create] SUPABASE_SERVICE_ROLE_KEY equals anon key — RLS will silently block writes",
      envStatus
    );
    return {
      client: null,
      error:
        "Cấu hình sai: SUPABASE_SERVICE_ROLE_KEY đang trùng với anon key. Pilot form không thể ghi đơn."
    } as const;
  }
  return { client, error: null } as const;
}

function normalisePhone(value: string) {
  let phone = value.replace(/\s+/g, "").trim();
  if (phone.startsWith("+84")) {
    phone = "0" + phone.slice(3);
  } else if (phone.startsWith("84") && phone.length === 11) {
    phone = "0" + phone.slice(2);
  }
  return phone;
}

function safeText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

/**
 * Insert a single application row from the public pilot intake form.
 *
 * Behavior:
 *   - Resolves season + intake_batch by code.
 *   - Blocks duplicates: same season + same role_applied + same canonical
 *     email returns code='duplicate'.
 *   - Writes `applications` and optional `application_answers`. Does NOT touch
 *     people, profiles, matches, or review/decision tables.
 *   - Uses service-role client so RLS does not block the anonymous form.
 */
export async function submitPilotApplication(
  input: ApplicationSubmissionInput
): Promise<ApplicationSubmissionResult> {
  // ── M069 gate — FIRST, before any write path is reachable ─────────────────
  // This is the same `evaluateApplyGate` the page render calls, with the same
  // inputs. Invoking this Server Action directly (stale tab, replayed POST,
  // handcrafted request) therefore cannot bypass what the page enforced.

  // The Season 12 binding is fixed. A submission naming any other season or
  // intake is refused outright rather than gated — that is what stops a
  // Season 11 form from ever being reachable through this path.
  if (
    input.seasonCode !== S12_BINDING.seasonCode ||
    input.intakeBatchCode !== S12_BINDING.intakeBatchCode
  ) {
    console.error("[applications-create] refused non-canonical intake binding", {
      role: input.role,
      seasonCode: input.seasonCode,
      intakeBatchCode: input.intakeBatchCode
    });
    return { ok: false, code: "validation", message: GATE_CLOSED_MESSAGE };
  }

  const gate = await evaluateApplyGate(input.applyToken, input.role);
  if (gate.status !== "open") {
    console.warn("[applications-create] submission refused by gate", {
      role: input.role,
      code: gate.code
    });
    return { ok: false, code: "validation", message: GATE_CLOSED_MESSAGE };
  }

  const IDENTITY_LOOKUP_MAX_CANDIDATES = 25;

  const { client, error: clientError } = clientResult();
  if (!client) {
    return { ok: false, code: "config", message: clientError ?? SAFE_ERROR };
  }

  const fullName = safeText(input.fullName);
  const emailPrimary = normalizeEmail(input.emailPrimary);
  const exactLookupPattern = escapeIlikePattern(emailPrimary);
  const fallbackLookupPattern = `%${exactLookupPattern}%`;
  const phonePrimary = normalisePhone(input.phonePrimary);
  const gender = safeText(input.gender);

  if (!fullName) {
    return { ok: false, code: "validation", message: "Họ tên không được để trống." };
  }
  if (!isValidEmail(emailPrimary)) {
    return { ok: false, code: "validation", message: "Email không hợp lệ." };
  }
  if (!phonePrimary) {
    return { ok: false, code: "validation", message: "Số điện thoại không được để trống." };
  }
  if (!input.consentDataStorage) {
    return {
      ok: false,
      code: "validation",
      message: "Bạn cần đồng ý cho phép VAM OS lưu trữ dữ liệu cá nhân để gửi đơn."
    };
  }

  // Resolve season
  const { data: seasonRow, error: seasonErr } = await client
    .from("seasons")
    .select("id,code")
    .eq("code", input.seasonCode)
    .maybeSingle();
  if (seasonErr) {
    log("season lookup failed", seasonErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (seasons: ${seasonErr.message})` };
  }
  if (!seasonRow) {
    return {
      ok: false,
      code: "season_missing",
      message: `Mùa ${input.seasonCode} chưa được tạo trong hệ thống. Vui lòng liên hệ BTC.`
    };
  }

  // Resolve intake batch
  const { data: batchRow, error: batchErr } = await client
    .from("intake_batches")
    .select("id,code")
    .eq("season_id", seasonRow.id)
    .eq("code", input.intakeBatchCode)
    .maybeSingle();
  if (batchErr) {
    log("intake_batch lookup failed", batchErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (intake_batches: ${batchErr.message})` };
  }
  if (!batchRow) {
    return {
      ok: false,
      code: "batch_missing",
      message: `Đợt ${input.intakeBatchCode} chưa được tạo trong hệ thống. Vui lòng liên hệ BTC.`
    };
  }

  // The role gate was evaluated at the top of this function, against the
  // database rather than an environment variable. Nothing re-checks it here.

  // Duplicate check: same season + same role + same canonical email. A person
  // may apply again in a later season, but not twice for this season merely by
  // changing case/whitespace or selecting another intake batch.
  // The `%...%` lookup exists to compensate for historical untrimmed/mixed-case
  // stored values, but canonical emailsEqual remains the authority.
  // The `%...%` fallback exists to compensate for historical untrimmed/mixed-case
  // stored values, but canonical emailsEqual remains the authority. We try exact first
  // to avoid short emails matching many unrelated rows and overflowing the limit.
  let { data: duplicateCandidates, error: dupErr } = await client
    .from("applications")
    .select("id,email_primary")
    .eq("season_id", seasonRow.id)
    .eq("role_applied", input.role)
    .ilike("email_primary", exactLookupPattern)
    .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

  if (!dupErr && (duplicateCandidates ?? []).length === 0) {
    const fallback = await client
      .from("applications")
      .select("id,email_primary")
      .eq("season_id", seasonRow.id)
      .eq("role_applied", input.role)
      .ilike("email_primary", fallbackLookupPattern)
      .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);
    duplicateCandidates = fallback.data;
    dupErr = fallback.error;
  }

  if (dupErr) {
    log("duplicate check failed", dupErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (dedup: ${dupErr.message})` };
  }
  if ((duplicateCandidates ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
    log("duplicate check limit exceeded", { limit: IDENTITY_LOOKUP_MAX_CANDIDATES });
    return { ok: false, code: "db", message: `${SAFE_ERROR} (dedup: too many candidates)` };
  }
  // Escaping is necessary but not sufficient: only exact canonical equality
  // is identity. This re-filter is the final linkage/duplicate decision.
  if ((duplicateCandidates ?? []).some((candidate) => emailsEqual(candidate.email_primary, emailPrimary))) {
    return {
      ok: false,
      code: "duplicate",
      message:
        "Email này đã có đơn đăng ký trong đợt hiện tại. Nếu cần điều chỉnh thông tin, vui lòng liên hệ BTC qua email."
    };
  }

  // Link an already-known canonical identity without creating a person during
  // anonymous intake. Multiple exact canonical matches fail closed if
  // historical corruption has produced more than one person.
  let { data: personCandidates, error: personLookupErr } = await client
    .from("people")
    .select("id,email_primary")
    .ilike("email_primary", exactLookupPattern)
    .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

  if (!personLookupErr && (personCandidates ?? []).length === 0) {
    const fallback = await client
      .from("people")
      .select("id,email_primary")
      .ilike("email_primary", fallbackLookupPattern)
      .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);
    personCandidates = fallback.data;
    personLookupErr = fallback.error;
  }

  if (personLookupErr) {
    log("person identity lookup failed", personLookupErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (identity: ${personLookupErr.message})` };
  }
  if ((personCandidates ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
    log("person identity lookup limit exceeded", { limit: IDENTITY_LOOKUP_MAX_CANDIDATES });
    return { ok: false, code: "db", message: `${SAFE_ERROR} (identity: too many candidates)` };
  }
  const exactPeople = (personCandidates ?? []).filter((person) =>
    emailsEqual(person.email_primary, emailPrimary)
  );
  if (exactPeople.length > 1) {
    log("person identity lookup ambiguous", { canonicalEmail: emailPrimary, matches: exactPeople.length });
    return { ok: false, code: "db", message: `${SAFE_ERROR} (identity: ambiguous)` };
  }
  const existingPerson = exactPeople[0] ?? null;

  // Phone Identity Guard: Prevents submitting a new application with a phone number
  // already used by another email for the same role.
  const { data: phoneApps, error: phoneErr } = await client
    .from("applications")
    .select("id,email_primary")
    .eq("role_applied", input.role)
    .eq("phone_primary", phonePrimary)
    .limit(1);

  if (phoneErr) {
    log("phone identity lookup failed", phoneErr);
    return { ok: false, code: "db", message: SAFE_ERROR };
  }

  if (phoneApps && phoneApps.length > 0) {
    if (!emailsEqual(phoneApps[0].email_primary, emailPrimary)) {
      return {
        ok: false,
        code: "validation",
        message: "Thông tin bạn nhập trùng với một hồ sơ đã có trên hệ thống. Vui lòng liên hệ Core Team UEH Mentoring để được hỗ trợ."
      };
    }
  }

  if (existingPerson) {
    if (input.role === "mentor") {
      // P0 — Returning Mentors must use the controlled S12 renewal flow rather
      // than creating a new public Mentor application.
      const { data: mentorHistory, error: mentorHistoryErr } = await client
        .from("mentor_profiles")
        .select("id")
        .eq("person_id", existingPerson.id)
        .limit(1);

      if (mentorHistoryErr) {
        log("returning mentor lookup failed", mentorHistoryErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      if ((mentorHistory ?? []).length > 0) {
        return {
          ok: false,
          code: "validation",
          reason: "returning_mentor",
          message:
            "Hồ sơ này cần được xử lý qua luồng xác nhận/gia hạn Mentor Season 12. Vui lòng sử dụng đường dẫn do BTC gửi hoặc liên hệ BTC nếu chưa nhận được."
        };
      }
      
      // MENTOR GUARD: Current/Recent Mentee applying as Mentor
      const { data: recentMenteeHistory, error: recentMenteeErr } = await client
        .from("person_season_memberships")
        .select("id")
        .eq("person_id", existingPerson.id)
        .eq("season_id", seasonRow.id)
        .eq("role", "mentee")
        .limit(1);

      if (recentMenteeErr) {
        log("recent mentee lookup failed", recentMenteeErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      if ((recentMenteeHistory ?? []).length > 0) {
        return {
          ok: false,
          code: "validation",
          message: "Hồ sơ của bạn hiện đang là Mentee của đợt này. Để ứng tuyển Mentor, vui lòng liên hệ Core Team UEH Mentoring để được hướng dẫn."
        };
      }

    } else if (input.role === "mentee") {
      // MENTEE INTAKE GUARDS:
      const { data: menteeHistory, error: menteeHistoryErr } = await client
        .from("mentee_profiles")
        .select("id")
        .eq("person_id", existingPerson.id)
        .limit(1);

      if (menteeHistoryErr) {
        log("returning mentee lookup failed", menteeHistoryErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      const { data: anyMenteeMemberships, error: anyMenteeMembershipsErr } = await client
        .from("person_season_memberships")
        .select("role")
        .eq("person_id", existingPerson.id)
        .eq("role", "mentee")
        .limit(1);

      if (anyMenteeMembershipsErr) {
        log("mentee membership lookup failed", anyMenteeMembershipsErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      // - current S12 Mentee -> block
      // - Supporters already transferred/approved into S12 should not submit again
      const { data: s12Memberships, error: s12MembershipsErr } = await client
        .from("person_season_memberships")
        .select("role")
        .eq("person_id", existingPerson.id)
        .eq("season_id", seasonRow.id)
        .in("role", ["mentee", "supporter"])
        .limit(1);

      if (s12MembershipsErr) {
        log("mentee s12 membership lookup failed", s12MembershipsErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      if (
        (menteeHistory ?? []).length > 0 || 
        (anyMenteeMemberships ?? []).length > 0 || 
        (s12Memberships ?? []).length > 0
      ) {
        return {
          ok: false,
          code: "validation",
          message:
            "Hồ sơ của bạn đã có trên hệ thống VAM OS. Vui lòng liên hệ Core Team UEH Mentoring để được hỗ trợ nếu bạn cần cập nhật thông tin hoặc cho rằng đây là nhầm lẫn."
        };
      }
    }
  }

  // Insert
  const insertPayload = {
    person_id: existingPerson?.id ?? null,
    season_id: seasonRow.id,
    intake_batch_id: batchRow.id,
    role_applied: input.role,
    status: "submitted",
    source: "vam_os_form",
    full_name: fullName,
    email_primary: emailPrimary,
    phone_primary: phonePrimary,
    gender,
    consent_data_storage: input.consentDataStorage,
    raw_payload: input.rawPayload,
    submitted_at: new Date().toISOString().slice(0, 10)
  };

  const { data: inserted, error: insertErr } = await client
    .from("applications")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") {
      return {
        ok: false,
        code: "duplicate",
        message: "Email này đã có đơn đăng ký cho Season 12. Nếu cần điều chỉnh thông tin, vui lòng liên hệ BTC."
      };
    }
    log("insert applications failed", insertErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (applications: ${insertErr.message})` };
  }
  if (!inserted) {
    log("insert applications returned no row", { batch: input.intakeBatchCode, role: input.role });
    return { ok: false, code: "db", message: SAFE_ERROR };
  }

  if (input.answers?.length) {
    const answerRows = input.answers.map((answer) => ({
      application_id: inserted.id,
      question_key: answer.questionKey,
      question_label: answer.questionLabel,
      value_text: answer.valueText,
      created_at: answer.acceptedAt ?? new Date().toISOString()
    }));
    const { error: answersErr } = await client.from("application_answers").insert(answerRows);
    if (answersErr) {
      log("insert application_answers failed", answersErr);
      // Keep this enhancement from creating a partially auditable application.
      // The row was created by this request and has not yet been returned as successful.
      const { error: cleanupErr } = await client.from("applications").delete().eq("id", inserted.id);
      if (cleanupErr) {
        const err = cleanupErr as { code?: string; message?: string };
        console.error("[applications-create] cleanup partial application failed", {
          applicationId: inserted.id,
          code: err.code,
          message: err.message
        });
        // A surviving incomplete row may trigger duplicate protection on retry.
        // Ask the applicant not to retry repeatedly; controlled repair uses the logged ID.
        return {
          ok: false,
          code: "incomplete_submission",
          message:
            "Đơn của bạn có thể đã được ghi nhận chưa hoàn tất. Vui lòng không gửi lại nhiều lần và liên hệ Ban Tổ chức để được hỗ trợ."
        };
      }
      return {
        ok: false,
        code: "db",
        message: `${SAFE_ERROR} (application_answers: ${answersErr.message})`
      };
    }
  }

  return { ok: true, applicationId: inserted.id };
}
