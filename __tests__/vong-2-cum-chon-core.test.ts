/**
 * Vòng 2 — cụm chọn (BTC 14/10/2026), phần thuần: luật cụm, tổng cung - cầu theo cụm, cảnh báo
 * khác nhóm theo cụm, và luật "được gửi thư khi đã đặt giờ mở".
 *
 * Database là nơi quyết định ai chọn được ai (vong-2-cum-chon-migration); ở đây soát rằng trang,
 * thư và báo cáo nói đúng điều database làm.
 */
import { describe, expect, it } from "vitest";
import { buildRound2Board, type Round2Assignment, type Round2Match, type Round2Person } from "@/lib/matching-round2-core";
import { fillGroups, fillPairsFromRows, isFillPick, mentorPoolLabel, poolGroups, poolList, poolMapFromRows, poolOf } from "@/lib/matching-round2-pools-core";
import { round2DispatchBlocked, round2OpensLabel } from "@/lib/matching-round2-dispatch-core";

const S12 = poolMapFromRows([
  { group_code: 1, pool_code: 1 },
  { group_code: 2, pool_code: 1 },
  { group_code: 3, pool_code: 1 },
  { group_code: 6, pool_code: 6 },
  { group_code: 9, pool_code: 6 }
]);

describe("luật cụm", () => {
  it("nhóm có dòng thì theo dòng; nhóm không có dòng là cụm của chính nó; dòng rác bị bỏ", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => poolOf(S12, g))).toEqual([1, 1, 1, 4, 5, 6, 7, 8, 6]);
    const junk = poolMapFromRows([{ group_code: 0, pool_code: 1 }, { group_code: 2, pool_code: 12 }, { group_code: "x", pool_code: 1 }, { group_code: 3, pool_code: 1 }]);
    expect(Array.from(junk.entries())).toEqual([[3, 1]]);
  });

  it("các nhóm chung danh sách, theo thứ tự nhóm", () => {
    expect(poolGroups(S12, 2)).toEqual([1, 2, 3]);
    expect(poolGroups(S12, 9)).toEqual([6, 9]);
    expect(poolGroups(S12, 4)).toEqual([4]);
    expect(poolGroups(new Map(), 2)).toEqual([2]);
  });

  it("nhãn cho mentor: nhóm của mình, kèm các nhóm chung danh sách", () => {
    expect(mentorPoolLabel(S12, 3)).toBe("3. Tài chính - Đầu tư (chung danh sách với 1. Ngân hàng - Bảo hiểm, 2. Kế toán - Kiểm toán)");
    expect(mentorPoolLabel(S12, 9)).toBe("9. Khác (chung danh sách với 6. Nhân sự)");
    expect(mentorPoolLabel(S12, 4)).toBe("4. Marketing - Kinh doanh");
  });

  it("danh sách cụm cho báo cáo: đủ 9 nhóm, mỗi nhóm đúng một cụm", () => {
    const list = poolList(S12);
    expect(list.map((p) => p.groups)).toEqual([[1, 2, 3], [4], [5], [6, 9], [7], [8]]);
    expect(list[0].label).toBe("Cụm 1 + 2 + 3: 1. Ngân hàng - Bảo hiểm · 2. Kế toán - Kiểm toán · 3. Tài chính - Đầu tư");
    expect(list[1].label).toBe("4. Marketing - Kinh doanh");
    expect(list.flatMap((p) => p.groups).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

// ── bảng Vòng 2 với cụm ─────────────────────────────────────────────────────────

const mentor = (id: string, capacityTarget = 2): Round2Person => ({
  role: "mentor",
  personId: id,
  applicationId: `app-${id}`,
  name: `Mentor ${id}`,
  email: `${id}@example.test`,
  eligible: true,
  mentorInput: { title: null, functionCode: null, industryCode: null, functionOther: null },
  capacityTarget,
  profileCount: 1,
  details: []
});
const mentee = (id: string): Round2Person => ({
  role: "mentee",
  personId: id,
  applicationId: `app-${id}`,
  name: `Mentee ${id}`,
  email: null,
  eligible: true,
  menteeInput: { targetFunction: null, targetFunctionOther: null, targetIndustry: null, targetIndustryOther: null, major: null, faculty: null, goals: null },
  details: []
});
const assign = (role: "mentor" | "mentee", personId: string, group: number): Round2Assignment => ({
  id: `as-${personId}`,
  role,
  personId,
  group,
  confidence: "cao",
  flags: [],
  source: "btc",
  driftGroup: null,
  secondary: [],
  reasons: [],
  overrideReason: null,
  reviewedAt: null
});
const match = (id: string, mentorId: string, menteeId: string, round: number | null): Round2Match => ({
  id,
  mentorPersonId: mentorId,
  menteePersonId: menteeId,
  status: "active",
  round,
  matchedAt: null,
  createdAt: "2026-10-15T04:00:00Z",
  endedAt: null,
  endReason: null
});

function board(pools = S12, matches: Round2Match[] = []) {
  return buildRound2Board({
    people: [mentor("t1"), mentor("t3", 1), mentor("t4"), mentor("t6"), mentee("e1"), mentee("e2"), mentee("e3"), mentee("e3b"), mentee("e4"), mentee("e9")],
    assignments: [
      assign("mentor", "t1", 1),
      assign("mentor", "t3", 3),
      assign("mentor", "t4", 4),
      assign("mentor", "t6", 6),
      assign("mentee", "e1", 1),
      assign("mentee", "e2", 2),
      assign("mentee", "e3", 3),
      assign("mentee", "e3b", 3),
      assign("mentee", "e4", 4),
      assign("mentee", "e9", 9)
    ],
    matches,
    pools
  });
}

describe("tổng theo cụm", () => {
  it("cộng chỗ và mentee chờ của mọi nhóm trong cụm; nhóm đơn giữ nguyên", () => {
    const b = board();
    const byCode = new Map(b.pools.map((p) => [p.code, p]));
    expect(byCode.get(1)).toMatchObject({ groups: [1, 2, 3], mentorsWithSlots: 2, slots: 3, visible: 4 });
    expect(byCode.get(6)).toMatchObject({ groups: [6, 9], mentorsWithSlots: 1, slots: 2, visible: 1 });
    expect(byCode.get(4)).toMatchObject({ groups: [4], mentorsWithSlots: 1, slots: 2, visible: 1 });
    // Tổng theo cụm bằng tổng theo nhóm: gộp không tạo ra hay làm mất chỗ / người nào.
    const sum = (rows: Array<{ slots: number; visible: number }>) => rows.reduce((s, r) => [s[0] + r.slots, s[1] + r.visible], [0, 0]);
    expect(sum(b.pools)).toEqual(sum(b.groups));
    expect(b.poolMap).toBe(S12);
  });

  it("không có bảng cụm: mỗi nhóm một dòng như trước", () => {
    const b = board(new Map());
    expect(b.pools).toHaveLength(9);
    expect(b.pools.every((p) => p.groups.length === 1)).toBe(true);
  });
});

describe("cảnh báo khác nhóm theo cụm", () => {
  it("cặp vòng 2 trong cùng cụm (nhóm 1 – nhóm 3) không phải bất thường", () => {
    const b = board(S12, [match("x1", "t1", "e3", 2)]);
    expect(b.anomalies.filter((a) => a.kind === "cross_group")).toEqual([]);
  });

  it("cặp vòng 2 khác cụm vẫn là cảnh báo; nếu không gộp thì nhóm 1 – nhóm 3 cũng là cảnh báo", () => {
    const outside = board(S12, [match("x2", "t4", "e3", 2)]);
    expect(outside.anomalies.filter((a) => a.kind === "cross_group").map((a) => a.severity)).toEqual(["warning"]);
    const noPools = board(new Map(), [match("x3", "t1", "e3", 2)]);
    expect(noPools.anomalies.filter((a) => a.kind === "cross_group").map((a) => a.severity)).toEqual(["warning"]);
  });

  it("cặp vòng 1 khác nhóm vẫn được ghi chú (thông tin), kể cả khi cùng cụm", () => {
    const b = board(S12, [match("x4", "t1", "e3", 1)]);
    expect(b.anomalies.filter((a) => a.kind === "cross_group").map((a) => a.severity)).toEqual(["info"]);
  });
});

describe("được gửi thư mời khi nào", () => {
  const now = Date.parse("2026-10-15T02:00:00Z"); // 09:00 giờ Việt Nam
  it("đã đặt giờ mở ở tương lai: gửi được (gửi trước, mở cùng lúc)", () => {
    expect(round2DispatchBlocked({ opensAt: "2026-10-15T04:00:00Z", closesAt: "2026-10-17T04:00:00Z" }, now)).toBeNull();
  });
  it("vòng đang mở: gửi được", () => {
    expect(round2DispatchBlocked({ opensAt: "2026-10-15T01:00:00Z", closesAt: null }, now)).toBeNull();
  });
  it("chưa đặt giờ mở, giờ mở hỏng, hoặc vòng đã đóng: không gửi", () => {
    expect(round2DispatchBlocked(null, now)).toBe("Chưa đặt giờ mở vòng 2 — đặt giờ mở trước khi gửi link.");
    expect(round2DispatchBlocked({ opensAt: null, closesAt: null }, now)).toBe("Chưa đặt giờ mở vòng 2 — đặt giờ mở trước khi gửi link.");
    expect(round2DispatchBlocked({ opensAt: "không phải giờ", closesAt: null }, now)).toBe("Chưa đặt giờ mở vòng 2 — đặt giờ mở trước khi gửi link.");
    expect(round2DispatchBlocked({ opensAt: "2026-10-13T04:00:00Z", closesAt: "2026-10-15T02:00:00Z" }, now)).toBe("Vòng 2 đã đóng — không gửi link.");
  });
  it("giờ mở trong thư theo giờ Việt Nam", () => {
    expect(round2OpensLabel("2026-10-15T04:00:00Z")).toBe("15/10/2026 11:00 (giờ Việt Nam)");
    expect(round2OpensLabel(null)).toBe("khi ban tổ chức thông báo mở vòng");
  });
});

describe("nhóm nhận bù (BTC 15/10/2026): nhóm 1 ← nhóm 3, một chiều", () => {
  const NO_POOLS = new Map<number, number>();
  const FILL = fillPairsFromRows([{ group_code: 1, donor_group_code: 3 }]);

  it("đọc dòng bảng: bỏ dòng hỏng và dòng tự bù cho chính mình", () => {
    expect(fillPairsFromRows([{ group_code: 1, donor_group_code: 3 }, { group_code: 4, donor_group_code: 4 }, { group_code: 0, donor_group_code: 3 }, { group_code: "x", donor_group_code: 2 }])).toEqual([
      { group: 1, donor: 3 }
    ]);
  });

  it("nhóm được bù: nhóm 1 nhận nhóm 3; nhóm 3 không nhận nhóm 1; nhóm khác không nhận gì", () => {
    expect(fillGroups(NO_POOLS, FILL, 1)).toEqual([3]);
    expect(fillGroups(NO_POOLS, FILL, 3)).toEqual([]);
    expect(fillGroups(NO_POOLS, FILL, 4)).toEqual([]);
    expect(isFillPick(NO_POOLS, FILL, 1, 3)).toBe(true);
    expect(isFillPick(NO_POOLS, FILL, 3, 1)).toBe(false);
    expect(isFillPick(NO_POOLS, FILL, 1, 2)).toBe(false);
  });

  it("báo cáo: cặp vòng 2 mentor nhóm 1 – mentee nhóm 3 không phải bất thường; chiều ngược lại và nhóm khác vẫn là cảnh báo", () => {
    const people = [mentor("t1"), mentor("t3"), mentor("t4"), mentee("e1"), mentee("e3"), mentee("e3b")];
    const assignments = [assign("mentor", "t1", 1), assign("mentor", "t3", 3), assign("mentor", "t4", 4), assign("mentee", "e1", 1), assign("mentee", "e3", 3), assign("mentee", "e3b", 3)];
    const cross = (matches: Round2Match[], fills = FILL) =>
      buildRound2Board({ people, assignments, matches, pools: NO_POOLS, fills }).anomalies.filter((a) => a.kind === "cross_group").map((a) => a.severity);
    expect(cross([match("f1", "t1", "e3", 2)])).toEqual([]);
    expect(cross([match("f2", "t3", "e1", 2)])).toEqual(["warning"]);
    expect(cross([match("f3", "t4", "e3b", 2)])).toEqual(["warning"]);
    // Không có dòng bù thì nhóm 1 – nhóm 3 lại là cảnh báo như luật cũ; cặp vòng 1 vẫn ghi chú.
    expect(cross([match("f4", "t1", "e3", 2)], [])).toEqual(["warning"]);
    expect(cross([match("f5", "t1", "e3", 1)])).toEqual(["info"]);
  });
});
