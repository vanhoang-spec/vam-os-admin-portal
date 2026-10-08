/**
 * @vitest-environment jsdom
 */
/**
 * Trang /interviews/bao-cao-mentor trên bản giả PostgREST — chỉ danh tính và ranh giới
 * module Next được giả; đọc bảng, phân trang, dựng báo cáo là mã thật.
 *
 * Điều phải đúng: hai cổng fail-closed (vai trò BTC, quyền vận hành mùa); số trên trang
 * đúng với dữ liệu; tên mở hồ sơ ở tab mới; trang không in email / SĐT của ai.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, within } from "@testing-library/react";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error("REDIRECT:" + destination);
  }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import MentorRecruitmentReportPage from "@/app/interviews/bao-cao-mentor/page";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const db = createFakeDb();

const payload = (over: Record<string, unknown> = {}) => ({
  title_current: "Trưởng phòng Kinh doanh",
  company_current: "MB Bank",
  mentor_total_work_years: "12",
  mentor_people_management_years: "6",
  mentoring_capacity_total: "2",
  university: "UEH",
  referrer_or_source: "friend",
  function_primary: "marketing_sales",
  industry_primary: "fmcg",
  ...over
});

function seed() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [
    { id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" },
    { id: "g2", user_id: "auth-support-read", program_id: null, season_id: SEASON, role: "read", status: "active" }
  ];
  db.tables.applications = [
    {
      id: "app-official", person_id: "p1", full_name: "Lê Chính Thức", email_primary: "chinhthuc@example.test", phone_primary: "0909000001",
      role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form", season_id: SEASON, submitted_at: "2026-09-01T00:00:00Z",
      raw_payload: payload({ title_current: "Giám đốc chi nhánh", company_current: "NH TMCP Quân Đội" })
    },
    {
      id: "app-wait", person_id: null, full_name: "Trần Chờ Chốt", email_primary: "chochot@example.test", role_applied: "mentor",
      status: "ready_for_final_decision", source: "vam_os_form", season_id: SEASON, submitted_at: "2026-09-02T00:00:00Z", raw_payload: payload()
    },
    {
      id: "app-reject", person_id: null, full_name: "Phạm Rớt Hồ Sơ", email_primary: "rot@example.test", role_applied: "mentor",
      status: "rejected_or_not_fit", source: "vam_os_form", season_id: SEASON, submitted_at: "2026-09-03T00:00:00Z", raw_payload: payload()
    },
    {
      id: "app-renew", person_id: "p2", full_name: "Võ Gia Hạn", email_primary: "giahan@example.test", role_applied: "mentor",
      status: "approved_as_mentor", source: "s12_mentor_renewal", season_id: SEASON, submitted_at: "2026-09-04T00:00:00Z",
      raw_payload: { source: "s12_mentor_renewal", renewal: payload({ title_current: "CEO", company_current: "Freelancer", mentor_total_work_years: "25" }) }
    },
    {
      id: "app-mentee", person_id: "p9", full_name: "Mentee Không Tính", email_primary: "mentee@example.test", role_applied: "mentee",
      status: "approved_as_mentee", source: "vam_os_form", season_id: SEASON, submitted_at: "2026-09-04T00:00:00Z", raw_payload: {}
    }
  ];
  db.tables.application_reviews = [
    { id: "r1", application_id: "app-official", review_round: "profile_screening", status: "submitted", recommendation: "pass_to_interview", submitted_at: "2026-09-05T00:00:00Z" },
    { id: "r2", application_id: "app-official", review_round: "interview", status: "submitted", recommendation: "approve_recommended", submitted_at: "2026-09-10T00:00:00Z" },
    { id: "r3", application_id: "app-wait", review_round: "profile_screening", status: "submitted", recommendation: "pass_to_interview", submitted_at: "2026-09-05T00:00:00Z" },
    { id: "r4", application_id: "app-wait", review_round: "interview", status: "submitted", recommendation: "approve_recommended", submitted_at: "2026-09-10T00:00:00Z" },
    { id: "r5", application_id: "app-reject", review_round: "profile_screening", status: "submitted", recommendation: "reject", submitted_at: "2026-09-05T00:00:00Z" }
  ];
  db.tables.application_decisions = [];
  db.tables.matching_industry_assignments = [{ id: "as1", season_id: SEASON, person_id: "p1", role: "mentor", group_code: 1 }];
  db.tables.person_season_invites = [
    { id: "i1", season_id: SEASON, role: "mentor", person_id: "p2", outcome: "accepted", revoked_at: null, expires_at: null },
    { id: "i2", season_id: SEASON, role: "mentor", person_id: "p3", outcome: "declined", revoked_at: null, expires_at: null }
  ];
}

function signIn(role: string, authUserId: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: `admin-${authUserId}`, role, status: "active", auth_user_id: authUserId, email: `${authUserId}@example.test`
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  const client = fakeClient(db, { rpc: () => ({ data: null, error: null }) });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});

const open = async (search: Record<string, string> = {}) =>
  render(<>{await MentorRecruitmentReportPage({ searchParams: Promise.resolve(search) })}</>);

describe("cổng", () => {
  it("Reviewer, Support team chỉ có quyền đọc mùa, người chưa đăng nhập: không thấy số liệu", async () => {
    for (const [role, auth] of [["reviewer", "auth-core"], ["support_team", "auth-support-read"], ["viewer", "auth-core"]]) {
      signIn(role, auth);
      const { container, unmount } = await open();
      expect(container.textContent).toContain("Trang này dành cho BTC");
      expect(container.querySelector('[data-testid="mentor-report-root"]')).toBeNull();
      unmount();
    }
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any);
    const { container } = await open();
    expect(container.querySelector('[data-testid="mentor-report-root"]')).toBeNull();
  });
});

describe("báo cáo", () => {
  it("phễu mentor mới, gia hạn, cấp bậc, công ty đúng với dữ liệu; mentee không lẫn vào", async () => {
    signIn("core_team", "auth-core");
    const { container } = await open();
    const funnel = container.querySelector('[data-testid="funnel"]') as HTMLElement;
    expect(funnel.querySelector('[data-funnel="Nộp đơn"]')?.textContent).toContain("3");
    expect(funnel.querySelector('[data-funnel="Vào vòng phỏng vấn (đạt vòng hồ sơ)"]')?.textContent).toContain("2");
    expect(funnel.querySelector('[data-funnel="Mentor chính thức"]')?.textContent).toContain("1");
    expect(container.querySelector('[data-testid="cv-stage"]')?.textContent).toContain("67%");
    expect(container.querySelector('[data-testid="result-stage"]')?.textContent).toContain("50%");

    const renewal = container.querySelector('[data-testid="renewal"]') as HTMLElement;
    expect(renewal.querySelector('[data-funnel="Được mời gia hạn"]')?.textContent).toContain("2");
    expect(renewal.querySelector('[data-funnel="Đồng ý tham gia mùa này"]')?.textContent).toContain("1");

    // Mặc định: mentor chính thức — 1 mới + 1 gia hạn.
    expect(container.querySelector('[data-testid="scope-banner"]')?.textContent).toContain("2 người");
    const seniority = container.querySelector('[data-testid="seniority-people"]') as HTMLElement;
    expect(within(seniority.querySelector('[data-level="c_level"]') as HTMLElement).getByText("Võ Gia Hạn")).toBeTruthy();
    expect(within(seniority.querySelector('[data-level="director"]') as HTMLElement).getByText("Lê Chính Thức")).toBeTruthy();

    // "NH TMCP Quân Đội" là MB; người làm tự do không thành một công ty.
    const companies = container.querySelector('[data-testid="companies"]') as HTMLElement;
    expect(companies.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(container.textContent).toContain("1 người làm tự do / nghỉ hưu");
    expect(container.textContent).not.toContain("Mentee Không Tính");
  });

  it("tên mở hồ sơ ở tab mới; trang không in email hay SĐT của ai", async () => {
    signIn("core_team", "auth-core");
    const { container } = await open();
    const link = within(container.querySelector('[data-level="director"]') as HTMLElement).getByText("Lê Chính Thức").closest("a")!;
    expect(link.getAttribute("href")).toBe("/applications/app-official");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    for (const secret of ["chinhthuc@example.test", "giahan@example.test", "rot@example.test", "0909000001"]) {
      expect(container.innerHTML).not.toContain(secret);
    }
  });

  it("bảng công ty có dòng tổng; bảng toàn bộ nơi làm việc cộng thêm tự do + không khai cho khớp số người (BTC 09/10/2026)", async () => {
    signIn("core_team", "auth-core");
    db.tables.applications.push(
      {
        id: "app-vcb", person_id: null, full_name: "Đỗ Một Mình", email_primary: "vcb@example.test", role_applied: "mentor",
        status: "submitted", source: "vam_os_form", season_id: SEASON, submitted_at: "2026-09-05T00:00:00Z", raw_payload: payload({ company_current: "Vietcombank" })
      },
      {
        id: "app-blank", person_id: null, full_name: "Ngô Không Khai", email_primary: "blank@example.test", role_applied: "mentor",
        status: "submitted", source: "vam_os_form", season_id: SEASON, submitted_at: "2026-09-06T00:00:00Z", raw_payload: payload({ company_current: "" })
      }
    );
    // Mọi người: 3 MB (một người viết "NH TMCP Quân Đội"), 1 Vietcombank, 1 tự do, 1 không khai = 6.
    const { container } = await open({ "pham-vi": "tat-ca" });
    const cells = (testId: string) =>
      Array.from(container.querySelectorAll(`[data-testid="${testId}"] td`)).map((td) => td.textContent?.trim());

    const many = container.querySelector('[data-testid="companies-total"]') as HTMLElement;
    expect(many.tagName).toBe("TFOOT");
    expect(many.closest("table")).toBe(container.querySelector('[data-testid="companies"] table'));
    expect(cells("companies-total")).toEqual(["", "Tổng 1 nơi", "3", "50% trong 6 người của phạm vi đang xem"]);

    const all = container.querySelector('[data-testid="companies-all-total"]') as HTMLElement;
    expect(all.closest("table")).toBe(container.querySelector('[data-testid="companies-all"]'));
    expect(cells("companies-all-total")).toEqual(["Tổng cả bảng: 2 nơi", "4", "+ 1 tự do / nghỉ hưu + 1 không khai = 6 người"]);
    // Bảng toàn bộ giờ có tiêu đề cột — trước đây chỉ có dòng, không biết cột số là gì.
    expect(Array.from(container.querySelectorAll('[data-testid="companies-all"] thead th')).map((th) => th.textContent)).toEqual(["Công ty", "Số mentor", "Mentor"]);
  });

  it("?pham-vi=tat-ca: tính mọi người nộp đơn / gia hạn; giá trị lạ quay về mặc định", async () => {
    signIn("core_team", "auth-core");
    const all = await open({ "pham-vi": "tat-ca" });
    expect(all.container.querySelector('[data-testid="scope-banner"]')?.textContent).toContain("4 người");
    expect(all.container.querySelector('[data-testid="scope-switch"] [aria-current="page"]')?.textContent).toBe("Mọi người nộp đơn / gia hạn");
    all.unmount();
    const odd = await open({ "pham-vi": "linh-tinh" });
    expect(odd.container.querySelector('[data-testid="scope-banner"]')?.textContent).toContain("2 người");
  });
});
