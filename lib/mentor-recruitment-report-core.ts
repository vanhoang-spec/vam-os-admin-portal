import { MENTOR_APPLICATION_FIELD_OPTIONS } from "@/lib/application-form-options";
import { companyKeyOf, type CompanyKey } from "@/lib/company-name-core";
import { classifyMentor } from "@/lib/matching-round2-classify-core";
import { INDUSTRY_GROUPS, industryGroupLabel } from "@/lib/matching-round2-groups-core";
import { pickQuickViewApplication } from "@/lib/matching-quick-view-core";
import { SENIORITY_LEVELS, seniorityOf, type SeniorityLevel } from "@/lib/mentor-seniority-core";
import { deriveDecisions, PROVES_SCREENING_PASSED, type DecisionRow } from "@/lib/recruitment-export";
import { crossTab, type CrossTab, type CrossTabColumnSpec, type CrossTabOption } from "@/lib/report-crosstab-core";

/**
 * lib/mentor-recruitment-report-core.ts — báo cáo tuyển mentor (BTC 08/10/2026).
 * Phần thuần, không I/O; lib/mentor-recruitment-report.ts đọc bảng rồi gọi vào đây.
 *
 * Hai luồng vào mùa, không trộn:
 *   - MENTOR MỚI (form /apply/mentor): vòng hồ sơ → vòng phỏng vấn / trao đổi với Core
 *     team → BTC chốt → mentor chính thức. Phễu tỷ lệ chỉ tính luồng này.
 *   - MENTOR GIA HẠN (link /renew): không qua chấm hồ sơ hay phỏng vấn — BTC xác nhận
 *     rồi duyệt thẳng. Trộn vào phễu là làm tỷ lệ đậu vòng hồ sơ cao giả tạo.
 *
 * "Không đạt" và "Rút đơn" mang cùng một trạng thái dù xảy ra ở vòng hồ sơ hay sau
 * phỏng vấn; vòng nào được đọc từ lịch sử quyết định (deriveDecisions — cùng hàm của
 * file xuất kết quả tuyển) cộng phiếu phỏng vấn đã nộp, không đoán từ trạng thái.
 */

export const RENEWAL_SOURCE = "s12_mentor_renewal";

// ---------------------------------------------------------------------------
// Đầu vào

export type MentorApplicationInput = {
  id: string;
  personId: string | null;
  fullName: string | null;
  email: string | null;
  source: string | null;
  status: string;
  submittedAt: string | null;
  /** Đơn đã bóc lớp gia hạn (applicantPayload): cùng một hình cho hai luồng. */
  payload: Record<string, unknown> | null;
};

export type ReviewInput = {
  applicationId: string;
  round: string;
  status: string;
  recommendation: string | null;
  submittedAt: string | null;
};

export type DecisionInput = DecisionRow & { applicationId: string };

export type InviteInput = { personId: string; outcome: string | null; revokedAt: string | null; expiresAt: string | null };

export type MentorReportInput = {
  applications: readonly MentorApplicationInput[];
  reviews: readonly ReviewInput[];
  decisions: readonly DecisionInput[];
  /** Nhóm ngành đã lưu ở Vòng 2, theo người. */
  savedGroups: ReadonlyMap<string, number>;
  invites: readonly InviteInput[];
  /** ISO — để biết link gia hạn còn hạn hay không. */
  now: string;
};

// ---------------------------------------------------------------------------
// Một dòng / một người

export type Stream = "new" | "renewal";

/** Vị trí hiện tại của một đơn mentor mới trong phễu. */
export type NewStage =
  | "cv_pending"
  | "cv_rejected"
  | "cv_withdrawn"
  | "iv_pending"
  | "iv_withdrawn"
  | "awaiting_decision"
  | "iv_rejected"
  | "waitlisted"
  | "official";

export type MentorReportRow = {
  applicationId: string;
  personId: string | null;
  name: string;
  stream: Stream;
  status: string;
  official: boolean;
  title: string | null;
  company: string | null;
  companyKey: CompanyKey;
  workYears: number | null;
  workYearsInvalid: boolean;
  mgmtYears: number | null;
  mgmtYearsInvalid: boolean;
  capacity: string | null;
  university: string | null;
  referral: string | null;
  group: number;
  groupSaved: boolean;
  seniority: SeniorityLevel;
  seniorityMatched: string | null;
  /** Chỉ có nghĩa với mentor mới. */
  stage: NewStage | null;
  cvRecommendation: string | null;
  interviewRecommendation: string | null;
  interviewed: boolean;
  reachedInterview: boolean;
};

const MAX_YEARS = 60;

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function years(value: unknown): { value: number | null; invalid: boolean } {
  const raw = text(value);
  if (raw === null) return { value: null, invalid: false };
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > MAX_YEARS) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

/** Phiếu đã nộp mới nhất của một vòng. Phiếu giao rồi huỷ / đang chấm không phải kết quả. */
function latestSubmitted(reviews: readonly ReviewInput[], round: string): ReviewInput | null {
  const done = reviews.filter((r) => r.round === round && r.status === "submitted");
  if (!done.length) return null;
  return [...done].sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")))[0];
}

const SCREENING_STATUSES = new Set([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "screening_in_progress",
  "screening_completed",
  "needs_admin_review"
]);

/**
 * Đơn mới đang ở đâu. Vào vòng phỏng vấn = có phiếu phỏng vấn đã nộp, HOẶC trạng
 * thái chỉ có được sau khi qua hồ sơ (PROVES_SCREENING_PASSED), HOẶC lịch sử quyết định
 * đã sang vòng phỏng vấn. Ba bằng chứng, vì luồng cũ thiếu dòng quyết định.
 */
export function newStageOf(status: string, interviewed: boolean, decisions: readonly DecisionRow[]): { stage: NewStage; reachedInterview: boolean } {
  const derived = deriveDecisions(decisions);
  const reachedInterview = interviewed || PROVES_SCREENING_PASSED.has(status) || derived.reachedStage !== "screening";
  if (status === "approved_as_mentor") return { stage: "official", reachedInterview };
  if (status === "interview_passed" || status === "ready_for_final_decision") return { stage: "awaiting_decision", reachedInterview };
  if (status === "waitlisted") return { stage: "waitlisted", reachedInterview };
  if (status === "rejected_or_not_fit") return { stage: reachedInterview ? "iv_rejected" : "cv_rejected", reachedInterview };
  if (status === "withdrawn") return { stage: reachedInterview ? "iv_withdrawn" : "cv_withdrawn", reachedInterview };
  if (SCREENING_STATUSES.has(status) && !reachedInterview) return { stage: "cv_pending", reachedInterview };
  if (status === "needs_more_review") return { stage: reachedInterview ? "iv_pending" : "cv_pending", reachedInterview };
  return { stage: reachedInterview ? "iv_pending" : "cv_pending", reachedInterview };
}

function dedupeKey(app: MentorApplicationInput): string {
  return app.personId ? `p:${app.personId}` : app.email ? `e:${app.email.trim().toLowerCase()}` : `a:${app.id}`;
}

/** Mỗi người một đơn trong mỗi luồng: đơn nộp sau cùng (cùng luật trang hồ sơ). */
function onePerPerson(apps: readonly MentorApplicationInput[]): MentorApplicationInput[] {
  const groups = new Map<string, MentorApplicationInput[]>();
  for (const app of apps) {
    const key = `${app.source === RENEWAL_SOURCE ? "r" : "n"}|${dedupeKey(app)}`;
    groups.set(key, [...(groups.get(key) ?? []), app]);
  }
  const picked: MentorApplicationInput[] = [];
  for (const list of Array.from(groups.values())) {
    const best = pickQuickViewApplication(list.map((a) => ({ ...a, submitted_at: a.submittedAt })));
    if (best) picked.push(list.find((a) => a.id === best.id) ?? list[0]);
  }
  return picked;
}

export function buildRows(input: MentorReportInput): MentorReportRow[] {
  const reviewsByApp = new Map<string, ReviewInput[]>();
  for (const r of input.reviews) reviewsByApp.set(r.applicationId, [...(reviewsByApp.get(r.applicationId) ?? []), r]);
  const decisionsByApp = new Map<string, DecisionInput[]>();
  for (const d of input.decisions) decisionsByApp.set(d.applicationId, [...(decisionsByApp.get(d.applicationId) ?? []), d]);

  return onePerPerson(input.applications).map((app) => {
    const p = app.payload ?? {};
    const stream: Stream = app.source === RENEWAL_SOURCE ? "renewal" : "new";
    const title = text(p.title_current);
    const company = text(p.company_current);
    const work = years(p.mentor_total_work_years);
    const mgmt = years(p.mentor_people_management_years);
    const saved = app.personId ? input.savedGroups.get(app.personId) : undefined;
    const group =
      saved ??
      classifyMentor({
        title,
        functionCode: text(p.function_primary),
        industryCode: text(p.industry_primary),
        functionOther: text(p.function_primary_other)
      }).group;
    const level = seniorityOf(title);
    const reviews = reviewsByApp.get(app.id) ?? [];
    const cv = latestSubmitted(reviews, "profile_screening");
    const iv = latestSubmitted(reviews, "interview");
    const position = stream === "new" ? newStageOf(app.status, Boolean(iv), decisionsByApp.get(app.id) ?? []) : null;
    return {
      applicationId: app.id,
      personId: app.personId,
      name: text(app.fullName) ?? "(chưa có tên)",
      stream,
      status: app.status,
      official: app.status === "approved_as_mentor",
      title,
      company,
      companyKey: companyKeyOf(company),
      workYears: work.value,
      workYearsInvalid: work.invalid,
      mgmtYears: mgmt.value,
      mgmtYearsInvalid: mgmt.invalid,
      capacity: text(p.mentoring_capacity_total),
      university: text(p.university),
      referral: text(p.referrer_or_source),
      group,
      groupSaved: saved !== undefined,
      seniority: level.level,
      seniorityMatched: level.matched,
      stage: position?.stage ?? null,
      cvRecommendation: cv?.recommendation ?? null,
      interviewRecommendation: iv?.recommendation ?? null,
      interviewed: Boolean(iv),
      reachedInterview: position?.reachedInterview ?? false
    };
  });
}

// ---------------------------------------------------------------------------
// Phễu mentor mới

export type NewMentorFunnel = {
  submitted: number;
  cv: {
    passed: number;
    passedByReview: number;
    passedDirect: number;
    rejected: number;
    withdrawn: number;
    pending: number;
    /** Đạt / (Đạt + Không đạt). Chưa có ai có kết quả → null. */
    passRate: number | null;
  };
  interview: {
    entered: number;
    interviewed: number;
    recommendations: { approve: number; waitlist: number; reject: number; needsAdmin: number };
    /** Vào vòng nhưng chưa có phiếu phỏng vấn nộp, theo vị trí hiện tại. */
    withoutForm: Record<NewStage, number>;
    /** Phiếu đề xuất nhận / số người đã phỏng vấn. */
    recommendRate: number | null;
  };
  result: {
    interviewed: number;
    byStage: Record<NewStage, number>;
    /** Đã thành mentor chính thức / đã phỏng vấn. */
    officialRate: number | null;
    /** (Chính thức + chờ BTC chốt) / đã phỏng vấn. */
    continuingRate: number | null;
  };
  officialTotal: number;
  stageCounts: Record<NewStage, number>;
};

export const NEW_STAGES: readonly NewStage[] = [
  "cv_pending",
  "cv_rejected",
  "cv_withdrawn",
  "iv_pending",
  "iv_withdrawn",
  "awaiting_decision",
  "iv_rejected",
  "waitlisted",
  "official"
];

export const NEW_STAGE_LABELS: Record<NewStage, string> = {
  cv_pending: "Đang chờ kết quả vòng hồ sơ",
  cv_rejected: "Không đạt vòng hồ sơ",
  cv_withdrawn: "Rút đơn ở vòng hồ sơ",
  iv_pending: "Chưa xong vòng phỏng vấn",
  iv_withdrawn: "Rút đơn ở vòng phỏng vấn",
  awaiting_decision: "Đã phỏng vấn, chờ BTC chốt",
  iv_rejected: "Không nhận sau phỏng vấn",
  waitlisted: "Dự bị",
  official: "Mentor chính thức"
};

function zeroStages(): Record<NewStage, number> {
  return Object.fromEntries(NEW_STAGES.map((s) => [s, 0])) as Record<NewStage, number>;
}

function rate(part: number, whole: number): number | null {
  return whole ? part / whole : null;
}

export function newMentorFunnel(rows: readonly MentorReportRow[]): NewMentorFunnel {
  const fresh = rows.filter((r) => r.stream === "new" && r.stage);
  const stageCounts = zeroStages();
  for (const r of fresh) stageCounts[r.stage as NewStage] += 1;

  const entered = fresh.filter((r) => r.reachedInterview);
  const passedByReview = entered.filter((r) => r.cvRecommendation === "pass_to_interview").length;
  const rejected = stageCounts.cv_rejected;

  const interviewed = entered.filter((r) => r.interviewed);
  const recommendations = { approve: 0, waitlist: 0, reject: 0, needsAdmin: 0 };
  for (const r of interviewed) {
    if (r.interviewRecommendation === "approve_recommended") recommendations.approve += 1;
    else if (r.interviewRecommendation === "waitlist") recommendations.waitlist += 1;
    else if (r.interviewRecommendation === "reject") recommendations.reject += 1;
    else recommendations.needsAdmin += 1;
  }
  const withoutForm = zeroStages();
  for (const r of entered) if (!r.interviewed) withoutForm[r.stage as NewStage] += 1;
  const byStage = zeroStages();
  for (const r of interviewed) byStage[r.stage as NewStage] += 1;

  return {
    submitted: fresh.length,
    cv: {
      passed: entered.length,
      passedByReview,
      passedDirect: entered.length - passedByReview,
      rejected,
      withdrawn: stageCounts.cv_withdrawn,
      pending: stageCounts.cv_pending,
      passRate: rate(entered.length, entered.length + rejected)
    },
    interview: {
      entered: entered.length,
      interviewed: interviewed.length,
      recommendations,
      withoutForm,
      recommendRate: rate(recommendations.approve, interviewed.length)
    },
    result: {
      interviewed: interviewed.length,
      byStage,
      officialRate: rate(byStage.official, interviewed.length),
      continuingRate: rate(byStage.official + byStage.awaiting_decision, interviewed.length)
    },
    officialTotal: stageCounts.official,
    stageCounts
  };
}

// ---------------------------------------------------------------------------
// Mentor gia hạn

export type RenewalFunnel = {
  invited: number;
  accepted: number;
  declined: number;
  /** Chưa trả lời, link còn dùng được. */
  pending: number;
  /** Chưa trả lời, link đã hết hạn / bị thu hồi. */
  lapsed: number;
  acceptanceRate: number | null;
  approved: number;
  awaitingConfirm: number;
};

/**
 * Theo NGƯỜI, không theo lời mời: một người có thể được cấp lại link nhiều lần (link
 * cũ bị thu hồi). Đã đồng ý ở bất kỳ link nào = đồng ý; từ chối rồi đồng ý lại = đồng ý.
 */
export function renewalFunnel(invites: readonly InviteInput[], rows: readonly MentorReportRow[], now: string): RenewalFunnel {
  const byPerson = new Map<string, InviteInput[]>();
  for (const i of invites) byPerson.set(i.personId, [...(byPerson.get(i.personId) ?? []), i]);
  const nowMs = Date.parse(now);
  let accepted = 0;
  let declined = 0;
  let pending = 0;
  let lapsed = 0;
  for (const list of Array.from(byPerson.values())) {
    if (list.some((i) => i.outcome === "accepted")) accepted += 1;
    else if (list.some((i) => i.outcome === "declined")) declined += 1;
    else if (list.some((i) => !i.outcome && !i.revokedAt && (!i.expiresAt || Date.parse(i.expiresAt) >= nowMs))) pending += 1;
    else lapsed += 1;
  }
  const renewal = rows.filter((r) => r.stream === "renewal");
  return {
    invited: byPerson.size,
    accepted,
    declined,
    pending,
    lapsed,
    acceptanceRate: rate(accepted, byPerson.size),
    approved: renewal.filter((r) => r.official).length,
    awaitingConfirm: renewal.filter((r) => !r.official && r.status !== "withdrawn").length
  };
}

// ---------------------------------------------------------------------------
// Hồ sơ mentor: phân bố

export const REPORT_SCOPES = [
  { key: "chinh-thuc", label: "Mentor chính thức" },
  { key: "tat-ca", label: "Mọi người nộp đơn / gia hạn" }
] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number]["key"];

export function parseScope(value: string | null | undefined): ReportScope {
  return REPORT_SCOPES.some((s) => s.key === value) ? (value as ReportScope) : "chinh-thuc";
}

/**
 * Người trong phạm vi. "Chính thức": đơn đã duyệt, mỗi người một lần dù có cả đơn mới
 * lẫn đơn gia hạn (giữ đơn gia hạn — người đó là mentor cũ). "Tất cả": mọi đơn, mỗi
 * luồng mỗi người một lần.
 */
export function scopeRows(rows: readonly MentorReportRow[], scope: ReportScope): MentorReportRow[] {
  if (scope === "tat-ca") return [...rows];
  const official = rows.filter((r) => r.official);
  const seen = new Set<string>();
  const out: MentorReportRow[] = [];
  for (const r of [...official].sort((a, b) => (a.stream === b.stream ? 0 : a.stream === "renewal" ? -1 : 1))) {
    const key = r.personId ?? r.applicationId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export const STREAM_COLUMNS: readonly CrossTabColumnSpec<MentorReportRow>[] = [
  { key: "new", label: "Mentor mới", filter: (r) => r.stream === "new" },
  { key: "renewal", label: "Mentor gia hạn", filter: (r) => r.stream === "renewal" }
];

export const EXPERIENCE_BUCKETS: readonly CrossTabOption[] = [
  { value: "lt5", label: "Dưới 5 năm" },
  { value: "5-9", label: "5–9 năm" },
  { value: "10-14", label: "10–14 năm" },
  { value: "15-19", label: "15–19 năm" },
  { value: "20-24", label: "20–24 năm" },
  { value: "25+", label: "25 năm trở lên" },
  { value: "invalid", label: "Số khai không hợp lệ" }
];

export const MANAGEMENT_BUCKETS: readonly CrossTabOption[] = [
  { value: "0", label: "Chưa quản lý nhân sự" },
  { value: "1-4", label: "1–4 năm" },
  { value: "5-9", label: "5–9 năm" },
  { value: "10-14", label: "10–14 năm" },
  { value: "15+", label: "15 năm trở lên" },
  { value: "invalid", label: "Số khai không hợp lệ" }
];

export function experienceBucket(value: number | null, invalid: boolean): string {
  if (invalid) return "invalid";
  if (value === null) return "";
  if (value < 5) return "lt5";
  if (value < 10) return "5-9";
  if (value < 15) return "10-14";
  if (value < 20) return "15-19";
  if (value < 25) return "20-24";
  return "25+";
}

export function managementBucket(value: number | null, invalid: boolean): string {
  if (invalid) return "invalid";
  if (value === null) return "";
  if (value === 0) return "0";
  if (value < 5) return "1-4";
  if (value < 10) return "5-9";
  if (value < 15) return "10-14";
  return "15+";
}

export type YearStats = { count: number; median: number | null; average: number | null };

export function yearStats(values: ReadonlyArray<number | null>): YearStats {
  const nums = values.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  if (!nums.length) return { count: 0, median: null, average: null };
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return { count: nums.length, median, average: nums.reduce((s, n) => s + n, 0) / nums.length };
}

export type PersonLine = { applicationId: string; name: string; title: string | null; company: string | null; stream: Stream; matched: string | null };

function personLine(r: MentorReportRow): PersonLine {
  return { applicationId: r.applicationId, name: r.name, title: r.title, company: r.company, stream: r.stream, matched: r.seniorityMatched };
}

const byName = (a: PersonLine, b: PersonLine) => a.name.localeCompare(b.name, "vi");

export type CompanyRank = { key: string; label: string; count: number; people: PersonLine[] };

export type CompanySummary = {
  ranked: CompanyRank[];
  distinct: number;
  independent: number;
  undeclared: number;
};

/**
 * Xếp công ty theo số mentor. Nhãn: tên thương hiệu nếu là thương hiệu đã biết, không
 * thì cách viết gặp nhiều nhất trong nhóm (hoà → cách viết đứng trước theo bảng chữ).
 */
export function companySummary(rows: readonly MentorReportRow[]): CompanySummary {
  const groups = new Map<string, { brand: string | null; spellings: Map<string, number>; rows: MentorReportRow[] }>();
  let independent = 0;
  let undeclared = 0;
  for (const r of rows) {
    const k = r.companyKey;
    if (k.kind === "independent") {
      independent += 1;
      continue;
    }
    if (k.kind === "none") {
      undeclared += 1;
      continue;
    }
    const g = groups.get(k.key) ?? { brand: k.brand, spellings: new Map<string, number>(), rows: [] };
    const spelling = (r.company ?? "").trim();
    g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + 1);
    g.rows.push(r);
    groups.set(k.key, g);
  }
  const ranked: CompanyRank[] = Array.from(groups.entries()).map(([key, g]) => {
    const label =
      g.brand ??
      Array.from(g.spellings.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"))[0][0];
    return { key, label, count: g.rows.length, people: g.rows.map(personLine).sort(byName) };
  });
  ranked.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));
  return { ranked, distinct: ranked.length, independent, undeclared };
}

export type SeniorityGroup = { level: SeniorityLevel; label: string; people: PersonLine[] };

export function seniorityGroups(rows: readonly MentorReportRow[]): SeniorityGroup[] {
  return SENIORITY_LEVELS.map((l) => ({
    level: l.key,
    label: l.label,
    people: rows.filter((r) => r.seniority === l.key).map(personLine).sort(byName)
  }));
}

const DIRECTOR_AND_ABOVE: ReadonlySet<SeniorityLevel> = new Set<SeniorityLevel>(["c_level", "senior_director", "director"]);

export type MentorProfileReport = {
  scope: ReportScope;
  population: number;
  experience: CrossTab;
  experienceStats: { all: YearStats; new: YearStats; renewal: YearStats };
  management: CrossTab;
  groups: CrossTab;
  groupsProposed: number;
  seniority: CrossTab;
  seniorityPeople: SeniorityGroup[];
  directorAndAbove: number;
  companies: CompanySummary;
  capacity: CrossTab;
  seats: number;
  university: CrossTab;
  referral: CrossTab;
};

const GROUP_OPTIONS: readonly CrossTabOption[] = INDUSTRY_GROUPS.map((g) => ({ value: String(g.code), label: industryGroupLabel(g.code) }));
const SENIORITY_OPTIONS: readonly CrossTabOption[] = SENIORITY_LEVELS.map((l) => ({ value: l.key, label: l.label }));

export function mentorProfileReport(rows: readonly MentorReportRow[], scope: ReportScope): MentorProfileReport {
  const population = scopeRows(rows, scope);
  const fresh = population.filter((r) => r.stream === "new");
  return {
    scope,
    population: population.length,
    experience: crossTab(population, STREAM_COLUMNS, (r) => experienceBucket(r.workYears, r.workYearsInvalid), EXPERIENCE_BUCKETS),
    experienceStats: {
      all: yearStats(population.map((r) => r.workYears)),
      new: yearStats(fresh.map((r) => r.workYears)),
      renewal: yearStats(population.filter((r) => r.stream === "renewal").map((r) => r.workYears))
    },
    management: crossTab(population, STREAM_COLUMNS, (r) => managementBucket(r.mgmtYears, r.mgmtYearsInvalid), MANAGEMENT_BUCKETS),
    groups: crossTab(population, STREAM_COLUMNS, (r) => String(r.group), GROUP_OPTIONS),
    groupsProposed: population.filter((r) => !r.groupSaved).length,
    seniority: crossTab(population, STREAM_COLUMNS, (r) => r.seniority, SENIORITY_OPTIONS),
    seniorityPeople: seniorityGroups(population),
    directorAndAbove: population.filter((r) => DIRECTOR_AND_ABOVE.has(r.seniority)).length,
    companies: companySummary(population),
    capacity: crossTab(population, STREAM_COLUMNS, (r) => r.capacity ?? "", MENTOR_APPLICATION_FIELD_OPTIONS.mentoring_capacity_total),
    seats: population.reduce((sum, r) => {
      const n = Number(r.capacity);
      return sum + (Number.isInteger(n) && n > 0 ? n : 0);
    }, 0),
    university: crossTab(population, STREAM_COLUMNS, (r) => r.university ?? "", MENTOR_APPLICATION_FIELD_OPTIONS.university),
    // Form gia hạn không hỏi nguồn biết đến — chỉ mentor mới.
    referral: crossTab(fresh, [STREAM_COLUMNS[0]], (r) => r.referral ?? "", MENTOR_APPLICATION_FIELD_OPTIONS.referrer_or_source, "count")
  };
}

// ---------------------------------------------------------------------------
// Tỷ lệ đạt vòng hồ sơ theo đặc điểm (mentor mới có kết quả vòng hồ sơ)

const CV_COLUMNS: readonly CrossTabColumnSpec<MentorReportRow>[] = [
  { key: "passed", label: "Đạt vòng hồ sơ", filter: (r) => r.reachedInterview },
  { key: "rejected", label: "Không đạt", filter: (r) => r.stage === "cv_rejected" }
];

export type CvBreakdown = { byGroup: CrossTab; byExperience: CrossTab; bySeniority: CrossTab };

export function cvBreakdown(rows: readonly MentorReportRow[]): CvBreakdown {
  const decided = rows.filter((r) => r.stream === "new" && (r.reachedInterview || r.stage === "cv_rejected"));
  return {
    byGroup: crossTab(decided, CV_COLUMNS, (r) => String(r.group), GROUP_OPTIONS),
    byExperience: crossTab(decided, CV_COLUMNS, (r) => experienceBucket(r.workYears, r.workYearsInvalid), EXPERIENCE_BUCKETS),
    bySeniority: crossTab(decided, CV_COLUMNS, (r) => r.seniority, SENIORITY_OPTIONS)
  };
}

// ---------------------------------------------------------------------------
// Toàn báo cáo

export type MentorRecruitmentReport = {
  funnel: NewMentorFunnel;
  renewal: RenewalFunnel;
  cv: CvBreakdown;
  profile: MentorProfileReport;
  officialTotal: number;
};

export function buildMentorRecruitmentReport(input: MentorReportInput, scope: ReportScope): MentorRecruitmentReport {
  const rows = buildRows(input);
  return {
    funnel: newMentorFunnel(rows),
    renewal: renewalFunnel(input.invites, rows, input.now),
    cv: cvBreakdown(rows),
    profile: mentorProfileReport(rows, scope),
    officialTotal: scopeRows(rows, "chinh-thuc").length
  };
}
