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
import { fireEvent, render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { classifyNewAction, confirmMenteeGroupsAction, confirmMentorGroupsAction, setGroupAction } from "@/app/actions/matching-round2";
import { GET as exportRound2 } from "@/app/api/exports/matching-round2/route";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const db = createFakeDb();
let rpcCalls: Array<{ fn: string; args: any }> = [];
let rpcError: { message: string } | null = null;
let rpcApproved: number | null = null;

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
  rpcError = null;
  rpcApproved = null;
  const client = fakeClient(db, {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (rpcError) return { data: null, error: rpcError };
      if (fn === "vam115_confirm_mentor_groups" || fn === "vam122_confirm_mentee_groups") return { data: { ok: true, approved: rpcApproved ?? args.p_rows.length }, error: null };
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

describe("cột Hồ sơ có Công ty, tên mở hồ sơ ở tab mới (BTC 08/10/2026)", () => {
  const detailLine = (container: HTMLElement, personId: string, label: string) =>
    Array.from(personRow(container, personId).querySelectorAll("div"))
      .map((d) => d.textContent ?? "")
      .find((t) => t.startsWith(`${label}:`)) ?? null;

  it("mentor: Công ty lấy từ đơn (cả đơn gia hạn), đơn trống thì lấy hồ sơ mentor; mentee không có dòng Công ty", async () => {
    db.tables.applications[0].raw_payload.company_current = "Công ty Sữa Đơn Mới";
    db.tables.mentor_profiles[0].company_current = "Công ty Cũ Không Dùng";
    db.tables.mentor_profiles[1].company_current = "Nhà máy Hồ Sơ Mentor";
    signIn("support_team", "auth-support");
    const { container } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(detailLine(container, "p-new", "Công ty")).toBe("Công ty: Công ty Sữa Đơn Mới");
    expect(detailLine(container, "p-renew", "Công ty")).toBe("Công ty: Nhà máy Hồ Sơ Mentor");
    expect(detailLine(container, "p-mentee", "Công ty")).toBeNull();
  });

  it("đơn gia hạn có công ty dưới raw_payload.renewal thì dùng công ty đó", async () => {
    db.tables.applications[1].raw_payload.renewal.company_current = "Tập đoàn Gia Hạn";
    db.tables.mentor_profiles[1].company_current = "Nhà máy Hồ Sơ Mentor";
    signIn("core_team", "auth-core");
    const { container } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(detailLine(container, "p-renew", "Công ty")).toBe("Công ty: Tập đoàn Gia Hạn");
  });

  it("tên mentor và mentee là link tới đúng đơn đã dùng để xếp nhóm, mở tab mới", async () => {
    signIn("support_team", "auth-support");
    const { container } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    for (const [personId, appId, name] of [
      ["p-renew", "a-renew", "Mentor Gia Hạn"],
      ["p-mentee", "a-mentee", "Mentee Kế Toán"]
    ]) {
      const links = personRow(container, personId).querySelectorAll('a[data-testid="profile-link"]');
      expect(links).toHaveLength(1);
      const link = links[0] as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(`/applications/${appId}`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.textContent).toContain(name);
    }
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

describe("nút duyệt mentor hàng loạt", () => {
  const submit = (confirmed = "yes") => {
    const form = new FormData();
    form.set("confirmed", confirmed);
    form.set("rows", JSON.stringify([{ assignmentId: "a5000000-0000-4000-8000-000000000001", expectedGroup: 3, expectedDrift: null }]));
    return confirmMentorGroupsAction(ROUND2_IDLE, form);
  };
  it("Support có quyền gửi đúng một RPC với mùa, người duyệt và nhóm đang xem", async () => {
    signIn("support_team", "auth-support");
    expect((await submit()).status).toBe("ok");
    expect(rpcCalls).toEqual([{ fn: "vam115_confirm_mentor_groups", args: {
      p_actor: "admin-auth-support", p_season: SEASON,
      p_rows: [{ assignmentId: "a5000000-0000-4000-8000-000000000001", expectedGroup: 3, expectedDrift: null }]
    } }]);
  });
  it("thiếu xác nhận hoặc không có quyền mùa không gửi gì", async () => {
    signIn("support_team", "auth-support");
    expect((await submit("no")).status).toBe("error");
    signIn("support_team", "auth-no-scope");
    expect((await submit()).status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("nút duyệt mentee hàng loạt (BTC 13/10/2026)", () => {
  const ROW = { assignmentId: "a5000000-0000-4000-8000-000000000002", expectedGroup: 2, expectedDrift: null };
  const submit = (opts: { confirmed?: string; rows?: unknown } = {}) => {
    const form = new FormData();
    form.set("confirmed", opts.confirmed ?? "yes");
    form.set("rows", typeof opts.rows === "string" ? opts.rows : JSON.stringify(opts.rows ?? [ROW]));
    return confirmMenteeGroupsAction(ROUND2_IDLE, form);
  };

  it("Support có quyền gửi đúng MỘT lệnh của MENTEE (không phải của mentor) với mùa, người duyệt và nhóm đang xem", async () => {
    signIn("support_team", "auth-support");
    const state = await submit();
    expect(state).toEqual({ status: "ok", message: "Đã ghi nhận BTC đã duyệt cho 1 mentee." });
    expect(rpcCalls).toEqual([{ fn: "vam122_confirm_mentee_groups", args: { p_actor: "admin-auth-support", p_season: SEASON, p_rows: [ROW] } }]);
  });

  it("Core team cũng duyệt được; trang được làm mới sau khi duyệt xong, và chỉ khi xong", async () => {
    const { revalidatePath } = await import("next/cache");
    signIn("core_team", "auth-core");
    expect((await submit()).status).toBe("ok");
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual(["/matches/vong-2", "/matches/vong-2/bao-cao"]);
    vi.mocked(revalidatePath).mockClear();
    rpcError = { message: "STALE_GROUP" };
    expect((await submit()).status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("hành động của mentor không bao giờ gọi lệnh của mentee và ngược lại", async () => {
    signIn("support_team", "auth-support");
    const mentorForm = new FormData();
    mentorForm.set("confirmed", "yes");
    mentorForm.set("rows", JSON.stringify([ROW]));
    await confirmMentorGroupsAction(ROUND2_IDLE, mentorForm);
    await submit();
    expect(rpcCalls.map((c) => c.fn)).toEqual(["vam115_confirm_mentor_groups", "vam122_confirm_mentee_groups"]);
  });

  it("thiếu dấu xác nhận, không có quyền mùa, hay danh sách sai hình dạng thì KHÔNG gửi gì, và câu báo nói 'mentee'", async () => {
    signIn("support_team", "auth-support");
    expect((await submit({ confirmed: "no" })).status).toBe("error");
    for (const rows of [[], "không phải JSON", [{ ...ROW, expectedGroup: 12 }], [ROW, ROW], Array(501).fill(ROW)]) {
      const state = await submit({ rows: rows as any });
      expect(state, JSON.stringify(rows).slice(0, 40)).toEqual({ status: "error", message: "Danh sách không hợp lệ. Chọn từ 1 đến 500 mentee rồi thử lại." });
    }
    signIn("support_team", "auth-no-scope");
    expect((await submit()).status).toBe("error");
    signIn("reviewer", "auth-core");
    expect((await submit()).status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });

  it("lỗi của database được nói bằng lời người dùng hiểu", async () => {
    signIn("support_team", "auth-support");
    const cases: Array<[string, RegExp]> = [
      ["NOT_APPROVED", /không còn ở trạng thái đã duyệt/],
      ["STALE_GROUP", /vừa được đổi ở nơi khác/],
      ["NOT_FOUND", /Không tìm thấy người này/],
      ["ACCESS_DENIED", /không có quyền vận hành ghép cặp/],
      ["deadlock detected", /Không lưu được/]
    ];
    for (const [code, expected] of cases) {
      rpcError = { message: code };
      const state = await submit();
      expect(state.status, code).toBe("error");
      expect(state.message, code).toMatch(expected);
    }
  });

  it("database báo số người được duyệt khác số đã gửi thì KHÔNG báo thành công", async () => {
    signIn("support_team", "auth-support");
    rpcApproved = 0;
    expect(await submit()).toEqual({ status: "error", message: "Chưa xác nhận được kết quả. Tải lại trang để kiểm tra." });
  });

  describe("thanh duyệt trên trang theo ô 'Vai trò'", () => {
    const seedAssignments = () => {
      const base = { season_id: SEASON, confidence: "thap", secondary_groups: [], evidence: { reasons: [] }, drift_group: null };
      db.tables.matching_industry_assignments = [
        { ...base, id: "a5000000-0000-4000-8000-000000000002", person_id: "p-mentee", role: "mentee", group_code: 2, flags: ["CAN_BTC_XEM"], source: "auto" },
        { ...base, id: "a5000000-0000-4000-8000-000000000003", person_id: "p-renew", role: "mentor", group_code: 2, flags: [], source: "auto" },
        { ...base, id: "a5000000-0000-4000-8000-000000000004", person_id: "p-new", role: "mentor", group_code: 6, flags: [], source: "btc" }
      ];
    };
    const view = async (search: Record<string, string>, role = "support_team", auth = "auth-support") => {
      signIn(role, auth);
      return render(<>{await Round2GroupsPage({ searchParams: Promise.resolve(search) })}</>);
    };
    const ticks = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLInputElement>("input[data-round2-approve]")).map((i) => i.getAttribute("aria-label"));

    it("xem Mentee: thanh nói 'mentee' và chỉ mentee còn do máy gán có ô tick", async () => {
      seedAssignments();
      const { container } = await view({ vai: "mentee" });
      expect(container.textContent).toContain("Chọn tất cả mentee chưa duyệt đang hiện (1)");
      expect(container.textContent).toContain("Mentee đã duyệt có nhãn");
      expect(ticks(container)).toEqual(["Duyệt nhóm của Mentee Kế Toán"]);
      expect(container.querySelector('[data-testid="bulk-note"]')).toBeNull();
    });

    it("xem Mentor: thanh nói 'mentor'; mentor đã được BTC duyệt không có ô tick", async () => {
      seedAssignments();
      const { container } = await view({ vai: "mentor" });
      expect(container.textContent).toContain("Chọn tất cả mentor chưa duyệt đang hiện (1)");
      expect(ticks(container)).toEqual(["Duyệt nhóm của Mentor Gia Hạn"]);
      expect(personRow(container, "p-new").textContent).toContain("Đã duyệt");
      expect(container.querySelector('[data-testid="bulk-note"]')).toBeNull();
    });

    it("xem cả hai vai trò: giữ như cũ (mentor) và có dòng nhắc chọn Vai trò = Mentee", async () => {
      seedAssignments();
      const { container } = await view({});
      expect(container.textContent).toContain("Chọn tất cả mentor chưa duyệt đang hiện (1)");
      expect(ticks(container)).toEqual(["Duyệt nhóm của Mentor Gia Hạn"]);
      expect(container.querySelector('[data-testid="bulk-note"]')!.textContent).toContain("Chọn “Vai trò = Mentee”");
    });

    // Thêm một mentee thật (người + đơn đã duyệt + dòng phân nhóm) để dữ liệu mẫu có nhiều hơn một mentee.
    const addMentee = (n: number, name: string, over: { flags?: string[]; source?: string } = {}) => {
      const id = `p-extra-${n}`;
      db.tables.people.push({ id, full_name: name, email_primary: `${id}@example.test` });
      db.tables.applications.push({ id: `a-extra-${n}`, person_id: id, season_id: SEASON, role_applied: "mentee", status: "approved_as_mentee", source: "vam_os_form", raw_payload: { target_function: "marketing", target_industry: "fmcg", major: "Marketing" } });
      db.tables.matching_industry_assignments.push({ id: `a5000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, season_id: SEASON, person_id: id, role: "mentee", group_code: 4, confidence: "cao", flags: over.flags ?? [], secondary_groups: [], evidence: { reasons: [] }, source: over.source ?? "auto", drift_group: null });
    };

    it("HTML dựng ở máy chủ (trước khi trình duyệt chạy mã) đã đếm đúng: chỉ người đúng vai trò, đủ điều kiện, còn do máy gán", async () => {
      seedAssignments();
      // Mentee đã rút còn dòng phân nhóm (không đủ điều kiện) và mentee đã được BTC duyệt: có trên bảng, không thuộc danh sách chờ duyệt.
      db.tables.matching_industry_assignments.push({ id: "a5000000-0000-4000-8000-000000000005", season_id: SEASON, person_id: "p-gone", role: "mentee", group_code: 5, confidence: "thap", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null });
      addMentee(1, "Mentee Đã Duyệt", { source: "btc" });
      signIn("support_team", "auth-support");
      const menteeView = renderToStaticMarkup(<>{await Round2GroupsPage({ searchParams: Promise.resolve({ vai: "mentee" }) })}</>);
      expect(menteeView).toContain("Chọn tất cả mentee chưa duyệt đang hiện (1)");
      // Xem cả hai vai trò: thanh chỉ áp cho mentor, nên mentee không được lọt vào đếm.
      const bothView = renderToStaticMarkup(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
      expect(bothView).toContain("Chọn tất cả mentor chưa duyệt đang hiện (1)");
    });

    it("chọn tất cả rồi mở hộp xác nhận: người còn cờ 'Cần BTC xem' được cảnh báo và đánh dấu đúng người", async () => {
      seedAssignments();
      addMentee(2, "Mentee Không Cờ");
      const { container } = await view({ vai: "mentee" });
      fireEvent.click(within(container).getByLabelText(/Chọn tất cả mentee/));
      fireEvent.click(within(container).getByRole("button", { name: "Duyệt 2 mentee đã chọn" }));
      const dialog = within(container).getByRole("dialog");
      expect(within(dialog).getByTestId("bulk-flagged-warning").textContent).toContain("1 người trong danh sách đang có cờ");
      expect(within(dialog).getAllByText("Cần BTC xem")).toHaveLength(1);
      expect(within(within(dialog).getByText("Mentee Kế Toán").closest("td")!).getByText("Cần BTC xem")).toBeTruthy();
    });

    it("tick riêng từng người: người còn cờ thì hộp xác nhận cảnh báo, người không cờ thì không", async () => {
      seedAssignments();
      addMentee(2, "Mentee Không Cờ");
      const flagged = await view({ vai: "mentee" });
      fireEvent.click(within(flagged.container).getByLabelText("Duyệt nhóm của Mentee Kế Toán"));
      fireEvent.click(within(flagged.container).getByRole("button", { name: "Duyệt 1 mentee đã chọn" }));
      expect(within(within(flagged.container).getByRole("dialog")).getByTestId("bulk-flagged-warning")).toBeTruthy();
      flagged.unmount();
      const clean = await view({ vai: "mentee" });
      fireEvent.click(within(clean.container).getByLabelText("Duyệt nhóm của Mentee Không Cờ"));
      fireEvent.click(within(clean.container).getByRole("button", { name: "Duyệt 1 mentee đã chọn" }));
      expect(within(within(clean.container).getByRole("dialog")).queryByTestId("bulk-flagged-warning")).toBeNull();
    });

    it("mentee đã rút không có ô tick dù đang có dòng; không có quyền sửa nhóm thì không có thanh duyệt nào", async () => {
      seedAssignments();
      db.tables.matching_industry_assignments.push({ id: "a5000000-0000-4000-8000-000000000005", season_id: SEASON, person_id: "p-gone", role: "mentee", group_code: 5, confidence: "thap", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null });
      db.tables.admin_scope_access.push({ id: "g9", user_id: "auth-support-read", program_id: null, season_id: SEASON, role: "read", status: "active" });
      const withEdit = await view({ vai: "mentee" });
      expect(ticks(withEdit.container)).toEqual(["Duyệt nhóm của Mentee Kế Toán"]);
      withEdit.unmount();
      const readOnly = await view({ vai: "mentee" }, "support_team", "auth-support-read");
      expect(readOnly.container.querySelector('[data-testid="round2-table"]')).not.toBeNull();
      expect(readOnly.container.textContent).not.toContain("Chọn tất cả");
      expect(ticks(readOnly.container)).toEqual([]);
      expect(readOnly.container.querySelector('[data-testid="bulk-note"]')).toBeNull();
    });
  });
});

describe("đổi / xác nhận nhóm từng người (Support team được làm từ 08/10/2026)", () => {
  const seedAssignments = () => {
    db.tables.matching_industry_assignments = [
      { id: "a5000000-0000-4000-8000-000000000001", season_id: SEASON, person_id: "p-mentee", role: "mentee", group_code: 2, confidence: "thap", flags: ["CAN_BTC_XEM"], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null }
    ];
    db.tables.admin_scope_access.push(
      { id: "g3", user_id: "auth-support-read", program_id: null, season_id: SEASON, role: "read", status: "active" },
      { id: "g4", user_id: "auth-reviewer-ops", program_id: null, season_id: SEASON, role: "operations", status: "active" }
    );
  };
  const editForm = (container: HTMLElement) => personRow(container, "p-mentee").querySelector('[data-testid="group-edit-form"]');
  const submit = (group: number, reason = "Bạn muốn làm phân tích đầu tư") => {
    const form = new FormData();
    form.set("assignmentId", "a5000000-0000-4000-8000-000000000001");
    form.set("expectedGroup", "2");
    form.set("newGroup", String(group));
    form.set("reason", reason);
    return setGroupAction(ROUND2_IDLE, form);
  };

  it("Support team có quyền vận hành mùa: thấy ô đổi nhóm ở đúng dòng, nhưng vẫn không có nút phân loại", async () => {
    seedAssignments();
    signIn("support_team", "auth-support");
    const { container } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(editForm(container)).not.toBeNull();
    expect(container.querySelector('[data-testid="classify-panel"]')).toBeNull();
    expect(container.textContent).toContain("Bạn vẫn đổi / xác nhận được nhóm");
  });

  it("Support team bấm Lưu nhóm: gửi đúng một lệnh đổi nhóm, mang chính người bấm", async () => {
    seedAssignments();
    signIn("support_team", "auth-support");
    const state = await submit(3);
    expect(state).toEqual({ status: "ok", message: "Đã đổi sang nhóm 3." });
    expect(rpcCalls).toEqual([
      {
        fn: "vam112_set_industry_group",
        args: {
          p_actor: "admin-auth-support",
          p_assignment: "a5000000-0000-4000-8000-000000000001",
          p_expected_group: 2,
          p_new_group: 3,
          p_reason: "Bạn muốn làm phân tích đầu tư"
        }
      }
    ]);
  });

  it("không đủ quyền thì không thấy ô đổi nhóm và không gửi gì: Support team chỉ có quyền đọc mùa, Reviewer dù có quyền vận hành", async () => {
    seedAssignments();
    signIn("support_team", "auth-support-read");
    const { container } = render(<>{await Round2GroupsPage({ searchParams: Promise.resolve({}) })}</>);
    expect(container.querySelector('[data-testid="round2-table"]')).not.toBeNull();
    expect(editForm(container)).toBeNull();
    expect((await submit(3)).status).toBe("error");
    signIn("reviewer", "auth-reviewer-ops");
    expect((await submit(3)).status).toBe("error");
    signIn("viewer", "auth-core");
    expect((await submit(3)).status).toBe("error");
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

  it("bảng Mentor còn nhận có dòng tổng cả bảng: cộng Đăng ký / Đang có / Còn (BTC 09/10/2026)", async () => {
    db.tables.matching_industry_assignments = [
      { id: "as1", season_id: SEASON, person_id: "p-renew", role: "mentor", group_code: 2, confidence: "cao", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null },
      { id: "as3", season_id: SEASON, person_id: "p-new", role: "mentor", group_code: 6, confidence: "cao", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "auto", drift_group: null }
    ];
    // Mentor gia hạn đăng ký 3, đã có 1 cặp → còn min(2, 3) − 1 = 1. Mentor mới đăng ký 2, chưa có ai → còn 2.
    db.tables.matches = [{ id: "m1", season_id: SEASON, mentor_person_id: "p-renew", mentee_person_id: "p-mentee", status: "active", matching_round: 1 }];
    signIn("core_team", "auth-core");
    const { container } = render(<>{await Round2ReportPage()}</>);
    const table = container.querySelector('[data-testid="mentors-with-slots"]') as HTMLElement;
    const body = Array.from(table.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent));
    expect(body.map((cells) => [cells[1], cells[3], cells[4], cells[5]])).toEqual([
      ["Mentor Gia Hạn", "3", "1", "1"],
      ["Mentor Đơn Mới", "2", "0", "2"]
    ]);
    const foot = container.querySelector('[data-testid="mentors-with-slots-total"]') as HTMLElement;
    expect(foot.tagName).toBe("TFOOT");
    expect(foot.closest("table")).toBe(table);
    expect(Array.from(foot.querySelectorAll("td")).map((td) => td.textContent?.trim())).toEqual(["Tổng cả bảng: 2 mentor", "5", "1", "3"]);
  });

  // BTC 14/10/2026: mùa có gộp nhóm thì cung - cầu phải đọc theo cụm — theo nhóm thì nhóm 2 trông như
  // thừa chỗ dù mentor nhóm 2 đang chọn chung với mentee nhóm 3.
  it("bảng Theo danh sách chọn (cụm): cộng chỗ và mentee chờ của mọi nhóm trong cụm, có dòng tổng; không gộp thì không có bảng", async () => {
    db.tables.matching_industry_assignments = [
      { id: "as1", season_id: SEASON, person_id: "p-renew", role: "mentor", group_code: 2, confidence: "cao", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "btc", drift_group: null },
      { id: "as3", season_id: SEASON, person_id: "p-new", role: "mentor", group_code: 6, confidence: "cao", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "btc", drift_group: null },
      { id: "as2", season_id: SEASON, person_id: "p-mentee", role: "mentee", group_code: 3, confidence: "cao", flags: [], secondary_groups: [], evidence: { reasons: [] }, source: "btc", drift_group: null }
    ];
    signIn("core_team", "auth-core");
    const plain = render(<>{await Round2ReportPage()}</>);
    expect(plain.container.querySelector('[data-testid="pool-table"]')).toBeNull();
    plain.unmount();

    db.tables.matching_round2_pools = [
      { season_id: SEASON, group_code: 1, pool_code: 1 },
      { season_id: SEASON, group_code: 2, pool_code: 1 },
      { season_id: SEASON, group_code: 3, pool_code: 1 },
      { season_id: SEASON, group_code: 6, pool_code: 6 },
      { season_id: SEASON, group_code: 9, pool_code: 6 }
    ];
    const { container } = render(<>{await Round2ReportPage()}</>);
    const cells = (selector: string) => Array.from(container.querySelectorAll(`${selector} td`)).map((td) => td.textContent?.trim());
    // Mentor nhóm 2 đăng ký 3 → còn 2 chỗ; mentee nhóm 3 chưa có mentor → cụm Tài chính thừa 1.
    expect(cells('[data-testid="pool-table"] tr[data-pool="1"]')).toEqual([
      "Cụm 1 + 2 + 3: 1. Ngân hàng - Bảo hiểm · 2. Kế toán - Kiểm toán · 3. Tài chính - Đầu tư",
      "1",
      "2",
      "1",
      "1"
    ]);
    expect(cells('[data-testid="pool-table"] tr[data-pool="6"]')).toEqual(["Cụm 6 + 9: 6. Nhân sự · 9. Khác", "1", "2", "0", "2"]);
    const total = Array.from(container.querySelectorAll('[data-testid="pool-table"] tbody tr')).at(-1)!;
    expect(Array.from(total.querySelectorAll("td")).map((td) => td.textContent?.trim())).toEqual(["Tổng", "2", "4", "1", "3"]);
  });
});
