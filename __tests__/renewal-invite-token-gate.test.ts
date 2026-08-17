import { describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  RENEWAL_GATE_FAILURE_MESSAGE,
  RENEWAL_ROUTE_HEADERS,
  RENEWAL_ROUTE_SEGMENT_CONFIG,
  RENEWAL_TOKEN_LENGTH,
  evaluateRenewalInviteGate,
  hashRenewalInviteToken,
  isCanonicalRenewalToken,
  isCanonicalRenewalTokenHash,
  mintRenewalInviteToken,
  renewalBindingFromInvite,
  renewalTokenHashEquals,
  safeHashRenewalInviteToken,
  type RenewalInviteLoader,
  type RenewalInviteRow
} from "@/lib/renewal-invite-token";

const NOW = new Date("2026-08-17T00:00:00.000Z");
const FUTURE = "2026-12-31T00:00:00.000Z";
const PAST = "2026-08-16T23:59:59.000Z";

function inviteFor(token: string, overrides: Partial<RenewalInviteRow> = {}): RenewalInviteRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    token_hash: hashRenewalInviteToken(token),
    person_id: "22222222-2222-4222-8222-222222222222",
    program_id: "33333333-3333-4333-8333-333333333333",
    season_id: "44444444-4444-4444-8444-444444444444",
    role: "mentor",
    expires_at: FUTURE,
    revoked_at: null,
    submitted_at: null,
    outcome: null,
    application_id: null,
    ...overrides
  };
}

function loaderFor(invite: RenewalInviteRow | null): RenewalInviteLoader {
  return async (hash) => ({
    ok: true,
    invite: invite && invite.token_hash === hash ? invite : null
  });
}

describe("token format and hashing", () => {
  it("mints exactly 43 base64url characters from 32 bytes", () => {
    for (let i = 0; i < 200; i += 1) {
      const { token, tokenHash } = mintRenewalInviteToken();
      expect(token).toHaveLength(RENEWAL_TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    }
  });

  it("mints a distinct token every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(mintRenewalInviteToken().token);
    expect(seen.size).toBe(500);
  });

  it("the hash matches what the database column will accept and the raw token never could", () => {
    const { token, tokenHash } = mintRenewalInviteToken();
    // person_season_invites_token_hash_format_check
    const columnPattern = /^[0-9a-f]{64}$/;
    expect(columnPattern.test(tokenHash)).toBe(true);
    expect(columnPattern.test(token)).toBe(false);
  });

  it("refuses to hash anything that is not a canonical token", () => {
    for (const bad of [
      "",
      "   ",
      "short",
      `${"a".repeat(42)}`,
      `${"a".repeat(44)}`,
      `${"a".repeat(42)}+`, // base64, not base64url
      `${"a".repeat(42)}/`,
      `${"a".repeat(42)}=`,
      "../../etc/passwd",
      randomBytes(32).toString("hex")
    ]) {
      expect(isCanonicalRenewalToken(bad)).toBe(false);
      expect(() => hashRenewalInviteToken(bad as string)).toThrow();
      expect(safeHashRenewalInviteToken(bad)).toBeNull();
    }
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(isCanonicalRenewalToken(bad)).toBe(false);
      expect(safeHashRenewalInviteToken(bad)).toBeNull();
    }
  });

  it("compares hashes without leaking through a non-constant path", () => {
    const a = mintRenewalInviteToken().tokenHash;
    expect(renewalTokenHashEquals(a, a)).toBe(true);
    expect(renewalTokenHashEquals(a, mintRenewalInviteToken().tokenHash)).toBe(false);
    // Non-canonical operands are never "equal", even to themselves.
    expect(renewalTokenHashEquals("nope", "nope")).toBe(false);
    expect(renewalTokenHashEquals(null, null)).toBe(false);
    expect(isCanonicalRenewalTokenHash(a.toUpperCase())).toBe(false);
  });
});

describe("the canonical gate", () => {
  it("accepts a good token for both render and submit", async () => {
    const { token } = mintRenewalInviteToken();
    const invite = inviteFor(token);
    for (const intent of ["render", "submit"] as const) {
      const d = await evaluateRenewalInviteGate(token, intent, loaderFor(invite), NOW);
      expect(d.status).toBe("renewable");
      if (d.status === "renewable") expect(d.invite.id).toBe(invite.id);
    }
  });

  it("returns ONE uniform failure for every invalid state", async () => {
    const { token } = mintRenewalInviteToken();
    const other = mintRenewalInviteToken().token;

    const cases: Array<[string, () => Promise<unknown>]> = [
      ["malformed", () => evaluateRenewalInviteGate("nope", "render", loaderFor(null), NOW)],
      ["not found", () => evaluateRenewalInviteGate(other, "render", loaderFor(inviteFor(token)), NOW)],
      [
        "revoked",
        () =>
          evaluateRenewalInviteGate(
            token,
            "render",
            loaderFor(inviteFor(token, { revoked_at: "2026-08-10T00:00:00.000Z" })),
            NOW
          )
      ],
      [
        "expired",
        () =>
          evaluateRenewalInviteGate(token, "render", loaderFor(inviteFor(token, { expires_at: PAST })), NOW)
      ],
      [
        "unparseable expiry",
        () =>
          evaluateRenewalInviteGate(
            token,
            "render",
            loaderFor(inviteFor(token, { expires_at: "whenever" })),
            NOW
          )
      ],
      ["lookup failed", () => evaluateRenewalInviteGate(token, "render", async () => ({ ok: false }), NOW)],
      [
        "loader threw",
        () =>
          evaluateRenewalInviteGate(
            token,
            "render",
            async () => {
              throw new Error("connection reset");
            },
            NOW
          )
      ]
    ];

    const messages = new Set<string>();
    for (const [label, run] of cases) {
      const d = (await run()) as { status: string; reason?: string };
      expect(`${label}:${d.status}`).toBe(`${label}:denied`);
      messages.add(d.reason!);
    }
    // Exactly one public message across every failure mode: nothing about the
    // state of a real invite is inferable from the response.
    expect(Array.from(messages)).toEqual([RENEWAL_GATE_FAILURE_MESSAGE]);
  });

  it("fails closed when the loader returns a row for a different hash", async () => {
    const { token } = mintRenewalInviteToken();
    const impostor = inviteFor(mintRenewalInviteToken().token);
    const d = await evaluateRenewalInviteGate(token, "render", async () => ({ ok: true, invite: impostor }), NOW);
    expect(d.status).toBe("denied");
    if (d.status === "denied") expect(d.code).toBe("token_hash_mismatch");
  });

  it("a submitted invite renders a read-only completion state but cannot submit again", async () => {
    for (const outcome of ["accepted", "declined"] as const) {
      const { token } = mintRenewalInviteToken();
      const invite = inviteFor(token, {
        submitted_at: "2026-08-16T10:00:00.000Z",
        outcome,
        application_id: outcome === "accepted" ? "55555555-5555-4555-8555-555555555555" : null
      });

      const rendered = await evaluateRenewalInviteGate(token, "render", loaderFor(invite), NOW);
      expect(rendered.status).toBe("completed");
      if (rendered.status === "completed") expect(rendered.outcome).toBe(outcome);

      const replayed = await evaluateRenewalInviteGate(token, "submit", loaderFor(invite), NOW);
      expect(replayed.status).toBe("denied");
      if (replayed.status === "denied") {
        expect(replayed.code).toBe("invite_already_submitted");
        expect(replayed.reason).toBe(RENEWAL_GATE_FAILURE_MESSAGE);
      }
    }
  });

  it("a submitted invite that was later revoked or expired shows the uniform failure, not a completion screen", async () => {
    const { token } = mintRenewalInviteToken();
    const submitted = { submitted_at: "2026-08-16T10:00:00.000Z", outcome: "accepted" as const, application_id: "55555555-5555-4555-8555-555555555555" };
    for (const overrides of [
      { ...submitted, revoked_at: "2026-08-16T12:00:00.000Z" },
      { ...submitted, expires_at: PAST }
    ]) {
      const d = await evaluateRenewalInviteGate(token, "render", loaderFor(inviteFor(token, overrides)), NOW);
      expect(d.status).toBe("denied");
    }
  });

  it("treats a corrupt submitted-without-outcome row as a failure, not a half-rendered state", async () => {
    const { token } = mintRenewalInviteToken();
    const d = await evaluateRenewalInviteGate(
      token,
      "render",
      loaderFor(inviteFor(token, { submitted_at: "2026-08-16T10:00:00.000Z", outcome: null })),
      NOW
    );
    expect(d.status).toBe("denied");
  });

  it("expiry is exclusive at the boundary", async () => {
    const { token } = mintRenewalInviteToken();
    const atNow = await evaluateRenewalInviteGate(
      token,
      "render",
      loaderFor(inviteFor(token, { expires_at: NOW.toISOString() })),
      NOW
    );
    expect(atNow.status).toBe("denied");
    const justAfter = await evaluateRenewalInviteGate(
      token,
      "render",
      loaderFor(inviteFor(token, { expires_at: new Date(NOW.getTime() + 1000).toISOString() })),
      NOW
    );
    expect(justAfter.status).toBe("renewable");
  });

  it("hashes the token exactly once and hands the loader nothing else", async () => {
    const { token } = mintRenewalInviteToken();
    const invite = inviteFor(token);
    const loader = vi.fn<RenewalInviteLoader>(async () => ({ ok: true, invite }));
    await evaluateRenewalInviteGate(token, "render", loader, NOW);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0]).toEqual([invite.token_hash]);
    // The raw token never reaches the query layer.
    expect(loader.mock.calls[0][0]).not.toContain(token);
  });

  it("never queries at all for a malformed token", async () => {
    const loader = vi.fn<RenewalInviteLoader>(async () => ({ ok: true, invite: null }));
    await evaluateRenewalInviteGate("not-a-token", "submit", loader, NOW);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("identity binding", () => {
  it("derives person, program, season and role from the invite row only", () => {
    const { token } = mintRenewalInviteToken();
    const invite = inviteFor(token);
    expect(renewalBindingFromInvite(invite)).toEqual({
      inviteId: invite.id,
      personId: invite.person_id,
      programId: invite.program_id,
      seasonId: invite.season_id,
      role: invite.role
    });
  });

  it("the gate's public surface exposes no way to supply an identity", () => {
    // evaluateRenewalInviteGate(rawToken, intent, loader, now) — four
    // parameters, none of which is an email, a person id or a season.
    expect(evaluateRenewalInviteGate.length).toBe(3); // `now` has a default
    const source = readFileSync(path.join(process.cwd(), "lib/renewal-invite-token.ts"), "utf8");
    expect(/email/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))).toBe(false);
  });
});

describe("no GET mutation, and the route contract the page must honour", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/renewal-invite-token.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

  it("the gate module contains no write path of any kind", () => {
    // `.update(` and a bare `.from(` are deliberately not in this list:
    // `createHash(…).update()` and `Buffer.from(value, …)` are both crypto, not
    // I/O. Every PostgREST access in this codebase is `.from("table")` with a
    // string literal, and both quoted forms are listed and absent.
    for (const forbidden of [
      ".insert(",
      ".update({",
      ".upsert(",
      ".delete(",
      ".rpc(",
      '.from("',
      ".from('",
      "getSupabaseServiceRoleClient"
    ]) {
      expect(`${forbidden}:${code.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  it("is server-only", () => {
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(code).not.toContain('"use client"');
  });

  it("exports the no-referrer and no-store contract as data the route cannot forget", () => {
    expect(RENEWAL_ROUTE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    expect(RENEWAL_ROUTE_HEADERS["Cache-Control"]).toContain("no-store");
    expect(RENEWAL_ROUTE_SEGMENT_CONFIG.dynamic).toBe("force-dynamic");
    expect(RENEWAL_ROUTE_SEGMENT_CONFIG.revalidate).toBe(0);
    expect(Object.isFrozen(RENEWAL_ROUTE_HEADERS)).toBe(true);
  });

  it("the uniform failure message names no invite, person or reason", () => {
    for (const leak of ["expired", "revoked", "hết hạn", "thu hồi", "token", "invite"]) {
      expect(`${leak}:${RENEWAL_GATE_FAILURE_MESSAGE.toLowerCase().includes(leak.toLowerCase())}`).toBe(
        `${leak}:false`
      );
    }
  });
});
