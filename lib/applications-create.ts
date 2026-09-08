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

/**
 * The two applicant-facing refusals for an intake the system already knows
 * about. Both are deliberately generic: which of email / phone / student id
 * matched, whose record it matched and which season it came from are all
 * operational detail an anonymous caller has no business probing. That
 * classification goes to the server log instead.
 */
/**
 * Từ vựng định danh hiển thị cho người nộp đơn.
 *
 * Trước 08/09/2026, mọi lần từ chối vì trùng định danh đều dùng một câu chung
 * cố ý KHÔNG nói trùng ở trường nào — để một người ẩn danh không thể dò xem
 * một email/số điện thoại/MSSV bất kỳ đã có trong hệ thống hay chưa.
 *
 * Cái giá của sự mơ hồ đó lớn hơn nhiều so với dự tính. Người nộp đơn hợp lệ
 * không biết phải sửa gì nên đoán: một mentee đổi email nhiều lần trong khi
 * thứ trùng là MSSV; một mentor bỏ cuộc sau bảy lần thử. Ngay cả người vận
 * hành cũng đoán sai trường khi đọc báo cáo sự cố.
 *
 * Chủ chương trình đã cân nhắc và quyết định nêu rõ trường. Đánh đổi được
 * chấp nhận có ý thức: form công khai giờ xác nhận được rằng một định danh cụ
 * thể đã tồn tại. Thông điệp vẫn không tiết lộ gì thêm — không tên, không
 * trạng thái hồ sơ, không cho biết đó là ai.
 */
type IdentityField = "email" | "phone" | "student_id";

const IDENTITY_FIELD_LABEL: Record<IdentityField, string> = {
  email: "Email",
  phone: "Số điện thoại",
  student_id: "Mã số sinh viên (MSSV)"
};

/** Cùng một lời khuyên hành động cho mọi trường hợp, viết một lần. */
const IDENTITY_NEXT_STEP =
  "Nếu bạn nhập nhầm, vui lòng kiểm tra và sửa lại. Nếu đây đúng là thông tin của bạn, vui lòng liên hệ Core Team UEH Mentoring để được hỗ trợ.";

/** Đã có một đơn đăng ký trong chính đợt tuyển sinh này. */
function sameSeasonDuplicateMessage(field: IdentityField) {
  return `${IDENTITY_FIELD_LABEL[field]} bạn nhập đã có một đơn đăng ký trong đợt tuyển sinh hiện tại. ${IDENTITY_NEXT_STEP}`;
}

/** Đã gắn với một hồ sơ / lần tham gia có thật trên hệ thống. */
function existingProfileMessage(field: IdentityField) {
  return `${IDENTITY_FIELD_LABEL[field]} bạn nhập đã gắn với một hồ sơ đã có trên hệ thống VAM OS. ${IDENTITY_NEXT_STEP}`;
}

/** Trùng với một bản ghi cũ, cần Core Team rà soát trước khi nhận đơn mới. */
function identityReviewMessage(field: IdentityField) {
  return `${IDENTITY_FIELD_LABEL[field]} bạn nhập trùng với một hồ sơ đã có trên hệ thống. ${IDENTITY_NEXT_STEP}`;
}

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

/**
 * Canonical student-id comparison. Deliberately narrow: the same whitespace
 * deletion `normalisePhone` already performs, plus case folding for the
 * alphanumeric codes some faculties issue. Nothing else is stripped — a
 * punctuation character inside a student id is data, not noise, and fuzzy
 * matching here would refuse innocent applicants for a digit they share.
 */
function normaliseStudentId(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

function studentIdsEqual(left: unknown, right: unknown) {
  const canonical = normaliseStudentId(left);
  return Boolean(canonical) && canonical === normaliseStudentId(right);
}

/**
 * An ILIKE pattern that is a SAFE SUPERSET of every raw spelling the canonical
 * comparison treats as equal to `canonical`.
 *
 * Both `normalisePhone` and `normaliseStudentId` delete whitespace, so
 * " 0345 466 453 " and "0345466453" are the SAME phone under the contract —
 * but an ILIKE of `%345466453%` never sees the stored row, and the Season 11
 * Mentee who re-applied in Season 12 walked straight through that gap. Placing
 * `%` between each literal character makes the pattern tolerant of any
 * separator the canonical form drops, so the database can only ever NARROW the
 * candidate window. The decision itself is always the canonical re-filter in
 * JS below, never the pattern.
 *
 * Every character is escaped first, so applicant input can never become ILIKE
 * syntax — the same rule the email lookups follow.
 */
function subsequenceIlikePattern(canonical: string) {
  return `%${canonical.split("").map((char) => escapeIlikePattern(char)).join("%")}%`;
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
      message: sameSeasonDuplicateMessage("email")
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
  const PHONE_IDENTITY_MAX_CANDIDATES = 10;
  const phoneSuffix = phonePrimary.length > 9 ? phonePrimary.slice(-9) : phonePrimary;
  // The subscriber suffix is what survives every prefix form `normalisePhone`
  // accepts (0…, +84…, 84…), and the subsequence pattern additionally survives
  // the whitespace it deletes. A `%<suffix>%` pattern did not, and silently hid
  // stored rows such as " 0345 466 453 " from this guard.
  const phoneCandidatePattern = subsequenceIlikePattern(phoneSuffix);
  const { data: phoneApps, error: phoneErr } = await client
    .from("applications")
    .select("id,email_primary,phone_primary")
    .eq("role_applied", input.role)
    .ilike("phone_primary", phoneCandidatePattern)
    .order("id")
    .limit(PHONE_IDENTITY_MAX_CANDIDATES + 1);

  if (phoneErr) {
    log("phone identity lookup failed", phoneErr);
    return { ok: false, code: "db", message: SAFE_ERROR };
  }

  if (phoneApps && phoneApps.length > PHONE_IDENTITY_MAX_CANDIDATES) {
    log("phone identity lookup exceeded window", { phonePrimary });
    return { ok: false, code: "db", message: SAFE_ERROR };
  }

  if (phoneApps && phoneApps.length > 0) {
    const hasSameRolePhoneMatch = phoneApps.some(app =>
      normalisePhone(app.phone_primary ?? "") === phonePrimary &&
      !emailsEqual(app.email_primary, emailPrimary)
    );

    if (hasSameRolePhoneMatch) {
      return {
        ok: false,
        code: "validation",
        message: identityReviewMessage("phone")
      };
    }
  }

  if (existingPerson) {
    if (input.role === "mentor") {
      // P0 — Returning Mentors must use the controlled S12 renewal flow rather
      // than creating a new public Mentor application.
      const [
        { data: mentorProfiles, error: profileErr },
        { data: mentorMemberships, error: membershipErr }
      ] = await Promise.all([
        client.from("mentor_profiles").select("id").eq("person_id", existingPerson.id).limit(1),
        client.from("person_season_memberships").select("id").eq("person_id", existingPerson.id).eq("role", "mentor").limit(1)
      ]);

      if (profileErr || membershipErr) {
        log("returning mentor lookup failed", profileErr || membershipErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      if ((mentorProfiles ?? []).length > 0 || (mentorMemberships ?? []).length > 0) {
        return {
          ok: false,
          code: "validation",
          reason: "returning_mentor",
          message:
            "Hồ sơ này cần được xử lý qua luồng xác nhận/gia hạn Mentor Season 12. Vui lòng sử dụng đường dẫn do BTC gửi hoặc liên hệ BTC nếu chưa nhận được."
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
        .select("id,status")
        .eq("person_id", existingPerson.id)
        .eq("role", "mentee");

      if (anyMenteeMembershipsErr) {
        log("mentee membership lookup failed", anyMenteeMembershipsErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      const activeAnyMenteeMemberships = (anyMenteeMemberships ?? []).filter(m =>
        ["active", "completed", "graduated"].includes(m.status)
      );

      const { data: anyMatches, error: anyMatchesErr } = await client
        .from("matches")
        .select("id")
        .eq("mentee_person_id", existingPerson.id)
        .limit(1);

      if (anyMatchesErr) {
        log("mentee match lookup failed", anyMatchesErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      const { data: anyApproved, error: anyApprovedErr } = await client
        .from("applications")
        .select("id,season_id")
        .eq("person_id", existingPerson.id)
        .eq("role_applied", "mentee")
        .eq("status", "approved_as_mentee");

      if (anyApprovedErr) {
        log("mentee approved applications lookup failed", anyApprovedErr);
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

      const hasHardParticipation =
        (menteeHistory ?? []).length > 0 ||
        activeAnyMenteeMemberships.length > 0 ||
        (anyMatches ?? []).length > 0 ||
        (s12Memberships ?? []).length > 0;

      const s12ApprovedApp = (anyApproved ?? []).some(a => a.season_id === seasonRow.id);

      if (hasHardParticipation || s12ApprovedApp) {
        return {
          ok: false,
          code: "validation",
          message: existingProfileMessage("email")
        };
      }

      if ((anyApproved ?? []).length > 0) {
        // Prior-season approved application ONLY -> identity_review
        return {
          ok: false,
          code: "validation",
          message: identityReviewMessage("email")
        };
      }
    }
  }

  // ── P1-A — MENTEE 1-OF-3 ELIGIBILITY GUARD ───────────────────────────────
  //
  // Owner policy, locked after the Season 12 incident: for PUBLIC Mentee
  // intake, ANY ONE of EMAIL or PHONE or MSSV that proves the applicant is an
  // existing or prior Mentee refuses the application. One of three suffices —
  // the signals do NOT have to converge on a single person first.
  //
  // EMAIL is already handled above, by the canonical `people` lookup and the
  // same-season duplicate check. What follows adds the other two keys, because
  // the incident showed both were reachable around the email path: a Season 11
  // Mentee re-applied for Season 12 with a NEW email, and her canonical
  // identity is backfilled `people` -> `mentee_profiles` ->
  // `person_season_memberships` data with NO historical application row behind
  // it. The email lookup found nobody, the applications phone lookup had
  // nothing to bridge to her person, every participation guard above sits
  // inside `if (existingPerson)` and was skipped, and the row was inserted with
  // `person_id = NULL`.
  //
  // This is an ELIGIBILITY gate and nothing more. It reads; it never links,
  // merges, repairs or writes identity. Where the evidence is ambiguous it
  // refuses rather than guessing — a controlled false refusal Core Team can
  // resolve by hand is the cheaper error here, and a false negative is what put
  // an ineligible application into Production.
  //
  // Mentee-scoped on purpose. Existing Mentor policy is unchanged: a former
  // Mentee may still apply as a Mentor, and a returning Mentor still routes to
  // renewal through the guard above.
  if (input.role === "mentee") {
    const submittedStudentId = normaliseStudentId(input.rawPayload?.mssv);

    // ── KEY 3 — MSSV ───────────────────────────────────────────────────────
    // A canonical `mentee_profiles` row IS proof that this student id belongs
    // to a known Mentee, so it blocks on its own. There is no need to resolve
    // `people` first, and deliberately no attempt to: the profile is the
    // evidence.
    if (submittedStudentId) {
      const studentIdPattern = subsequenceIlikePattern(submittedStudentId);

      // `mssv` is canonical everywhere. `mssv_raw` carries the pre-backfill
      // spelling and exists ONLY in Production — elsewhere PostgREST answers
      // 42703 (undefined column). That one schema condition degrades to "no
      // historical raw value in this environment"; every other failure still
      // fails closed, because a lookup that could not run has cleared nobody.
      for (const column of ["mssv", "mssv_raw"] as const) {
        const { data: profileRows, error: profileErr } = await client
          .from("mentee_profiles")
          .select(`id,${column}`)
          .ilike(column, studentIdPattern)
          .order("id")
          .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

        if (profileErr) {
          if (column === "mssv_raw" && (profileErr as { code?: string }).code === "42703") continue;
          log("mentee student id lookup failed", profileErr);
          return { ok: false, code: "db", message: SAFE_ERROR };
        }
        if ((profileRows ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
          log("mentee student id lookup limit exceeded", { column, limit: IDENTITY_LOOKUP_MAX_CANDIDATES });
          return { ok: false, code: "db", message: SAFE_ERROR };
        }
        // The pattern only narrowed the window; canonical equality decides.
        if (
          (profileRows ?? []).some((row) =>
            studentIdsEqual((row as Record<string, unknown> | null)?.[column], submittedStudentId)
          )
        ) {
          log("mentee intake refused on canonical student id", { column });
          return { ok: false, code: "validation", message: existingProfileMessage("student_id") };
        }
      }

      // Same-season duplicate on MSSV. Without this, changing only the email
      // while keeping the student id walks past same-season protection.
      const { data: studentIdDupRows, error: studentIdDupErr } = await client
        .from("applications")
        .select("id,raw_payload")
        .eq("season_id", seasonRow.id)
        .eq("role_applied", "mentee")
        .ilike("raw_payload->>mssv", studentIdPattern)
        .order("id")
        .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

      if (studentIdDupErr) {
        log("mentee student id duplicate check failed", studentIdDupErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }
      if ((studentIdDupRows ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
        log("mentee student id duplicate check limit exceeded", { limit: IDENTITY_LOOKUP_MAX_CANDIDATES });
        return { ok: false, code: "db", message: SAFE_ERROR };
      }
      if ((studentIdDupRows ?? []).some((row) => studentIdsEqual(row?.raw_payload?.mssv, submittedStudentId))) {
        // Duplicate semantics, generic wording: the applicant is not told which
        // of their identifiers collided.
        return { ok: false, code: "duplicate", message: sameSeasonDuplicateMessage("student_id") };
      }
    }

    // ── KEY 2 — PHONE ──────────────────────────────────────────────────────
    // `people` is the canonical identity table and it carries the phone, so it
    // is asked directly rather than through whatever applications happen to
    // exist. `phone_raw` is Production-only and deliberately not projected.
    const { data: phonePeopleRows, error: phonePeopleErr } = await client
      .from("people")
      .select("id,phone_primary")
      .ilike("phone_primary", phoneCandidatePattern)
      .order("id")
      .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

    if (phonePeopleErr) {
      log("canonical phone candidate lookup failed", phonePeopleErr);
      return { ok: false, code: "db", message: SAFE_ERROR };
    }
    if ((phonePeopleRows ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
      // Never silently truncate a safety window: the row that proves prior
      // participation could be the one past the cut.
      log("canonical phone candidate lookup limit exceeded", { limit: IDENTITY_LOOKUP_MAX_CANDIDATES });
      return { ok: false, code: "db", message: SAFE_ERROR };
    }

    const phonePersonIds = Array.from(
      new Set(
        (phonePeopleRows ?? [])
          .filter((person) => normalisePhone(String(person?.phone_primary ?? "")) === phonePrimary)
          .map((person) => person.id as string)
      )
    );

    // Several canonical people on one handset is not a reason to let the
    // submission through: every one of them is checked for Mentee history, and
    // none of them is written onto the application.
    if (phonePersonIds.length > 0) {
      const [menteeProfiles, menteeMemberships, seasonMemberships, menteeMatches, approvedMenteeApps] =
        await Promise.all([
          client.from("mentee_profiles").select("id").in("person_id", phonePersonIds).limit(1),
          client
            .from("person_season_memberships")
            .select("id,status")
            .in("person_id", phonePersonIds)
            .eq("role", "mentee"),
          client
            .from("person_season_memberships")
            .select("role")
            .in("person_id", phonePersonIds)
            .eq("season_id", seasonRow.id)
            .in("role", ["mentee", "supporter"])
            .limit(1),
          client.from("matches").select("id").in("mentee_person_id", phonePersonIds).limit(1),
          client
            .from("applications")
            .select("id,season_id")
            .in("person_id", phonePersonIds)
            .eq("role_applied", "mentee")
            .eq("status", "approved_as_mentee")
        ]);

      const evidenceErr =
        menteeProfiles.error ||
        menteeMemberships.error ||
        seasonMemberships.error ||
        menteeMatches.error ||
        approvedMenteeApps.error;
      if (evidenceErr) {
        log("phone-resolved mentee evidence lookup failed", evidenceErr);
        return { ok: false, code: "db", message: SAFE_ERROR };
      }

      // The same proof paths the email branch above already accepts, so the
      // phone key is exactly as strong as the email key and no stronger.
      const hasHardParticipation =
        (menteeProfiles.data ?? []).length > 0 ||
        (menteeMemberships.data ?? []).some((membership: { status: string }) =>
          ["active", "completed", "graduated"].includes(membership.status)
        ) ||
        (seasonMemberships.data ?? []).length > 0 ||
        (menteeMatches.data ?? []).length > 0 ||
        (approvedMenteeApps.data ?? []).some(
          (application: { season_id: string }) => application.season_id === seasonRow.id
        );

      if (hasHardParticipation) {
        log("mentee intake refused on canonical phone", { candidates: phonePersonIds.length });
        return { ok: false, code: "validation", message: existingProfileMessage("phone") };
      }

      if ((approvedMenteeApps.data ?? []).length > 0) {
        // Prior-season approved application ONLY -> identity_review
        return { ok: false, code: "validation", message: identityReviewMessage("phone") };
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
