/**
 * S12 final UAT blockers — authoritative server-side contract.
 *
 * Browser validation is never sufficient: these rules must hold for a crafted
 * POST with JavaScript disabled or bypassed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  enforceOtherDetails,
  isValidApplicationPhone,
  validateMaxThreeWithOther,
  MENTEE_OTHER_DETAIL_RULES,
  MENTOR_OTHER_DETAIL_RULES,
  type OtherDetailRule
} from "../lib/application-form-validation";
import { SEASON_CONFIG } from "../lib/season-config";

const MENTOR_FORM = "app/apply/mentor/apply-mentor-form.tsx";
const MENTEE_FORM = "app/apply/mentee/apply-mentee-form.tsx";
const APPLY_ACTION = "app/actions/apply.ts";
const read = (p: string) => readFileSync(p, "utf8");

/** Mirrors how the server trims a submitted text field before validating it. */
const formText = (v: unknown) => String(v ?? "").trim();

describe("S12 UAT — phone: exactly 10 ASCII digits, server-side", () => {
  it.each([
    ["0123456789", true],
    ["0901234567", true],
    ["012345678", false],
    ["01234567890", false],
    ["01234abc89", false],
    ["0123 456789", false],
    ["", false],
    ["٠١٢٣٤٥٦٧٨٩", false]
  ])("%s -> %s", (input, expected) => {
    expect(isValidApplicationPhone(formText(input))).toBe(expected);
  });

  it("rejects a pasted 11-digit number outright instead of accepting a truncation of it", () => {
    const pasted = "09012345678";
    expect(isValidApplicationPhone(pasted)).toBe(false);
    // The truncation the old maxLength produced would have been accepted, which is
    // exactly the silent-wrong-number failure this guards against.
    expect(isValidApplicationPhone(pasted.slice(0, 10))).toBe(true);
    expect(pasted.slice(0, 10)).not.toBe(pasted);
  });

  it("preserves the leading zero and never coerces to a number", () => {
    const value = formText("0123456789");
    expect(value).toBe("0123456789");
    expect(typeof value).toBe("string");
    expect(String(Number(value))).not.toBe(value);
  });
});

describe("S12 UAT — every applicable Other detail is enforced server-side", () => {
  const REQUIRED_MENTOR_PARENTS = [
    "gender",
    "industry_primary",
    "function_primary",
    "highest_degree",
    "activities_willing_to_support",
    "referrer_or_source",
    "secondary_industries_functions"
  ];
  const REQUIRED_MENTEE_PARENTS = [
    "gender",
    "university",
    "school_or_faculty",
    "target_industry",
    "target_function",
    "target_soft_skills",
    "training_topics_interest",
    "referrer_or_source"
  ];

  it("covers exactly the reviewed mentor fields", () => {
    expect(MENTOR_OTHER_DETAIL_RULES.map((r) => r.parentKey).sort()).toEqual([...REQUIRED_MENTOR_PARENTS].sort());
  });

  it("covers exactly the reviewed mentee fields", () => {
    expect(MENTEE_OTHER_DETAIL_RULES.map((r) => r.parentKey).sort()).toEqual([...REQUIRED_MENTEE_PARENTS].sort());
  });

  it("names every detail key as <parent>_other", () => {
    for (const rule of [...MENTOR_OTHER_DETAIL_RULES, ...MENTEE_OTHER_DETAIL_RULES]) {
      expect(rule.detailKey).toBe(`${rule.parentKey}_other`);
    }
  });

  it("uses the uppercase OTHER trigger for the mentee university list", () => {
    const rule = MENTEE_OTHER_DETAIL_RULES.find((r) => r.parentKey === "university");
    expect(rule?.triggerValue).toBe("OTHER");
    // and that trigger is the value the form actually renders
    expect(read(MENTEE_FORM)).toContain('{ value: "OTHER", label: "Trường khác" }');
  });

  const allRules: Array<[string, string, OtherDetailRule]> = [
    ...MENTOR_OTHER_DETAIL_RULES.map((r) => ["mentor", r.detailKey, r] as [string, string, OtherDetailRule]),
    ...MENTEE_OTHER_DETAIL_RULES.map((r) => ["mentee", r.detailKey, r] as [string, string, OtherDetailRule])
  ];

  describe.each(allRules)("%s %s", (_role, _key, rule) => {
    const trigger = rule.triggerValue ?? "other";
    const rules = [rule];

    // Both shapes are exercised: single-select parents submit a string, checkbox
    // groups submit an array.
    it.each([
      ["string parent", trigger as unknown],
      ["array parent", [trigger] as unknown]
    ])("rejects a blank detail (%s)", (_shape, parent) => {
      const payload: Record<string, unknown> = { [rule.detailKey]: "" };
      const result = enforceOtherDetails({ [rule.parentKey]: parent }, payload, rules);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldName).toBe(rule.detailKey);
    });

    it("rejects a whitespace-only detail", () => {
      const payload: Record<string, unknown> = { [rule.detailKey]: "   \t  " };
      const result = enforceOtherDetails({ [rule.parentKey]: trigger }, payload, rules);
      expect(result.ok).toBe(false);
    });

    it("rejects a missing detail key entirely", () => {
      const payload: Record<string, unknown> = {};
      const result = enforceOtherDetails({ [rule.parentKey]: trigger }, payload, rules);
      expect(result.ok).toBe(false);
    });

    it("accepts and persists a real detail, trimmed", () => {
      const payload: Record<string, unknown> = { [rule.detailKey]: "  Nội dung khác  " };
      const result = enforceOtherDetails({ [rule.parentKey]: trigger }, payload, rules);
      expect(result.ok).toBe(true);
      expect(payload[rule.detailKey]).toBe("Nội dung khác");
    });

    it("does not require a detail when Other is not selected", () => {
      const payload: Record<string, unknown> = { [rule.detailKey]: "" };
      const result = enforceOtherDetails({ [rule.parentKey]: "something_else" }, payload, rules);
      expect(result.ok).toBe(true);
    });

    it("drops stale or forged detail text when Other is not selected", () => {
      const payload: Record<string, unknown> = { [rule.detailKey]: "forged leftover" };
      const result = enforceOtherDetails({ [rule.parentKey]: "something_else" }, payload, rules);
      expect(result.ok).toBe(true);
      expect(payload[rule.detailKey]).toBeNull();
    });
  });

  it("reports the first offending field so the UI can focus it", () => {
    const payload: Record<string, unknown> = { gender_other: "", industry_primary_other: "" };
    const result = enforceOtherDetails(
      { gender: "other", industry_primary: "other" },
      payload,
      MENTOR_OTHER_DETAIL_RULES
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldName).toBe("gender_other");
  });

  it("leaves a fully valid mentor payload untouched", () => {
    const payload: Record<string, unknown> = { gender_other: "Không muốn nêu", referrer_or_source_other: "Bạn bè" };
    const result = enforceOtherDetails(
      { gender: "other", referrer_or_source: "other", industry_primary: "TECH" },
      payload,
      MENTOR_OTHER_DETAIL_RULES
    );
    expect(result.ok).toBe(true);
    expect(payload.gender_other).toBe("Không muốn nêu");
    expect(payload.referrer_or_source_other).toBe("Bạn bè");
  });

  it("is wired into both server actions", () => {
    const source = read(APPLY_ACTION);
    expect(source).toContain("MENTOR_OTHER_DETAIL_RULES");
    expect(source).toContain("MENTEE_OTHER_DETAIL_RULES");
    expect(source.match(/enforceOtherDetails\(/g)?.length).toBe(2);
    // gender is a top-level column, so it must be merged in for the lookup
    expect(source).toContain("{ ...rawPayload, gender }");
  });
});

describe("S12 UAT — maximum 3, Other counts as one", () => {
  const call = (values: string[], otherText = "") =>
    validateMaxThreeWithOther({ values, otherText, fieldName: "target_soft_skills", fieldLabel: "Soft skills" });

  it("accepts A+B+C", () => expect(call(["a", "b", "c"]).ok).toBe(true));
  it("accepts A+B+Other with a detail", () => expect(call(["a", "b", "other"], "Đàm phán").ok).toBe(true));
  it("rejects A+B+C+Other even with a detail", () => expect(call(["a", "b", "c", "other"], "Đàm phán").ok).toBe(false));
  it("rejects A+B+Other with a blank detail", () => expect(call(["a", "b", "other"], "   ").ok).toBe(false));

  it("rejects a crafted over-length payload without truncating it", () => {
    const values = ["a", "b", "c", "d", "e"];
    const result = call(values);
    expect(result.ok).toBe(false);
    expect(values).toHaveLength(5); // caller's array is not mutated/truncated
  });

  it("guards both reviewed max-3 fields in the server actions", () => {
    const source = read(APPLY_ACTION);
    expect(source).toContain('fieldName: "secondary_industries_functions"');
    expect(source).toContain('fieldName: "target_soft_skills"');
  });
});

describe("S12 UAT — program selection and recruitment binding stay separate", () => {
  it("keeps UEHM selected by default in the mentor form", () => {
    expect(read(MENTOR_FORM)).toContain('defaultSelected={["UEHM"]}');
  });

  it("lists exactly the active programs and no FTU", () => {
    const source = read(MENTOR_FORM);
    const block = source.slice(source.indexOf("const PROGRAM_OPTIONS"));
    const options = block.slice(0, block.indexOf("];"));
    for (const code of ["UEHM", "HAM", "BK", "HUFLIT", "HUB", "DUE"]) {
      expect(options).toContain(`value: "${code}"`);
    }
    expect(options).not.toContain("FTU");
    expect(options).not.toContain('value: "other"');
  });

  it("has no FTU option anywhere in either public form", () => {
    expect(read(MENTOR_FORM)).not.toContain("FTU");
    expect(read(MENTEE_FORM)).not.toContain("FTU");
  });

  it("binds recruitment to UEHM-S12 / UEHM-S12-B1 from season config alone", () => {
    expect(SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).toBe("UEHM-S12");
    expect(SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE).toBe("UEHM-S12-B1");
    const source = read(APPLY_ACTION);
    expect(source).toContain("const SEASON_CODE = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE");
    expect(source).toContain("const INTAKE_BATCH_CODE = SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE");
    expect(source.match(/seasonCode: SEASON_CODE/g)?.length).toBe(2);
    expect(source.match(/intakeBatchCode: INTAKE_BATCH_CODE/g)?.length).toBe(2);
  });

  it("never lets the visible program preference reach the binding", () => {
    const source = read(APPLY_ACTION);
    for (const line of source.split("\n").filter((l) => l.includes("programs_willing_to_join"))) {
      expect(line).not.toContain("seasonCode");
      expect(line).not.toContain("intakeBatchCode");
    }
    // it reaches the DB only as a raw_payload entry, never as a binding argument
    const submitCalls = source.split("submitPilotApplication({").slice(1);
    expect(submitCalls).toHaveLength(2);
    for (const call of submitCalls) {
      const args = call.slice(0, call.indexOf("});"));
      expect(args).not.toContain("programs_willing_to_join");
      expect(args).toContain("seasonCode: SEASON_CODE");
      expect(args).toContain("intakeBatchCode: INTAKE_BATCH_CODE");
    }
  });
});
