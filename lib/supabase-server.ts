import "server-only";

import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { AUTH_ACCESS_COOKIE } from "@/lib/auth-constants";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

const SERVICE_ROLE_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

function supabaseServiceRoleKey() {
  return process.env[SERVICE_ROLE_ENV_NAME]?.trim();
}

export function getSupabaseServerClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  let accessToken: string | undefined;
  try {
    accessToken = (cookies() as unknown as UnsafeUnwrappedCookies).get(AUTH_ACCESS_COOKIE)?.value;
  } catch {
    accessToken = undefined;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}

export function getSupabaseServiceRoleClient() {
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}

export function getSupabaseServiceRoleEnvStatus() {
  const serviceRoleKey = supabaseServiceRoleKey();
  return {
    envName: SERVICE_ROLE_ENV_NAME,
    loaded: Boolean(serviceRoleKey),
    usesPublicPrefix: SERVICE_ROLE_ENV_NAME.startsWith("NEXT_PUBLIC_"),
    sameAsAnonKey: Boolean(serviceRoleKey && supabaseAnonKey && serviceRoleKey === supabaseAnonKey)
  };
}
