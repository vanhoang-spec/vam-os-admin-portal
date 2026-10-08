/**
 * Ghép cặp Vòng 2 — số chỗ, ai hiện cho ai, bất thường, đối soát (BTC 07/10/2026).
 */
import { describe, expect, it } from "vitest";
import {
  assignmentRowsForSave,
  buildRound2Board,
  byGroupThenName,
  round2Slots,
  type Round2Assignment,
  type Round2Match,
  type Round2Person
} from "@/lib/matching-round2-core";

const mentor = (id: string, over: Partial<Round2Person> = {}): Round2Person => ({
  role: "mentor",
  personId: id,
  applicationId: `app-${id}`,
  name: `Mentor ${id}`,
  email: `${id}@example.test`,
  eligible: true,
  mentorInput: { title: "Marketing Manager", functionCode: "marketing", industryCode: "fmcg", functionOther: null },
  capacityTarget: 2,
  profileCount: 1,
  details: [],
  ...over
});
const mentee = (id: string, over: Partial<Round2Person> = {}): Round2Person => ({
  role: "mentee",
  personId: id,
  applicationId: `app-${id}`,
  name: `Mentee ${id}`,
  email: null,
  eligible: true,
  menteeInput: { targetFunction: "marketing", targetFunctionOther: null, targetIndustry: "fmcg", targetIndustryOther: null, major: null, faculty: null, goals: null },
  details: [],
  ...over
});
const assign = (role: "mentor" | "mentee", personId: string, group: number, over: Partial<Round2Assignment> = {}): Round2Assignment => ({
  id: `as-${personId}`,
  role,
  personId,
  group,
  confidence: "cao",
  flags: [],
  source: "auto",
  driftGroup: null,
  secondary: [],
  reasons: [],
  overrideReason: null,
  reviewedAt: null,
  ...over
});
let seq = 0;
const match = (mentorId: string, menteeId: string, over: Partial<Round2Match> = {}): Round2Match => ({
  id: `m${++seq}`,
  mentorPersonId: mentorId,
  menteePersonId: menteeId,
  status: "active",
  round: 1,
  matchedAt: "2026-10-04",
  createdAt: "2026-10-04T02:00:00Z",
  endedAt: null,
  endReason: null,
  ...over
});

describe("thứ tự hiển thị (BTC 07/10/2026: mới nhất trước)", () => {
  it("cặp vòng 2 vừa chọn lên đầu danh sách 'Đã ghép ở vòng 2'", () => {
    const board = buildRound2Board({
      people: [mentor("a", { capacityTarget: 3 }), mentee("x"), mentee("y"), mentee("z")],
      assignments: [assign("mentor", "a", 4), assign("mentee", "x", 4), assign("mentee", "y", 4), assign("mentee", "z", 4)],
      matches: [
        match("a", "x", { round: 2, createdAt: "2026-10-08T02:00:00Z" }),
        match("a", "y", { round: 2, createdAt: "2026-10-08T09:15:00+07:00" }), // 02:15Z
        match("a", "z", { round: 2, createdAt: "2026-10-08T01:00:00Z" })
      ]
    });
    expect(board.round2Matches.map((m) => m.mentee?.person.personId)).toEqual(["y", "x", "z"]);
  });

  it("byGroupThenName: nhóm 1→9, chưa phân nhóm cuối, trong nhóm theo tên", () => {
    const board = buildRound2Board({
      people: [
        mentee("p1", { name: "Trần B" }),
        mentee("p2", { name: "Lê A" }),
        mentee("p3", { name: "An C" }),
        mentee("p4", { name: "Bùi D" })
      ],
      assignments: [assign("mentee", "p1", 4), assign("mentee", "p2", 4), assign("mentee", "p3", 6)],
      matches: []
    });
    expect([...board.rows].sort(byGroupThenName).map((r) => r.person.personId)).toEqual(["p2", "p1", "p3", "p4"]);
  });
});

describe("round2Slots", () => {
  it("min(2, đăng ký) − số cặp đang hoạt động, không âm", () => {
    expect(round2Slots(3, 0)).toBe(2);
    expect(round2Slots(3, 2)).toBe(0);
    expect(round2Slots(3, 1)).toBe(1);
    expect(round2Slots(1, 0)).toBe(1);
    expect(round2Slots(1, 1)).toBe(0);
    expect(round2Slots(2, 3)).toBe(0);
    // Sức nhận thiếu → dự phòng 3 như trigger database, rồi trần 2.
    expect(round2Slots(null, 0)).toBe(2);
  });
});

describe("buildRound2Board", () => {
  it("cặp vòng 1 tính vào số chỗ; mentor hết chỗ không nhận danh sách", () => {
    const board = buildRound2Board({
      people: [mentor("a", { capacityTarget: 3 }), mentor("b", { capacityTarget: 1 }), mentee("x"), mentee("y")],
      assignments: [assign("mentor", "a", 4), assign("mentor", "b", 4), assign("mentee", "x", 4), assign("mentee", "y", 4)],
      matches: [match("a", "x"), match("b", "y")]
    });
    const a = board.rows.find((r) => r.person.personId === "a")!;
    const b = board.rows.find((r) => r.person.personId === "b")!;
    expect([a.slots, a.receivesList]).toEqual([1, true]);
    expect([b.slots, b.receivesList]).toEqual([0, false]);
  });

  it("mentee có cặp hoạt động thì ẩn; cặp bị huỷ thì hiện lại kèm cảnh báo", () => {
    const board = buildRound2Board({
      people: [mentor("a"), mentee("x"), mentee("y")],
      assignments: [assign("mentor", "a", 4), assign("mentee", "x", 4), assign("mentee", "y", 4)],
      matches: [match("a", "x"), match("a", "y", { status: "dropped", endedAt: "2026-10-05T03:00:00Z", endReason: "Chọn nhầm" })]
    });
    const state = (id: string) => board.rows.find((r) => r.person.personId === id)!.menteeState;
    expect(state("x")).toBe("matched");
    expect(state("y")).toBe("visible");
    const reappeared = board.anomalies.filter((a) => a.kind === "reappeared");
    expect(reappeared).toHaveLength(1);
    expect(reappeared[0].personIds).toEqual(["y"]);
    expect(reappeared[0].message).toContain("Chọn nhầm");
  });

  it("mentee chưa có nhóm không hiện cho ai; người đã rút không vào danh sách chờ phân loại", () => {
    const board = buildRound2Board({
      people: [mentor("a"), mentee("x"), mentee("z", { eligible: false })],
      assignments: [assign("mentor", "a", 4)],
      matches: []
    });
    const group4 = board.groups.find((g) => g.code === 4)!;
    expect(group4.visible).toBe(0);
    expect(board.unclassified.mentees).toBe(1);
    expect(board.pending.map((r) => r.person.personId)).toEqual(["x"]);
    expect(board.anomalies.filter((a) => a.kind === "unclassified").map((a) => a.personIds[0])).toEqual(["x"]);
  });

  it("đối soát theo nhóm: mentee = vòng 1 + vòng 2 + khác + đang hiện", () => {
    const board = buildRound2Board({
      people: [mentor("a", { capacityTarget: 3 }), mentor("b"), mentee("w"), mentee("x"), mentee("y"), mentee("z")],
      assignments: ["a", "b"].map((id) => assign("mentor", id, 4)).concat(["w", "x", "y", "z"].map((id) => assign("mentee", id, 4))),
      matches: [match("a", "w"), match("a", "x", { round: 2 }), match("b", "y", { round: null })]
    });
    const g = board.groups.find((x) => x.code === 4)!;
    expect(g).toMatchObject({ mentors: 2, mentees: 4, matchedR1: 1, matchedR2: 1, matchedOther: 1, visible: 1, reconciled: true });
    // a: min(2,3) − 2 = 0; b: min(2,2) − 1 = 1.
    expect([g.mentorsWithSlots, g.slots]).toEqual([1, 1]);
    expect(board.round2Matches.map((m) => m.mentee?.person.personId)).toEqual(["x"]);
  });

  it("cảnh báo: cặp vòng 2 khác nhóm; mentor có nhiều hồ sơ; drift", () => {
    const board = buildRound2Board({
      people: [mentor("a"), mentor("b", { profileCount: 2 }), mentee("x")],
      assignments: [assign("mentor", "a", 4), assign("mentor", "b", 4), assign("mentee", "x", 6, { driftGroup: 4 })],
      matches: [match("a", "x", { round: 2 })]
    });
    const kinds = board.anomalies.map((a) => `${a.kind}:${a.severity}`);
    expect(kinds).toContain("cross_group:warning");
    expect(kinds).toContain("mentor_profile_ambiguous:warning");
    expect(kinds).toContain("drift:info");
    expect(board.rows.find((r) => r.person.personId === "b")!.receivesList).toBe(false);
  });

  it("dòng gửi lưu: chỉ người đủ điều kiện, mentor trước, nhóm theo luật hiện hành", () => {
    const board = buildRound2Board({
      people: [mentee("x"), mentor("a"), mentee("z", { eligible: false })],
      assignments: [],
      matches: []
    });
    const saved = assignmentRowsForSave(board);
    expect(saved.map((r) => [r.role, r.personId, r.group])).toEqual([
      ["mentor", "a", 4],
      ["mentee", "x", 4]
    ]);
  });

  it("dòng gửi lưu bỏ người BTC đã đổi / xác nhận nhóm — không sinh 'Dữ liệu đổi nhóm' giả; người máy xếp vẫn được soát", () => {
    const board = buildRound2Board({
      people: [mentor("a"), mentor("b"), mentee("x")],
      assignments: [assign("mentor", "a", 3, { source: "btc" }), assign("mentor", "b", 1), assign("mentee", "x", 4, { source: "btc" })],
      matches: []
    });
    expect(assignmentRowsForSave(board).map((r) => [r.role, r.personId])).toEqual([["mentor", "b"]]);
  });
});
