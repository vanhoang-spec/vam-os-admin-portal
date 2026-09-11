/**
 * Hai hành động của màn hình mời tài khoản.
 *
 * Mời hàng loạt: danh sách người do MÁY CHỦ tính, con số gõ lại phải khớp con
 * số máy chủ vừa tính, và số người còn lại luôn đếm lại từ database — không
 * lấy "trước trừ số vừa gửi", vì thư lỗi không làm ai rời khỏi danh sách.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ access: { ok: true, actor: { id: "admin-1" } } as any }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/participant-invites", () => ({
  authorizeParticipantInvites: vi.fn(async () => h.access),
  inviteParticipantAccount: vi.fn(),
  inviteParticipantsInSeason: vi.fn()
}));
vi.mock("@/lib/login-invite-roster", () => ({ loadLoginInviteRoster: vi.fn() }));

import { inviteParticipantAction, runBulkInviteAction } from "@/app/actions/participants";
import { loadLoginInviteRoster } from "@/lib/login-invite-roster";
import { initialBulkInviteState, initialParticipantInviteState } from "@/lib/participant-action-types";
import { summarizeRoster, type RosterRow } from "@/lib/participant-invite-core";
import {
  authorizeParticipantInvites,
  inviteParticipantAccount,
  inviteParticipantsInSeason
} from "@/lib/participant-invites";

const SEASON = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    personId: uuid(n),
    fullName: `Người ${String(n).padStart(3, "0")}`,
    email: `p${n}@example.com`,
    roles: ["mentor"],
    status: "not_invited",
    blockReason: null,
    inFlight: false,
    everSent: false,
    lastSentAt: null,
    latest: null,
    activatedAt: null,
    ...overrides
  };
}

function roster(count: number, overrides: Record<string, unknown> = {}) {
  const rows = Array.from({ length: count }, (_, index) => row(index + 1));
  return { ok: true, rows, summary: summarizeRoster(rows), sentLast24h: 0, budgetLeft: 240, gateOpen: true, ...overrides };
}

function bulkForm(fields: Record<string, string>) {
  const data = new FormData();
  data.set("season_id", SEASON);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const sent = (personId: string) => ({ personId, outcome: "sent", ok: true, message: "Đã gửi thư mời." });

beforeEach(() => {
  vi.clearAllMocks();
  h.access = { ok: true, actor: { id: "admin-1" } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("mời hàng loạt: cổng trước mọi lần đọc", () => {
  it("không đủ quyền thì không đọc danh sách, không mời ai", async () => {
    h.access = { ok: false, code: "forbidden", message: "Bạn không có quyền gửi lời mời tài khoản." };

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "5" }));

    expect(state).toMatchObject({ ok: false, message: "Bạn không có quyền gửi lời mời tài khoản.", canContinue: false });
    expect(authorizeParticipantInvites).toHaveBeenCalledWith(SEASON);
    expect(loadLoginInviteRoster).not.toHaveBeenCalled();
    expect(inviteParticipantsInSeason).not.toHaveBeenCalled();
  });

  it("cổng thư tắt thì không mời ai", async () => {
    vi.mocked(loadLoginInviteRoster).mockResolvedValue(roster(5, { gateOpen: false }) as never);

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "5" }));

    expect(state.message).toContain("đang tắt gửi thư");
    expect(inviteParticipantsInSeason).not.toHaveBeenCalled();
  });
});

describe("mời hàng loạt: xác nhận quy mô", () => {
  it("con số gõ lại phải khớp con số máy chủ tính, không phải con số ẩn trong biểu mẫu", async () => {
    vi.mocked(loadLoginInviteRoster).mockResolvedValue(roster(7) as never);

    const state = await runBulkInviteAction(
      initialBulkInviteState,
      bulkForm({ phase: "start", typed_count: "5", expected_count: "5" })
    );

    expect(state.ok).toBe(false);
    expect(state.message).toContain("7");
    expect(inviteParticipantsInSeason).not.toHaveBeenCalled();
  });

  it("gửi tiếp mà danh sách đã dài ra thì bắt xác nhận lại", async () => {
    vi.mocked(loadLoginInviteRoster).mockResolvedValue(roster(14) as never);

    const state = await runBulkInviteAction(
      { ...initialBulkInviteState, remaining: 10 },
      bulkForm({ phase: "continue", previous_remaining: "10" })
    );

    expect(state.ok).toBe(false);
    expect(state.message).toContain("14");
    expect(inviteParticipantsInSeason).not.toHaveBeenCalled();
  });
});

describe("mời hàng loạt: một lượt", () => {
  it("gửi đúng 20 người đầu của danh sách máy chủ tính, rồi bảo Gửi tiếp", async () => {
    vi.mocked(loadLoginInviteRoster)
      .mockResolvedValueOnce(roster(30) as never)
      .mockResolvedValueOnce(roster(10) as never);
    vi.mocked(inviteParticipantsInSeason).mockImplementation(async ({ personIds }) => ({
      ok: true,
      results: personIds.map((personId) => sent(personId)) as never,
      remainingPersonIds: [],
      stoppedBy: null
    }));

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "30" }));

    const call = vi.mocked(inviteParticipantsInSeason).mock.calls[0][0];
    expect(call.seasonId).toBe(SEASON);
    expect(call.personIds).toEqual(Array.from({ length: 20 }, (_, index) => uuid(index + 1)));
    expect(state).toMatchObject({ ok: true, remaining: 10, canContinue: true });
    expect(state.message).toContain("Đã gửi 20 thư mời");
    expect(state.message).toContain("Gửi tiếp");
  });

  it("số người còn lại lấy từ lần đếm lại, không lấy phép trừ", async () => {
    vi.mocked(loadLoginInviteRoster)
      .mockResolvedValueOnce(roster(25) as never)
      .mockResolvedValueOnce(roster(8) as never);
    vi.mocked(inviteParticipantsInSeason).mockImplementation(async ({ personIds }) => ({
      ok: true,
      results: personIds.map((personId, index) =>
        index < 17 ? sent(personId) : { personId, outcome: "send_failed", ok: false, message: "Chưa gửi được thư." }
      ) as never,
      remainingPersonIds: [],
      stoppedBy: null
    }));

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "25" }));

    expect(state.remaining).toBe(8);
    expect(state.message).toContain("3 thư chưa gửi được");
  });

  it("chạm hạn mức thì không mời gửi tiếp, dù còn người", async () => {
    vi.mocked(loadLoginInviteRoster)
      .mockResolvedValueOnce(roster(25) as never)
      .mockResolvedValueOnce(roster(15) as never);
    vi.mocked(inviteParticipantsInSeason).mockResolvedValue({
      ok: true,
      results: [sent(uuid(1))] as never,
      remainingPersonIds: [],
      stoppedBy: "daily_budget"
    });

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "25" }));

    expect(state.remaining).toBe(15);
    expect(state.canContinue).toBe(false);
    expect(state.message).toContain("ngày mai");
  });

  it("không đếm lại được thì không đoán số còn lại", async () => {
    vi.mocked(loadLoginInviteRoster)
      .mockResolvedValueOnce(roster(3) as never)
      .mockResolvedValueOnce({ ok: false, error: "hỏng" } as never);
    vi.mocked(inviteParticipantsInSeason).mockResolvedValue({
      ok: true,
      results: [sent(uuid(1)), sent(uuid(2)), sent(uuid(3))] as never,
      remainingPersonIds: [],
      stoppedBy: null
    });

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "3" }));

    expect(state.remaining).toBeNull();
    expect(state.canContinue).toBe(false);
  });

  it("chi tiết tối đa mười dòng, theo tên người", async () => {
    vi.mocked(loadLoginInviteRoster)
      .mockResolvedValueOnce(roster(12) as never)
      .mockResolvedValueOnce(roster(0) as never);
    vi.mocked(inviteParticipantsInSeason).mockImplementation(async ({ personIds }) => ({
      ok: true,
      results: personIds.map((personId) => ({
        personId,
        outcome: "refused",
        ok: false,
        message: "Email này đang dùng cho nhiều người trong danh bạ."
      })) as never,
      remainingPersonIds: [],
      stoppedBy: null
    }));

    const state = await runBulkInviteAction(initialBulkInviteState, bulkForm({ phase: "start", typed_count: "12" }));

    expect(state.problems).toHaveLength(10);
    expect(state.problems[0]).toBe("Người 001: Email này đang dùng cho nhiều người trong danh bạ.");
  });
});

describe("nút trên một dòng", () => {
  beforeEach(() => {
    vi.mocked(inviteParticipantAccount).mockResolvedValue({
      personId: uuid(1),
      outcome: "sent",
      ok: true,
      message: "Đã gửi thư mời tới An."
    } as never);
  });

  function rowForm(fields: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  it("chỉ chuyển người, mùa và kiểu — email trong biểu mẫu bị bỏ qua", async () => {
    const state = await inviteParticipantAction(
      initialParticipantInviteState,
      rowForm({ person_id: uuid(1), season_id: SEASON, mode: "invite", email: "ke-la@example.com" })
    );

    expect(inviteParticipantAccount).toHaveBeenCalledWith({ personId: uuid(1), seasonId: SEASON, mode: "invite" });
    expect(state).toMatchObject({ ok: true, message: "Đã gửi thư mời tới An.", outcome: "sent" });
    expect(state.at).toBeGreaterThan(0);
  });

  it("chỉ `reset` mới là đặt lại mật khẩu; giá trị lạ thành mời thường", async () => {
    await inviteParticipantAction(initialParticipantInviteState, rowForm({ person_id: uuid(1), season_id: SEASON, mode: "reset" }));
    await inviteParticipantAction(initialParticipantInviteState, rowForm({ person_id: uuid(1), season_id: SEASON, mode: "bulk" }));

    expect(vi.mocked(inviteParticipantAccount).mock.calls.map((call) => call[0].mode)).toEqual(["reset", "invite"]);
  });

  it("lỗi bất ngờ thành một lời báo, không ném ra màn hình", async () => {
    vi.mocked(inviteParticipantAccount).mockRejectedValue(new Error("boom"));
    const state = await inviteParticipantAction(
      initialParticipantInviteState,
      rowForm({ person_id: uuid(1), season_id: SEASON, mode: "invite" })
    );
    expect(state).toMatchObject({ ok: false, outcome: "failed" });
  });
});
