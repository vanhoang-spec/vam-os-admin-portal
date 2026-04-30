import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
export const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export function getSupabasePublicEnvDiagnostics() {
  let host = "missing";
  let projectRef = "missing";
  if (supabaseUrl) {
    try {
      host = new URL(supabaseUrl).host;
      projectRef = host.split(".")[0] || "unknown";
    } catch {
      host = "invalid_url";
      projectRef = "invalid_url";
    }
  }

  const keyType = !supabaseAnonKey
    ? "missing"
    : supabaseAnonKey.startsWith("sb_publishable_")
      ? "starts_with_sb_publishable"
      : supabaseAnonKey.startsWith("eyJ")
        ? "starts_with_eyJ"
        : "other";

  return {
    host,
    projectRef,
    keyType,
    expectedStagingRef: "ljfneyuvpxrmejpxsmpz",
    isExpectedStagingRef: projectRef === "ljfneyuvpxrmejpxsmpz",
    isKnownProductionRef: projectRef === "qkkroesfiazsejkzflcd"
  };
}

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
      }
    })
  : null;
