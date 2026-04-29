import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { AUTH_ACCESS_COOKIE } from "@/lib/auth-constants";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getSupabaseServerClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  let accessToken: string | undefined;
  try {
    accessToken = cookies().get(AUTH_ACCESS_COOKIE)?.value;
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
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}
