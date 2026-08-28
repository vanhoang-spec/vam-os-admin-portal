import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  requiredCheckboxAcknowledgements
} from "@/lib/application-commitments";
import { hashRenewalInviteToken, mintRenewalInviteToken } from "@/lib/renewal-invite-token";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh } from "@/lib/renewal-profile-safety";
import {
  renewalPayloadFromFormData,
  submitRenewalAccepted,
  validateRenewalAcceptance
} from "@/lib/renewal-runtime";
import {
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD,
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_TEXT
} from "@/lib/renewal-types";

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
  form.set("mentoring_capacity_total", "2");
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

function query(data: unknown) {
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "gt", "range"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return chain;
}

describe("Season 12 renewal current-profile requirements", () => {
  it("renders every required profile field and the exact separate review confirmation", () => {
    const source = fs.readFileSync("app/renew/[token]/renewal-form.tsx", "utf8");
    for (const field of [
      "company_current",
      "title_current",
      "industry_primary",
      "function_primary",
      "mentor_total_work_years",
      "mentor_people_management_years",
      "mentoring_capacity_total",
      "mentoring_topics",
      "programs_willing_to_join",
      "consent_data_storage"
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD");
    expect(RENEWAL_PROFILE_REVIEW_CONFIRMATION_TEXT).toBe(
      "Tôi xác nhận đã kiểm tra và cập nhật các thông tin nghề nghiệp ở trên theo tình trạng hiện tại của tôi cho Season 12."
    );
    expect(source).toContain("Quyền riêng tư:");
    expect(source).toContain("Xác nhận rà soát hồ sơ — Bắt buộc:");
  });

  it.each([
    ["company_current", "   "],
    ["title_current", "\t"],
    ["industry_primary", "   "],
    ["function_primary", "\n"],
    ["mentor_total_work_years", "   "],
    ["mentor_people_management_years", "   "],
    ["mentoring_capacity_total", "   "]
  ])("refuses blank required field %s", (field, value) => {
    expect(validateRenewalAcceptance(acceptedForm({ [field]: value })).ok).toBe(false);
  });

  it("accepts a canonical mentor function value", () => {
    const result = validateRenewalAcceptance(acceptedForm({ function_primary: "product" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.function_primary).toBe("product");
  });

  it("rejects a forged free-text mentor function value", () => {
    expect(validateRenewalAcceptance(acceptedForm({ function_primary: "Chief Happiness Officer" }))).toEqual({
      ok: false,
      message: "Vui lòng chọn chức năng/chuyên môn chính hợp lệ."
    });
  });

  it("rejects Other with a blank or whitespace-only function detail", () => {
    expect(validateRenewalAcceptance(acceptedForm({
      function_primary: "other",
      function_primary_other: "   \t "
    }))).toEqual({
      ok: false,
      message: "Vui lòng ghi rõ chức năng/chuyên môn chính khác."
    });
  });

  it("accepts Other with a valid function detail and trims it", () => {
    const result = validateRenewalAcceptance(acceptedForm({
      function_primary: "other",
      function_primary_other: "  Sustainability  "
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.function_primary_other).toBe("Sustainability");
  });

  it("removes forged Other detail when a non-Other function is selected", () => {
    const result = validateRenewalAcceptance(acceptedForm({
      function_primary: "operations",
      function_primary_other: "misleading stale detail"
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty("function_primary_other");
  });

  it("accepts a canonical mentor industry value", () => {
    const result = validateRenewalAcceptance(acceptedForm({ industry_primary: "tech" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.industry_primary).toBe("tech");
  });

  it("rejects a forged free-text mentor industry value", () => {
    expect(validateRenewalAcceptance(acceptedForm({ industry_primary: "Blockchain AI" }))).toEqual({
      ok: false,
      message: "Vui lòng chọn ngành nghề chính hợp lệ."
    });
  });

  it("rejects Other with a blank or whitespace-only industry detail", () => {
    expect(validateRenewalAcceptance(acceptedForm({
      industry_primary: "other",
      industry_primary_other: "   \t "
    }))).toEqual({
      ok: false,
      message: "Vui lòng ghi rõ ngành nghề chính khác."
    });
  });

  it("accepts Other with a valid industry detail and trims it", () => {
    const result = validateRenewalAcceptance(acceptedForm({
      industry_primary: "other",
      industry_primary_other: "  Web3  "
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.industry_primary_other).toBe("Web3");
  });

  it("removes forged Other detail when a non-Other industry is selected", () => {
    const result = validateRenewalAcceptance(acceptedForm({
      industry_primary: "tech",
      industry_primary_other: "misleading stale detail"
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty("industry_primary_other");
  });

  it.each(["__DELETE__", "   "])("keeps mentoring topics optional (%s)", (mentoringTopics) => {
    const result = validateRenewalAcceptance(acceptedForm({ mentoring_topics: mentoringTopics }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty("mentoring_topics");
  });

  it("refuses an unchecked final profile-review confirmation independently of consent", () => {
    const form = acceptedForm({ [RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD]: "__DELETE__" });
    expect(form.get("consent_data_storage")).toBe("yes");
    const result = validateRenewalAcceptance(form);
    expect(result).toEqual({
      ok: false,
      message: "Vui lòng xác nhận đã kiểm tra thông tin nghề nghiệp hiện tại cho Season 12."
    });
  });

  it.each([
    ["mentor_total_work_years", "-1"],
    ["mentor_total_work_years", "81"],
    ["mentor_total_work_years", "2.5"],
    ["mentor_total_work_years", "abc"],
    ["mentor_people_management_years", "-1"],
    ["mentor_people_management_years", "81"],
    ["mentor_people_management_years", "2.5"],
    ["mentor_people_management_years", "13"]
  ])("refuses invalid bounded experience value %s=%s", (field, value) => {
    expect(validateRenewalAcceptance(acceptedForm({ [field]: value })).ok).toBe(false);
  });

  it.each(["0", "4", "-1", "2.5", "abc"])("refuses capacity outside S12 policy: %s", (value) => {
    expect(validateRenewalAcceptance(acceptedForm({ mentoring_capacity_total: value })).ok).toBe(false);
  });

  it("accepts unchanged prefilled professional data after explicit review", () => {
    const result = validateRenewalAcceptance(acceptedForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const refresh = buildRenewalProfileRefresh(result.payload);
    expect(buildRenewalProfileDiff({
      company_current: "Acme",
      title_current: "Director",
      function_area: "strategy_consulting",
      industry: "education",
      years_experience_text: "11-15",
      years_experience_min: 12,
      capacity_target: 2
    }, refresh)).toEqual([]);
  });

  it("persists management years, mentoring topics, and review evidence in the renewal payload", () => {
    const payload = renewalPayloadFromFormData(acceptedForm());
    expect(payload).toMatchObject({
      mentor_total_work_years: 12,
      mentor_people_management_years: 5,
      mentoring_capacity_total: 2,
      mentoring_topics: "Phát triển nghề nghiệp và chiến lược",
      profile_review_confirmed: true
    });
    const refresh = buildRenewalProfileRefresh(payload) as Record<string, unknown>;
    expect(refresh).not.toHaveProperty("mentor_people_management_years");
    expect(refresh).not.toHaveProperty(RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD);
  });

  it("submits only through the unchanged token-hash RPC and creates no membership prematurely", async () => {
    const { token, tokenHash } = mintRenewalInviteToken();
    const invite = {
      id: "00000000-0000-4000-8000-000000000001",
      token_hash: hashRenewalInviteToken(token),
      person_id: "00000000-0000-4000-8000-000000000002",
      program_id: "00000000-0000-4000-8000-000000000003",
      season_id: "00000000-0000-4000-8000-000000000004",
      role: "mentor",
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
      submitted_at: null,
      outcome: null,
      application_id: null
    };
    const from = vi.fn((_table: string) => query(invite));
    const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => ({
      data: [{ outcome_status: "accepted" }],
      error: null
    }));

    expect(await submitRenewalAccepted(token, acceptedForm(), { from, rpc } as any)).toMatchObject({
      ok: true,
      outcome: "accepted"
    });
    expect(rpc).toHaveBeenCalledWith("vam071_submit_renewal_accepted", expect.objectContaining({
      p_token_hash: tokenHash,
      p_consent_data_storage: true,
      p_raw_payload: expect.objectContaining({ profile_review_confirmed: true })
    }));
    expect(from.mock.calls.map((call) => call[0])).toEqual(["person_season_invites"]);
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain("vam063_add_membership_role");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
  });

  it("keeps New Mentor core professional field definitions compatible without changing its form", () => {
    const newMentor = fs.readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    const newMentorAction = fs.readFileSync("app/actions/apply.ts", "utf8");
    for (const field of [
      "company_current",
      "title_current",
      "industry_primary",
      "function_primary",
      "years_of_experience",
      "mentor_total_work_years",
      "mentor_people_management_years",
      "mentoring_capacity_total",
      "programs_willing_to_join"
    ]) {
      expect(newMentor).toContain(field);
      expect(newMentorAction).toContain(field);
    }
  });
});
