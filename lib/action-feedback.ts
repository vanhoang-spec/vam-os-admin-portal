const DEFAULT_ACTION_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại.";

const SENSITIVE_PATTERNS = [
  /service[_-]?role/i,
  /password/i,
  /token/i,
  /secret/i,
  /database_url/i,
  /supabase/i,
  /jwt/i,
  /postgres/i,
  /sql/i,
  /constraint/i,
  /duplicate key/i,
  /violates/i,
  /stack/i
];

export function normalizeActionError(error: unknown, fallback = DEFAULT_ACTION_ERROR) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) return fallback;
  if (trimmed.length > 220) return fallback;
  return trimmed;
}

export function logActionTiming(
  actionName: string,
  data: {
    durationMs: number;
    ok?: boolean;
    resultCount?: number;
    stage?: string;
  }
) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[action-timing]", {
    action: actionName,
    durationMs: data.durationMs,
    ok: data.ok,
    resultCount: data.resultCount,
    stage: data.stage
  });
}
