/**
 * Duyệt chung mentor + mentee một lượt (VAM00005, 28/10/2026). Hành động chia danh sách theo vai trò rồi gọi
 * hai hàm duyệt sẵn có; ở đây khoá việc chia đúng, việc không gửi trường thừa xuống hàm SQL, và lời báo khi
 * một nửa đã ghi mà nửa kia hỏng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const lib = vi.hoisted(() => ({
  mentor: vi.fn(async (rows: unknown[]) => ({ ok: true, message: `ok ${rows.length}` })),
  mentee: vi.fn(async (rows: unknown[]) => ({ ok: true, message: `ok ${rows.length}` })),
  revalidate: vi.fn()
}));
vi.mock("next/cache", () => ({ revalidatePath: lib.revalidate }));
vi.mock("@/lib/matching-round2", () => ({
  confirmMentorGroups: lib.mentor,
  confirmMenteeGroups: lib.mentee,
  classifyNewPeople: vi.fn(),
  setIndustryGroup: vi.fn(),
  setRound2Window: vi.fn()
}));
vi.mock("@/lib/matching-round2-dispatch", () => ({
  runRound2Dispatch: vi.fn(),
  runRound2Reminder: vi.fn(),
  sendRound2InviteTest: vi.fn(),
  sendRound2ReminderTest: vi.fn()
}));

import { confirmRound2GroupsAction } from "@/app/actions/matching-round2";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";
import { parseRoleGroupApprovals } from "@/lib/matching-round2-bulk-core";

const MENTOR_ID = "11111111-1111-4111-8111-111111111111";
const MENTEE_ID = "22222222-2222-4222-8222-222222222222";
const row = (assignmentId: string, role: unknown, expectedGroup = 3) => ({ assignmentId, expectedGroup, expectedDrift: null, role });

function form(rows: unknown, confirmed = "yes") {
  const data = new FormData();
  data.set("confirmed", confirmed);
  data.set("rows", JSON.stringify(rows));
  return data;
}

beforeEach(() => {
  lib.mentor.mockClear();
  lib.mentee.mockClear();
  lib.revalidate.mockClear();
  lib.mentor.mockImplementation(async (rows: unknown[]) => ({ ok: true, message: `ok ${rows.length}` }));
  lib.mentee.mockImplementation(async (rows: unknown[]) => ({ ok: true, message: `ok ${rows.length}` }));
});

describe("confirmRound2GroupsAction", () => {
  it("chia đúng vai trò, gửi xuống mỗi hàm chỉ ba trường của GroupApproval", async () => {
    const state = await confirmRound2GroupsAction(ROUND2_IDLE, form([row(MENTOR_ID, "mentor"), row(MENTEE_ID, "mentee", 4)]));
    expect(lib.mentor).toHaveBeenCalledWith([{ assignmentId: MENTOR_ID, expectedGroup: 3, expectedDrift: null }]);
    expect(lib.mentee).toHaveBeenCalledWith([{ assignmentId: MENTEE_ID, expectedGroup: 4, expectedDrift: null }]);
    expect(state).toEqual({ status: "ok", message: "Đã ghi nhận BTC đã duyệt cho 1 mentor và 1 mentee." });
    expect(lib.revalidate).toHaveBeenCalled();
  });

  it("chỉ có một vai trò thì không gọi hàm của vai trò kia", async () => {
    const state = await confirmRound2GroupsAction(ROUND2_IDLE, form([row(MENTEE_ID, "mentee")]));
    expect(lib.mentor).not.toHaveBeenCalled();
    expect(lib.mentee).toHaveBeenCalledTimes(1);
    expect(state.message).toBe("Đã ghi nhận BTC đã duyệt cho 1 mentee.");
  });

  it("phần mentor đã ghi mà phần mentee hỏng: báo rõ phần đã xong, vẫn làm mới trang", async () => {
    lib.mentee.mockImplementation(async () => ({ ok: false, message: "Nhóm đã đổi." }));
    const state = await confirmRound2GroupsAction(ROUND2_IDLE, form([row(MENTOR_ID, "mentor"), row(MENTEE_ID, "mentee")]));
    expect(state).toEqual({ status: "error", message: "Đã duyệt 1 mentor; phần còn lại chưa duyệt được: Nhóm đã đổi." });
    expect(lib.revalidate).toHaveBeenCalled();
  });

  it("phần mentor hỏng thì dừng, không duyệt tiếp mentee và không làm mới trang", async () => {
    lib.mentor.mockImplementation(async () => ({ ok: false, message: "Không có quyền." }));
    const state = await confirmRound2GroupsAction(ROUND2_IDLE, form([row(MENTOR_ID, "mentor"), row(MENTEE_ID, "mentee")]));
    expect(state).toEqual({ status: "error", message: "Không có quyền." });
    expect(lib.mentee).not.toHaveBeenCalled();
    expect(lib.revalidate).not.toHaveBeenCalled();
  });

  it("thiếu dấu xác nhận, vai trò lạ hoặc thiếu vai trò: không gọi hàm nào", async () => {
    for (const data of [
      form([row(MENTOR_ID, "mentor")], "no"),
      form([row(MENTOR_ID, "admin")]),
      form([row(MENTOR_ID, undefined)]),
      form([])
    ]) {
      const state = await confirmRound2GroupsAction(ROUND2_IDLE, data);
      expect(state.status).toBe("error");
    }
    expect(lib.mentor).not.toHaveBeenCalled();
    expect(lib.mentee).not.toHaveBeenCalled();
  });

  it("trần 500 tính trên tổng cả lượt, không phải trên từng vai trò", () => {
    const ids = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => `${prefix}0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    const rows = [...ids(300, "a").map((id) => row(id, "mentor")), ...ids(201, "b").map((id) => row(id, "mentee"))];
    expect(parseRoleGroupApprovals(rows)).toBeNull();
    expect(parseRoleGroupApprovals(rows.slice(0, 500))).toHaveLength(500);
  });
});
