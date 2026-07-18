import "server-only";

import { SEASON_CONFIG } from "@/lib/season-config";

export type ApplyGateRole = "mentor" | "mentee";

export type ApplyGateResult =
  | { status: "open" }
  | { status: "dev_warning"; reason: string }
  | { status: "closed"; reason: string };

/**
 * Decide whether to show the public application form on /apply/*.
 *
 * Gate model — BOTH conditions must pass:
 *   1. Explicit enable flag: VAM_OS_ENABLE_MENTOR_APPLICATION=true or
 *      VAM_OS_ENABLE_MENTEE_APPLICATION=true (per role). Default is false (closed).
 *   2. Token: env VAM_OS_APPLY_TOKEN (or VAM_OS_APPLICATION_PILOT_TOKEN fallback)
 *      must be set AND match the `?token=...` query param.
 *
 * If the enable flag is false, the form is closed immediately — token is irrelevant.
 * In production, if the token env var is unset, the form is also closed.
 * In development, if the token env var is unset, a dev_warning is shown instead of
 * closed — but only if the enable flag is also true.
 */
export function evaluateApplyGate(
  providedToken: string | undefined | null,
  role: ApplyGateRole
): ApplyGateResult {
  // Step 1: check explicit enable flag — this is the primary safety gate.
  const isEnabled =
    role === "mentor"
      ? SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION
      : SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION;

  if (!isEnabled) {
    return {
      status: "closed",
      reason: `Đơn đăng ký ${role === "mentor" ? "mentor" : "mentee"} chưa được mở. Vui lòng chờ thông báo chính thức.`
    };
  }

  // Step 2: check token.
  const expected =
    process.env.VAM_OS_APPLY_TOKEN?.trim() ||
    process.env.VAM_OS_APPLICATION_PILOT_TOKEN?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  const provided = String(providedToken ?? "").trim();

  if (!expected) {
    if (isProduction) {
      return {
        status: "closed",
        reason: "VAM_OS_APPLY_TOKEN chưa được cấu hình trên server."
      };
    }
    return {
      status: "dev_warning",
      reason: "VAM_OS_APPLY_TOKEN chưa được set — form đang mở vì đang ở môi trường dev."
    };
  }

  if (!provided || provided !== expected) {
    return { status: "closed", reason: "Token không hợp lệ hoặc chưa cung cấp." };
  }

  return { status: "open" };
}
