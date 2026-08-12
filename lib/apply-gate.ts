import "server-only";

import { timingSafeEqual } from "node:crypto";
import {
  readApplicationFormState,
  type ApplicantRole,
  type ApplicationFormState
} from "@/lib/application-form-controls";

export type ApplyGateRole = ApplicantRole;

export type ApplyGateDecision =
  | { status: "open"; state: ApplicationFormState }
  | { status: "closed"; state: ApplicationFormState; reason: string; code: ApplyGateDenyCode };

export type ApplyGateDenyCode =
  | "state_closed"
  | "token_required"
  | "token_invalid"
  | "token_not_configured"
  | "lookup_failed"
  | "bad_role";

const CLOSED_MESSAGE =
  "Đơn đăng ký chưa được mở. Vui lòng chờ thông báo chính thức từ Ban Tổ chức.";

const PILOT_MESSAGE =
  "Đường link đăng ký đang ở chế độ pilot và chỉ mở cho danh sách được BTC mời.";

const UNAVAILABLE_MESSAGE =
  "Không xác minh được trạng thái form đăng ký. Đây là lỗi hệ thống — form được giữ đóng để an toàn.";

/**
 * The configured pilot token, server-side only.
 *
 * `VAM_OS_APPLY_TOKEN` is the current name; `VAM_OS_APPLICATION_PILOT_TOKEN`
 * is the original one and is still honoured as a fallback so an existing
 * deployment does not silently lose its pilot link. Neither is ever returned
 * to a caller, logged, or persisted.
 */
function configuredToken(): string | null {
  const value =
    process.env.VAM_OS_APPLY_TOKEN?.trim() ||
    process.env.VAM_OS_APPLICATION_PILOT_TOKEN?.trim();
  return value || null;
}

/**
 * Constant-time comparison. A plain `===` on a secret leaks its prefix length
 * through timing; the forms are public and unauthenticated, so the comparison
 * is reachable by anyone.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * THE canonical gate. The page render path and the submission Server Action
 * both resolve this exact function with the same inputs, so there is no way
 * for the two to disagree — that split was the known token finding this
 * replaces.
 *
 * Decision table:
 *
 *   DB state   token provided   result
 *   --------   --------------   ------------------------------------------
 *   closed     (any)            CLOSED  — token can never bypass closed
 *   pilot      correct          OPEN
 *   pilot      wrong / missing  CLOSED
 *   pilot      env unset        CLOSED  — fail closed, in every environment
 *   open       (ignored)        OPEN
 *   unreadable (any)            CLOSED
 *
 * Note the second row of `closed`: there is deliberately no token escape
 * hatch out of CLOSED. Pilot access is a distinct state the owner selects,
 * not a side effect of holding a token.
 */
export async function evaluateApplyGate(
  providedToken: string | undefined | null,
  role: ApplyGateRole
): Promise<ApplyGateDecision> {
  if (role !== "mentor" && role !== "mentee") {
    return { status: "closed", state: "closed", reason: CLOSED_MESSAGE, code: "bad_role" };
  }

  const { state, reason } = await readApplicationFormState(role);

  if (reason) {
    return { status: "closed", state: "closed", reason: UNAVAILABLE_MESSAGE, code: "lookup_failed" };
  }

  if (state === "closed") {
    return { status: "closed", state, reason: CLOSED_MESSAGE, code: "state_closed" };
  }

  if (state === "open") {
    return { status: "open", state };
  }

  // state === "pilot" — the token contract applies, identically on both paths.
  const expected = configuredToken();
  if (!expected) {
    // Deliberately NOT a dev bypass. The previous implementation opened the
    // form in development when the token env var was unset; that made the
    // dev and production decision tables differ, which is exactly how a gate
    // gets shipped believing it was tested.
    return {
      status: "closed",
      state,
      reason: UNAVAILABLE_MESSAGE,
      code: "token_not_configured"
    };
  }

  const provided = String(providedToken ?? "").trim();
  if (!provided) {
    return { status: "closed", state, reason: PILOT_MESSAGE, code: "token_required" };
  }
  if (!tokenMatches(provided, expected)) {
    return { status: "closed", state, reason: PILOT_MESSAGE, code: "token_invalid" };
  }

  return { status: "open", state };
}
