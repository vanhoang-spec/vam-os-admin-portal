/** @vitest-environment jsdom */
/**
 * Điểm cộng theo ngày nộp — nơi người xếp hạng nhìn thấy nó.
 *
 * Canh: file CSV điểm review có đúng hai cột mới ở CUỐI (cột cũ không dịch chỗ),
 * đơn trong mốc được cộng vào tổng của từng reviewer, và khi không đọc được mốc
 * thì màn hình / file nói "không đọc được" chứ không in thành 0. Khung đánh giá của
 * Core Team in tổng sau cộng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scope: "test" })),
  canOperateSeason: vi.fn(async () => true)
}));
vi.mock("@/app/actions/application-decisions", () => ({ updateApplicationDecisionAction: vi.fn() }));

// react-dom 18.3.1 bản ổn định không có useFormState; Next dùng bản đóng gói riêng.
// Giả như các test khác của khung này, để render được mà không đổi thứ đang kiểm.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: () => [{ ok: false, message: null }, vi.fn()],
    useFormStatus: () => ({ pending: false })
  };
});

import { GET as scoresGet } from "@/app/api/exports/review-scores/route";
import { ScreeningDecisionPanel } from "@/app/applications/[id]/screening-decision-panel";
import { scoreWithBonusText, SubmissionBonusBadge } from "@/components/submission-bonus-badge";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason } from "@/lib/program-scope";
import { buildScreeningDecisionState } from "@/lib/screening-decision";
import { resolveSubmissionBonus } from "@/lib/submission-bonus-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

const BOM = String.fromCharCode(0xfeff);
const SEASON = "11111111-1111-4111-8111-111111111111";
const BATCH = "33333333-3333-4333-8333-333333333333";

const db = createFakeDb();

function review(id: string, createdAt: string, role = "mentee") {
  return {
    id,
    application_id: `app-${id}`,
    reviewer_admin_user_id: "r-1",
    review_round: "profile_screening",
    status: "submitted",
    score_motivation: 4,
    score_goal_clarity: 4,
    score_commitment: 5,
    score_fit: 3,
    score_communication: 4,
    total_score: 20,
    recommendation: "advance",
    reviewer_note: "",
    submitted_at: "2026-09-12T00:00:00Z",
    reviewer: { email: "rev@example.com", full_name: "Reviewer" },
    application: {
      full_name: "Người nộp",
      email_primary: "a@example.com",
      role_applied: role,
      season_id: SEASON,
      intake_batch_id: BATCH,
      created_at: createdAt
    }
  };
}

function parseCsv(text: string) {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  return body.split("\n").map((line) => line.split('","').map((cell) => cell.replace(/^"|"$/g, "")));
}

async function exportRows() {
  const res = await scoresGet(new Request(`https://preview.test/x?season_id=${SEASON}`));
  expect(res.status).toBe(200);
  return parseCsv(await res.text());
}

beforeEach(() => {
  db.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "admin" } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true as never);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  db.tables.intake_batches = [{ id: BATCH, season_id: SEASON }];
  db.tables.submission_bonus_rules = [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      form_kind: "application",
      intake_batch_id: BATCH,
      role_applied: "mentee",
      label: "Nộp sớm",
      starts_on: null,
      ends_on: "2026-09-10",
      points: 3
    }
  ];
});

afterEach(() => cleanup());

describe("1. file CSV điểm review", () => {
  it("hai cột mới nằm ở cuối; cột Tổng điểm không dịch chỗ", async () => {
    db.tables.application_reviews = [review("aaaaaaaa-0000-4000-8000-0000000000a1", "2026-09-09T03:00:00Z")];
    const [headers] = await exportRows();
    expect(headers[13]).toBe("Tổng điểm");
    expect(headers[16]).toBe("Thời điểm gửi");
    expect(headers.slice(-2)).toEqual(["Điểm cộng theo ngày nộp (của đơn)", "Tổng điểm sau cộng"]);
  });

  it("đơn nộp trong mốc: +3, tổng sau cộng 23", async () => {
    db.tables.application_reviews = [review("aaaaaaaa-0000-4000-8000-0000000000a1", "2026-09-10T16:59:00Z")];
    const [, row] = await exportRows();
    expect(row[13]).toBe("20");
    expect(row.slice(-2)).toEqual(["3", "23"]);
  });

  it("đơn nộp 00:30 sáng 11/09 giờ Việt Nam: ngoài mốc 'đến hết 10/09' — 0 điểm cộng", async () => {
    db.tables.application_reviews = [review("aaaaaaaa-0000-4000-8000-0000000000a1", "2026-09-10T17:30:00Z")];
    const [, row] = await exportRows();
    expect(row.slice(-2)).toEqual(["0", "20"]);
  });

  it("mốc của form mentee không cộng cho đơn mentor cùng đợt", async () => {
    db.tables.application_reviews = [review("aaaaaaaa-0000-4000-8000-0000000000a1", "2026-09-09T03:00:00Z", "mentor")];
    const [, row] = await exportRows();
    expect(row.slice(-2)).toEqual(["0", "20"]);
  });

  it("không đọc được bảng mốc: ghi rõ 'Không đọc được', không ghi 0", async () => {
    db.errors.submission_bonus_rules = { code: "42P01", message: "relation does not exist" };
    db.tables.application_reviews = [review("aaaaaaaa-0000-4000-8000-0000000000a1", "2026-09-09T03:00:00Z")];
    const [, row] = await exportRows();
    expect(row.slice(-2)).toEqual(["Không đọc được", ""]);
    expect(row[13]).toBe("20");
  });
});

describe("2. ô điểm cộng trong danh sách duyệt", () => {
  const rules = [{ id: "r1", label: "Nộp sớm", startsOn: null, endsOn: "2026-09-10", points: 3 }];

  it("được cộng: +3, kèm mốc khi rê chuột", () => {
    render(<SubmissionBonusBadge bonus={resolveSubmissionBonus(rules, "2026-09-09T03:00:00Z")} />);
    const badge = screen.getByTestId("submission-bonus-points");
    expect(badge.textContent).toBe("+3");
    expect(badge.getAttribute("title")).toBe("Nộp sớm · Nộp đến hết 10/09/2026");
  });

  it("không được cộng: gạch ngang, không có huy hiệu", () => {
    const { container } = render(<SubmissionBonusBadge bonus={resolveSubmissionBonus(rules, "2026-09-12T03:00:00Z")} />);
    expect(container.textContent).toBe("—");
    expect(screen.queryByTestId("submission-bonus-points")).toBeNull();
  });

  it("không đọc được: một ô riêng, không trông như 'không được cộng'", () => {
    const { container } = render(<SubmissionBonusBadge bonus={resolveSubmissionBonus(null, "2026-09-09T03:00:00Z")} />);
    expect(screen.getByTestId("submission-bonus-unknown").textContent).toBe("Chưa rõ");
    expect(container.textContent).not.toBe("—");
  });

  it("chữ tổng điểm", () => {
    const bonus = resolveSubmissionBonus(rules, "2026-09-09T03:00:00Z");
    expect(scoreWithBonusText(18, bonus)).toBe("18 + 3 = 21");
    expect(scoreWithBonusText(18, { kind: "none", submittedOn: null })).toBe("18");
    expect(scoreWithBonusText(18, { kind: "unknown" })).toBe("18");
    expect(scoreWithBonusText(null, bonus)).toBe("-");
  });
});

describe("3. khung đánh giá của Core Team", () => {
  const state = buildScreeningDecisionState({
    applicationStatus: "screening_completed",
    reviews: [
      {
        id: "rv-1",
        review_round: "profile_screening",
        status: "submitted",
        reviewer_admin_user_id: "r-1",
        total_score: 18,
        recommendation: "pass_to_interview",
        reviewer_note: null,
        submitted_at: "2026-09-12T03:00:00Z"
      }
    ],
    requiredCount: 1,
    actorAdminUserId: "core-1",
    reviewerNameById: new Map([["r-1", "Reviewer A"]])
  });

  it("đơn được cộng: in tổng sau cộng của reviewer", () => {
    render(
      <ScreeningDecisionPanel
        applicationId="app-1"
        currentStatus="screening_completed"
        state={state}
        canAssignReview
        submissionBonus={resolveSubmissionBonus(
          [{ id: "r1", label: null, startsOn: null, endsOn: "2026-09-10", points: 3 }],
          "2026-09-09T03:00:00Z"
        )}
      />
    );
    expect(screen.getByTestId("screening-evidence-row").textContent).toContain("Điểm tổng: 18 + 3 = 21");
  });

  it("không truyền điểm cộng: in điểm reviewer như cũ", () => {
    render(<ScreeningDecisionPanel applicationId="app-1" currentStatus="screening_completed" state={state} canAssignReview />);
    const row = screen.getByTestId("screening-evidence-row").textContent ?? "";
    expect(row).toContain("Điểm tổng: 18");
    expect(row).not.toContain("+");
  });
});
