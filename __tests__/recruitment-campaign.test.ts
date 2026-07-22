import { describe, expect, it } from "vitest";
import {
  buildTrustedApplicationScope,
  campaignAggregate,
  canChangeCampaignScope,
  canManageCampaign,
  canReadCampaign,
  canonicalEmail,
  classifyDuplicate,
  createApplicationReference,
  normalizeCampaignSlug,
  normalizePhone,
  resolveCampaignStatus,
  resolvePublicCampaign,
  validateCampaign,
  type CampaignCatalog,
  type RecruitmentCampaign
} from "@/lib/recruitment-campaign";

const catalog: CampaignCatalog = {
  programs: [{ id: "ueh", code: "UEHM" }, { id: "ham", code: "HAM" }],
  seasons: [{ id: "ueh-s12", code: "UEHM-S12", programId: "ueh" }, { id: "ham-s6", code: "HAM-S6", programId: "ham" }],
  intakeBatches: [{ id: "ueh-b1", code: "UEHM-S12-B1", seasonId: "ueh-s12" }, { id: "ham-b1", code: "HAM-S6-B1", seasonId: "ham-s6" }]
};

const campaign: RecruitmentCampaign = {
  id: "campaign-secret-id",
  programId: "ueh",
  seasonId: "ueh-s12",
  intakeBatchId: "ueh-b1",
  applicantRole: "mentee",
  name: "Tuyển mentee Season 12",
  publicSlug: "ueh-mentee-s12",
  status: "published",
  opensAt: "2026-08-01T00:00:00+07:00",
  closesAt: "2026-08-31T23:59:59+07:00",
  capacityTarget: 120,
  interviewRequired: true,
  confirmationDeadlineDays: 5,
  eligibilityText: "Sinh viên đủ điều kiện",
  privacyNotice: "Dữ liệu chỉ dùng cho quy trình tuyển chọn",
  consentVersion: "2026-07-v1",
  successMessage: "VAM đã nhận hồ sơ của bạn",
  applicationCount: 0
};

const at = (status: RecruitmentCampaign["status"]) => ({ ...campaign, status });

describe("recruitment campaign domain", () => {
  it("allows Super Admin to read and manage every program", () => {
    const principal = { globalRole: "super_admin", grants: [] };
    expect(canReadCampaign(principal, { ...campaign, programId: "ham" })).toBe(true);
    expect(canManageCampaign(principal, { ...campaign, programId: "ham" })).toBe(true);
  });

  it("allows UEH operations admin to manage UEH", () => expect(canManageCampaign({ globalRole: "admin", grants: [{ programId: "ueh", level: "operations" }] }, campaign)).toBe(true));
  it("blocks HAM admin from UEH campaign", () => expect(canManageCampaign({ globalRole: "admin", grants: [{ programId: "ham", level: "full_access" }] }, campaign)).toBe(false));
  it("allows Reviewer to read but not mutate", () => {
    const principal = { globalRole: "reviewer", grants: [{ programId: "ueh", level: "review" as const }] };
    expect(canReadCampaign(principal, campaign)).toBe(true);
    expect(canManageCampaign(principal, campaign)).toBe(false);
  });
  it("allows Viewer to read but not mutate", () => {
    const principal = { globalRole: "viewer", grants: [{ programId: "ueh", level: "read" as const }] };
    expect(canReadCampaign(principal, campaign)).toBe(true);
    expect(canManageCampaign(principal, campaign)).toBe(false);
  });
  it("honors season-level grants", () => expect(canManageCampaign({ globalRole: "admin", grants: [{ programId: "ueh", seasonId: "ueh-s12", level: "operations" }] }, campaign)).toBe(true));
  it("rejects a season from another program", () => expect(validateCampaign({ ...campaign, seasonId: "ham-s6" }, catalog)).toMatchObject({ ok: false, field: "seasonId" }));
  it("rejects an intake batch from another season", () => expect(validateCampaign({ ...campaign, intakeBatchId: "ham-b1" }, catalog)).toMatchObject({ ok: false, field: "intakeBatchId" }));
  it("accepts a valid canonical context", () => expect(validateCampaign(campaign, catalog)).toEqual({ ok: true }));
  it("rejects an invalid slug", () => expect(validateCampaign({ ...campaign, publicSlug: "Bad Slug!" }, catalog)).toMatchObject({ ok: false, field: "publicSlug" }));
  it("normalizes public slugs", () => expect(normalizeCampaignSlug(" UEH Mentee / S12 ")).toBe("ueh-mentee-s12"));
  it("rejects an invalid time window", () => expect(validateCampaign({ ...campaign, closesAt: campaign.opensAt }, catalog)).toMatchObject({ ok: false, field: "closesAt" }));
  it("rejects missing privacy notice", () => expect(validateCampaign({ ...campaign, privacyNotice: " " }, catalog)).toMatchObject({ ok: false, field: "privacyNotice" }));
  it("rejects missing consent version", () => expect(validateCampaign({ ...campaign, consentVersion: "" }, catalog)).toMatchObject({ ok: false, field: "consentVersion" }));

  it("keeps draft private", () => expect(resolvePublicCampaign(at("draft"), "2026-08-10T00:00:00+07:00")).toMatchObject({ available: false, status: "not_found" }));
  it("resolves scheduled before opens_at", () => expect(resolveCampaignStatus(campaign, "2026-07-31T23:59:59+07:00")).toBe("scheduled"));
  it("opens exactly at opens_at", () => expect(resolveCampaignStatus(campaign, campaign.opensAt)).toBe("open"));
  it("stays open before closes_at", () => expect(resolveCampaignStatus(campaign, "2026-08-31T23:59:58+07:00")).toBe("open"));
  it("closes exactly at closes_at", () => expect(resolveCampaignStatus(campaign, campaign.closesAt)).toBe("closed"));
  it("blocks paused campaigns", () => expect(resolvePublicCampaign(at("paused"), "2026-08-10T00:00:00+07:00")).toMatchObject({ available: false, status: "paused" }));
  it("blocks manually closed campaigns", () => expect(resolvePublicCampaign(at("closed"), "2026-08-10T00:00:00+07:00")).toMatchObject({ available: false, status: "closed" }));
  it("never exposes the database campaign ID on the public projection", () => {
    const result = resolvePublicCampaign(campaign, "2026-08-10T00:00:00+07:00");
    expect(result.available).toBe(true);
    expect(result.campaign).not.toHaveProperty("id");
  });

  it("hides archived and invalid slugs as not found", () => {
    expect(resolvePublicCampaign(at("archived"), "2026-08-10T00:00:00+07:00").status).toBe("not_found");
    expect(resolvePublicCampaign(null, "2026-08-10T00:00:00+07:00").status).toBe("not_found");
  });

  it("ignores tampered hidden scope and role fields", () => {
    const result = buildTrustedApplicationScope(campaign, { programId: "ham", seasonId: "ham-s6", intakeBatchId: "ham-b1", applicantRole: "mentor", fullName: "Applicant" });
    expect(result).toMatchObject({ programId: "ueh", seasonId: "ueh-s12", intakeBatchId: "ueh-b1", applicantRole: "mentee", fullName: "Applicant" });
  });
  it("binds consent version and trusted source", () => expect(buildTrustedApplicationScope(campaign, {})).toMatchObject({ consentVersion: "2026-07-v1", source: "campaign_public_form" }));
  it("prevents scope edits after the first application", () => expect(canChangeCampaignScope({ ...campaign, applicationCount: 1 })).toBe(false));
  it("allows safe scope edits before applications exist", () => expect(canChangeCampaignScope(campaign)).toBe(true));

  it("blocks same email in the same campaign and returns opaque reference", () => {
    expect(classifyDuplicate({ campaignId: campaign.id, seasonId: campaign.seasonId, programId: campaign.programId, applicantRole: "mentee", email: " USER@EXAMPLE.COM " }, [{ campaignId: campaign.id, seasonId: campaign.seasonId, programId: campaign.programId, applicantRole: "mentee", emailCanonical: "user@example.com", applicationReference: "VAM-ABC1234567" }])).toEqual({ action: "block", reason: "same_campaign", applicationReference: "VAM-ABC1234567" });
  });
  it("flags same identity in another campaign of the same season and role", () => expect(classifyDuplicate({ campaignId: "new", seasonId: "ueh-s12", programId: "ueh", applicantRole: "mentee", email: "u@e.com" }, [{ campaignId: "old", seasonId: "ueh-s12", programId: "ueh", applicantRole: "mentee", emailCanonical: "u@e.com" }])).toMatchObject({ action: "review", reason: "same_season_role" }));
  it("allows the same identity in a previous season", () => expect(classifyDuplicate({ campaignId: "new", seasonId: "ueh-s12", programId: "ueh", applicantRole: "mentee", email: "u@e.com" }, [{ campaignId: "old", seasonId: "ueh-s11", programId: "ueh", applicantRole: "mentee", emailCanonical: "u@e.com" }]).action).toBe("allow"));
  it("does not conflate mentor and mentee roles", () => expect(classifyDuplicate({ campaignId: campaign.id, seasonId: "ueh-s12", programId: "ueh", applicantRole: "mentee", email: "u@e.com" }, [{ campaignId: campaign.id, seasonId: "ueh-s12", programId: "ueh", applicantRole: "mentor", emailCanonical: "u@e.com" }]).action).toBe("allow"));
  it("does not conflate cross-program applications", () => expect(classifyDuplicate({ campaignId: campaign.id, seasonId: "ueh-s12", programId: "ueh", applicantRole: "mentee", email: "u@e.com" }, [{ campaignId: "ham", seasonId: "ham-s6", programId: "ham", applicantRole: "mentee", emailCanonical: "u@e.com" }]).action).toBe("allow"));
  it("canonicalizes email and phone", () => {
    expect(canonicalEmail(" User@Example.COM ")).toBe("user@example.com");
    expect(normalizePhone("+84 912-345-678")).toBe("0912345678");
  });
  it("creates an opaque application reference", () => expect(createApplicationReference("a9x8-k7m6-p5q4-z3")).toBe("VAM-A9X8K7M6P5Q4"));
  it("rejects low-entropy reference input", () => expect(() => createApplicationReference("short")).toThrow());
  it("returns count-only aggregates without PII", () => expect(campaignAggregate([{ email: "private@example.com" }, { phone: "0900" }])).toEqual({ count: 2 }));
});
