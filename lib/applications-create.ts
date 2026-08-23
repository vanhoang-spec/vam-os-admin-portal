import "server-only";

import { evaluateApplyGate } from "@/lib/apply-gate";
import { S12_BINDING } from "@/lib/application-form-controls";
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

export type ApplicationSubmissionResult =
  | { ok: true; applicationId: string }
  | { ok: false; code: "config" | "duplicate" | "season_missing" | "batch_missing" | "validation" | "db" | "incomplete_submission"; message: string };

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

function normaliseEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalisePhone(value: string) {
  return value.replace(/\s+/g, "").trim();
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
 *   - Blocks duplicates: same intake_batch + same role_applied + same
 *     normalised email returns code='duplicate'.
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

  const { client, error: clientError } = clientResult();
  if (!client) {
    return { ok: false, code: "config", message: clientError ?? SAFE_ERROR };
  }

  const fullName = safeText(input.fullName);
  const emailPrimary = normaliseEmail(input.emailPrimary);
  const phonePrimary = normalisePhone(input.phonePrimary);
  const gender = safeText(input.gender);

  if (!fullName) {
    return { ok: false, code: "validation", message: "Họ tên không được để trống." };
  }
  if (!emailPrimary || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPrimary)) {
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

  const DUPLICATE_APPLICATION_MESSAGE =
    "Email hoặc MSSV này đã có đơn đăng ký trong đợt hiện tại. Nếu cần điều chỉnh thông tin, vui lòng liên hệ BTC.";

  if (input.role === "mentor") {
    const { data: existing, error: existErr } = await client
      .from("applications")
      .select("id")
      .eq("intake_batch_id", batchRow.id)
      .eq("role_applied", "mentor")
      .eq("email_primary", emailPrimary)
      .maybeSingle();

    if (existErr) {
      log("duplicate check failed", existErr);
      return { ok: false, code: "db", message: SAFE_ERROR };
    }
    if (existing) {
      return { ok: false, code: "duplicate", message: DUPLICATE_APPLICATION_MESSAGE };
    }
  }

  // Token hygiene: strictly strip application tokens before insertion
  const sanitizedPayload = { ...input.rawPayload };
  delete sanitizedPayload["__apply_token"];
  delete sanitizedPayload["token"];

  // Insert application and answers via atomic RPC
  const { data: rpcResult, error: rpcErr } = await client.rpc("vam_submit_intake_application_atomic", {
    p_season_id: seasonRow.id,
    p_intake_batch_id: batchRow.id,
    p_role_applied: input.role,
    p_source: "vam_os_form",
    p_full_name: fullName,
    p_email_primary: emailPrimary,
    p_phone_primary: phonePrimary,
    p_gender: gender,
    p_consent_data_storage: input.consentDataStorage,
    p_raw_payload: sanitizedPayload,
    p_answers: input.answers ?? null
  });

  if (rpcErr) {
    log("insert application atomic failed", rpcErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (applications: ${rpcErr.message})` };
  }

  if (!rpcResult || !rpcResult.ok) {
    if (rpcResult?.code === 'duplicate') {
      return {
        ok: false,
        code: "duplicate",
        message: DUPLICATE_APPLICATION_MESSAGE
      };
    }
    return { ok: false, code: "db", message: SAFE_ERROR };
  }

  return { ok: true, applicationId: rpcResult.applicationId };
}
