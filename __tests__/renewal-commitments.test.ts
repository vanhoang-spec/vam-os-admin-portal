import { describe, expect, it } from "vitest";

import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  requiredCheckboxAcknowledgements
} from "../lib/application-commitments";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh } from "../lib/renewal-profile-safety";
import { renewalPayloadFromFormData } from "../lib/renewal-runtime";

/**
 * Applies the canonical mentor commitments to a form.
 *
 * `skip` drops one key so a test can prove the effect of a single missing
 * commitment without ever naming the set. Nothing in this file restates which
 * commitments exist — that belongs to lib/application-commitments.ts, and a
 * test holding its own copy is exactly the drift M073 removed from the runtime
 * and the form.
 */
function withCanonicalCommitments(form: FormData, options: { skip?: string } = {}) {
  for (const entry of requiredCheckboxAcknowledgements("mentor")) {
    if (entry.key === options.skip) continue;
    form.append(entry.key, "true");
  }
  return form;
}

describe("Renewal Commitments & Mentee Capacity", () => {
  it("carries the submitted mentee capacity as a number", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    fd.append("mentoring_capacity_total", "1");
    withCanonicalCommitments(fd);
    fd.append(ACTIVE_READING_KEYS.mentor, CONFIRMATION_PHRASES.mentor);

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.mentoring_capacity_total).toBe(1);
    expect((payload.commitments as Record<string, unknown>)[`${ACTIVE_READING_KEYS.mentor}_matched`]).toBe(true);
    expect(payload.commitments_completed).toBe(true);
  });

  it("reports incomplete when any single canonical commitment is missing", () => {
    for (const missing of requiredCheckboxAcknowledgements("mentor")) {
      const fd = new FormData();
      fd.append("participation_confirmed", "yes");
      withCanonicalCommitments(fd, { skip: missing.key });
      fd.append(ACTIVE_READING_KEYS.mentor, CONFIRMATION_PHRASES.mentor);

      const payload = renewalPayloadFromFormData(fd);
      expect(`${missing.key}:${payload.commitments_completed}`).toBe(`${missing.key}:false`);
    }
  });

  it("acknowledgement exact phrase passes with whitespace trimmed", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    withCanonicalCommitments(fd);
    fd.append(ACTIVE_READING_KEYS.mentor, `   ${CONFIRMATION_PHRASES.mentor}   `);

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.commitments_completed).toBe(true);
    expect((payload.commitments as Record<string, unknown>)[`${ACTIVE_READING_KEYS.mentor}_matched`]).toBe(true);
  });

  it("altered acknowledgement phrase fails", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    withCanonicalCommitments(fd);
    fd.append(ACTIVE_READING_KEYS.mentor, "Tôi đồng ý.");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.commitments_completed).toBe(false);
    expect((payload.commitments as Record<string, unknown>)[`${ACTIVE_READING_KEYS.mentor}_matched`]).toBe(false);
  });

  it("Core team note optional and persists in payload but not in profile diff", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    fd.append("core_team_note", "I want the same mentee");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.core_team_note).toBe("I want the same mentee");

    const refresh = buildRenewalProfileRefresh(payload);
    const oldProfile = { id: "p1", person_id: "x" } as Record<string, unknown>;
    const diff = buildRenewalProfileDiff(oldProfile, refresh);

    expect(diff.find((entry) => entry.field === "core_team_note")).toBeUndefined();
    expect((refresh as Record<string, unknown>).core_team_note).toBeUndefined();
  });

  it("removal of old free-text availability_commitment does not overwrite historical data", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload).not.toHaveProperty("availability_commitment");

    const refresh = buildRenewalProfileRefresh(payload);
    expect(refresh).not.toHaveProperty("availability_commitment");
  });
});
