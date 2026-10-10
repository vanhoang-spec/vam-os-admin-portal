/**
 * @vitest-environment jsdom
 */
/**
 * Số mentee tối đa của mentor trên hồ sơ người (BTC 10/10/2026): phần thuần, cổng quyền,
 * đường ghi (action → RPC) trên bản giả PostgREST, và khung hiển thị.
 *
 * Điều phải đúng: ai mở hồ sơ cũng thấy số; chỉ Core team trở lên CÓ quyền vận hành mùa
 * mới gửi được lệnh ghi, và gửi ĐÚNG MỘT lệnh vam116 với đúng số đang thấy + số mới;
 * người không đủ quyền hoặc dữ liệu sai thì KHÔNG có lệnh nào đi ra.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const formState = vi.hoisted(() => ({ current: { status: "idle", message: null } as { status: string; message: string | null } }));

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormState: () => [formState.current, vi.fn()], useFormStatus: () => ({ pending: false }) };
});
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import { revalidatePath } from "next/cache";
import { setMentorCapacityAction } from "@/app/actions/mentor-capacity";
import { MentorCapacityPanel } from "@/app/people/[id]/mentor-capacity-panel";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  DEFAULT_MENTOR_CAPACITY,
  MENTOR_CAPACITY_MAX,
  mentorCapacityEditState,
  mentorCapacityView,
  parseMentorCapacity,
  storedMentorCapacity
} from "@/lib/mentor-capacity";
import { canEditMentorCapacity } from "@/lib/permissions";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON = "11111111-1111-4111-8111-111111111111";
const OTHER_SEASON = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const db = createFakeDb();
let rpcCalls: Array<{ fn: string; args: any }> = [];
let rpcResult: { data: any; error: any } = { data: { ok: true, changed: true, capacity: 3, previous: 1, active: 0 }, error: null };

function signIn(role: string, authUserId: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: `admin-${authUserId}`, role, status: "active", auth_user_id: authUserId, email: `${authUserId}@example.test`
  } as any);
}
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
};
const save = (values: Record<string, string>, personId = PERSON) =>
  setMentorCapacityAction(personId, { status: "idle", message: null }, form(values));

beforeEach(() => {
  vi.clearAllMocks();
  formState.current = { status: "idle", message: null };
  db.reset();
  db.tables.seasons = [
    { id: SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: PROGRAM },
    { id: OTHER_SEASON, code: "UEHM-S11", name: "UEH Mentoring Season 11", program_id: PROGRAM }
  ];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [
    { id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" },
    { id: "g2", user_id: "auth-support", program_id: null, season_id: SEASON, role: "operations", status: "active" },
    { id: "g3", user_id: "auth-core-read", program_id: null, season_id: SEASON, role: "read", status: "active" },
    { id: "g4", user_id: "auth-core-s11", program_id: null, season_id: OTHER_SEASON, role: "operations", status: "active" },
    { id: "g5", user_id: "auth-reviewer", program_id: null, season_id: SEASON, role: "operations", status: "active" }
  ];
  rpcCalls = [];
  rpcResult = { data: { ok: true, changed: true, capacity: 3, previous: 1, active: 0 }, error: null };
  const client = fakeClient(db, {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    }
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});
afterEach(cleanup);

describe("phần thuần", () => {
  it("parseMentorCapacity: chỉ nhận số nguyên 1..10", () => {
    expect([1, "1", " 3 ", "10", 10].map(parseMentorCapacity)).toEqual([1, 1, 3, 10, 10]);
    // "1." và "+5" là số hợp lệ với Number() nhưng không phải thứ BTC gõ vào ô số nguyên.
    for (const bad of [0, "0", 11, "11", "100", "2.5", 2.5, "-1", "1e1", "abc", "", "  ", null, undefined, "２", "1.", "+5", ".5"]) {
      expect(parseMentorCapacity(bad)).toBeNull();
    }
    expect(MENTOR_CAPACITY_MAX).toBe(10);
  });

  it("storedMentorCapacity giữ đúng giá trị đang lưu — không thay rỗng hay 0 bằng mặc định", () => {
    expect([2, "3", 0, null, undefined, "", "x", 1.5].map(storedMentorCapacity)).toEqual([2, 3, 0, null, null, null, null, null]);
  });

  it("mentorCapacityView chỉ đếm cặp ĐANG hoạt động của ĐÚNG mùa và ĐÚNG mentor", () => {
    const matches = [
      { mentor_person_id: PERSON, season_id: SEASON, status: "active" },
      { mentor_person_id: PERSON, season_id: SEASON, status: " Active " },
      { mentor_person_id: PERSON, season_id: SEASON, status: "dropped" },
      { mentor_person_id: PERSON, season_id: SEASON, status: "completed" },
      { mentor_person_id: PERSON, season_id: OTHER_SEASON, status: "active" },
      { mentor_person_id: "nguoi-khac", season_id: SEASON, status: "active" }
    ];
    expect(mentorCapacityView({ capacityTarget: 3, personId: PERSON, seasonId: SEASON, matches })).toEqual({ declared: 3, effective: 3, active: 2, remaining: 1 });
    // Trần thấp hơn số đang nhận (dữ liệu cũ): còn 0 chỗ, không phải số âm.
    expect(mentorCapacityView({ capacityTarget: 1, personId: PERSON, seasonId: SEASON, matches })).toMatchObject({ effective: 1, active: 2, remaining: 0 });
    // Chưa khai hoặc 0: hệ thống cưỡng chế mặc định, và nói rõ là chưa khai.
    for (const blank of [null, undefined, 0, ""]) {
      expect(mentorCapacityView({ capacityTarget: blank, personId: PERSON, seasonId: SEASON, matches })).toEqual({
        declared: null, effective: DEFAULT_MENTOR_CAPACITY, active: 2, remaining: 1
      });
    }
    // Không xác định được mùa thì không đếm bừa cặp của mọi mùa.
    expect(mentorCapacityView({ capacityTarget: 2, personId: PERSON, seasonId: undefined, matches }).active).toBe(0);
  });

  it("mentorCapacityEditState: ô sửa chỉ mời khi đủ CẢ BA điều kiện; thiếu “mentor của mùa” thì có câu giải thích", () => {
    const state = (roleAllowed: boolean, canOperateSeason: boolean, isSeasonMentor: boolean) =>
      mentorCapacityEditState({ roleAllowed, canOperateSeason, isSeasonMentor });
    expect(state(true, true, true)).toEqual({ canEdit: true, lockedReason: null });
    // Không đủ quyền: không ô sửa và cũng không giải thích — người xem không cần biết có ô đó.
    for (const [role, operate] of [[false, true], [true, false], [false, false]] as const) {
      for (const seasonMentor of [true, false]) {
        expect(state(role, operate, seasonMentor)).toEqual({ canEdit: false, lockedReason: null });
      }
    }
    const locked = state(true, true, false);
    expect(locked.canEdit).toBe(false);
    expect(locked.lockedReason).toContain("chưa là mentor đang tham dự mùa này");
  });

  it("canEditMentorCapacity: Core team trở lên; Support team, Reviewer, Viewer không", () => {
    expect(["super_admin", "admin", "core_team"].map(canEditMentorCapacity)).toEqual([true, true, true]);
    expect(["support_team", "reviewer", "viewer", "", null, undefined].map((r) => canEditMentorCapacity(r as any))).toEqual([false, false, false, false, false, false]);
  });
});

describe("lưu số mentee tối đa", () => {
  it("Core team có quyền vận hành mùa: gửi ĐÚNG MỘT lệnh vam116 mang chính người bấm, số đang thấy và số mới", async () => {
    signIn("core_team", "auth-core");
    const state = await save({ expected: "1", capacity: "3" });
    expect(state).toEqual({ status: "ok", message: "Đã lưu: tối đa 3 mentee trong mùa này." });
    expect(rpcCalls).toEqual([
      { fn: "vam116_set_mentor_capacity", args: { p_actor: "admin-auth-core", p_season: SEASON, p_person: PERSON, p_expected: 1, p_capacity: 3 } }
    ]);
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual([`/people/${PERSON}`, "/mentors", "/matches", "/matches/vong-2", "/matches/vong-2/bao-cao"]);
  });

  it("mentor chưa khai: ô “số đang thấy” rỗng được gửi là null, không phải 0", async () => {
    signIn("super_admin", "auth-super");
    rpcResult = { data: { ok: true, changed: true, capacity: 2, previous: null, active: 0 }, error: null };
    await save({ expected: "", capacity: "2" });
    expect(rpcCalls[0].args).toMatchObject({ p_expected: null, p_capacity: 2 });
  });

  it("database báo không đổi thì nói đúng là không đổi", async () => {
    signIn("core_team", "auth-core");
    rpcResult = { data: { ok: true, changed: false, capacity: 3, active: 1 }, error: null };
    expect(await save({ expected: "3", capacity: "3" })).toEqual({ status: "ok", message: "Số mentee tối đa vẫn là 3." });
  });

  it("không đủ quyền thì KHÔNG gửi gì: Support team, Reviewer dù có quyền vận hành; Core chỉ đọc; Core của mùa khác; chưa đăng nhập", async () => {
    for (const [role, auth] of [["support_team", "auth-support"], ["reviewer", "auth-reviewer"], ["core_team", "auth-core-read"], ["core_team", "auth-core-s11"], ["viewer", "auth-core"]]) {
      signIn(role, auth);
      const state = await save({ expected: "1", capacity: "3" });
      expect(state).toEqual({ status: "error", message: "Bạn không có quyền sửa số mentee tối đa của mentor mùa này." });
    }
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any);
    expect((await save({ expected: "1", capacity: "3" })).status).toBe("error");
    expect(rpcCalls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("dữ liệu biểu mẫu sai thì KHÔNG gửi gì: số ngoài 1..10, không phải số nguyên, mã người hỏng, số đang thấy không phải số", async () => {
    signIn("core_team", "auth-core");
    for (const capacity of ["0", "11", "2.5", "abc", "", "-3"]) {
      expect(await save({ expected: "1", capacity })).toEqual({ status: "error", message: "Số mentee tối đa phải là số nguyên từ 1 đến 10." });
    }
    expect((await save({ expected: "1", capacity: "3" }, "khong-phai-uuid")).status).toBe("error");
    expect((await save({ expected: "mot", capacity: "3" })).status).toBe("error");
    expect((await save({ expected: "1.5", capacity: "3" })).status).toBe("error");
    expect(rpcCalls).toEqual([]);
  });

  it("lỗi từ database được nói bằng lời người dùng hiểu; không làm mới trang khi chưa lưu", async () => {
    signIn("core_team", "auth-core");
    const cases: Array<[string, RegExp]> = [
      ["STALE_CAPACITY", /vừa được người khác đổi/],
      ["CAPACITY_BELOW_ACTIVE", /đang nhận nhiều mentee hơn/],
      ["NOT_SEASON_MENTOR", /không phải mentor đang tham dự mùa này/],
      ["MENTOR_IDENTITY_AMBIGUOUS", /không có đúng một hồ sơ mentor/],
      ["ACCESS_DENIED", /không có quyền/],
      ["INVALID_CAPACITY", /từ 1 đến 10/],
      ["deadlock detected", /Không lưu được/]
    ];
    for (const [code, expected] of cases) {
      rpcResult = { data: null, error: { message: code } };
      const state = await save({ expected: "1", capacity: "3" });
      expect(state.status).toBe("error");
      expect(state.message).toMatch(expected);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("database trả về số khác số đã gửi thì không báo thành công", async () => {
    signIn("core_team", "auth-core");
    rpcResult = { data: { ok: true, changed: true, capacity: 2 }, error: null };
    expect(await save({ expected: "1", capacity: "3" })).toEqual({ status: "error", message: "Chưa xác nhận được kết quả. Tải lại trang để kiểm tra." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("không tìm thấy mùa đang vận hành thì dừng, không gửi lệnh với mùa đoán", async () => {
    signIn("super_admin", "auth-super");
    db.tables.seasons = db.tables.seasons.filter((s: any) => s.code !== "UEHM-S12");
    expect(await save({ expected: "1", capacity: "3" })).toEqual({ status: "error", message: "Không xác định được mùa đang vận hành. Thử tải lại trang." });
    expect(rpcCalls).toEqual([]);
  });
});

describe("khung trên hồ sơ mentor", () => {
  const view = { declared: 2, effective: 2, active: 1, remaining: 1 };
  const base = { action: vi.fn(), seasonLabel: "UEHM-S12", view, expected: 2 as number | null, max: 10, round2Cap: 2 };
  const panel = (container: HTMLElement) => container.querySelector('[data-testid="mentor-capacity"]') as HTMLElement;

  it("ai mở hồ sơ cũng thấy: trần của mùa, đang nhận, còn mấy chỗ — người không có quyền không thấy ô sửa", () => {
    const { container } = render(<MentorCapacityPanel {...base} canEdit={false} />);
    const el = panel(container);
    expect(el.textContent).toContain("Số mentee tối đa mùa UEHM-S12");
    expect(el.querySelector('[data-testid="mentor-capacity-value"]')?.textContent).toBe("2");
    expect(el.querySelector('[data-testid="mentor-capacity-usage"]')?.textContent).toBe("Đang nhận 1 · còn 1 chỗ");
    expect(el.querySelector("form")).toBeNull();
    expect(el.querySelector("input")).toBeNull();
    expect(el.querySelector('[data-testid="mentor-capacity-default"]')).toBeNull();
  });

  it("người có quyền: ô nhập có cận dưới là số đang nhận, cận trên 10, mang đúng số đang lưu", () => {
    const { container } = render(<MentorCapacityPanel {...base} view={{ declared: 3, effective: 3, active: 2, remaining: 1 }} expected={3} canEdit />);
    const formEl = panel(container).querySelector('[data-testid="mentor-capacity-form"]') as HTMLFormElement;
    const input = formEl.querySelector('input[name="capacity"]') as HTMLInputElement;
    expect([input.type, input.min, input.max, input.value, input.required]).toEqual(["number", "2", "10", "3", true]);
    expect((formEl.querySelector('input[name="expected"]') as HTMLInputElement).value).toBe("3");
    expect(formEl.querySelector('button[type="submit"]')?.textContent).toBe("Lưu");
    // Hai số khác nhau (đang nhận 2, còn 1): đổi chỗ cho nhau là thấy ngay.
    expect(panel(container).querySelector('[data-testid="mentor-capacity-usage"]')?.textContent).toBe("Đang nhận 2 · còn 1 chỗ");
    // Trần 3 > 2: nhắc luật riêng của Vòng 2.
    expect(panel(container).textContent).toContain("Vòng 2");
  });

  it("mentor chưa khai: nói rõ đang tính mặc định, và gửi “số đang thấy” rỗng", () => {
    const { container } = render(<MentorCapacityPanel {...base} view={{ declared: null, effective: 3, active: 0, remaining: 3 }} expected={null} canEdit />);
    expect(panel(container).querySelector('[data-testid="mentor-capacity-default"]')?.textContent).toContain("mặc định 3");
    expect((panel(container).querySelector('input[name="expected"]') as HTMLInputElement).value).toBe("");
    expect((panel(container).querySelector('input[name="capacity"]') as HTMLInputElement).min).toBe("1");
  });

  it("trần không vượt luật Vòng 2 thì không hiện câu nhắc Vòng 2", () => {
    const { container } = render(<MentorCapacityPanel {...base} canEdit />);
    expect(panel(container).textContent).not.toContain("Vòng 2");
  });

  it("có quyền nhưng người này chưa là mentor của mùa: không có ô sửa, có câu giải thích", () => {
    const { container } = render(<MentorCapacityPanel {...base} canEdit={false} lockedReason="Người này chưa là mentor đang tham dự mùa này nên chưa sửa được số mentee tối đa." />);
    expect(panel(container).querySelector("form")).toBeNull();
    expect(panel(container).querySelector('[data-testid="mentor-capacity-locked"]')?.textContent).toContain("chưa là mentor đang tham dự mùa này");
  });

  it("hiện kết quả lưu: thành công màu xanh, lỗi màu đỏ", () => {
    formState.current = { status: "ok", message: "Đã lưu: tối đa 3 mentee trong mùa này." };
    const ok = render(<MentorCapacityPanel {...base} canEdit />);
    const okMessage = panel(ok.container).querySelector('[data-testid="mentor-capacity-message"]') as HTMLElement;
    expect(okMessage.textContent).toBe("Đã lưu: tối đa 3 mentee trong mùa này.");
    expect(okMessage.className).toContain("text-green-700");
    ok.unmount();
    formState.current = { status: "error", message: "Số này vừa được người khác đổi" };
    const bad = render(<MentorCapacityPanel {...base} canEdit />);
    expect((panel(bad.container).querySelector('[data-testid="mentor-capacity-message"]') as HTMLElement).className).toContain("text-red-600");
  });
});
