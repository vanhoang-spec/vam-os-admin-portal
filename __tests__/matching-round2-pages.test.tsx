/**
 * @vitest-environment jsdom
 */
/**
 * Vòng 2 — trang Phân nhóm, trang Báo cáo, nút "Phân loại người mới" và file CSV, chạy
 * trên bản giả PostgREST. Chỉ danh tính và ranh giới module Next được giả.
 *
 * Điều phải đúng: đọc đúng dữ liệu mentor gia hạn (nằm dưới raw_payload.renewal); người
 * đã rút không vào danh sách; nút phân loại gửi ĐÚNG MỘT lệnh lưu do máy chủ tự tính, và
 * không gửi gì khi người bấm không có quyền vận hành mùa.
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
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()],
    useFormStatus: () => ({ pending: false })
  };
});
vi.mock("next/link", () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import Round2GroupsPage from "@/app/matches/vong-2/page";
import Round2ReportPage from "@/app/matches/vong-2/bao-cao/page";
import { classifyNewAction } from "@/app/actions/matching-round2";
import { GET as exportRound2 } from "@/app/api/exports/matching-round2/route";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const db = createFakeDb();
let rpcCalls: Array<{ fn: string; args: any }> = [];

function seed() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [
    { id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" },
    { id: "g2", user_id: "auth-support", program_id: null, season_id: SEASON, role: "operations", status: "active" }
  ];
  db.tables.people = [
    { id: "p-new", full_name: "Mentor Đơn Mới", email_primary: "new@example.test" },
    { id: "p-renew", full_name: "Mentor Gia Hạn", email_primary: "renew@example.test" },
    { id: "p-mentee", full_name: "Mentee Kế Toán", email_primary: "mentee@example.test" },
    { id: "p-gone", full_name: "Mentee Đã Rút", email_primary: "gone@example.test" }
  ];
  db.tables.applications = [
    {
      id: "a-new", person_id: "p-new", season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form",
      raw_payload: { title_current: "HR Business Partner", function_primary: "hr_people", industry_primary: "fmcg", mentoring_capacity_total: "2" }
    },
    {
      id: "a-renew", person_id: "p-renew", season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "s12_mentor_renewal",
      raw_payload: { renewal: { title_current: "Kế toán trưởng", function_primary: "finance_accounting", industry_primary: "manufacturing" } }
    },
    {
      id: "a-mentee", person_id: "p-mentee", season_id: SEASON, role_applied: "mentee", status: "approved_as_mentee", source: "vam_os_form",
      raw_payload: { target_function: "finance_accounting", target_industry: "undecided", major: "Kiểm toán", school_or_faculty: "ke_toan", year_of_study: "3" }
    },
    {
      id: "a-gone", person_id: "p-gone", season_id: SEASON, role_applied: "mentee", status: "approved_as_mentee", source: "vam_os_form",
      raw_payload: { target_function: "marketing", target_industry: "fmcg", major: "Marketing" }
    }
  ];
  db.tables.mentor_profiles = [
    { id: "mp-new", person_id: "p-new", title_current: "HR Business Partner", industry: "fmcg", function_area: "hr_people", capacity_target: 2 },
    { id: "mp-renew", person_id: "p-renew", title_current: null, industry: null, function_area: null, capacity_target: 3 }
  ];
  db.tables.person_season_memberships = [{ id: "psm1", person_id: "p-gone", season_id: SEASON, role: "mentee", status: "withdrawn" }];
  db.tables.matches = [];
  db.tables.matching_industry_assignments = [];
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
  rpcCalls = [];
  const client = fakeClient(db, {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return { data: { ok: true, newMentors: 2, newMentees: 1, drift: 0 }, error: null };
    }
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});

const personRow = (container: HTMLElement, personId: string) => {
  const row = container.querySelector(`tr[data-person="${personId}"]`);
  if (!row) throw new Error(`không thấy dòng ${personId}`);
  return row as HTMLElement;
};

describe("trang Vòng 2 · Phân nhóm ngành", () => {
  it("BTC: thấy đề xuất cho người chưa có nhóm, đọc đúng mentor gia hạn, người đã rút không vào danh sách chờ", async () => {
    signIn("core_team", "auth-core");
    const { container } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(container.querySelector('[data-testid="classify-panel"]')).not.toBeNull();
    expect(within(personRow(container, "p-renew")).getByText("2. Kế toán - Kiểm toán")).toBeTruthy();
    expect(within(personRow(container, "p-new")).getByText("6. Nhân sự")).toBeTruthy();
    expect(within(personRow(container, "p-mentee")).getByText("2. Kế toán - Kiểm toán")).toBeTruthy();
    expect(personRow(container, "p-gone").textContent).toContain("Đã rút");
    expect(container.querySelector('[data-testid="classify-panel"]')!.textContent).toContain("Phân loại 3 người mới");
  });

  it("Support team xem được nhưng không có nút lưu; Reviewer không vào được", async () => {
    signIn("support_team", "auth-support");
    const { container, unmount } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(container.querySelector('[data-testid="round2-table"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="classify-panel"]')).toBeNull();
    unmount();
    signIn("reviewer", "auth-reviewer");
    const denied = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(denied.container.textContent).toContain("Không có quyền truy cập");
    expect(denied.container.querySelector('[data-testid="round2-table"]')).toBeNull();
  });
});

describe("nút Phân loại người mới", () => {
  it("gửi đúng một lệnh lưu, do máy chủ tự tính: mentor trước, không có người đã rút", async () => {
    signIn("core_team", "auth-core");
    const form = new FormData();
    form.set("group", "1"); // form có gửi gì cũng không được dùng
    const state = await classifyNewAction(ROUND2_IDLE, form);
    expect(state.status).toBe("ok");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("vam112_save_industry_assignments");
    expect(rpcCalls[0].args.p_actor).toBe("admin-auth-core");
    expect(rpcCalls[0].args.p_season).toBe(SEASON);
    expect(rpcCalls[0].args.p_rows.map((r: any) => [r.role, r.personId, r.group])).toEqual([
      ["mentor", "p-new", 6],
      ["mentor", "p-renew", 2],
      ["mentee", "p-mentee", 2]
    ]);
  });

  it("không có quyền vận hành mùa thì không gửi gì", async () => {
    signIn("support_team", "auth-support");
    const state = await classifyNewAction(ROUND2_IDLE, new FormData());
    expect(state.status).toBe("error");
    signIn("core_team", "auth-no-scope");
    expect((await classifyNewAction(ROUND2_IDLE, new FormData())).status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("báo cáo và CSV", () => {
  it("báo cáo hiện bảng đối soát; CSV chỉ cho người vận hành mùa", async () => {
    db.tables.matching_industry_assignments = [
      { id: "as1", season_id: SEASON, person_id: "p-renew", role: "mentor", group_code: 2, confidence: "cao", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null },
      { id: "as2", season_id: SEASON, person_id: "p-mentee", role: "mentee", group_code: 2, confidence: "trung_binh", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null }
    ];
    signIn("support_team", "auth-support");
    const { container } = render(<>{await Round2ReportPage()}</>);
    const group2 = container.querySelector('[data-testid="group-table"] tr[data-group="2"]')!;
    expect(group2.textContent).toContain("Khớp");
    expect(container.textContent).not.toContain("Tải CSV");
    expect((await exportRound2(new Request("https://x.test/api/exports/matching-round2?list=mentor"))).status).toBe(403);

    signIn("core_team", "auth-core");
    const bad = await exportRound2(new Request("https://x.test/api/exports/matching-round2?list=all"));
    expect(bad.status).toBe(400);
    const res = await exportRound2(new Request("https://x.test/api/exports/matching-round2?list=mentor"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const csv = await res.text();
    expect(csv).toContain("Mentor Gia Hạn");
    expect(csv).toContain("renew@example.test");
    expect(csv).not.toContain("Mentor Đơn Mới"); // chưa có nhóm → chưa nhận danh sách
  });
});
