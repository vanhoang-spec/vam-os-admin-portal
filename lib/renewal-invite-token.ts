import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// M070 — Renewal invite token security contract.
//
// This module is the ENTIRE trust boundary for /renew/[token]. It contains no
// UI, no database client and no route wiring on purpose: the gate is a pure
// function over an injected loader, so the page render path and the submit
// Server Action resolve the identical decision from the identical inputs.
// That is the same arrangement `lib/apply-gate.ts` uses, and for the same
// reason — the defect it exists to prevent is a page and an action that each
// carry their own copy of the rules and drift apart.
//
// TOKEN MODEL
//   mint      randomBytes(32).toString("base64url")  → exactly 43 characters
//   transmit  once, inside the /renew/<token> URL, to one person
//   persist   sha256(token) as 64 lowercase hex characters, and NOTHING else
//   look up   equality on the unique person_season_invites.token_hash index
//
// The raw token is never written to the database, never logged, never put in a
// response body, and never round-tripped through a form field. 32 bytes is 256
// bits of entropy, so the hash is not enumerable and no rate limit is load
// bearing for guessing; the reason a rate limit still belongs in front of the
// route is denial of service, not brute force.
//
// WHY THE HASH, GIVEN THE TOKEN IS ALREADY UNGUESSABLE
// Read access to person_season_invites — a database export, a support dump, a
// future reporting view — must not hand anyone a working renewal link for
// every returning mentor. Storing only the digest makes the table useless as a
// credential store even to someone who can read all of it.
// ---------------------------------------------------------------------------

/** 32 random bytes rendered base64url is always exactly 43 characters. */
export const RENEWAL_TOKEN_BYTES = 32;
export const RENEWAL_TOKEN_LENGTH = 43;

/** Exactly the base64url alphabet, exactly 43 characters, anchored. */
const RENEWAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Lowercase hex sha256. Mirrors person_season_invites_token_hash_format_check. */
const RENEWAL_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The ONE public failure message. Expired, revoked, not found, malformed,
 * already used on a write, or a database error the server could not resolve —
 * every one of them renders exactly this, with no detail that distinguishes
 * them. A holder of a wrong token learns only that it does not work; a holder
 * of a revoked one learns nothing about why it was revoked, and an attacker
 * probing the route cannot use the response to tell a real-but-expired invite
 * apart from a value they invented.
 */
export const RENEWAL_GATE_FAILURE_MESSAGE =
  "Đường dẫn gia hạn không hợp lệ hoặc đã hết hiệu lực. Vui lòng liên hệ Ban Tổ chức để được cấp lại.";

/**
 * Response headers the /renew route MUST send, exported as data so the route
 * cannot quietly omit one and so a test can assert them without rendering
 * anything.
 *
 *   Referrer-Policy: no-referrer   the token is IN THE URL. Without this, the
 *                                  full path leaks to every third-party origin
 *                                  the page ever links to or loads from, and
 *                                  into their logs.
 *   Cache-Control / Pragma         a shared cache — a CDN, a corporate proxy,
 *                                  a browser back/forward store — must never
 *                                  retain a page rendered for one person's
 *                                  bearer token.
 */
export const RENEWAL_ROUTE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache"
});

/**
 * The Next.js route segment config the /renew route MUST declare. `force-dynamic`
 * plus `revalidate = 0` keeps the page out of the full-route cache; without
 * them a statically-optimised render could serve one mentor's renewal state to
 * the next visitor holding a different token.
 */
export const RENEWAL_ROUTE_SEGMENT_CONFIG = Object.freeze({
  dynamic: "force-dynamic" as const,
  revalidate: 0 as const,
  fetchCache: "force-no-store" as const
});

// ---------------------------------------------------------------------------
// Minting and hashing
// ---------------------------------------------------------------------------

export type MintedRenewalToken = {
  /** Show once, in the URL handed to exactly one person. Never persist. */
  token: string;
  /** The only half that is ever written to the database. */
  tokenHash: string;
};

/**
 * Mint a token and its hash. The caller persists `tokenHash` and is
 * responsible for making sure `token` reaches exactly one inbox and no log.
 */
export function mintRenewalInviteToken(): MintedRenewalToken {
  const token = randomBytes(RENEWAL_TOKEN_BYTES).toString("base64url");
  // Defensive, not decorative: if a future Node changed base64url padding
  // behaviour this would be the first place it showed, and minting a token the
  // gate will later reject as malformed is worse than failing here.
  if (!RENEWAL_TOKEN_PATTERN.test(token)) {
    throw new Error("renewal token mint produced a non-canonical token");
  }
  return { token, tokenHash: hashRenewalInviteToken(token) };
}

/** Exactly 43 base64url characters. Anything else is not one of our tokens. */
export function isCanonicalRenewalToken(value: unknown): value is string {
  return typeof value === "string" && RENEWAL_TOKEN_PATTERN.test(value);
}

export function isCanonicalRenewalTokenHash(value: unknown): value is string {
  return typeof value === "string" && RENEWAL_TOKEN_HASH_PATTERN.test(value);
}

/**
 * sha256 of a CANONICAL token, lowercase hex.
 *
 * Throws on a non-canonical input rather than hashing it. Hashing whatever
 * arrives would produce a well-formed 64-hex string for `""`, for a 5000-byte
 * body, or for a path traversal attempt — all of which would then be issued as
 * a database query. Refusing at the boundary keeps the malformed case from ever
 * reaching the loader, and callers that must not throw use
 * `safeHashRenewalInviteToken`.
 */
export function hashRenewalInviteToken(token: string): string {
  if (!isCanonicalRenewalToken(token)) {
    throw new Error("renewal token is not canonical");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Null instead of throwing, for the request path. */
export function safeHashRenewalInviteToken(token: unknown): string | null {
  return isCanonicalRenewalToken(token) ? hashRenewalInviteToken(token) : null;
}

/**
 * Constant-time equality for two token hashes.
 *
 * The database index does the real lookup, so this is the belt to that
 * braces — it re-checks that the row handed back by the loader is the row the
 * hash asked for. Comparison is where a timing side channel would live, so it
 * is constant-time even though both operands are already digests, and the
 * length check happens on values whose length is fixed by contract rather than
 * by the attacker.
 */
export function renewalTokenHashEquals(a: unknown, b: unknown): boolean {
  if (!isCanonicalRenewalTokenHash(a) || !isCanonicalRenewalTokenHash(b)) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// The canonical gate
// ---------------------------------------------------------------------------

/**
 * The invite fields the gate reads. Deliberately the WHOLE binding: nothing
 * downstream may take person, program, season or role from anywhere else, and
 * least of all from the client. There is no email field here and no name field,
 * because the renewal flow never asks the visitor who they are — the token is
 * the identity claim and the row is the answer.
 */
export type RenewalInviteRow = {
  id: string;
  token_hash: string;
  person_id: string;
  program_id: string;
  season_id: string;
  role: "mentor" | "mentee";
  expires_at: string;
  revoked_at: string | null;
  submitted_at: string | null;
  outcome: "accepted" | "declined" | null;
  application_id: string | null;
};

/**
 * Loads at most one invite by token hash. `{ ok: false }` is the fail-closed
 * signal for "the service-role client was unavailable, the query errored, or
 * more than one row came back" — the gate never distinguishes it publicly from
 * a bad token.
 */
export type RenewalInviteLoader = (
  tokenHash: string
) => Promise<{ ok: true; invite: RenewalInviteRow | null } | { ok: false }>;

export type RenewalGateIntent = "render" | "submit";

export type RenewalGateDenyCode =
  | "token_malformed"
  | "token_not_found"
  | "token_hash_mismatch"
  | "invite_revoked"
  | "invite_expired"
  | "invite_already_submitted"
  | "lookup_failed";

export type RenewalGateDecision =
  /** The token is good and the invite may be filled in / submitted. */
  | { status: "renewable"; invite: RenewalInviteRow }
  /**
   * The invite was already answered. Reachable only with `intent: "render"`,
   * and only ever a READ-ONLY completion screen. A `submit` intent on the same
   * row is denied, so a replayed POST cannot renew twice.
   */
  | { status: "completed"; invite: RenewalInviteRow; outcome: "accepted" | "declined" }
  /**
   * Uniform public failure. `code` is server-side diagnostics: log it, never
   * render it, never put it in a response body or a query string.
   */
  | { status: "denied"; code: RenewalGateDenyCode; reason: string };

function deny(code: RenewalGateDenyCode): RenewalGateDecision {
  return { status: "denied", code, reason: RENEWAL_GATE_FAILURE_MESSAGE };
}

/**
 * THE canonical gate. Both the page render and the submit Server Action call
 * this exact function; the only difference between them is `intent`, and that
 * difference is expressed HERE rather than in two places that could disagree.
 *
 *   state                     intent=render          intent=submit
 *   -----------------------   --------------------   --------------------
 *   malformed token           denied                 denied
 *   no matching row           denied                 denied
 *   row hash ≠ asked hash     denied                 denied
 *   revoked_at set            denied                 denied
 *   expires_at <= now         denied                 denied
 *   submitted_at set          completed (read-only)  denied
 *   otherwise                 renewable              renewable
 *
 * Order matters and is deliberate: revoked and expired are checked BEFORE
 * submitted, so a completed invite that was later revoked or has since expired
 * shows the uniform failure rather than a completion screen — the invite is
 * dead, and the screen would be telling a story about a link that should no
 * longer resolve at all.
 *
 * GET NEVER MUTATES. This function is pure: it reads, it decides, it returns.
 * It has no write path of any kind, so no rendering of /renew/[token] can
 * change a row, and the "submitted" transition can only be reached from the
 * Server Action that runs after this gate returns `renewable` for `submit`.
 */
export async function evaluateRenewalInviteGate(
  rawToken: unknown,
  intent: RenewalGateIntent,
  loader: RenewalInviteLoader,
  now: Date = new Date()
): Promise<RenewalGateDecision> {
  const tokenHash = safeHashRenewalInviteToken(rawToken);
  if (!tokenHash) return deny("token_malformed");

  let loaded: Awaited<ReturnType<RenewalInviteLoader>>;
  try {
    loaded = await loader(tokenHash);
  } catch {
    // A thrown loader is a database or transport failure. Fail closed; do not
    // let an exception escape into a 500 whose body might name the table.
    return deny("lookup_failed");
  }

  if (!loaded.ok) return deny("lookup_failed");
  const invite = loaded.invite;
  if (!invite) return deny("token_not_found");

  // The loader was asked for one hash; prove it returned that one.
  if (!renewalTokenHashEquals(invite.token_hash, tokenHash)) {
    return deny("token_hash_mismatch");
  }

  if (invite.revoked_at !== null) return deny("invite_revoked");

  const expiresAt = Date.parse(invite.expires_at);
  // An unparseable expiry is not "no expiry".
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return deny("invite_expired");
  }

  if (invite.submitted_at !== null) {
    if (intent === "submit") return deny("invite_already_submitted");
    // outcome is NOT NULL whenever submitted_at is, enforced by
    // person_season_invites_outcome_binding_check. A row that violates it is
    // corrupt, and corrupt fails closed rather than rendering half a state.
    if (invite.outcome !== "accepted" && invite.outcome !== "declined") {
      return deny("invite_already_submitted");
    }
    return { status: "completed", invite, outcome: invite.outcome };
  }

  return { status: "renewable", invite };
}

/**
 * The binding every downstream write must use, derived from the invite row and
 * from nothing else.
 *
 * It exists as a named function so that "person/program/season/role always come
 * from the invite" is a thing code CALLS rather than a thing a reviewer has to
 * notice the absence of. There is no overload that accepts a person id, an
 * email, or a season from a form field.
 */
export function renewalBindingFromInvite(invite: RenewalInviteRow): {
  inviteId: string;
  personId: string;
  programId: string;
  seasonId: string;
  role: "mentor" | "mentee";
} {
  return {
    inviteId: invite.id,
    personId: invite.person_id,
    programId: invite.program_id,
    seasonId: invite.season_id,
    role: invite.role
  };
}
