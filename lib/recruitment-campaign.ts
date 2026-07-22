export type ApplicantRole = "mentor" | "mentee";
export type CampaignStoredStatus = "draft" | "published" | "paused" | "closed" | "archived";
export type CampaignEffectiveStatus = "draft" | "scheduled" | "open" | "paused" | "closed" | "archived";
export type CampaignAccessLevel = "read" | "review" | "operations" | "full_access";

export type RecruitmentCampaign = {
  id: string;
  programId: string;
  seasonId: string;
  intakeBatchId: string;
  applicantRole: ApplicantRole;
  name: string;
  publicSlug: string;
  status: CampaignStoredStatus;
  opensAt: string;
  closesAt: string;
  capacityTarget: number | null;
  interviewRequired: boolean;
  confirmationDeadlineDays: number | null;
  eligibilityText: string;
  privacyNotice: string;
  consentVersion: string;
  successMessage: string;
  applicationCount?: number;
};

export type CampaignCatalog = {
  programs: Array<{ id: string; code: string }>;
  seasons: Array<{ id: string; code: string; programId: string }>;
  intakeBatches: Array<{ id: string; code: string; seasonId: string }>;
};

export type CampaignPrincipal = {
  globalRole: string | null;
  grants: Array<{ programId: string; seasonId?: string | null; level: CampaignAccessLevel }>;
};

export type ExistingApplicationIdentity = {
  campaignId: string | null;
  seasonId: string | null;
  programId: string | null;
  applicantRole: ApplicantRole;
  emailCanonical: string;
  applicationReference?: string | null;
};

export type CampaignValidationResult = { ok: true } | { ok: false; field: string; message: string };

const ACCESS_RANK: Record<CampaignAccessLevel, number> = { read: 1, review: 2, operations: 3, full_access: 4 };
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function canonicalEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  return value.replace(/[\s().-]+/g, "").replace(/^\+84/, "0").trim();
}

export function normalizeCampaignSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function resolveCampaignStatus(
  campaign: Pick<RecruitmentCampaign, "status" | "opensAt" | "closesAt">,
  nowIso: string
): CampaignEffectiveStatus {
  if (campaign.status === "archived") return "archived";
  if (campaign.status === "closed") return "closed";
  if (campaign.status === "paused") return "paused";
  if (campaign.status === "draft") return "draft";
  const now = Date.parse(nowIso);
  const opens = Date.parse(campaign.opensAt);
  const closes = Date.parse(campaign.closesAt);
  if (!Number.isFinite(now) || !Number.isFinite(opens) || !Number.isFinite(closes)) return "closed";
  if (now < opens) return "scheduled";
  if (now >= closes) return "closed";
  return "open";
}

export function validateCampaign(campaign: RecruitmentCampaign, catalog: CampaignCatalog): CampaignValidationResult {
  const program = catalog.programs.find((row) => row.id === campaign.programId);
  if (!program) return { ok: false, field: "programId", message: "Chương trình không tồn tại." };
  const season = catalog.seasons.find((row) => row.id === campaign.seasonId);
  if (!season || season.programId !== program.id) return { ok: false, field: "seasonId", message: "Mùa không thuộc chương trình đã chọn." };
  const batch = catalog.intakeBatches.find((row) => row.id === campaign.intakeBatchId);
  if (!batch || batch.seasonId !== season.id) return { ok: false, field: "intakeBatchId", message: "Đợt tuyển không thuộc mùa đã chọn." };
  if (!SLUG_PATTERN.test(campaign.publicSlug)) return { ok: false, field: "publicSlug", message: "Slug chỉ gồm chữ thường, số và dấu gạch ngang." };
  const opens = Date.parse(campaign.opensAt);
  const closes = Date.parse(campaign.closesAt);
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens >= closes) return { ok: false, field: "closesAt", message: "Thời gian đóng phải sau thời gian mở." };
  if (campaign.capacityTarget !== null && (!Number.isInteger(campaign.capacityTarget) || campaign.capacityTarget < 1)) return { ok: false, field: "capacityTarget", message: "Chỉ tiêu phải là số nguyên dương." };
  if (campaign.confirmationDeadlineDays !== null && (!Number.isInteger(campaign.confirmationDeadlineDays) || campaign.confirmationDeadlineDays < 1)) return { ok: false, field: "confirmationDeadlineDays", message: "Hạn xác nhận phải là số ngày nguyên dương." };
  if (!campaign.eligibilityText.trim()) return { ok: false, field: "eligibilityText", message: "Cần mô tả điều kiện tham gia." };
  if (!campaign.privacyNotice.trim()) return { ok: false, field: "privacyNotice", message: "Cần có thông báo quyền riêng tư." };
  if (!campaign.consentVersion.trim()) return { ok: false, field: "consentVersion", message: "Cần xác định phiên bản consent." };
  return { ok: true };
}

export function canReadCampaign(principal: CampaignPrincipal, campaign: RecruitmentCampaign) {
  if (principal.globalRole === "super_admin") return true;
  return principal.grants.some((grant) => grant.programId === campaign.programId && (!grant.seasonId || grant.seasonId === campaign.seasonId));
}

export function canManageCampaign(principal: CampaignPrincipal, campaign: RecruitmentCampaign) {
  if (principal.globalRole === "super_admin") return true;
  return principal.grants.some(
    (grant) => grant.programId === campaign.programId && (!grant.seasonId || grant.seasonId === campaign.seasonId) && ACCESS_RANK[grant.level] >= ACCESS_RANK.operations
  );
}

export function canChangeCampaignScope(campaign: RecruitmentCampaign) {
  return (campaign.applicationCount ?? 0) === 0 && campaign.status !== "archived";
}

export function resolvePublicCampaign(campaign: RecruitmentCampaign | null, nowIso: string) {
  if (!campaign) return { available: false as const, status: "not_found" as const };
  const status = resolveCampaignStatus(campaign, nowIso);
  if (status === "draft" || status === "archived") return { available: false as const, status: "not_found" as const };
  const { id: _privateId, ...publicCampaign } = campaign;
  return { available: status === "open", status, campaign: publicCampaign };
}

export function buildTrustedApplicationScope(campaign: RecruitmentCampaign, untrusted: Record<string, unknown>) {
  return {
    ...untrusted,
    campaignId: campaign.id,
    programId: campaign.programId,
    seasonId: campaign.seasonId,
    intakeBatchId: campaign.intakeBatchId,
    applicantRole: campaign.applicantRole,
    consentVersion: campaign.consentVersion,
    source: "campaign_public_form"
  };
}

export function classifyDuplicate(
  input: { campaignId: string; seasonId: string; programId: string; applicantRole: ApplicantRole; email: string },
  existing: ExistingApplicationIdentity[]
) {
  const email = canonicalEmail(input.email);
  const matches = existing.filter((row) => canonicalEmail(row.emailCanonical) === email);
  const sameCampaign = matches.find((row) => row.campaignId === input.campaignId && row.applicantRole === input.applicantRole);
  if (sameCampaign) return { action: "block" as const, reason: "same_campaign" as const, applicationReference: sameCampaign.applicationReference ?? null };
  const sameSeasonRole = matches.find((row) => row.seasonId === input.seasonId && row.applicantRole === input.applicantRole);
  if (sameSeasonRole) return { action: "review" as const, reason: "same_season_role" as const };
  return { action: "allow" as const, reason: matches.length ? "different_campaign_or_role" as const : "new_identity" as const };
}

export function createApplicationReference(randomToken: string) {
  const safe = randomToken.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (safe.length < 10) throw new Error("Reference entropy is insufficient");
  return `VAM-${safe}`;
}

export function campaignAggregate<T extends Record<string, unknown>>(rows: T[]) {
  return { count: rows.length };
}
