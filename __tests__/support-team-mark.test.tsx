/**
 * @vitest-environment jsdom
 */
/**
 * Tích "Support team" trên hồ sơ (BTC 13/10/2026): phần thuần, cổng quyền, đường ghi
 * (action → RPC) trên bản giả PostgREST, đọc trạng thái khung, và khung giao diện nối THẬT với hành động.
 *
 * Điều phải đúng: người có quyền vận hành mùa (Support team, Core team, Admin, Super admin) gửi
 * ĐÚNG MỘT lệnh vam121 mang chính người bấm, mùa hiện tại và người được tích; mọi người khác, hay dữ
 * liệu sai, thì KHÔNG có lệnh nào đi ra. Bấm Lưu mà chưa tích thì không làm gì. Điều database cản
 * (đơn đã bị từ chối…) được nói bằng lời người dùng hiểu và không làm mới trang.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { markSupportTeamAction } from "@/app/actions/support-team";
import { SupportTeamPanel } from "@/app/people/[id]/support-team-panel";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canMarkSupportTeam } from "@/lib/permissions";
import { getSupportTeamPanel, SUPPORT_TEAM_SEASON_CODE } from "@/lib/support-team-mark";
import {
  SUPPORT_TEAM_IDLE,
  SUPPORT_TEAM_NOT_TICKED_MESSAGE,
  supportTeamErrorMessage,
  supportTeamPanelState,
  supportTeamResultMessage
} from "@/lib/support-team-mark-core";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON = "11111111-1111-4111-8111-111111111111";
const OTHER_SEASON = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const db = createFakeDb();
let rpcCalls: Array<{ fn: string; args: any }> = [];
let rpcResult: { data: any; error: any } = { data: { ok: true, code: "marked" }, error: null };

function signIn(role: string, authUserId: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: `admin-${authUserId}`, role, status: "active", auth_user_id: authUserId, email: `${authUserId}@example.test`
  } as any);
}
const tickedForm = () => {
  const data = new FormData();
  data.set("support_team", "on");
  return data;
};
const tick = (personId = PERSON, data: FormData = tickedForm()) => markSupportTeamAction(personId, SUPPORT_TEAM_IDLE, data);

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
    { id: "g3", user_id: "auth-support-read", program_id: null, season_id: SEASON, role: "read", status: "active" },
    { id: "g4", user_id: "auth-core-s11", program_id: null, season_id: OTHER_SEASON, role: "operations", status: "active" },
    { id: "g5", user_id: "auth-reviewer", program_id: null, season_id: SEASON, role: "operations", status: "active" },
    { id: "g6", user_id: "auth-admin", program_id: null, season_id: SEASON, role: "operations", status: "active" }
  ];
  db.tables.mentee_exemptions = [];
  rpcCalls = [];
  rpcResult = { data: { ok: true, code: "marked" }, error: null };
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
  it("canMarkSupportTeam: Support team, Core team, Admin, Super admin; không mở thêm cho Reviewer, Viewer, tài khoản lạ", () => {
    expect(["super_admin", "admin", "core_team", "support_team"].map(canMarkSupportTeam)).toEqual([true, true, true, true]);
    expect(["reviewer", "viewer", "", null, undefined].map((r) => canMarkSupportTeam(r as any))).toEqual([false, false, false, false, false]);
  });

  it("supportTeamPanelState: đã xác nhận thắng mọi thứ; gỡ rồi thì coi như chưa; trong danh sách thư mời là 'listed'", () => {
    expect(supportTeamPanelState(null)).toBe("unmarked");
    expect(supportTeamPanelState({ confirmedAt: null, revokedAt: null, sendCount: 0 })).toBe("listed");
    expect(supportTeamPanelState({ confirmedAt: null, revokedAt: null, sendCount: 3 })).toBe("listed");
    expect(supportTeamPanelState({ confirmedAt: null, revokedAt: "2026-10-12T00:00:00Z", sendCount: 1 })).toBe("unmarked");
    expect(supportTeamPanelState({ confirmedAt: "2026-10-12T00:00:00Z", revokedAt: null, sendCount: 1 })).toBe("marked");
    // Một dấu gỡ còn sót không được che việc đã xác nhận.
    expect(supportTeamPanelState({ confirmedAt: "2026-10-12T00:00:00Z", revokedAt: "2026-10-13T00:00:00Z", sendCount: 1 })).toBe("marked");
  });

  it("supportTeamErrorMessage: nói đúng lời cho từng mã của database, không để lộ chữ lạ", () => {
    expect(supportTeamErrorMessage("ACCESS_DENIED")).toContain("không có quyền vận hành mùa");
    expect(supportTeamErrorMessage("PERSON_NOT_FOUND")).toContain("Không tìm thấy hồ sơ");
    const blocked = supportTeamErrorMessage("NEEDS_BTC:application_closed");
    expect(blocked).toContain("đã bị từ chối hoặc đã rút");
    expect(blocked).toContain("Chưa có gì bị thay đổi");
    expect(supportTeamErrorMessage("NEEDS_BTC:membership_inactive")).toContain("tư cách mentee mùa này đã ngừng");
    // Mã điều cản lạ: vẫn nói được "cần ban tổ chức kiểm tra", không văng mã thô.
    expect(supportTeamErrorMessage("NEEDS_BTC:mot_ma_moi")).toContain("cần ban tổ chức kiểm tra hồ sơ");
    for (const unknown of ["deadlock detected", "", null, undefined]) {
      const message = supportTeamErrorMessage(unknown);
      expect(message).toContain("Chưa ghi nhận được");
      expect(message).not.toContain("deadlock");
    }
  });

  it("supportTeamResultMessage: chỉ hai mã thành công; mã lạ là null để không báo nhầm", () => {
    expect(supportTeamResultMessage("marked", "UEHM-S12")).toContain("thành mentee của mùa này");
    expect(supportTeamResultMessage("already", "UEHM-S12")).toContain("đã là Support team");
    for (const other of ["confirmed", "ok", "", null, undefined, "exists"]) expect(supportTeamResultMessage(other, "UEHM-S12")).toBeNull();
  });
});

describe("tích Support team (action → RPC)", () => {
  it.each([
    ["support_team", "auth-support"],
    ["core_team", "auth-core"],
    ["admin", "auth-admin"]
  ])("%s có quyền vận hành mùa: gửi ĐÚNG MỘT lệnh vam121 mang chính người bấm, mùa hiện tại và người được tích", async (role, auth) => {
    signIn(role, auth);

    const state = await tick();

    expect(state.status).toBe("ok");
    expect(state.message).toContain(SUPPORT_TEAM_SEASON_CODE);
    expect(rpcCalls).toEqual([{ fn: "vam121_set_support_team", args: { p_actor: `admin-${auth}`, p_season: SEASON, p_person: PERSON } }]);
    // Người này vừa thành mentee của mùa: mọi nơi dựa vào danh sách mentee phải đọc lại.
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual([
      `/people/${PERSON}`, "/mentees", "/matches", "/matches/vong-2", "/matches/vong-2/bao-cao", "/applications/mentee-dac-cach"
    ]);
  });

  it("Super admin (không cần phạm vi) cũng tích được nếu lấy được phạm vi vận hành của mùa", async () => {
    db.tables.admin_scope_access.push({ id: "g7", user_id: "auth-super", program_id: null, season_id: SEASON, role: "full_access", status: "active" });
    signIn("super_admin", "auth-super");
    expect((await tick()).status).toBe("ok");
    expect(rpcCalls).toHaveLength(1);
  });

  it("database báo đã là Support team từ trước thì nói đúng là không đổi gì", async () => {
    signIn("core_team", "auth-core");
    rpcResult = { data: { ok: true, code: "already" }, error: null };
    const state = await tick();
    expect(state.status).toBe("ok");
    expect(state.message).toContain("không có gì thay đổi");
  });

  it("bấm Lưu mà CHƯA tích: không làm gì, không gửi lệnh nào, không làm mới trang", async () => {
    signIn("core_team", "auth-core");
    for (const data of [new FormData(), (() => { const d = new FormData(); d.set("support_team", ""); return d; })(), (() => { const d = new FormData(); d.set("support_team", "off"); return d; })()]) {
      expect(await tick(PERSON, data)).toEqual({ status: "error", message: SUPPORT_TEAM_NOT_TICKED_MESSAGE });
    }
    expect(rpcCalls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("không đủ quyền thì KHÔNG gửi gì: Reviewer dù có quyền vận hành; Support chỉ đọc; Core của mùa khác; Viewer; chưa đăng nhập", async () => {
    for (const [role, auth] of [["reviewer", "auth-reviewer"], ["support_team", "auth-support-read"], ["core_team", "auth-core-s11"], ["viewer", "auth-core"]]) {
      signIn(role, auth);
      const state = await tick();
      expect(state, `${role}/${auth}`).toEqual({ status: "error", message: supportTeamErrorMessage("ACCESS_DENIED") });
    }
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any);
    expect((await tick()).status).toBe("error");
    expect(rpcCalls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("không đọc được mùa thì coi như không có quyền, không gửi lệnh", async () => {
    signIn("core_team", "auth-core");
    db.tables.seasons = [];
    expect((await tick()).status).toBe("error");
    expect(rpcCalls).toEqual([]);
  });

  it("mã người hỏng thì KHÔNG gửi gì", async () => {
    signIn("core_team", "auth-core");
    for (const bad of ["khong-phai-uuid", "", "   "]) expect((await tick(bad)).status).toBe("error");
    expect(rpcCalls).toEqual([]);
  });

  it("điều database cản được nói bằng lời người dùng hiểu; không làm mới trang khi chưa ghi", async () => {
    signIn("core_team", "auth-core");
    const cases: Array<[string, RegExp]> = [
      ["NEEDS_BTC:application_closed", /đã bị từ chối hoặc đã rút/],
      ["NEEDS_BTC:membership_inactive", /đã ngừng/],
      ["NEEDS_BTC:email_ambiguous", /hơn một hồ sơ người dùng chung email/],
      ["NEEDS_BTC:no_email", /thiếu họ tên hoặc email/],
      ["ACCESS_DENIED", /không có quyền vận hành mùa/],
      ["PERSON_NOT_FOUND", /Không tìm thấy hồ sơ/],
      ["deadlock detected", /Chưa ghi nhận được/]
    ];
    for (const [code, expected] of cases) {
      rpcResult = { data: null, error: { message: code } };
      const state = await tick();
      expect(state.status, code).toBe("error");
      expect(state.message, code).toMatch(expected);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("database trả về điều không chắc (ok false, mã lạ, thiếu dữ liệu) thì KHÔNG báo thành công", async () => {
    signIn("core_team", "auth-core");
    for (const data of [{ ok: false, code: "marked" }, { ok: true, code: "confirmed" }, { ok: true }, null, {}]) {
      rpcResult = { data, error: null };
      expect(await tick()).toEqual({ status: "error", message: "Chưa xác nhận được kết quả. Tải lại trang để kiểm tra." });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("đọc trạng thái khung", () => {
  const panel = () => getSupportTeamPanel(PERSON);

  it("người không được tích thì khung ẩn hẳn (null), không phải khung bị khoá", async () => {
    for (const [role, auth] of [["reviewer", "auth-reviewer"], ["support_team", "auth-support-read"], ["core_team", "auth-core-s11"], ["viewer", "auth-core"]]) {
      signIn(role, auth);
      expect(await panel(), `${role}/${auth}`).toBeNull();
    }
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any);
    expect(await panel()).toBeNull();
  });

  it("mã người hỏng thì ẩn khung ngay cả với người có quyền, và không đọc bảng nào", async () => {
    signIn("core_team", "auth-core");
    db.requests.length = 0;
    for (const bad of ["khong-phai-uuid", "", "   "]) expect(await getSupportTeamPanel(bad), bad).toBeNull();
    expect(db.requests.filter((r) => r.table === "mentee_exemptions")).toEqual([]);
  });

  it("chưa có dòng đặc cách: unmarked", async () => {
    signIn("support_team", "auth-support");
    expect(await panel()).toEqual({ seasonCode: SUPPORT_TEAM_SEASON_CODE, state: "unmarked", sendCount: 0 });
  });

  it("đã xác nhận: marked; trong danh sách thư mời: listed kèm số thư; đã gỡ: unmarked", async () => {
    signIn("core_team", "auth-core");
    db.tables.mentee_exemptions = [{ id: "e1", season_id: SEASON, person_id: PERSON, confirmed_at: "2026-10-13T06:00:00Z", revoked_at: null, send_count: 0 }];
    expect((await panel())?.state).toBe("marked");
    db.tables.mentee_exemptions = [{ id: "e1", season_id: SEASON, person_id: PERSON, confirmed_at: null, revoked_at: null, send_count: 2 }];
    expect(await panel()).toEqual({ seasonCode: SUPPORT_TEAM_SEASON_CODE, state: "listed", sendCount: 2 });
    db.tables.mentee_exemptions = [{ id: "e1", season_id: SEASON, person_id: PERSON, confirmed_at: null, revoked_at: "2026-10-12T00:00:00Z", send_count: 2 }];
    expect((await panel())?.state).toBe("unmarked");
  });

  it("dòng của mùa khác hoặc của người khác không tính", async () => {
    signIn("core_team", "auth-core");
    db.tables.mentee_exemptions = [
      { id: "e1", season_id: OTHER_SEASON, person_id: PERSON, confirmed_at: "2026-10-13T06:00:00Z", revoked_at: null, send_count: 0 },
      { id: "e2", season_id: SEASON, person_id: "55555555-5555-4555-8555-555555555555", confirmed_at: "2026-10-13T06:00:00Z", revoked_at: null, send_count: 0 }
    ];
    expect((await panel())?.state).toBe("unmarked");
  });

  it("không đọc được trạng thái thì ẩn khung (fail-closed): hiện 'chưa tích' cho người đã tích là mời tích lần hai", async () => {
    signIn("core_team", "auth-core");
    db.errors.mentee_exemptions = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await panel()).toBeNull();
  });
});

describe("khung giao diện", () => {
  const renderPanel = (state: "unmarked" | "listed" | "marked", sendCount = 0, name = "Nguyễn Văn A") =>
    render(
      <SupportTeamPanel
        action={(previous, formData) => markSupportTeamAction(PERSON, previous, formData)}
        seasonCode="UEHM-S12"
        personName={name}
        state={state}
        sendCount={sendCount}
      />
    );
  const checkbox = () => screen.getByRole("checkbox") as HTMLInputElement;
  const saveButton = () => screen.getByRole("button", { name: "Lưu" }) as HTMLButtonElement;

  it("chưa tích: có ô tích tên 'support_team' (khớp với cái action đọc), nút Lưu bị khoá cho tới khi tích", () => {
    renderPanel("unmarked");
    expect(checkbox().name).toBe("support_team");
    expect(checkbox().checked).toBe(false);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(checkbox());
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(checkbox());
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Nguyễn Văn A tự thành mentee của mùa UEHM-S12 ngay/)).toBeTruthy();
    expect(screen.queryByTestId("support-team-listed")).toBeNull();
  });

  it("ô tích trong form thật sinh ra FormData mà action nhận ra: tích thì gửi lệnh, bỏ tích thì không", async () => {
    signIn("support_team", "auth-support");
    renderPanel("unmarked");
    const form = screen.getByTestId("support-team-form") as HTMLFormElement;

    expect((await markSupportTeamAction(PERSON, SUPPORT_TEAM_IDLE, new FormData(form))).status).toBe("error");
    expect(rpcCalls).toEqual([]);

    fireEvent.click(checkbox());
    expect((await markSupportTeamAction(PERSON, SUPPORT_TEAM_IDLE, new FormData(form))).status).toBe("ok");
    expect(rpcCalls).toHaveLength(1);
  });

  it("đang trong danh sách thư mời: nói rõ tích ở đây là xác nhận luôn, kèm số thư đã gửi", () => {
    renderPanel("listed", 2);
    const note = screen.getByTestId("support-team-listed").textContent ?? "";
    expect(note).toContain("đã gửi 2 thư, chờ xác nhận");
    expect(note).toContain("xác nhận luôn");
    expect(saveButton().disabled).toBe(true);
  });

  it("đã là Support team: hiện dấu ✓ và lời hướng dẫn ngừng, KHÔNG còn form, không có lệnh bỏ tích", () => {
    renderPanel("marked");
    expect(screen.getByTestId("support-team-marked").textContent).toContain("Là Support team mùa UEHM-S12");
    expect(screen.getByText(/đã là mentee của mùa này, không qua phỏng vấn/)).toBeTruthy();
    expect(screen.getByText(/Trạng thái tham gia/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lưu" })).toBeNull();
  });

  it("hiện kết quả của lần lưu: xanh khi thành công, đỏ khi bị cản", () => {
    formState.current = { status: "ok", message: "Đã ghi nhận Support team." };
    const { unmount } = renderPanel("unmarked");
    expect(screen.getByTestId("support-team-message").textContent).toBe("Đã ghi nhận Support team.");
    expect(screen.getByTestId("support-team-message").className).toContain("text-green-700");
    unmount();

    formState.current = { status: "error", message: "Chưa tích được: đơn mentee mùa này đã bị từ chối hoặc đã rút." };
    renderPanel("unmarked");
    expect(screen.getByTestId("support-team-message").className).toContain("text-red-600");
  });

  it("không có tên thì dùng 'Bạn này', không in chuỗi rỗng", () => {
    renderPanel("unmarked", 0, "   ");
    expect(screen.getByText(/Bạn này tự thành mentee/)).toBeTruthy();
  });
});
