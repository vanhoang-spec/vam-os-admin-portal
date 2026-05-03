import "server-only";

export type ApplyGateResult =
  | { status: "open" }
  | { status: "dev_warning"; reason: string }
  | { status: "closed"; reason: string };

/**
 * Decide whether to show the public pilot form on /apply/*.
 *
 * Token model:
 *   - Production: env VAM_OS_APPLICATION_PILOT_TOKEN must be set AND
 *     match the `?token=...` query param. Mismatch / missing returns
 *     "closed" so the visitor sees "Form chưa được mở công khai."
 *   - Development: if the env is unset, the form is allowed through
 *     with a "dev_warning" so the dev knows the gate is bypassed.
 *     If the env IS set in dev, the same rules as production apply.
 */
export function evaluateApplyGate(providedToken: string | undefined | null): ApplyGateResult {
  const expected = process.env.VAM_OS_APPLICATION_PILOT_TOKEN?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  const provided = String(providedToken ?? "").trim();

  if (!expected) {
    if (isProduction) {
      return {
        status: "closed",
        reason: "VAM_OS_APPLICATION_PILOT_TOKEN chưa được cấu hình trên server."
      };
    }
    return {
      status: "dev_warning",
      reason: "VAM_OS_APPLICATION_PILOT_TOKEN chưa được set — form đang mở vì đang ở môi trường dev."
    };
  }

  if (!provided || provided !== expected) {
    return { status: "closed", reason: "Token không hợp lệ hoặc chưa cung cấp." };
  }

  return { status: "open" };
}
