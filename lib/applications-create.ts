import "server-only";

import { getSupabaseServiceRoleClient, getSupabaseServiceRoleEnvStatus } from "@/lib/supabase-server";
import type { JsonRecord } from "@/lib/types";

export type ApplicationRole = "mentor" | "mentee";

export type ApplicationSubmissionInput = {
  role: ApplicationRole;
  seasonCode: string; // e.g. "UEHM-S12"
  intakeBatchCode: string; // e.g. "UEHM-S12-B1"
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

  // Duplicate check: same batch + same role + same normalised email
  const { data: dupRow, error: dupErr } = await client
    .from("applications")
    .select("id")
    .eq("intake_batch_id", batchRow.id)
    .eq("role_applied", input.role)
    .ilike("email_primary", emailPrimary)
    .limit(1)
    .maybeSingle();
  if (dupErr) {
    log("duplicate check failed", dupErr);
    return { ok: false, code: "db", message: `${SAFE_ERROR} (dedup: ${dupErr.message})` };
  }
  if (dupRow) {
    return {
      ok: false,
      code: "duplicate",
      message:
        "Email này đã có đơn đăng ký trong đợt hiện tại. Nếu cần điều chỉnh thông tin, vui lòng liên hệ BTC qua email."
    };
  }

  // Insert
  const insertPayload = {
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
