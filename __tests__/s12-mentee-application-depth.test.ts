import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FORM = readFileSync("app/apply/mentee/apply-mentee-form.tsx", "utf8");
const ACTION = readFileSync("app/actions/apply.ts", "utf8");

function fieldBlock(source: string, name: string, radius = 450) {
  const marker = `name="${name}"`;
  const index = source.indexOf(marker);
  expect(index, `${name} must exist`).toBeGreaterThan(-1);
  return source.slice(Math.max(0, index - 120), index + radius);
}

describe("S12 mentee application depth contract", () => {
  const requiredNarratives = [
    "current_difficulty_text",
    "why_uem_text",
    "mentoring_plan_text",
    "if_not_effective_text"
  ];

  it.each(requiredNarratives)("makes %s required with a 100-character browser floor", (name) => {
    const block = fieldBlock(FORM, name);
    expect(block).toContain("required");
    expect(block).toContain("minLength={100}");
  });

  it("keeps all seven selection narratives server-enforced at their UI minimums", () => {
    for (const name of [
      "one_year_vision_text",
      "mentoring_goals_text",
      "top_3_questions_for_mentor",
      ...requiredNarratives
    ]) {
      expect(ACTION).toContain(`{ key: "${name}"`);
    }
    expect(ACTION).toContain("minLength: 50");
    expect(ACTION.match(/minLength: 100/g)?.length).toBeGreaterThanOrEqual(6);
    expect(ACTION).toContain("tooShortNarrative");
    expect(ACTION).toContain("fieldErrors: [{ name: tooShortNarrative.key, label: tooShortNarrative.label }]");
  });

  it.each(requiredNarratives)("includes %s in authoritative required-field validation", (name) => {
    expect(ACTION).toContain(`${name}: rawPayload.${name}`);
  });

  it("adds an optional profile/CV URL and persists it only in raw_payload", () => {
    const block = fieldBlock(FORM, "profile_or_cv_url");
    expect(block).toContain('type="url"');
    expect(ACTION).toContain('profile_or_cv_url: formText(formData, "profile_or_cv_url") || null');
    expect(ACTION.match(/profile_or_cv_url/g)?.length).toBe(2);
  });
});
