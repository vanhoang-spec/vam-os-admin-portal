import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildMentorProfileRefresh } from "@/lib/application-approvals";
import {
  RENEWAL_STRIPPED_PROFILE_FIELDS,
  buildRenewalProfileDiff,
  buildRenewalProfileRefresh,
  renewalProfileUpdateFromDiff
} from "@/lib/renewal-profile-safety";

const FULL_PAYLOAD = {
  company_current: "Acme Vietnam",
  title_current: "Head of Data",
  function_primary: "Data",
  industry_primary: "Technology",
  years_of_experience: "11-15",
  mentor_total_work_years: 13,
  mentoring_capacity_total: 2,
  first_vam_season: "UEHM-S12",
  prior_vam_involvement: "Mentor S11, panelist S10"
};

describe("first_vam_season is structurally unreachable through renewal", () => {
  it("the approval allowlist DOES emit it — which is why renewal needs its own strip", () => {
    // Stated as a test so the reason this module exists cannot be forgotten.
    // If this ever fails, buildMentorProfileRefresh changed and the strip below
    // may have become unnecessary — or may have become necessary for more.
    expect(buildMentorProfileRefresh(FULL_PAYLOAD)).toHaveProperty("first_vam_season");
  });

  it("the renewal payload never carries it, whatever the submission contains", () => {
    const variants: Array<Record<string, unknown>> = [
      FULL_PAYLOAD,
      { first_vam_season: "UEHM-S12" },
      { first_vam_season: "" },
      { first_vam_season: null },
      { first_vam_season: 12 },
      { FIRST_VAM_SEASON: "UEHM-S12" },
      { prior_vam_involvement: "rewritten history" },
      {}
    ];
    for (const payload of variants) {
      const patch = buildRenewalProfileRefresh(payload) as Record<string, unknown>;
      for (const field of RENEWAL_STRIPPED_PROFILE_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(patch, field)).toBe(false);
      }
    }
  });

  it("the renewal allowlist can never be wider than the reviewed approval allowlist", () => {
    const approval = Object.keys(buildMentorProfileRefresh(FULL_PAYLOAD));
    const renewal = Object.keys(buildRenewalProfileRefresh(FULL_PAYLOAD));
    for (const key of renewal) expect(approval).toContain(key);
    // …and it is strictly narrower, by exactly the lineage fields present.
    expect(renewal.length).toBe(approval.length - 1);
  });

  it("buildMentorProfileRefresh itself is untouched", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/application-approvals.ts"), "utf8");
    expect(source).toContain("const firstVamSeason = nonBlankText(payload.first_vam_season);");
    expect(source).toContain("if (firstVamSeason !== undefined) patch.first_vam_season = firstVamSeason;");
    const renewal = readFileSync(path.join(process.cwd(), "lib/renewal-profile-safety.ts"), "utf8");
    expect(renewal).toContain("buildMentorProfileRefresh");
    expect(renewal).not.toContain("export function buildMentorProfileRefresh");
  });
});

describe("delta semantics", () => {
  it("omitted preserves — the key is simply absent", () => {
    const patch = buildRenewalProfileRefresh({ company_current: "Acme" }) as Record<string, unknown>;
    expect(patch).toEqual({ company_current: "Acme" });
    expect("title_current" in patch).toBe(false);
  });

  it("blank preserves — it is never emitted as an update", () => {
    for (const blank of ["", "   ", "\t\n"]) {
      const patch = buildRenewalProfileRefresh({
        company_current: blank,
        title_current: blank,
        industry_primary: blank,
        function_primary: blank,
        years_of_experience: blank
      }) as Record<string, unknown>;
      expect(patch).toEqual({});
    }
  });

  it("an explicit clear is unrepresentable — no value in the patch is ever null", () => {
    const patch = buildRenewalProfileRefresh({
      company_current: null,
      title_current: undefined,
      industry_primary: "",
      mentoring_capacity_total: null,
      mentor_total_work_years: ""
    }) as Record<string, unknown>;
    expect(Object.values(patch)).not.toContain(null);
    expect(patch).toEqual({});
  });

  it("a valid changed value becomes a candidate update", () => {
    const patch = buildRenewalProfileRefresh({
      company_current: "  New Employer  ",
      mentoring_capacity_total: 3,
      mentor_total_work_years: 14
    }) as Record<string, unknown>;
    expect(patch).toEqual({
      company_current: "New Employer",
      capacity_target: 3,
      years_experience_min: 14
    });
  });

  it("rejects a negative or non-integer capacity rather than writing it", () => {
    expect(buildRenewalProfileRefresh({ mentoring_capacity_total: -1 })).toEqual({});
    expect(buildRenewalProfileRefresh({ mentoring_capacity_total: 2.5 })).toEqual({});
    expect(buildRenewalProfileRefresh({ mentor_total_work_years: "many" })).toEqual({});
  });
});

describe("admin field-level BEFORE / AFTER diff", () => {
  const current = {
    company_current: "Old Employer",
    title_current: "Head of Data",
    industry: "Technology",
    function_area: "Data",
    capacity_target: 2,
    first_vam_season: "UEHM-S11"
  };

  it("returns only genuinely changed fields", () => {
    const candidate = buildRenewalProfileRefresh({
      company_current: "Acme Vietnam",
      title_current: "Head of Data",
      mentoring_capacity_total: 3,
      first_vam_season: "UEHM-S12"
    });
    expect(buildRenewalProfileDiff(current, candidate)).toEqual([
      { field: "capacity_target", before: 2, after: 3 },
      { field: "company_current", before: "Old Employer", after: "Acme Vietnam" }
    ]);
  });

  it("a renewal that changes nothing produces an empty diff", () => {
    const candidate = buildRenewalProfileRefresh({
      company_current: "Old Employer",
      title_current: "  Head of Data  ",
      mentoring_capacity_total: 2
    });
    expect(buildRenewalProfileDiff(current, candidate)).toEqual([]);
  });

  it("never presents first_vam_season as an approvable change", () => {
    const candidate = buildRenewalProfileRefresh(FULL_PAYLOAD);
    const diff = buildRenewalProfileDiff(current, candidate);
    expect(diff.map((d) => d.field)).not.toContain("first_vam_season");
    // …and even if the strip were bypassed upstream, the diff refuses it.
    const smuggled = { ...candidate, first_vam_season: "UEHM-S12" } as never;
    expect(buildRenewalProfileDiff(current, smuggled).map((d) => d.field)).not.toContain(
      "first_vam_season"
    );
  });

  it("a first-time-populated field shows before=null, not a missing row", () => {
    const diff = buildRenewalProfileDiff({}, buildRenewalProfileRefresh({ company_current: "Acme" }));
    expect(diff).toEqual([{ field: "company_current", before: null, after: "Acme" }]);
  });

  it("the write set is exactly the diff — unchanged columns are not rewritten", () => {
    const candidate = buildRenewalProfileRefresh({
      company_current: "Acme Vietnam",
      title_current: "Head of Data",
      mentoring_capacity_total: 3
    });
    const diff = buildRenewalProfileDiff(current, candidate);
    expect(renewalProfileUpdateFromDiff(diff)).toEqual({
      capacity_target: 3,
      company_current: "Acme Vietnam"
    });
    expect(renewalProfileUpdateFromDiff([])).toEqual({});
  });

  it("the diff is deterministically ordered so two reviewers see the same screen", () => {
    const candidate = buildRenewalProfileRefresh(FULL_PAYLOAD);
    const fields = buildRenewalProfileDiff({}, candidate).map((d) => d.field);
    expect(fields).toEqual([...fields].sort());
  });
});

describe("module boundary", () => {
  it("is server-only and performs no database access", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/renewal-profile-safety.ts"), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const forbidden of [".from(", ".update(", ".insert(", ".rpc(", "getSupabaseServiceRoleClient"]) {
      expect(`${forbidden}:${code.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  it("the stripped-field list is frozen", () => {
    expect(Object.isFrozen(RENEWAL_STRIPPED_PROFILE_FIELDS)).toBe(true);
    expect([...RENEWAL_STRIPPED_PROFILE_FIELDS]).toEqual([
      "first_vam_season",
      "prior_vam_involvement"
    ]);
  });
});
