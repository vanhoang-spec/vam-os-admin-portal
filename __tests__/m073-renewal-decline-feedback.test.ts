import fs from "fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  acknowledgementsForRole,
  requiredCheckboxAcknowledgements
} from "@/lib/application-commitments";
import {
  RENEWAL_MENTEE_CAPACITY_CHOICES,
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD
} from "@/lib/renewal-types";
import { loadRenewalConsoleData } from "@/lib/renewal-console";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh } from "@/lib/renewal-profile-safety";
import { hashRenewalInviteToken, mintRenewalInviteToken } from "@/lib/renewal-invite-token";
import {
  normalizeOptionalFeedback,
  renewalPayloadFromFormData,
  submitRenewalAccepted,
  submitRenewalDeclined,
  validateRenewalAcceptance
} from "@/lib/renewal-runtime";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const IDS = {
  invite: "00000000-0000-4000-8000-000000000001",
  person: "00000000-0000-4000-8000-000000000002",
  program: "00000000-0000-4000-8000-000000000003",
  season: "00000000-0000-4000-8000-000000000004"
};

const TOKEN = mintRenewalInviteToken();

function query(data: unknown) {
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq", "gt", "order", "limit", "range", "is", "not"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return chain;
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.invite,
    token_hash: hashRenewalInviteToken(TOKEN.token),
    person_id: IDS.person,
    program_id: IDS.program,
    season_id: IDS.season,
    role: "mentor",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
    submitted_at: null,
    outcome: null,
    application_id: null,
    ...overrides
  };
}

function declineClient(rpcImpl?: any) {
  const rpc =
    rpcImpl ??
    vi.fn(async () => ({
      data: [{ outcome_status: "declined", membership_outcome: "opted_out" }],
      error: null
    }));
  const from = vi.fn(() => query(invite()));
  return { client: { from, rpc } as any, rpc, from };
}

function acceptedForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("participation_confirmed", "yes");
  form.set(RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD, "yes");
  form.set("consent_data_storage", "yes");
  form.set("company_current", "Acme");
  form.set("title_current", "Director");
  form.set("function_primary", "strategy_consulting");
  form.set("industry_primary", "education");
  form.set("mentor_total_work_years", "12");
  form.set("mentor_people_management_years", "5");
  form.set("mentoring_capacity_total", "1");
  form.set("mentoring_topics", "Phát triển nghề nghiệp và chiến lược");
  form.set("university", "UEH");
  form.set("programs_willing_to_join", "UEHM");
  for (const entry of requiredCheckboxAcknowledgements("mentor")) form.set(entry.key, "true");
  form.set(ACTIVE_READING_KEYS.mentor, CONFIRMATION_PHRASES.mentor);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === "__DELETE__") form.delete(key);
    else form.set(key, value);
  }
  return form;
}

// ---------------------------------------------------------------------------
// F1 / F2 — the decline feedback is carried by the trusted decline call itself
// ---------------------------------------------------------------------------

describe("M073 decline feedback travels with the trusted decline call", () => {
  it("normalises blank, whitespace-only and absent feedback to NULL", () => {
    expect(normalizeOptionalFeedback("")).toBeNull();
    expect(normalizeOptionalFeedback("   \n\t ")).toBeNull();
    expect(normalizeOptionalFeedback(undefined)).toBeNull();
    expect(normalizeOptionalFeedback(null)).toBeNull();
  });

  it("preserves user content and trims only the edges", () => {
    expect(normalizeOptionalFeedback("  bận công việc  ")).toBe("bận công việc");
    expect(normalizeOptionalFeedback("dòng 1\ndòng 2")).toBe("dòng 1\ndòng 2");
  });

  it("empty feedback still declines and sends NULL to the RPC", async () => {
    const { client, rpc } = declineClient();
    const result = await submitRenewalDeclined(TOKEN.token, new FormData(), client);
    expect(result).toMatchObject({ ok: true, outcome: "declined" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_decline_feedback: null });
  });

  it("declining with no FormData at all is valid and sends NULL", async () => {
    const { client, rpc } = declineClient();
    const result = await submitRenewalDeclined(TOKEN.token, undefined, client);
    expect(result).toMatchObject({ ok: true, outcome: "declined" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_decline_feedback: null });
  });

  it("populated feedback reaches the trusted RPC, trimmed", async () => {
    const { client, rpc } = declineClient();
    const form = new FormData();
    form.set("decline_feedback", "  Em đổi công việc nên chưa sắp xếp được.  ");
    await submitRenewalDeclined(TOKEN.token, form, client);
    expect(rpc).toHaveBeenCalledWith("vam071_submit_renewal_declined", {
      p_token_hash: expect.any(String),
      p_decline_feedback: "Em đổi công việc nên chưa sắp xếp được."
    });
  });

  it("writes through ONE call — no second statement and no applications traffic", async () => {
    const { client, rpc, from } = declineClient();
    const form = new FormData();
    form.set("decline_feedback", "góp ý");
    await submitRenewalDeclined(TOKEN.token, form, client);

    expect(rpc).toHaveBeenCalledTimes(1);
    const tables = from.mock.calls.map((call: unknown[]) => call[0]);
    expect(tables).not.toContain("applications");
    expect(tables).not.toContain("person_season_memberships");
  });

  it("exposes no insert capability on the decline path at all", async () => {
    const { client, from } = declineClient();
    const form = new FormData();
    form.set("decline_feedback", "lý do");
    await submitRenewalDeclined(TOKEN.token, form, client);
    for (const result of from.mock.results) {
      expect((result.value as Record<string, unknown>).insert).toBeUndefined();
    }
  });

  it("the runtime and console no longer mention the invalid declined_renewal status", () => {
    for (const file of ["lib/renewal-runtime.ts", "lib/renewal-console.ts"]) {
      expect(`${file}:${fs.readFileSync(file, "utf8").includes("declined_renewal")}`).toBe(
        `${file}:false`
      );
    }
  });

  it("a replayed decline is refused before the RPC, so feedback cannot be written twice", async () => {
    const rpc = vi.fn();
    const form = new FormData();
    form.set("decline_feedback", "lần hai");
    const used = invite({ submitted_at: "2026-08-18T00:00:00.000Z", outcome: "declined" });
    const result = await submitRenewalDeclined(TOKEN.token, form, {
      from: () => query(used),
      rpc
    } as any);
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an RPC that does not report declined fails closed without leaking internals", async () => {
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "accepted" }], error: null }));
    const { client } = declineClient(rpc);
    const result = await submitRenewalDeclined(TOKEN.token, new FormData(), client);
    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/rpc|sql|constraint|declined_renewal/i);
  });
});

// ---------------------------------------------------------------------------
// F5 — the admin console reads the invite, never applications
// ---------------------------------------------------------------------------

describe("M073 admin console reads decline feedback from the invite", () => {
  const season = { id: IDS.season, programId: IDS.program, code: "S12" };

  function consoleClient(rows: { invites: unknown[]; applications: unknown[] }) {
    const served = new Map<string, number>();
    const from = vi.fn((table: string) => {
      const chain: Record<string, any> = {};
      const data =
        table === "person_season_invites"
          ? rows.invites
          : table === "applications"
            ? rows.applications
            : table === "people"
              ? [{ id: IDS.person, full_name: "Mentor A", email_primary: "a@example.com" }]
              : table === "mentor_profiles"
                ? [{ id: "profile-1", person_id: IDS.person, capacity_target: 2 }]
                : [];
      for (const method of ["select", "eq", "gt", "order", "range", "is", "not"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.limit = vi.fn(async () => {
        const seen = served.get(table) ?? 0;
        served.set(table, seen + 1);
        return { data: seen === 0 ? data : [], error: null };
      });
      return chain;
    });
    (getSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ from });
    return from;
  }

  const declinedInvite = (declineFeedback: string | null) => ({
    id: IDS.invite,
    person_id: IDS.person,
    program_id: IDS.program,
    season_id: IDS.season,
    role: "mentor",
    created_at: "2026-08-18T00:00:00.000Z",
    expires_at: "2026-09-18T00:00:00.000Z",
    revoked_at: null,
    submitted_at: "2026-08-18T01:00:00.000Z",
    outcome: "declined",
    application_id: null,
    decline_feedback: declineFeedback
  });

  it("surfaces person_season_invites.decline_feedback for a declined invite", async () => {
    consoleClient({ invites: [declinedInvite("Chưa sắp xếp được thời gian")], applications: [] });
    const data = await loadRenewalConsoleData(season);
    expect(data.error).toBeNull();
    expect(data.invites).toHaveLength(1);
    expect(data.invites[0].inviteState).toBe("declined");
    expect(data.invites[0].declineFeedback).toBe("Chưa sắp xếp được thời gian");
    expect(data.invites[0].applicationId).toBeNull();
  });

  it("ignores a same-person application row that the old lookup would have matched", async () => {
    consoleClient({
      invites: [declinedInvite(null)],
      applications: [
        {
          id: "application-ghost",
          person_id: IDS.person,
          season_id: IDS.season,
          status: "declined_renewal",
          source: "s12_mentor_renewal",
          raw_payload: { renewal: { decline_feedback: "GHOST_VALUE" } }
        }
      ]
    });
    const data = await loadRenewalConsoleData(season);
    expect(data.invites[0].declineFeedback).toBeNull();
    expect(JSON.stringify(data.invites[0])).not.toContain("GHOST_VALUE");
  });

  it("declined rows carry no profile diff and no core team note", async () => {
    consoleClient({ invites: [declinedInvite("ok")], applications: [] });
    const data = await loadRenewalConsoleData(season);
    expect(data.invites[0].diff).toEqual([]);
    expect(data.invites[0].coreTeamNote).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F3 / F4 — server-side enforcement, derived from the canonical policy source
// ---------------------------------------------------------------------------

describe("M073 acceptance gate enforces the canonical mentor commitments", () => {
  it("derives the required set from the canonical acknowledgements", () => {
    const required = requiredCheckboxAcknowledgements("mentor");
    const applicationStage = acknowledgementsForRole("mentor");
    expect(required.map((entry) => entry.key)).toEqual(
      applicationStage
        .filter((entry) => entry.key !== ACTIVE_READING_KEYS.mentor)
        .map((entry) => entry.key)
    );
    // Collected post-approval after orientation; never demanded at renewal.
    expect(required.map((entry) => entry.key)).not.toContain("MENTOR_CONDUCT_V1");
    expect(required.length).toBeGreaterThan(0);
  });

  it("neither the runtime nor the form keeps a commitment list of its own", () => {
    for (const file of ["lib/renewal-runtime.ts", "app/renew/[token]/renewal-form.tsx"]) {
      const source = fs.readFileSync(file, "utf8");
      expect(`${file}:${source.includes("requiredCheckboxAcknowledgements")}`).toBe(`${file}:true`);
      expect(`${file}:${source.includes("MENTOR_BOUNDARIES_V1")}`).toBe(`${file}:false`);
    }
  });

  it("accepts a fully satisfied submission", () => {
    expect(validateRenewalAcceptance(acceptedForm()).ok).toBe(true);
  });

  it.each(requiredCheckboxAcknowledgements("mentor").map((entry) => entry.key))(
    "refuses when required commitment %s is missing",
    (key) => {
      const result = validateRenewalAcceptance(acceptedForm({ [key]: "__DELETE__" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Vui lòng xác nhận:");
    }
  );

  it("refuses a commitment submitted with any value other than true", () => {
    const key = requiredCheckboxAcknowledgements("mentor")[0].key;
    expect(validateRenewalAcceptance(acceptedForm({ [key]: "false" })).ok).toBe(false);
    expect(validateRenewalAcceptance(acceptedForm({ [key]: "on" })).ok).toBe(false);
  });

  it("accepts the canonical typed phrase, including surrounding whitespace", () => {
    const padded = `   ${CONFIRMATION_PHRASES.mentor}   `;
    expect(validateRenewalAcceptance(acceptedForm({ [ACTIVE_READING_KEYS.mentor]: padded })).ok).toBe(
      true
    );
  });

  it("refuses a materially different typed phrase", () => {
    const rejects = [
      "",
      "Tôi đồng ý",
      `${CONFIRMATION_PHRASES.mentor} nhưng không chắc`,
      CONFIRMATION_PHRASES.mentee
    ];
    for (const candidate of rejects) {
      const result = validateRenewalAcceptance(
        acceptedForm({ [ACTIVE_READING_KEYS.mentor]: candidate })
      );
      expect(`${candidate.slice(0, 14)}:${result.ok}`).toBe(`${candidate.slice(0, 14)}:false`);
    }
  });

  it("refuses a missing participation confirmation or data-storage consent", () => {
    expect(validateRenewalAcceptance(acceptedForm({ participation_confirmed: "__DELETE__" })).ok).toBe(
      false
    );
    expect(validateRenewalAcceptance(acceptedForm({ consent_data_storage: "__DELETE__" })).ok).toBe(
      false
    );
  });

  it.each(RENEWAL_MENTEE_CAPACITY_CHOICES.map((choice) => String(choice)))(
    "accepts mentee capacity %s",
    (choice) => {
      expect(validateRenewalAcceptance(acceptedForm({ mentoring_capacity_total: choice })).ok).toBe(
        true
      );
    }
  );

  it.each(["0", "4", "-1", "2.5", "abc", "__DELETE__"])("refuses mentee capacity %s", (choice) => {
    const result = validateRenewalAcceptance(acceptedForm({ mentoring_capacity_total: choice }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("số mentee");
  });

  it("never reaches the trusted RPC, or even the invite, when a commitment is missing", async () => {
    const rpc = vi.fn();
    const from = vi.fn(() => query(invite()));
    const key = requiredCheckboxAcknowledgements("mentor")[0].key;
    const result = await submitRenewalAccepted(TOKEN.token, acceptedForm({ [key]: "__DELETE__" }), {
      from,
      rpc
    } as any);
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    // The invite is never claimed, so a corrected resubmission stays possible.
    expect(from).not.toHaveBeenCalled();
  });

  it("records commitments_completed true only once every condition holds", () => {
    expect(renewalPayloadFromFormData(acceptedForm()).commitments_completed).toBe(true);
    const key = requiredCheckboxAcknowledgements("mentor")[0].key;
    expect(
      renewalPayloadFromFormData(acceptedForm({ [key]: "__DELETE__" })).commitments_completed
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — profile safety is unchanged by any of the above
// ---------------------------------------------------------------------------

describe("M073 operational evidence never becomes a mentor profile field", () => {
  it("keeps commitments, acknowledgement, notes and feedback out of the profile delta", () => {
    const payload = renewalPayloadFromFormData(acceptedForm({ core_team_note: "ưu tiên mentee cũ" }));
    expect(payload.core_team_note).toBe("ưu tiên mentee cũ");

    const refresh = buildRenewalProfileRefresh(payload) as Record<string, unknown>;
    for (const forbidden of [
      "commitments",
      "commitments_completed",
      "core_team_note",
      "decline_feedback",
      "mentor_people_management_years",
      "mentoring_topics",
      RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD,
      ACTIVE_READING_KEYS.mentor
    ]) {
      expect(`${forbidden}:${forbidden in refresh}`).toBe(`${forbidden}:false`);
    }

    const diff = buildRenewalProfileDiff({}, refresh);
    expect(JSON.stringify(diff)).not.toMatch(/commitment|core_team_note|decline_feedback|ACTIVE_READING/i);
  });

  it("still treats mentee capacity as a legitimate profile update", () => {
    const payload = renewalPayloadFromFormData(acceptedForm({ mentoring_capacity_total: "3" }));
    const refresh = buildRenewalProfileRefresh(payload) as Record<string, unknown>;
    expect(refresh.capacity_target).toBe(3);
  });

  it("historical capacity is never silently reused as the submitted value", () => {
    // The form defaults to 1 regardless of last season, and the payload carries
    // only what was actually submitted.
    const payload = renewalPayloadFromFormData(acceptedForm());
    expect(payload.mentoring_capacity_total).toBe(1);

    const source = fs.readFileSync("app/renew/[token]/renewal-form.tsx", "utf8");
    expect(source).toContain("RENEWAL_MENTEE_CAPACITY_DEFAULT");
    expect(source).not.toMatch(/defaultChecked=\{num === display\.capacityTarget\}/);
  });

  it("does not resurrect availability_commitment, and omitting it clears nothing", () => {
    const payload = renewalPayloadFromFormData(acceptedForm());
    expect(payload).not.toHaveProperty("availability_commitment");

    const refresh = buildRenewalProfileRefresh(payload) as Record<string, unknown>;
    expect(refresh).not.toHaveProperty("availability_commitment");

    const diff = buildRenewalProfileDiff({ availability_commitment: "Hai buổi mỗi tháng" }, refresh);
    expect(diff.find((entry) => entry.field === "availability_commitment")).toBeUndefined();
  });

  it("never lets a renewal rewrite lineage", () => {
    const payload = renewalPayloadFromFormData(acceptedForm({ first_vam_season: "S12" }));
    const refresh = buildRenewalProfileRefresh(payload) as Record<string, unknown>;
    expect(refresh).not.toHaveProperty("first_vam_season");
  });
});
