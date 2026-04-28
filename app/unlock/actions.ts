"use server";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_SALT } from "@/lib/password-gate";

function unlockToken(password: string) {
  return createHash("sha256").update(`${ADMIN_UNLOCK_SALT}:${password}`).digest("hex");
}

function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "/");
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/unlock")) return "/";
  return next;
}

export async function unlockAdminPortal(formData: FormData) {
  const configuredPassword = process.env.VAM_OS_ADMIN_PASSWORD;
  const submittedPassword = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!configuredPassword || submittedPassword !== configuredPassword) {
    redirect(`/unlock?error=1&next=${encodeURIComponent(next)}`);
  }

  cookies().set(ADMIN_UNLOCK_COOKIE, unlockToken(configuredPassword), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });

  redirect(next);
}

