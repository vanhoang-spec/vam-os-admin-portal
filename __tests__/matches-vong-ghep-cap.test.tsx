/**
 * @vitest-environment jsdom
 */
/**
 * Trang Ghép cặp hiện vòng ghép cặp (BTC 07/10/2026): nhãn "Vòng 1" trên đúng dòng của
 * cặp, ô lọc theo vòng, và dòng "Vòng ghép cặp" ở trang chi tiết.
 *
 * Chạy trang thật trên bản giả PostgREST (./support/fake-postgrest.ts); chỉ danh tính
 * và ranh giới module của Next được giả.
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
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/matches/matches-client", () => ({
  ManualMatchForm: () => <div />,
  MatchCancelForm: () => <div />
}));

import MatchesPage from "@/app/matches/page";
import MatchDetailPage from "@/app/matches/[id]/page";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getMatchList } from "@/lib/matches";
import { matchingRoundLabel, parseMatchingRoundFilter } from "@/lib/matching-round";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const db = createFakeDb();

function seed() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [
    { id: "grant-0", user_id: "auth-core", program_id: PROGRAM, season_id: null, role: "operations", status: "active" }
  ];
  db.tables.intake_batches = [];
  db.tables.mentor_profiles = [];
  db.tables.mentee_profiles = [];
  db.tables.applications = [];
  db.tables.person_season_memberships = [];
  db.tables.people = [
    { id: "mentor-a", full_name: "Mentor Anh", email_primary: "a@example.test" },
    { id: "mentee-a", full_name: "Mentee Nhận Tại Buổi", email_primary: "ma@example.test" },
    { id: "mentor-b", full_name: "Mentor Bình", email_primary: "b@example.test" },
    { id: "mentee-b", full_name: "Mentee Ghép Tay", email_primary: "mb@example.test" },
    { id: "mentee-c", full_name: "Mentee Đã Huỷ", email_primary: "mc@example.test" }
  ];
  db.tables.matches = [
    { id: "m-round1", season_id: SEASON, status: "active", mentor_person_id: "mentor-a", mentee_person_id: "mentee-a", matched_at: "2026-10-04", matching_round: 1 },
    { id: "m-manual", season_id: SEASON, status: "active", mentor_person_id: "mentor-b", mentee_person_id: "mentee-b", matched_at: "2026-10-05", matching_round: null },
    { id: "m-dropped", season_id: SEASON, status: "dropped", mentor_person_id: "mentor-a", mentee_person_id: "mentee-c", matched_at: "2026-10-03", matching_round: 1 }
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  const client = fakeClient(db, { rpc: () => ({ data: null, error: { code: "PGRST202", message: "not found" } }) });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "admin-auth-core",
    role: "core_team",
    status: "active",
    auth_user_id: "auth-core",
    email: "core@example.test"
  } as any);
});

async function renderList(searchParams: Record<string, string>) {
  const ui = await MatchesPage({ searchParams: Promise.resolve(searchParams) });
  return render(<>{ui}</>).container;
}

/** Dòng bảng chứa đúng tên mentee — soi nhãn trong dòng, không tìm chung cả trang. */
function rowOf(container: HTMLElement, menteeName: string) {
  const row = Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(menteeName));
  if (!row) throw new Error(`không thấy dòng của ${menteeName}`);
  return row as HTMLElement;
}
const listHeading = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("h2")).find((h) => h.textContent?.startsWith("Danh sách matching"))?.textContent;
const MENTEES = ["Mentee Nhận Tại Buổi", "Mentee Ghép Tay", "Mentee Đã Huỷ"];
const menteesShown = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("tbody tr")).map(
    (tr) => MENTEES.find((name) => tr.textContent?.includes(name)) ?? "(dòng lạ)"
  );

describe("nhãn và bộ lọc vòng ghép cặp trên /matches", () => {
  it("mặc định: mọi vòng, chỉ cặp đang đồng hành — nhãn nằm trên đúng dòng", async () => {
    const container = await renderList({});
    expect(menteesShown(container).sort()).toEqual(["Mentee Ghép Tay", "Mentee Nhận Tại Buổi"]);
    expect(within(rowOf(container, "Mentee Nhận Tại Buổi")).getByTestId("match-round").textContent).toBe("Vòng 1");
    const manual = rowOf(container, "Mentee Ghép Tay");
    expect(within(manual).queryByTestId("match-round")).toBeNull();
    expect(manual.textContent).toContain("Chưa gắn vòng");
  });

  it("?round=1: chỉ cặp vòng 1, tiêu đề ghi rõ đang lọc, ô lọc giữ lựa chọn", async () => {
    const container = await renderList({ round: "1" });
    expect(menteesShown(container)).toEqual(["Mentee Nhận Tại Buổi"]);
    expect(listHeading(container)).toContain("1 Đang đồng hành · Vòng 1");
    expect((container.querySelector('select[name="round"]') as HTMLSelectElement).value).toBe("1");
  });

  it("?round=none: chỉ cặp chưa gắn vòng", async () => {
    const container = await renderList({ round: "none" });
    expect(menteesShown(container)).toEqual(["Mentee Ghép Tay"]);
    expect(listHeading(container)).toContain("· Chưa gắn vòng");
  });

  it("vòng 1 + mọi trạng thái: thấy cả cặp vòng 1 đã huỷ", async () => {
    const container = await renderList({ round: "1", status: "all" });
    expect(menteesShown(container).sort()).toEqual(["Mentee Nhận Tại Buổi", "Mentee Đã Huỷ"]);
  });

  it("?round= lạ thì về mọi vòng, không ra danh sách rỗng", async () => {
    const container = await renderList({ round: "abc" });
    expect(menteesShown(container)).toHaveLength(2);
    expect((container.querySelector('select[name="round"]') as HTMLSelectElement).value).toBe("");
  });

  it("vai trò bị che tên vẫn nhận được số vòng", async () => {
    const res = await getMatchList({ round: { kind: "round", round: 1 }, audienceRole: "viewer" });
    expect(res.data.map((row) => [row.id, row.matching_round])).toEqual([
      ["m-round1", 1],
      ["m-dropped", 1]
    ]);
    expect(res.data[0]).not.toHaveProperty("mentee_name");
  });
});

describe("trang chi tiết cặp", () => {
  it("ghi vòng ghép cặp", async () => {
    for (const [id, expected] of [
      ["m-round1", "Vòng 1"],
      ["m-manual", "Chưa gắn vòng"]
    ]) {
      const ui = await MatchDetailPage({ params: Promise.resolve({ id }) });
      const { container, unmount } = render(<>{ui}</>);
      const label = Array.from(container.querySelectorAll("*")).find((el) => el.textContent === "Vòng ghép cặp");
      expect(label?.parentElement?.textContent).toBe(`Vòng ghép cặp${expected}`);
      unmount();
    }
  });
});

describe("lib/matching-round", () => {
  it("nhãn chỉ cho số vòng nguyên từ 1", () => {
    expect(matchingRoundLabel(1)).toBe("Vòng 1");
    expect(matchingRoundLabel("2")).toBe("Vòng 2");
    for (const bad of [null, undefined, 0, -1, 1.5, "", "x"]) expect(matchingRoundLabel(bad)).toBeNull();
  });

  it("đọc ?round=", () => {
    expect(parseMatchingRoundFilter("1")).toEqual({ kind: "round", round: 1 });
    expect(parseMatchingRoundFilter(" 2 ")).toEqual({ kind: "round", round: 2 });
    expect(parseMatchingRoundFilter("none")).toEqual({ kind: "none" });
    for (const raw of ["", undefined, "0", "1.5", "-1", "abc", "1e1"]) expect(parseMatchingRoundFilter(raw)).toEqual({ kind: "all" });
  });
});
