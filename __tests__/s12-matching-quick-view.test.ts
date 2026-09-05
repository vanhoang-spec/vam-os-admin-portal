/**
 * S12 matching quick view — behavioural tests for the server gate and shaping.
 *
 * Every test calls the real `getMatchingQuickView` body against an in-memory
 * PostgREST fake and asserts on the value returned. The fake honours projection,
 * so a column the production code forgets to select is absent from the response
 * exactly as PostgREST would leave it.
 *
 * The access cases are the point: this loader reads application answers, so a
 * crafted request naming another season, an unapproved person or the wrong role
 * must come back refused with nothing read.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: unknown) => fn };
});
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateAnyScope: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  canAccessSeason,
  canOperateAnyScope,
  getAdminScopeContext,
  getAllowedSeasonIds
} from "@/lib/program-scope";
import { getMatchingQuickView } from "@/lib/matching-quick-view";
import {
  buildQuickView,
  isQuickViewExcludedKey,
  pickQuickViewApplication,
  applicantPayload
} from "@/lib/matching-quick-view-core";
import type { Application } from "@/lib/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const S12 = "00000000-0000-4000-8000-000000000001";
const S11 = "00000000-0000-4000-8000-000000000002";
const B1 = "00000000-0000-4000-8000-000000000011";
const B_OLD = "00000000-0000-4000-8000-000000000012";

const P_RENEWAL = "00000000-0000-4000-8000-000000000101";
const P_FORM_MENTOR = "00000000-0000-4000-8000-000000000102";
const P_UNAPPROVED = "00000000-0000-4000-8000-000000000103";
const P_OTHER_SEASON = "00000000-0000-4000-8000-000000000104";
const P_MENTEE = "00000000-0000-4000-8000-000000000201";

type Row = Record<string, any>;

const db: Record<string, Row[]> = {
  intake_batches: [],
  applications: [],
  mentor_profiles: [],
  mentee_profiles: [],
  people: [],
  application_answers: [],
  matches: []
};

let recorded: Array<{ table: string; columns: string }> = [];

function makeClient() {
  return {
    from: vi.fn((table: string) => {
      let projection: string[] = [];
      let headCount = false;
      const preds: Array<(r: Row) => boolean> = [];

      const project = (row: Row) => {
        if (!projection.length || projection.includes("*")) return { ...row };
        const out: Row = {};
        for (const col of projection) {
          if (Object.prototype.hasOwnProperty.call(row, col)) out[col] = row[col];
        }
        return out;
      };
      const matching = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)));

      const run = async () => {
        if (headCount) return { data: null, error: null, count: matching().length };
        return { data: matching().map(project), error: null };
      };

      const q: Row = {
        select: vi.fn((cols?: string, opts?: { head?: boolean }) => {
          recorded.push({ table, columns: String(cols ?? "*") });
          projection = String(cols ?? "*").split(",").map((c) => c.trim()).filter(Boolean);
          if (opts?.head) headCount = true;
          return q;
        }),
        eq: vi.fn((col: string, val: unknown) => {
          preds.push((r) => r[col] === val);
          return q;
        }),
        in: vi.fn((col: string, vals: unknown[]) => {
          const set = new Set(vals);
          preds.push((r) => set.has(r[col]));
          return q;
        }),
        limit: vi.fn(() => q),
        order: vi.fn(() => q),
        maybeSingle: async () => {
          const rows = matching().map(project);
          return { data: rows.length ? rows[0] : null, error: null };
        }
      };
      q.then = (res: unknown, rej: unknown) => run().then(res as never, rej as never);
      return q;
    })
  };
}

function seed() {
  db.intake_batches = [
    { id: B1, season_id: S12 },
    { id: B_OLD, season_id: S11 }
  ];
  db.applications = [
    {
      id: "app-renewal",
      person_id: P_RENEWAL,
      season_id: S12,
      status: "approved_as_mentor",
      role_applied: "mentor",
      full_name: "Renewal Mentor",
      source: "s12_mentor_renewal",
      intake_batch_id: null,
      submitted_at: "2026-08-01T00:00:00Z",
      raw_payload: {
        invite_token: "SECRET",
        renewal: {
          mentoring_topics: "Career pivot; leadership",
          sme_mentoring_experience: "3 mùa VAM",
          phone_primary: "0900000000",
          email_primary: "renewal@x.vn",
          consent_data_storage: true
        }
      }
    },
    {
      id: "app-form",
      person_id: P_FORM_MENTOR,
      season_id: S12,
      status: "approved_as_mentor",
      role_applied: "mentor",
      full_name: "Form Mentor",
      source: "vam_os_form",
      intake_batch_id: B1,
      submitted_at: "2026-08-02T00:00:00Z",
      raw_payload: {
        mentoring_topics: "Data",
        motivation_text: "Muốn đồng hành",
        phone_primary: "0911111111",
        social_contact: "fb.com/x"
      }
    },
    {
      id: "app-other-season",
      person_id: P_OTHER_SEASON,
      season_id: S11,
      status: "approved_as_mentor",
      role_applied: "mentor",
      full_name: "Other Season",
      source: "vam_os_form",
      submitted_at: "2025-08-01T00:00:00Z",
      raw_payload: { mentoring_topics: "Should not be visible" }
    },
    {
      id: "app-unapproved",
      person_id: P_UNAPPROVED,
      season_id: S12,
      status: "interview_passed",
      role_applied: "mentor",
      full_name: "Unapproved",
      source: "vam_os_form",
      submitted_at: "2026-08-03T00:00:00Z",
      raw_payload: { mentoring_topics: "Should not be visible" }
    },
    {
      id: "app-mentee",
      person_id: P_MENTEE,
      season_id: S12,
      status: "approved_as_mentee",
      role_applied: "mentee",
      full_name: "Approved Mentee",
      source: "vam_os_form",
      intake_batch_id: B1,
      submitted_at: "2026-08-04T00:00:00Z",
      raw_payload: {
        mentoring_goals_text: "Định hướng nghề nghiệp",
        target_industry: "Tài chính",
        phone_primary: "0922222222"
      }
    }
  ];
  db.mentor_profiles = [
    { id: "mp-renewal", person_id: P_RENEWAL, company_current: "Acme", title_current: "Lead", industry: "Tech", function_area: "Eng", years_experience_text: "10", years_experience_min: 10, first_vam_season: "S9", intake_batch_id: B_OLD, capacity_target: 1 },
    { id: "mp-form", person_id: P_FORM_MENTOR, company_current: "Beta", title_current: "PM", industry: "Fin", function_area: "PM", years_experience_text: "7", years_experience_min: 7, first_vam_season: "S12", intake_batch_id: B1, capacity_target: 2 },
    { id: "mp-unapproved", person_id: P_UNAPPROVED, company_current: "Gamma", title_current: "Dev", intake_batch_id: B1, capacity_target: 3 },
    { id: "mp-other", person_id: P_OTHER_SEASON, company_current: "Delta", title_current: "Head", intake_batch_id: B_OLD, capacity_target: 3 }
  ];
  db.mentee_profiles = [
    { id: "ep-1", person_id: P_MENTEE, school_code: "UEH", school_raw: "UEH", major: "Finance", class_cohort: "K47", intake_batch_id: B1 }
  ];
  db.people = [
    { id: P_RENEWAL, full_name: "Renewal Mentor" },
    { id: P_FORM_MENTOR, full_name: "Form Mentor" },
    { id: P_UNAPPROVED, full_name: "Unapproved" },
    { id: P_OTHER_SEASON, full_name: "Other Season" },
    { id: P_MENTEE, full_name: "Approved Mentee" }
  ];
  db.application_answers = [];
  db.matches = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded = [];
  seed();
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "core_team" });
  (getAdminScopeContext as Mock).mockResolvedValue({ scope: "all" });
  (canOperateAnyScope as Mock).mockReturnValue(true);
  (getAllowedSeasonIds as Mock).mockResolvedValue([S12, S11]);
  (canAccessSeason as Mock).mockReturnValue(true);
});

const load = (personId: string, role: "mentor" | "mentee", intakeBatchId = B1) =>
  getMatchingQuickView({ personId, role, intakeBatchId });

// ═══════════════════════════════════════════════════════════════════════════
// A / B / C — the happy paths
// ═══════════════════════════════════════════════════════════════════════════

describe("quick view loads the approved application for the selected season", () => {
  it("A · mentor quick view loads the approved S12 mentor application", async () => {
    const result = await load(P_FORM_MENTOR, "mentor");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe("mentor");
    expect(result.data.fullName).toBe("Form Mentor");
    expect(result.data.answers.some((a) => a.value.includes("Data"))).toBe(true);
    expect(result.data.summary.some((r) => r.value === "Beta")).toBe(true);
  });

  it("B · renewal mentor with NULL application batch and an older profile batch still loads", async () => {
    const result = await load(P_RENEWAL, "mentor");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The applicant's own answers live under raw_payload.renewal.
    expect(result.data.answers.some((a) => a.value.includes("Career pivot"))).toBe(true);
    expect(result.data.summary.some((r) => r.value === "Acme")).toBe(true);
  });

  it("B · the renewal envelope's own plumbing is never rendered", async () => {
    const result = await load(P_RENEWAL, "mentor");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const blob = JSON.stringify(result.data);
    expect(blob).not.toContain("SECRET");
    expect(blob).not.toContain("invite_token");
  });

  it("C · mentee quick view loads the approved S12 mentee application", async () => {
    const result = await load(P_MENTEE, "mentee");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe("mentee");
    expect(result.data.answers.some((a) => a.value.includes("Định hướng"))).toBe(true);
    expect(result.data.summary.some((r) => r.label === "Trường")).toBe(true);
  });

  it("shows the mentor's capacity against their current load", async () => {
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "x", status: "active" }
    ];
    const result = await load(P_FORM_MENTOR, "mentor");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary.some((r) => r.value === "1/2")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D / E / F / G / H — the access boundary
// ═══════════════════════════════════════════════════════════════════════════

describe("access boundary", () => {
  it("D · an unapproved person is refused", async () => {
    const result = await load(P_UNAPPROVED, "mentor");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/duyệt/i);
  });

  it("E · approval in another season only is refused for this season", async () => {
    const result = await load(P_OTHER_SEASON, "mentor");
    expect(result.ok).toBe(false);
  });

  it("E · and the other season's answers are never returned", async () => {
    const result = await load(P_OTHER_SEASON, "mentor");
    expect(JSON.stringify(result)).not.toContain("Should not be visible");
  });

  it("F · asking for the wrong role is refused", async () => {
    // An approved mentor requested as a mentee, and vice versa.
    expect((await load(P_FORM_MENTOR, "mentee")).ok).toBe(false);
    expect((await load(P_MENTEE, "mentor")).ok).toBe(false);
  });

  it("F · an unrecognised role value is refused", async () => {
    const result = await getMatchingQuickView({ personId: P_FORM_MENTOR, role: "admin", intakeBatchId: B1 });
    expect(result.ok).toBe(false);
  });

  it("G · a recruitment helper (reviewer) cannot call the loader", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "helper", role: "reviewer" });
    const result = await load(P_FORM_MENTOR, "mentor");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/quyền/i);
  });

  it("G · viewer and support_team cannot call the loader either", async () => {
    for (const role of ["viewer", "support_team"]) {
      (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", role });
      expect((await load(P_FORM_MENTOR, "mentor")).ok).toBe(false);
    }
  });

  it("G · an unauthenticated caller is refused", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    expect((await load(P_FORM_MENTOR, "mentor")).ok).toBe(false);
  });

  it("H · a matching operator outside the batch's season scope is refused", async () => {
    (canAccessSeason as Mock).mockReturnValue(false);
    expect((await load(P_FORM_MENTOR, "mentor")).ok).toBe(false);
  });

  it("H · an operator with no operations scope at all is refused", async () => {
    (canOperateAnyScope as Mock).mockReturnValue(false);
    expect((await load(P_FORM_MENTOR, "mentor")).ok).toBe(false);
  });

  it("H · core_team, admin and super_admin with season scope succeed", async () => {
    for (const role of ["core_team", "admin", "super_admin"]) {
      (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", role });
      expect((await load(P_FORM_MENTOR, "mentor")).ok).toBe(true);
    }
  });

  it("refuses a malformed person id before any read", async () => {
    const result = await load("not-a-uuid", "mentor");
    expect(result.ok).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  it("takes no application id from the caller at all", async () => {
    // The application is FOUND from (person, season, role). Passing an id is
    // simply ignored, so there is no "read any application by id" path.
    const result = await getMatchingQuickView({
      personId: P_UNAPPROVED,
      role: "mentor",
      intakeBatchId: B1,
      // @ts-expect-error deliberately passing a field the contract does not accept
      applicationId: "app-form"
    });
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I / M — no preloading, no contact
// ═══════════════════════════════════════════════════════════════════════════

describe("payload discipline", () => {
  it("I · reads exactly one person's records, never the candidate pool", async () => {
    await load(P_FORM_MENTOR, "mentor");

    const appReads = recorded.filter((r) => r.table === "applications");
    const answerReads = recorded.filter((r) => r.table === "application_answers");
    expect(appReads).toHaveLength(1);
    expect(answerReads).toHaveLength(1);
    // Nothing walked the pool: no unfiltered profile listing.
    expect(recorded.filter((r) => r.table === "mentor_profiles")).toHaveLength(1);
  });

  it("M · no contact field reaches the payload", async () => {
    const mentor = await load(P_FORM_MENTOR, "mentor");
    const mentee = await load(P_MENTEE, "mentee");
    const blob = JSON.stringify([mentor, mentee]);

    expect(blob).not.toContain("0911111111");
    expect(blob).not.toContain("0922222222");
    expect(blob).not.toContain("fb.com/x");
    expect(blob).not.toContain("renewal@x.vn");
  });

  it("M · the exclusion is by key, so a newly added contact field is blocked by default", () => {
    for (const key of [
      "phone_primary", "phone_secondary", "email_primary", "social_contact",
      "linkedin_url", "mentor_phone_2", "contactEmail", "zalo_number"
    ]) {
      expect(isQuickViewExcludedKey(key)).toBe(true);
    }
  });

  it("M · substantive matching answers are NOT excluded", () => {
    for (const key of [
      "mentoring_topics", "mentoring_goals_text", "target_industry",
      "sme_mentoring_experience", "bio_or_cv_url", "current_difficulty_text"
    ]) {
      expect(isQuickViewExcludedKey(key)).toBe(false);
    }
  });

  it("drops consent and acknowledgement boilerplate", async () => {
    const result = await load(P_RENEWAL, "mentor");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.answers.some((a) => a.key === "consent_data_storage")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic selection + shaping
// ═══════════════════════════════════════════════════════════════════════════

describe("deterministic application choice", () => {
  it("picks the most recently submitted approved application", () => {
    const rows = [
      { id: "b", submitted_at: "2026-01-01T00:00:00Z" },
      { id: "a", submitted_at: "2026-06-01T00:00:00Z" },
      { id: "c", submitted_at: "2025-01-01T00:00:00Z" }
    ];
    expect(pickQuickViewApplication(rows)?.id).toBe("a");
    // Stable regardless of arrival order.
    expect(pickQuickViewApplication([...rows].reverse())?.id).toBe("a");
  });

  it("breaks a tie on id and sorts undated rows last", () => {
    expect(
      pickQuickViewApplication([
        { id: "z", submitted_at: "2026-01-01T00:00:00Z" },
        { id: "a", submitted_at: "2026-01-01T00:00:00Z" }
      ])?.id
    ).toBe("a");
    expect(
      pickQuickViewApplication([
        { id: "undated", submitted_at: null },
        { id: "dated", submitted_at: "2020-01-01T00:00:00Z" }
      ])?.id
    ).toBe("dated");
  });

  it("returns null for an empty set", () => {
    expect(pickQuickViewApplication([])).toBeNull();
  });
});

describe("shaping", () => {
  it("orders matching-relevant answers before the rest", () => {
    const payload = buildQuickView({
      role: "mentee",
      person: null,
      application: {
        id: "a1",
        full_name: "M",
        source: "vam_os_form",
        raw_payload: {
          additional_notes: "cuối",
          mentoring_goals_text: "đầu"
        }
      } as unknown as Application
    });
    expect(payload.answers[0].value).toBe("đầu");
  });

  it("unwraps a renewal payload and leaves an ordinary one alone", () => {
    expect(
      applicantPayload({ source: "s12_mentor_renewal", raw_payload: { renewal: { a: 1 } } } as unknown as Application)
    ).toEqual({ a: 1 });
    expect(
      applicantPayload({ source: "vam_os_form", raw_payload: { a: 1 } } as unknown as Application)
    ).toEqual({ a: 1 });
  });

  it("reports an empty application honestly rather than rendering a blank panel", () => {
    const payload = buildQuickView({
      role: "mentee",
      person: null,
      application: { id: "a1", full_name: "M", source: "vam_os_form", raw_payload: {} } as unknown as Application
    });
    expect(payload.empty).toBe(true);
  });

  it("renders legacy application_answers when raw_payload is absent", () => {
    const payload = buildQuickView({
      role: "mentee",
      person: null,
      application: { id: "a1", full_name: "M", source: "vam_os_form", raw_payload: null } as unknown as Application,
      legacyAnswers: [
        { question_key: "goal_main", question_label: "Mục tiêu chính", value_text: "Học hỏi" },
        { question_key: "phone_primary", question_label: "SĐT", value_text: "09999" }
      ]
    });
    expect(payload.answers).toHaveLength(1);
    expect(payload.answers[0].label).toBe("Mục tiêu chính");
  });
});
