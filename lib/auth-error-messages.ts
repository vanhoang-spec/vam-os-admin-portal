/**
 * lib/auth-error-messages.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Safe authentication error taxonomy.
 * Maps raw backend errors into user-facing Vietnamese strings without leaking
 * technical metadata, stack traces, or environment configuration.
 */

export function mapAuthError(errorType: "invalid_credentials" | "unauthorized_admin" | "network_unavailable" | "unknown"): string {
  switch (errorType) {
    case "invalid_credentials":
      return "Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra và thử lại.";
    case "unauthorized_admin":
      return "Tài khoản này chưa được cấp quyền truy cập VAM OS. Vui lòng liên hệ người phụ trách.";
    case "network_unavailable":
      return "VAM OS đang tạm thời không thể kết nối. Vui lòng thử lại sau.";
    case "unknown":
    default:
      return "Đăng nhập không thành công. Vui lòng thử lại.";
  }
}

/**
 * Derives the safe error type from an arbitrary Supabase or network error object.
 */
export function getSafeAuthErrorType(error: any): "invalid_credentials" | "network_unavailable" | "unknown" {
  if (!error) return "unknown";

  const message = (error?.message || error?.error_description || "").toLowerCase();
  const name = (error?.name || "").toLowerCase();
  const status = error?.status;

  // Supabase Auth invalid credentials usually return status 400 with message "Invalid login credentials"
  if (status === 400 && (message.includes("invalid login credentials") || message.includes("invalid credentials"))) {
    return "invalid_credentials";
  }

  // Network or fetch failures
  if (name === "authretryablefetcherror" || name === "typeerror" || message.includes("fetch failed") || message.includes("network error")) {
    return "network_unavailable";
  }

  return "unknown";
}

export function safeNext(value: any): string {
  const next = Array.isArray(value) ? value[0] : value;
  const normalized = String(next ?? "/operations");
  // Must start with exactly one slash — blocks empty string, external URLs, protocol-relative //
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return "/operations";
  // Block backslash immediately after leading slash (disguised protocol-relative on some parsers)
  if (normalized.startsWith("/\\")) return "/operations";
  // Block control characters: CR, LF, null, or any ASCII control (CRLF header injection)
  if (/[\x00-\x1f\x7f]/.test(normalized)) return "/operations";
  // Block auth loop routes using segment-aware matching: matches /login, /login?…, /login/…
  // but intentionally does NOT block unrelated paths like /login-report
  if (/^\/login([/?#]|$)/.test(normalized)) return "/operations";
  if (/^\/unlock([/?#]|$)/.test(normalized)) return "/operations";
  return normalized;
}
