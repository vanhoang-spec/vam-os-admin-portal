/**
 * Báo cáo tuyển mentor — phần thuần (BTC 08/10/2026).
 *
 * Điều phải đúng: phễu mentor mới đặt mỗi đơn đúng vòng (rớt / rút ở vòng hồ sơ hay
 * sau phỏng vấn đọc từ phiếu phỏng vấn đã nộp và lịch sử quyết định, không từ trạng
 * thái); phiếu bị huỷ không phải kết quả; tỷ lệ tính đúng mẫu số; mentor gia hạn đếm
 * theo người và không lẫn vào phễu; mỗi người một dòng.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildMentorRecruitmentReport,
  buildRows,
  companySummary,
  experienceBucket,
  managementBucket,
  RENEWAL_SOURCE,
  type DecisionInput,
  type InviteInput,
  type MentorApplicationInput,
  type MentorReportInput,
  type ReviewInput
} from "@/lib/mentor-recruitment-report-core";

const NOW = "2026-10-08T12:00:00.000Z";

function app(id: string, over: Partial<MentorApplicationInput> = {}, payload: Record<string, unknown> = {}): MentorApplicationInput {
  return {
    id,
    personId: null,
    fullName: `Người ${id}`,
    email: `${id}@example.test`,
    source: "vam_os_form",
    status: "submitted",
    submittedAt: "2026-09-01T00:00:00.000Z",
    payload: {
      title_current: "Marketing Manager",
      company_current: "Công ty ABC",
      mentor_total_work_years: "12",
      mentor_people_management_years: "5",
      mentoring_capacity_total: "2",
      university: "UEH",
      referrer_or_source: "friend",
      function_primary: "marketing_sales",
      industry_primary: "fmcg",
      ...payload
    },
    ...over
  };
}

const review = (applicationId: string, round: string, recommendation: string | null, status = "submitted"): ReviewInput => ({
  applicationId,
  round,
  status,
  recommendation,
  submittedAt: "2026-09-10T00:00:00.000Z"
});
const cv = (id: string, rec: string, status = "submitted") => review(id, "profile_screening", rec, status);
const iv = (id: string, rec: string | null, status = "submitted") => review(id, "interview", rec, status);
const decision = (applicationId: string, status: string, at: string): DecisionInput => ({ applicationId, new_status: status, created_at: at });

/**
 * a1 đạt hồ sơ, PV đề xuất nhận, đã chính thức · a2 PV xong chờ BTC chốt · a3 đạt hồ sơ,
 * chưa PV (phiếu PV bị huỷ) · a4 rớt hồ sơ · a5 không phiếu, lịch sử: mời PV rồi loại →
 * rớt SAU vòng hồ sơ · a6 BTC duyệt thẳng, không phiếu · a7 rút trước khi chấm · a8 PV
 * xong rồi rút · a9 mới nộp (a12 là đơn nộp trước của cùng người) · a10 chỉ có phiếu
 * hồ sơ bị huỷ · a11 PV đề xuất không nhận, đã loại.
 */
function scenario(): MentorReportInput {
  const applications = [
    app("a1", { personId: "p1", status: "approved_as_mentor" }, { title_current: "Giám đốc chi nhánh", mentor_total_work_years: "4.9" }),
    app("a2", { status: "ready_for_final_decision" }),
    app("a3", { status: "invited_to_interview" }),
    app("a4", { status: "rejected_or_not_fit" }),
    app("a5", { status: "rejected_or_not_fit" }),
    app("a6", { personId: "p-shared", status: "approved_as_mentor" }),
    app("a7", { status: "withdrawn" }),
    app("a8", { status: "withdrawn" }),
    app("a9", { email: "Trung@Example.test", submittedAt: "2026-09-20T00:00:00.000Z" }),
    app("a10", { status: "screening_completed" }),
    app("a11", { status: "rejected_or_not_fit" }),
    app("a12", { email: "trung@example.test", submittedAt: "2026-09-02T00:00:00.000Z", status: "rejected_or_not_fit" }),
    app("r1", { personId: "p-shared", source: RENEWAL_SOURCE, status: "approved_as_mentor" }, { title_current: "CEO", mentor_total_work_years: "25", referrer_or_source: undefined }),
    app("r2", { personId: "p-r2", source: RENEWAL_SOURCE, status: "submitted" }, { referrer_or_source: undefined })
  ];
  const reviews = [
    cv("a1", "pass_to_interview"),
    iv("a1", "approve_recommended"),
    cv("a2", "pass_to_interview"),
    iv("a2", "approve_recommended"),
    cv("a3", "pass_to_interview"),
    iv("a3", null, "cancelled"),
    cv("a4", "reject"),
    cv("a8", "pass_to_interview"),
    iv("a8", "approve_recommended"),
    cv("a10", "pass_to_interview", "cancelled"),
    cv("a11", "pass_to_interview"),
    iv("a11", "reject")
  ];
  const decisions = [decision("a5", "invited_to_interview", "2026-09-05T00:00:00.000Z"), decision("a5", "rejected_or_not_fit", "2026-09-12T00:00:00.000Z")];
  const invites: InviteInput[] = [
    { personId: "q1", outcome: "accepted", revokedAt: null, expiresAt: "2026-09-30T00:00:00.000Z" },
    { personId: "q2", outcome: "declined", revokedAt: null, expiresAt: "2026-09-30T00:00:00.000Z" },
    { personId: "q2", outcome: "accepted", revokedAt: null, expiresAt: "2026-10-30T00:00:00.000Z" },
    { personId: "q3", outcome: "declined", revokedAt: null, expiresAt: null },
    { personId: "q4", outcome: null, revokedAt: null, expiresAt: "2026-10-30T00:00:00.000Z" },
    { personId: "q5", outcome: null, revokedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-30T00:00:00.000Z" },
    { personId: "q6", outcome: null, revokedAt: null, expiresAt: "2026-10-01T00:00:00.000Z" },
    { personId: "q7", outcome: null, revokedAt: null, expiresAt: null }
  ];
  return { applications, reviews, decisions, savedGroups: new Map([["p1", 3]]), invites, now: NOW };
}

describe("vị trí từng đơn mentor mới", () => {
  it("rớt / rút ở vòng nào: theo phiếu PV đã nộp và lịch sử quyết định; phiếu huỷ không tính; đơn trùng chỉ giữ đơn sau cùng", () => {
    const rows = buildRows(scenario());
    const stage = Object.fromEntries(rows.filter((r) => r.stream === "new").map((r) => [r.applicationId, r.stage]));
    expect(stage).toEqual({
      a1: "official",
      a2: "awaiting_decision",
      a3: "iv_pending",
      a4: "cv_rejected",
      a5: "iv_rejected",
      a6: "official",
      a7: "cv_withdrawn",
      a8: "iv_withdrawn",
      a9: "cv_pending",
      a10: "cv_pending",
      a11: "iv_rejected"
    });
    expect(rows.find((r) => r.applicationId === "a3")?.interviewed).toBe(false);
    expect(rows.find((r) => r.applicationId === "r1")?.stage).toBeNull();
  });
});

describe("phễu mentor mới", () => {
  it("đếm từng vòng và tỷ lệ với đúng mẫu số", () => {
    const { funnel } = buildMentorRecruitmentReport(scenario(), "chinh-thuc");
    expect(funnel.submitted).toBe(11);
    expect(funnel.cv).toEqual({ passed: 7, passedByReview: 5, passedDirect: 2, rejected: 1, withdrawn: 1, pending: 2, passRate: 7 / 8 });
    expect(funnel.interview.entered).toBe(7);
    expect(funnel.interview.interviewed).toBe(4);
    expect(funnel.interview.recommendations).toEqual({ approve: 3, waitlist: 0, reject: 1, needsAdmin: 0 });
    expect(funnel.interview.recommendRate).toBe(3 / 4);
    expect(funnel.interview.withoutForm).toMatchObject({ iv_pending: 1, iv_rejected: 1, official: 1, awaiting_decision: 0 });
    expect(funnel.result.byStage).toMatchObject({ official: 1, awaiting_decision: 1, iv_withdrawn: 1, iv_rejected: 1, iv_pending: 0 });
    expect(funnel.result.officialRate).toBe(1 / 4);
    expect(funnel.result.continuingRate).toBe(2 / 4);
    expect(funnel.officialTotal).toBe(2);
  });

  it("chưa ai có kết quả thì tỷ lệ là null, không phải 0%", () => {
    const { funnel } = buildMentorRecruitmentReport({ ...scenario(), applications: [app("x")], reviews: [], decisions: [] }, "chinh-thuc");
    expect(funnel.cv.passRate).toBeNull();
    expect(funnel.result.officialRate).toBeNull();
  });
});

describe("mentor gia hạn", () => {
  it("theo người: đồng ý ở link nào cũng là đồng ý; chưa trả lời chia còn hạn / hết hạn hoặc thu hồi", () => {
    const { renewal } = buildMentorRecruitmentReport(scenario(), "chinh-thuc");
    expect(renewal).toEqual({
      invited: 7,
      accepted: 2,
      declined: 1,
      pending: 2,
      lapsed: 2,
      acceptanceRate: 2 / 7,
      approved: 1,
      awaitingConfirm: 1
    });
  });
});

describe("hồ sơ mentor", () => {
  it("chính thức: mỗi người một lần — người có cả đơn mới lẫn đơn gia hạn tính là gia hạn", () => {
    const { profile, officialTotal } = buildMentorRecruitmentReport(scenario(), "chinh-thuc");
    expect(officialTotal).toBe(2);
    expect(profile.population).toBe(2);
    expect(profile.experience.columns.map((c) => [c.key, c.total])).toEqual([
      ["new", 1],
      ["renewal", 1]
    ]);
    expect(profile.experience.rows.map((r) => [r.key, r.total])).toEqual([
      ["lt5", 1],
      ["25+", 1]
    ]);
    expect(profile.directorAndAbove).toBe(2);
    expect(profile.seniorityPeople.find((g) => g.level === "c_level")?.people.map((p) => p.applicationId)).toEqual(["r1"]);
    expect(profile.groupsProposed).toBe(1);
    expect(profile.groups.rows.find((r) => r.key === "3")?.cells.map((c) => c.count)).toEqual([1, 0]);
  });

  it("tất cả: mọi đơn (mỗi luồng mỗi người một lần); nguồn biết đến chỉ tính mentor mới", () => {
    const { profile } = buildMentorRecruitmentReport(scenario(), "tat-ca");
    expect(profile.population).toBe(13);
    expect(profile.referral.columns).toEqual([{ key: "new", label: "Mentor mới", total: 11 }]);
    expect(profile.seats).toBe(26);
  });

  it("nhóm khoảng năm: biên đúng, số vô lý tách riêng, bỏ trống là Chưa khai", () => {
    expect([0, 4.9, 5, 9.5, 10, 14, 15, 20, 24, 25, 40].map((n) => experienceBucket(n, false))).toEqual([
      "lt5",
      "lt5",
      "5-9",
      "5-9",
      "10-14",
      "10-14",
      "15-19",
      "20-24",
      "20-24",
      "25+",
      "25+"
    ]);
    expect(experienceBucket(null, true)).toBe("invalid");
    expect(experienceBucket(null, false)).toBe("");
    expect([0, 1, 4, 5, 15].map((n) => managementBucket(n, false))).toEqual(["0", "1-4", "1-4", "5-9", "15+"]);
    const rows = buildRows({ ...scenario(), applications: [app("big", {}, { mentor_people_management_years: "300", mentor_total_work_years: "" })] });
    expect(rows[0]).toMatchObject({ mgmtYearsInvalid: true, mgmtYears: null, workYears: null, workYearsInvalid: false });
  });

  it("công ty: gộp cách viết, nhãn là thương hiệu hoặc cách viết gặp nhiều nhất; tự do / không khai đếm riêng", () => {
    const rows = buildRows({
      ...scenario(),
      applications: [
        app("m1", {}, { company_current: "MB Bank" }),
        app("m2", {}, { company_current: "NH TMCP Quân Đội" }),
        app("c1", {}, { company_current: "Công ty TNHH Hygge" }),
        app("c2", {}, { company_current: "Công ty TNHH Hygge" }),
        app("c3", {}, { company_current: "Hygge Co., Ltd" }),
        app("f1", {}, { company_current: "Tự do" }),
        app("n1", {}, { company_current: "" })
      ]
    });
    const summary = companySummary(rows);
    expect(summary.ranked.map((c) => [c.label, c.count])).toEqual([
      ["Công ty TNHH Hygge", 3],
      ["MB Bank", 2]
    ]);
    expect(summary.ranked[1].people.map((p) => p.applicationId)).toEqual(["m1", "m2"]);
    expect([summary.distinct, summary.independent, summary.undeclared]).toEqual([2, 1, 1]);
  });
});

describe("tỷ lệ đạt vòng hồ sơ theo đặc điểm", () => {
  it("chỉ mentor mới đã có kết quả vòng hồ sơ: đạt (vào vòng PV) và không đạt", () => {
    const { cv: breakdown } = buildMentorRecruitmentReport(scenario(), "chinh-thuc");
    expect(breakdown.byGroup.columns.map((c) => [c.key, c.total])).toEqual([
      ["passed", 7],
      ["rejected", 1]
    ]);
  });
});
