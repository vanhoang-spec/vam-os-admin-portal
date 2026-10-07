/**
 * @vitest-environment jsdom
 */
/**
 * Vòng 2 — trang mentor chọn mentee (/chon-mentee/[token]), nút chọn, và bộ gửi link.
 *
 * Điều phải đúng:
 *   - thẻ hồ sơ chỉ mang các trường BTC cho phép (soi TRONG từng thẻ, không tìm cả trang);
 *   - chỉ hiện mentee cùng nhóm, chưa có mentor, chưa rút;
 *   - token lạ / chưa mở / đã đủ chỗ thì không hiện hồ sơ nào;
 *   - nút chọn gửi đúng token đã bind + mã đơn, mã sai hình dạng thì không gọi RPC;
 *   - bộ gửi chỉ gửi cho mentor còn chỗ, dùng lại link cũ, ghi đúng đợt, không gửi khi vòng
 *     chưa mở, và đợt 2 gửi lại cho người còn chỗ.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormState: (_a: unknown, initial: unknown) => [initial, vi.fn()], useFormStatus: () => ({ pending: false }) };
});
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })), headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.test") }));
vi.mock("@/lib/email", () => ({ sendMatchingRound2Invite: vi.fn(async () => ({ ok: true, skipped: false })) }));

import MentorPickPage from "@/app/chon-mentee/[token]/page";
import { pickMenteeAction } from "@/app/chon-mentee/[token]/actions";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMatchingRound2Invite } from "@/lib/email";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { linkify, menteeCard, MENTEE_CARD_KEYS, stableOrderKey, undoMinutesLeft, windowState } from "@/lib/matching-round2-link-core";
import { isRound2Recipient } from "@/lib/matching-round2-dispatch-core";
import { runRound2Dispatch } from "@/lib/matching-round2-dispatch";
import { ROUND2_PICK_IDLE } from "@/lib/matching-round2-action-types";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TOKEN_FULL = "bbbbbbbb-0000-4000-8000-00000000000b";
const APP = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const PRIVATE = { email_primary: "rieng@example.test", phone_primary: "0909123456", mssv: "31221020999", gender: "female", linkedin_url: "https://linkedin.example/x" };
const db = createFakeDb();
let rpcCalls: Array<{ fn: string; args: any }> = [];

function menteePayload(major: string) {
  return {
    ...PRIVATE,
    year_of_study: "3",
    school_or_faculty: "marketing",
    major,
    target_function: "marketing",
    target_industry: "fmcg",
    gpa_4: "3.6",
    profile_or_cv_url: "CV: https://drive.example/cv javascript:alert(1)",
    mentoring_goals_text: "Hiểu nghề brand"
  };
}

function seed(opensOffsetMs = -3600_000) {
  const now = Date.now();
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "S12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM" }];
  db.tables.admin_scope_access = [{ id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" }];
  db.tables.matching_round2_settings = [
    { season_id: SEASON, opens_at: new Date(now + opensOffsetMs).toISOString(), closes_at: new Date(now + 3 * 86400_000).toISOString(), current_send_wave: 1 }
  ];
  db.tables.matching_round2_links = [
    { id: "L1", season_id: SEASON, mentor_person_id: "mentor-a", token: TOKEN_A, revoked_at: null, last_sent_wave: 0, send_count: 0, first_sent_at: null, claimed_at: null, created_at: "2026-10-07T00:00:00Z" },
    { id: "L2", season_id: SEASON, mentor_person_id: "mentor-full", token: TOKEN_FULL, revoked_at: null, last_sent_wave: 0, send_count: 0, first_sent_at: null, claimed_at: null, created_at: "2026-10-07T00:00:00Z" }
  ];
  db.tables.matching_round2_picks = [];
  db.tables.people = [
    { id: "mentor-a", full_name: "Mentor An", email_primary: "an@example.test" },
    { id: "mentor-full", full_name: "Mentor Đủ", email_primary: "du@example.test" },
    { id: "m1", full_name: "Mentee Còn Trống", email_primary: PRIVATE.email_primary },
    { id: "m2", full_name: "Mentee Đã Có Mentor" },
    { id: "m3", full_name: "Mentee Nhóm Khác" },
    { id: "m4", full_name: "Mentee Đã Rút" }
  ];
  db.tables.applications = [
    { id: "app-mentor-a", person_id: "mentor-a", season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form", raw_payload: { title_current: "Brand Manager", function_primary: "marketing", industry_primary: "fmcg" } },
    { id: "app-mentor-full", person_id: "mentor-full", season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form", raw_payload: { title_current: "Sales Director", function_primary: "sales_bd", industry_primary: "fmcg" } },
    ...[1, 2, 3, 4].map((n) => ({
      id: APP(n), person_id: `m${n}`, season_id: SEASON, role_applied: "mentee", status: "approved_as_mentee", source: "vam_os_form", raw_payload: menteePayload(`Marketing ${n}`)
    }))
  ];
  db.tables.mentor_profiles = [
    { id: "mp-a", person_id: "mentor-a", capacity_target: 2 },
    { id: "mp-full", person_id: "mentor-full", capacity_target: 1 }
  ];
  db.tables.matching_industry_assignments = [
    { id: "as-a", season_id: SEASON, person_id: "mentor-a", role: "mentor", application_id: "app-mentor-a", group_code: 4, confidence: "cao", flags: [], secondary_groups: [], evidence: {}, source: "auto", drift_group: null },
    { id: "as-f", season_id: SEASON, person_id: "mentor-full", role: "mentor", application_id: "app-mentor-full", group_code: 4, confidence: "cao", flags: [], secondary_groups: [], evidence: {}, source: "auto", drift_group: null },
    ...[1, 2, 3, 4].map((n) => ({
      id: `as-m${n}`, season_id: SEASON, person_id: `m${n}`, role: "mentee", application_id: APP(n), group_code: n === 3 ? 6 : 4, confidence: "cao", flags: [], secondary_groups: [], evidence: {}, source: "auto", drift_group: null
    }))
  ];
  db.tables.person_season_memberships = [{ id: "psm4", person_id: "m4", season_id: SEASON, role: "mentee", status: "withdrawn" }];
  db.tables.matches = [{ id: "match-r1", season_id: SEASON, mentor_person_id: "mentor-full", mentee_person_id: "m2", status: "active", matching_round: 1 }];
  db.tables.outbound_emails = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  rpcCalls = [];
  const client = fakeClient(db, {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return { data: { ok: true, remaining: 1 }, error: null };
    }
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-core", role: "core_team", status: "active", auth_user_id: "auth-core", email: "core@example.test", full_name: "BTC" } as any);
});

async function renderPage(token: string) {
  return render(<>{await MentorPickPage({ params: Promise.resolve({ token }) })}</>).container;
}

describe("phần thuần", () => {
  it("thẻ hồ sơ chỉ mang trường được phép; CV chỉ biến http(s) thành link", () => {
    const card = menteeCard({ applicationId: APP(1), name: "A", payload: menteePayload("Marketing số") });
    const flat = JSON.stringify(card);
    for (const secret of Object.values(PRIVATE)) expect(flat).not.toContain(secret);
    expect(card.facts).toContainEqual(["GPA (thang 4)", "3.6"]);
    expect(card.cv).toEqual([
      { kind: "text", value: "CV:" },
      { kind: "link", value: "https://drive.example/cv", href: "https://drive.example/cv" },
      { kind: "text", value: "javascript:alert(1)" }
    ]);
    for (const key of Object.keys(PRIVATE)) expect(MENTEE_CARD_KEYS).not.toContain(key);
  });

  it("cửa sổ, thời gian bỏ chọn, thứ tự riêng từng mentor", () => {
    const now = Date.parse("2026-10-08T03:00:00Z");
    expect(windowState(null, now)).toBe("not_open");
    expect(windowState({ opensAt: "2026-10-08T04:00:00Z", closesAt: null }, now)).toBe("not_open");
    expect(windowState({ opensAt: "2026-10-08T02:00:00Z", closesAt: null }, now)).toBe("open");
    expect(windowState({ opensAt: "2026-10-08T01:00:00Z", closesAt: "2026-10-08T03:00:00Z" }, now)).toBe("closed");
    expect(undoMinutesLeft("2026-10-08T02:31:00Z", now)).toBe(1);
    expect(undoMinutesLeft("2026-10-08T02:30:00Z", now)).toBe(0);
    expect(stableOrderKey("a", "x")).toBe(stableOrderKey("a", "x"));
    expect(stableOrderKey("a", "x")).not.toBe(stableOrderKey("b", "x"));
  });

  it("người nhận thư: còn chỗ, có email, chưa nhận thư của đợt hiện hành", () => {
    const row = (over: any) => ({ person: { role: "mentor", email: "x@e.test" }, receivesList: true, ...over });
    expect(isRound2Recipient(row({}) as any, 0, 1)).toBe(true);
    expect(isRound2Recipient(row({}) as any, 1, 1)).toBe(false);
    expect(isRound2Recipient(row({}) as any, 1, 2)).toBe(true);
    expect(isRound2Recipient(row({ receivesList: false }) as any, 0, 1)).toBe(false);
    expect(isRound2Recipient(row({ person: { role: "mentor", email: null } }) as any, 0, 1)).toBe(false);
  });
});

describe("trang /chon-mentee/[token]", () => {
  it("chỉ hiện mentee cùng nhóm, chưa có mentor, chưa rút; thẻ không mang thông tin riêng", async () => {
    const container = await renderPage(TOKEN_A);
    const cards = Array.from(container.querySelectorAll('[data-testid="mentee-card"]'));
    expect(cards.map((c) => c.getAttribute("data-application"))).toEqual([APP(1)]);
    const card = cards[0] as HTMLElement;
    expect(card.textContent).toContain("Mentee Còn Trống");
    expect(card.textContent).toContain("3.6");
    for (const secret of Object.values(PRIVATE)) expect(card.innerHTML).not.toContain(secret);
    expect(card.querySelector('a[href="https://drive.example/cv"]')).not.toBeNull();
    expect(card.querySelector('a[href^="javascript"]')).toBeNull();
    expect(card.querySelector('[data-testid="pick-button"]')).not.toBeNull();
    expect(container.textContent).toContain("còn chọn được 2 mentee");
  });

  it("token sai hình dạng: không chạm database; token lạ: báo không mở được", async () => {
    const bad = await renderPage("khong-phai-uuid");
    expect(bad.textContent).toContain("Không mở được trang chọn mentee");
    expect(db.requests).toHaveLength(0);
    const unknown = await renderPage("cccccccc-0000-4000-8000-00000000000c");
    expect(unknown.textContent).toContain("Đường dẫn không đúng");
    expect(unknown.querySelector('[data-testid="mentee-card"]')).toBeNull();
  });

  it("mentor đã đủ chỗ: không thấy hồ sơ nào", async () => {
    const container = await renderPage(TOKEN_FULL);
    expect(container.textContent).toContain("đã nhận đủ 1 mentee");
    expect(container.querySelector('[data-testid="mentee-card"]')).toBeNull();
  });

  it("chưa tới giờ mở: không thấy hồ sơ nào", async () => {
    db.reset();
    seed(3600_000);
    const container = await renderPage(TOKEN_A);
    expect(container.textContent).toContain("Vòng 2 chưa mở");
    expect(container.querySelector('[data-testid="mentee-card"]')).toBeNull();
  });
});

describe("nút chọn", () => {
  it("gửi đúng token đã bind và mã đơn; mã đơn sai hình dạng thì không gọi RPC", async () => {
    const form = new FormData();
    form.set("menteeApplicationId", APP(1));
    const state = await pickMenteeAction(TOKEN_A, ROUND2_PICK_IDLE, form);
    expect(state.status).toBe("ok");
    expect(rpcCalls).toEqual([{ fn: "vam113_round2_pick", args: { p_token: TOKEN_A, p_mentee_application: APP(1) } }]);
    const bad = new FormData();
    bad.set("menteeApplicationId", "'; drop table matches; --");
    expect((await pickMenteeAction(TOKEN_A, ROUND2_PICK_IDLE, bad)).status).toBe("error");
    expect(rpcCalls).toHaveLength(1);
  });
});

describe("bộ gửi link", () => {
  it("gửi cho mentor còn chỗ (không cho mentor đã đủ), dùng lại link cũ, ghi đợt; bấm lại không gửi trùng", async () => {
    // Bộ gửi đọc nhóm đã lưu → mentor-a nhận danh sách, mentor-full đã đủ.
    const result = await runRound2Dispatch();
    expect(result).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(vi.mocked(sendMatchingRound2Invite).mock.calls.map(([input]) => [input.toEmail, input.token, input.linkId, input.slots])).toEqual([
      ["an@example.test", TOKEN_A, "L1", 2]
    ]);
    const link = db.tables.matching_round2_links.find((l: any) => l.id === "L1");
    expect(link).toMatchObject({ last_sent_wave: 1, send_count: 1, claimed_at: null });
    expect(db.tables.matching_round2_links).toHaveLength(2);

    vi.mocked(sendMatchingRound2Invite).mockClear();
    const again = await runRound2Dispatch();
    expect(again.sent).toBe(0);
    expect(sendMatchingRound2Invite).not.toHaveBeenCalled();

    // Đợt 2: người còn chỗ nhận lại, cùng link.
    db.tables.matching_round2_settings[0].current_send_wave = 2;
    const wave2 = await runRound2Dispatch();
    expect(wave2.sent).toBe(1);
    expect(vi.mocked(sendMatchingRound2Invite).mock.calls[0][0]).toMatchObject({ token: TOKEN_A, linkId: "L1" });
    expect(db.tables.matching_round2_links.find((l: any) => l.id === "L1")).toMatchObject({ last_sent_wave: 2, send_count: 2 });
  });

  it("vòng chưa mở hoặc người bấm không vận hành mùa: không gửi gì", async () => {
    db.reset();
    seed(3600_000);
    expect((await runRound2Dispatch()).ok).toBe(false);
    db.reset();
    seed();
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-sp", role: "support_team", status: "active", auth_user_id: "auth-sp", email: "sp@example.test" } as any);
    expect((await runRound2Dispatch()).ok).toBe(false);
    expect(sendMatchingRound2Invite).not.toHaveBeenCalled();
    expect(db.writes.filter((w) => w.table === "matching_round2_links")).toHaveLength(0);
  });
});
