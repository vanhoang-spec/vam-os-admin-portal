"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  resolveSeasonContext,
  SEASON_COOKIE_NAME,
  type ResolvedSeasonContext
} from "@/lib/season-context";
import { seasonLabel } from "@/lib/season-labels";

export type SeasonSelectorState = {
  ok: boolean;
  selectedSeasonCode: string | null;
  seasons: Array<{ id: string; code: string; label: string }>;
};

function selectorState(context: ResolvedSeasonContext): SeasonSelectorState {
  return {
    ok: true,
    selectedSeasonCode: context.selectedSeasonCode,
    seasons: context.availableSeasons.map((season) => ({
      id: season.id,
      code: season.code,
      label: seasonLabel(season.code, season.name)
    }))
  };
}

function safeReturnTo(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const url = new URL(raw, "https://vam.invalid");
    const supported = new Set(["/", "/mentors", "/mentees", "/matches", "/operations", "/operations/tasks"]);
    if (url.origin !== "https://vam.invalid" || !supported.has(url.pathname)) return "/";
    url.searchParams.delete("season");
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

export async function getSeasonSelectorState(
  explicitSeason?: string | string[] | null
): Promise<SeasonSelectorState> {
  try {
    return selectorState(await resolveSeasonContext(explicitSeason));
  } catch {
    return { ok: false, selectedSeasonCode: null, seasons: [] };
  }
}

export async function setSeasonContextAction(formData: FormData) {
  const requestedSeason = String(formData.get("season") ?? "").trim();
  const context = await resolveSeasonContext(requestedSeason);
  const cookieStore = await cookies();
  cookieStore.set(SEASON_COOKIE_NAME, context.selectedSeasonCode, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  redirect(safeReturnTo(formData.get("returnTo")));
}

