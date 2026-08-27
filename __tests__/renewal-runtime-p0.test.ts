import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/application-approvals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/application-approvals")>();
  return { ...actual, approveApplication: vi.fn() };
});

import { approveApplication } from "@/lib/application-approvals";
import { buildRenewalPublicDisplayDto, createRenewalInvite, loadRenewalPage, reconcileRenewalMembership, submitRenewalAccepted, submitRenewalDeclined, confirmRenewalAndApprove, regenerateRenewalInvite, revokeRenewalInvite } from "@/lib/renewal-runtime";
import { hashRenewalInviteToken, mintRenewalInviteToken, type RenewalInviteRow } from "@/lib/renewal-invite-token";
import { renewalDeclineAttention, renewalInviteState } from "@/lib/renewal-console";
import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  requiredCheckboxAcknowledgements
} from "@/lib/application-commitments";
import { RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD } from "@/lib/renewal-types";

const IDS = {
  invite: "00000000-0000-4000-8000-000000000001",
  person: "00000000-0000-4000-8000-000000000002",
  program: "00000000-0000-4000-8000-000000000003",
  season: "00000000-0000-4000-8000-000000000004",
  application: "00000000-0000-4000-8000-000000000005",
  membership: "00000000-0000-4000-8000-000000000006",
  profile: "00000000-0000-4000-8000-000000000007"
};

beforeEach(() => {
  vi.clearAllMocks();
});

function query(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "gt", "range"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null, ...result }));
  return chain;
}

function invite(token: string): RenewalInviteRow {
  return {
    id: IDS.invite,
    token_hash: hashRenewalInviteToken(token),
    person_id: IDS.person,
    program_id: IDS.program,
    season_id: IDS.season,
    role: "mentor",
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
    submitted_at: null,
    outcome: null,
    application_id: null
  };
}

/**
 * A submission that satisfies the M073 acceptance gate. The commitments are
 * applied from the canonical mentor set rather than a list held here, so this
 * helper cannot drift away from what the runtime enforces.
 */
function acceptedForm() {
  const form = new FormData();
  form.set("participation_confirmed", "yes");
  form.set(RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD, "yes");
  form.set("consent_data_storage", "yes");
  form.set("company_current", "Acme");
  form.set("title_current", "Director");
  form.set("function_primary", "Strategy");
  form.set("industry_primary", "Education");
  form.set("years_of_experience", "11-15");
  form.set("mentor_total_work_years", "12");
  form.set("mentor_people_management_years", "5");
  form.set("mentoring_capacity_total", "1");
  form.set("mentoring_topics", "Phát triển nghề nghiệp và chiến lược");
  form.set("university", "UEH");
  form.set("programs_willing_to_join", "UEHM");
  for (const entry of requiredCheckboxAcknowledgements("mentor")) form.set(entry.key, "true");
  form.set(ACTIVE_READING_KEYS.mentor, CONFIRMATION_PHRASES.mentor);
  form.set("first_vam_season", "MUST_NOT_PASS");
  form.set("person_id", "MUST_NOT_PASS");
  return form;
}

/** The commitments block the canonical set produces when every box is ticked. */
function expectedCommitments() {
  const commitments: Record<string, boolean | string> = {};
  for (const entry of requiredCheckboxAcknowledgements("mentor")) commitments[entry.key] = true;
  commitments[`${ACTIVE_READING_KEYS.mentor}_matched`] = true;
  commitments[`${ACTIVE_READING_KEYS.mentor}_text`] = CONFIRMATION_PHRASES.mentor;
  return commitments;
}

describe("P0 public renewal submission boundary", () => {
  it("builds the public client DTO without person/profile UUIDs or linkage identifiers", () => {
    const display = buildRenewalPublicDisplayDto(
      { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: "0900" },
      {
        id: IDS.profile,
        person_id: IDS.person,
        mentor_code: "M01",
        company_current: "Acme",
        title_current: "Lead",
        years_experience_min: 10,
        years_experience_text: "10+",
        capacity_target: 2,
        industry: "Tech",
        function_area: "Engineering",
        first_vam_season: "S10",
        prior_vam_involvement: "internal history"
      } as any
    );
    expect(display).toEqual({
      fullName: "Mentor",
      emailPrimary: "m@example.com",
      phonePrimary: "0900",
      mentorCode: "M01",
      firstVamSeason: "S10",
      companyCurrent: "Acme",
      titleCurrent: "Lead",
      yearsExperienceMin: 10,
      yearsExperienceText: "10+",
      capacityTarget: 2,
      industry: "Tech",
      functionArea: "Engineering"
    });
    const serialized = JSON.stringify(display);
    expect(serialized).not.toContain(IDS.person);
    expect(serialized).not.toContain(IDS.profile);
    expect(serialized).not.toMatch(/person_id|profile_id|prior_vam_involvement/);
  });

  it("returns only the display DTO from the public renewal page loader", async () => {
    const { token } = mintRenewalInviteToken();
    const person = { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: "0900" };
    const profile = {
      id: IDS.profile,
      person_id: IDS.person,
      mentor_code: "M01",
      company_current: "Acme",
      title_current: "Lead",
      years_experience_min: 10,
      years_experience_text: "10+",
      capacity_target: 2,
      industry: "Tech",
      function_area: "Engineering",
      first_vam_season: "S10"
    };
    const from = vi.fn((table: string) => query({
      data: table === "person_season_invites" ? invite(token) : table === "people" ? person : profile
    }));
    const result = await loadRenewalPage(token, { from } as any);
    expect(result.status).toBe("renewable");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(IDS.invite);
    expect(serialized).not.toContain(IDS.person);
    expect(serialized).not.toContain(IDS.profile);
    expect(serialized).not.toMatch(/person_id|profile_id|token_hash|renewal_invites/);
  });

  it("hashes the raw token, sends the renewal payload to M071, and never sends identity/lineage fields", async () => {
    const { token, tokenHash } = mintRenewalInviteToken();
    const from = vi.fn(() => query({ data: invite(token) }));
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "accepted" }], error: null }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await submitRenewalAccepted(token, acceptedForm(), { from, rpc } as any);

    expect(result).toMatchObject({ ok: true, outcome: "accepted" });
    expect(rpc).toHaveBeenCalledWith("vam071_submit_renewal_accepted", {
      p_token_hash: tokenHash,
      p_raw_payload: {
        participation_confirmed: true,
        profile_review_confirmed: true,
        company_current: "Acme",
        title_current: "Director",
        function_primary: "Strategy",
        industry_primary: "Education",
        years_of_experience: "11-15",
        mentor_total_work_years: 12,
        mentor_people_management_years: 5,
        mentoring_capacity_total: 1,
        mentoring_topics: "Phát triển nghề nghiệp và chiến lược",
        university: "UEH",
        programs_willing_to_join: ["UEHM"],
        commitments: expectedCommitments(),
        commitments_completed: true
      },
      p_consent_data_storage: true
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("rejects submission if consent_data_storage is missing", async () => {
    const { token } = mintRenewalInviteToken();
    const form = acceptedForm();
    form.delete("consent_data_storage");
    const result = await submitRenewalAccepted(token, form, { from: () => query({ data: invite(token) }) } as any);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Vui lòng đồng ý lưu trữ dữ liệu để gửi xác nhận gia hạn.");
  });

  it("passes consent_data_storage exactly to the payload in M071 RPC", async () => {
    const { token, tokenHash } = mintRenewalInviteToken();
    const from = vi.fn(() => query({ data: invite(token) }));
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "accepted" }], error: null }));
    const result = await submitRenewalAccepted(token, acceptedForm(), { from, rpc } as any);

    expect(result.ok).toBe(true);
    // acceptedForm includes consent_data_storage="yes"
    expect(rpc).toHaveBeenCalledWith("vam071_submit_renewal_accepted", expect.objectContaining({
      p_consent_data_storage: true
    }));
  });

  it("replay is refused by the shared submit gate before the accepted RPC", async () => {
    const { token } = mintRenewalInviteToken();
    const used = { ...invite(token), submitted_at: "2026-08-17T00:00:00.000Z", outcome: "accepted" as const, application_id: IDS.application };
    const rpc = vi.fn();
    const result = await submitRenewalAccepted(token, acceptedForm(), { from: () => query({ data: used }), rpc } as any);
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("decline acknowledges deferred_actor_unauthorized without exposing it to the mentor", async () => {
    const { token } = mintRenewalInviteToken();
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "declined", membership_outcome: "deferred_actor_unauthorized" }], error: null }));
    const result = await submitRenewalDeclined(token, new FormData(), { from: () => query({ data: invite(token) }), rpc } as any);
    expect(result).toMatchObject({ ok: true, outcome: "declined" });
    expect(result.message).not.toMatch(/deferred|unauthorized/i);
    expect(renewalDeclineAttention("declined", "active")).toMatchObject({ needsAttention: true });
  });
});

describe("P0-RT-10 exact membership reconciliation", () => {
  function clientFor(status: string | null, rpcOutcome = "transitioned") {
    const rpc = vi.fn(async (name: string) => ({
      data: [{ outcome_status: name === "vam063_add_membership_role" ? "created" : rpcOutcome, membership_id: IDS.membership }],
      error: null
    }));
    const from = vi.fn(() => query({ data: status === null ? null : { id: IDS.membership, status } }));
    return { client: { from, rpc } as any, rpc };
  }

  const input = { actorAdminUserId: "admin-1", personId: IDS.person, programId: IDS.program, seasonId: IDS.season, role: "mentor" as const };

  it("none → vam063_add_membership_role", async () => {
    const { client, rpc } = clientFor(null);
    expect(await reconcileRenewalMembership(client, input)).toMatchObject({ ok: true, outcome: "created" });
    expect(rpc).toHaveBeenCalledWith("vam063_add_membership_role", expect.objectContaining({ p_person_id: IDS.person, p_season_id: IDS.season, p_role: "mentor" }));
  });

  it("active → noop with zero RPC writes", async () => {
    const { client, rpc } = clientFor("active");
    expect(await reconcileRenewalMembership(client, input)).toMatchObject({ ok: true, outcome: "noop" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("opted_out → vam063_reactivate_membership", async () => {
    const { client, rpc } = clientFor("opted_out");
    expect(await reconcileRenewalMembership(client, input)).toMatchObject({ ok: true, outcome: "reactivated" });
    expect(rpc).toHaveBeenCalledWith("vam063_reactivate_membership", expect.objectContaining({ p_membership_id: IDS.membership }));
  });

  it.each(["paused", "invited", "withdrawn", "cancelled", "completed", "graduated", "mystery"])("%s → refuse with zero RPC writes", async (status) => {
    const { client, rpc } = clientFor(status);
    expect(await reconcileRenewalMembership(client, input)).toMatchObject({ ok: false, status });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("admin invite and confirmation controls", () => {
  it("creates a 32-byte bearer path once while sending only its hash to SQL", async () => {
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "created", invite_id: IDS.invite }], error: null }));
    const result = await createRenewalInvite({ actorAdminUserId: "admin-1", personId: IDS.person, programId: IDS.program, seasonId: IDS.season, expiresAt: "2026-09-01T00:00:00.000Z" }, { rpc } as any);
    expect(result.ok).toBe(true);
    expect(result.renewalPath).toMatch(/^\/renew\/[A-Za-z0-9_-]{43}$/);
    const params = (rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(params.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(params)).not.toContain(String(result.renewalPath).slice("/renew/".length));
  });

  it("revokes through M071 and regenerates strictly revoke → create with a new one-time link", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: [{ outcome_status: name === "vam071_revoke_renewal_invite" ? "revoked" : "created", invite_id: IDS.invite }],
      error: null
    }));
    const revokeResult = await revokeRenewalInvite({ actorAdminUserId: "admin-1", inviteId: IDS.invite }, { rpc } as any);
    expect(revokeResult).toMatchObject({ ok: true, outcome: "revoked" });

    rpc.mockClear();
    const from = vi.fn(() => query({ data: { id: IDS.invite, person_id: IDS.person, program_id: IDS.program, season_id: IDS.season, role: "mentor", submitted_at: null } }));
    const regenerated = await regenerateRenewalInvite({ actorAdminUserId: "admin-1", inviteId: IDS.invite, expiresAt: "2026-09-01T00:00:00.000Z" }, { from, rpc } as any);
    expect(regenerated).toMatchObject({ ok: true, outcome: "regenerated" });
    expect(regenerated.renewalPath).toMatch(/^\/renew\/[A-Za-z0-9_-]{43}$/);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["vam071_revoke_renewal_invite", "vam071_create_renewal_invite"]);
  });

  it("regenerate reports partial failure when revoke succeeds but replacement create fails", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "vam071_revoke_renewal_invite"
        ? { data: [{ outcome_status: "revoked" }], error: null }
        : { data: null, error: { code: "CREATE_FAILED" } }
    );
    const from = vi.fn(() => query({ data: { id: IDS.invite, person_id: IDS.person, program_id: IDS.program, season_id: IDS.season, role: "mentor", submitted_at: null } }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await regenerateRenewalInvite(
      { actorAdminUserId: "admin-1", inviteId: IDS.invite, expiresAt: "2026-09-01T00:00:00.000Z" },
      { from, rpc } as any
    );
    expect(result).toMatchObject({ ok: false, outcome: "old_invite_revoked_new_invite_failed" });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["vam071_revoke_renewal_invite", "vam071_create_renewal_invite"]);
  });

  it("derives every invite status displayed by the admin console", () => {
    const base = { expires_at: "2026-09-01T00:00:00.000Z", revoked_at: null, outcome: null };
    const now = Date.parse("2026-08-17T00:00:00.000Z");
    expect(renewalInviteState(base, now)).toBe("live");
    expect(renewalInviteState({ ...base, expires_at: "2026-08-01T00:00:00.000Z" }, now)).toBe("expired");
    expect(renewalInviteState({ ...base, revoked_at: "2026-08-16T00:00:00.000Z" }, now)).toBe("revoked");
    expect(renewalInviteState({ ...base, outcome: "accepted" }, now)).toBe("accepted");
    expect(renewalInviteState({ ...base, outcome: "declined" }, now)).toBe("declined");
  });

  it("stale profile confirmation refusal stops before membership and approval writes", async () => {
    const inviteRow = { ...invite(mintRenewalInviteToken().token), submitted_at: "2026-08-17T00:00:00.000Z", outcome: "accepted", application_id: IDS.application };
    const application = { id: IDS.application, person_id: IDS.person, season_id: IDS.season, role_applied: "mentor", status: "submitted", source: "s12_mentor_renewal", full_name: "Mentor", email_primary: "m@example.com", phone_primary: null, gender: null, intake_batch_id: null, raw_payload: { renewal: { company_current: "New Co" } } };
    const person = { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: null };
    const profile = { id: IDS.profile, person_id: IDS.person, mentor_code: "M01", company_current: "Old Co", title_current: null, years_experience_min: null, years_experience_text: null, capacity_target: null, industry: null, function_area: null, first_vam_season: "S11", prior_vam_involvement: null };
    const from = vi.fn((table: string) => query({ data: table === "person_season_invites" ? inviteRow : table === "applications" ? application : table === "people" ? person : table === "mentor_profiles" ? profile : null }));
    const rpc = vi.fn(async (name: string) => name === "vam071_confirm_renewal_profile" ? { data: null, error: { code: "40001" } } : { data: [], error: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await confirmRenewalAndApprove({
      applicationId: IDS.application,
      actorAdminUserId: "admin-1",
      actorName: "Admin",
      reviewed: {
        applicationId: IDS.application,
        expectedProfile: { company_current: "Old Co" },
        profileUpdate: { company_current: "New Co" },
        diff: [{ field: "company_current", before: "Old Co", after: "New Co" }]
      }
    }, { from, rpc } as any);
    expect(result).toMatchObject({ ok: false, outcome: "profile_confirmation_refused" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("vam071_confirm_renewal_profile", expect.objectContaining({
      p_expected_profile: { company_current: "Old Co" },
      p_profile_update: { company_current: "New Co" }
    }));
    expect(from).not.toHaveBeenCalledWith("person_season_memberships");
  });

  it("tampered confirmation intent is rejected before confirm, membership, or approval", async () => {
    const minted = mintRenewalInviteToken();
    const inviteRow = { ...invite(minted.token), submitted_at: "2026-08-17T00:00:00.000Z", outcome: "accepted", application_id: IDS.application };
    const application = { id: IDS.application, person_id: IDS.person, season_id: IDS.season, role_applied: "mentor", status: "submitted", source: "s12_mentor_renewal", full_name: "Mentor", email_primary: "m@example.com", phone_primary: null, gender: null, intake_batch_id: null, raw_payload: { renewal: { company_current: "New Co" } } };
    const person = { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: null };
    const profile = { id: IDS.profile, person_id: IDS.person, mentor_code: "M01", company_current: "Old Co", title_current: null, years_experience_min: null, years_experience_text: null, capacity_target: null, industry: null, function_area: null, first_vam_season: "S11" };
    const from = vi.fn((table: string) => query({ data: table === "person_season_invites" ? inviteRow : table === "applications" ? application : table === "people" ? person : table === "mentor_profiles" ? profile : null }));
    const rpc = vi.fn();
    const result = await confirmRenewalAndApprove({
      applicationId: IDS.application,
      actorAdminUserId: "admin-1",
      actorName: "Admin",
      reviewed: {
        applicationId: IDS.application,
        expectedProfile: { company_current: "Old Co" },
        profileUpdate: { company_current: "Attacker Co" },
        diff: [{ field: "company_current", before: "Old Co", after: "Attacker Co" }]
      }
    }, { from, rpc } as any);
    expect(result).toMatchObject({ ok: false, outcome: "confirmation_intent_invalid" });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("person_season_memberships");
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("partial failure after confirm stops when membership reconciliation fails", async () => {
    const minted = mintRenewalInviteToken();
    const inviteRow = { ...invite(minted.token), submitted_at: "2026-08-17T00:00:00.000Z", outcome: "accepted", application_id: IDS.application };
    const application = { id: IDS.application, person_id: IDS.person, season_id: IDS.season, role_applied: "mentor", status: "submitted", source: "s12_mentor_renewal", full_name: "Mentor", email_primary: "m@example.com", phone_primary: null, gender: null, intake_batch_id: null, raw_payload: { renewal: {} } };
    const person = { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: null };
    const profile = { id: IDS.profile, person_id: IDS.person, mentor_code: "M01", company_current: "Same", title_current: null, years_experience_min: null, years_experience_text: null, capacity_target: null, industry: null, function_area: null, first_vam_season: "S11" };
    const from = vi.fn((table: string) => query({ data: table === "person_season_invites" ? inviteRow : table === "applications" ? application : table === "people" ? person : table === "mentor_profiles" ? profile : table === "person_season_memberships" ? { id: IDS.membership, status: "paused" } : null }));
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "noop" }], error: null }));
    const result = await confirmRenewalAndApprove({
      applicationId: IDS.application,
      actorAdminUserId: "admin-1",
      actorName: "Admin",
      reviewed: { applicationId: IDS.application, expectedProfile: {}, profileUpdate: {}, diff: [] }
    }, { from, rpc } as any);
    expect(result).toMatchObject({ ok: false, outcome: "profile_confirmed_membership_refused" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("partial failure reports confirm+membership success followed by approval failure", async () => {
    const minted = mintRenewalInviteToken();
    const inviteRow = { ...invite(minted.token), submitted_at: "2026-08-17T00:00:00.000Z", outcome: "accepted", application_id: IDS.application };
    const application = { id: IDS.application, person_id: IDS.person, season_id: IDS.season, role_applied: "mentor", status: "submitted", source: "s12_mentor_renewal", full_name: "Mentor", email_primary: "m@example.com", phone_primary: null, gender: null, intake_batch_id: null, raw_payload: { renewal: {} } };
    const person = { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: null };
    const profile = { id: IDS.profile, person_id: IDS.person, mentor_code: "M01", company_current: "Same", title_current: null, years_experience_min: null, years_experience_text: null, capacity_target: null, industry: null, function_area: null, first_vam_season: "S11" };
    const from = vi.fn((table: string) => query({ data: table === "person_season_invites" ? inviteRow : table === "applications" ? application : table === "people" ? person : table === "mentor_profiles" ? profile : table === "person_season_memberships" ? { id: IDS.membership, status: "active" } : null }));
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "noop" }], error: null }));
    (approveApplication as Mock).mockResolvedValue({ ok: false, message: "approval refused" });
    const result = await confirmRenewalAndApprove({
      applicationId: IDS.application,
      actorAdminUserId: "admin-1",
      actorName: "Admin",
      reviewed: { applicationId: IDS.application, expectedProfile: {}, profileUpdate: {}, diff: [] }
    }, { from, rpc } as any);
    expect(result).toMatchObject({ ok: false, outcome: "profile_and_membership_confirmed_approval_failed" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(approveApplication).toHaveBeenCalledOnce();
  });

  it("retry after approval converges without a second approval mutation", async () => {
    const minted = mintRenewalInviteToken();
    const inviteRow = { ...invite(minted.token), submitted_at: "2026-08-17T00:00:00.000Z", outcome: "accepted", application_id: IDS.application };
    const application = { id: IDS.application, person_id: IDS.person, season_id: IDS.season, role_applied: "mentor", status: "approved_as_mentor", source: "s12_mentor_renewal", full_name: "Mentor", email_primary: "m@example.com", phone_primary: null, gender: null, intake_batch_id: null, raw_payload: { renewal: {} } };
    const person = { id: IDS.person, full_name: "Mentor", email_primary: "m@example.com", phone_primary: null };
    const profile = { id: IDS.profile, person_id: IDS.person, mentor_code: "M01", company_current: "Same", title_current: null, years_experience_min: null, years_experience_text: null, capacity_target: null, industry: null, function_area: null, first_vam_season: "S11" };
    const from = vi.fn((table: string) => query({ data: table === "person_season_invites" ? inviteRow : table === "applications" ? application : table === "people" ? person : table === "mentor_profiles" ? profile : table === "person_season_memberships" ? { id: IDS.membership, status: "active" } : null }));
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: "noop" }], error: null }));
    const result = await confirmRenewalAndApprove({
      applicationId: IDS.application,
      actorAdminUserId: "admin-1",
      actorName: "Admin",
      reviewed: { applicationId: IDS.application, expectedProfile: {}, profileUpdate: {}, diff: [] }
    }, { from, rpc } as any);
    expect(result).toMatchObject({ ok: true, outcome: "renewal_already_complete" });
    expect(from.mock.calls.map((call) => call[0])).not.toContain("admin_audit_log");
    expect(from).not.toHaveBeenCalledWith("person_season_memberships");
    expect(rpc).not.toHaveBeenCalled();
    expect(approveApplication).not.toHaveBeenCalled();
  });
});
