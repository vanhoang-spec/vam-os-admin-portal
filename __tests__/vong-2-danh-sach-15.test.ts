/**
 * Danh sách 15 hồ sơ của từng mentor ở Vòng 2 — phần thuần (BTC 14/10/2026).
 *
 * BTC chốt: mỗi mentor thấy tối đa 15 mentee cùng nhóm; mỗi mentee xuất hiện ở số mentor gần như
 * bằng nhau; một bạn được chọn thì bạn kế tiếp vào thay, 14 hồ sơ kia giữ nguyên; còn dưới 15 bạn
 * thì thấy hết. Số mentor/mentee dưới đây là số thật lúc 19:24 ngày 14/10/2026.
 */
import { describe, expect, it } from "vitest";
import {
  round2Circle,
  round2MentorIndex,
  round2Window,
  round2WindowStart,
  ROUND2_WINDOW_SIZE
} from "@/lib/matching-round2-window-core";

const SEASON = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (count: number) => Array.from({ length: count }, (_, n) => id(n));

/** Mỗi mentee hiện ở bao nhiêu mentor (chỉ tính bạn còn trống). */
function exposure(circle: string[], available: Set<string>, mentors: number): Map<string, number> {
  const count = new Map<string, number>(Array.from(available, (x) => [x, 0]));
  for (let i = 0; i < mentors; i += 1) {
    for (const x of round2Window(circle, available, round2WindowStart(i, circle.length))) count.set(x, (count.get(x) ?? 0) + 1);
  }
  return count;
}

describe("1. mỗi mentor thấy tối đa 15 bạn còn trống", () => {
  it("nhóm đông: đúng 15 bạn, không trùng, đều còn trống, theo thứ tự trên vòng kể từ điểm xuất phát", () => {
    const circle = round2Circle(SEASON, [4], ids(175));
    const available = new Set(circle.filter((_, p) => p % 3 !== 0));
    const start = round2WindowStart(7, circle.length);
    const w = round2Window(circle, available, start);
    expect(ROUND2_WINDOW_SIZE).toBe(15);
    expect(w).toHaveLength(15);
    expect(new Set(w).size).toBe(15);
    for (const x of w) expect(available.has(x)).toBe(true);
    // Là 15 bạn trống ĐẦU TIÊN kể từ điểm xuất phát (đi vòng qua cuối danh sách).
    const expected: string[] = [];
    for (let s = 0; expected.length < 15; s += 1) {
      const x = circle[(start + s) % circle.length];
      if (available.has(x)) expected.push(x);
    }
    expect(w).toEqual(expected);
  });

  it("còn dưới 15 bạn trống: thấy hết; không còn ai: danh sách rỗng", () => {
    const circle = round2Circle(SEASON, [7], ids(30));
    const few = new Set([circle[2], circle[17], circle[29]]);
    expect(new Set(round2Window(circle, few, round2WindowStart(0, 30)))).toEqual(few);
    expect(round2Window(circle, new Set(), 5)).toEqual([]);
    expect(round2Window([], new Set(), 0)).toEqual([]);
  });
});

describe("2. chia đều: mỗi mentee hiện ở số mentor gần như bằng nhau (số thật 14/10)", () => {
  const GROUPS: Array<[group: number, mentors: number, mentees: number]> = [
    [1, 50, 16], [2, 18, 36], [3, 45, 94], [4, 124, 175], [5, 17, 64], [6, 66, 60], [7, 3, 4], [8, 13, 68], [9, 33, 60]
  ];

  for (const [group, mentors, mentees] of GROUPS) {
    it(`nhóm ${group}: ${mentors} mentor, ${mentees} mentee — chênh nhau tối đa 3 mentor, không ai bị bỏ sót`, () => {
      const circle = round2Circle(SEASON, [group], ids(mentees));
      const counts = Array.from(exposure(circle, new Set(circle), mentors).values());
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      expect(max - min).toBeLessThanOrEqual(3);
      expect(min).toBeGreaterThanOrEqual(1);
      // Trung bình đúng bằng tổng lượt hiện / số mentee.
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total).toBe(mentors * Math.min(15, mentees));
    });
  }

  it("nhóm 4 lúc mở: mỗi bạn hiện ở 10–12 mentor (trung bình 10,6)", () => {
    const circle = round2Circle(SEASON, [4], ids(175));
    const counts = Array.from(exposure(circle, new Set(circle), 124).values());
    expect(Math.min(...counts)).toBe(10);
    expect(Math.max(...counts)).toBe(12);
  });
});

describe("3. một bạn được chọn: bạn kế tiếp vào thay, 14 hồ sơ kia giữ nguyên", () => {
  it("mọi mentor đang thấy bạn đó: mất đúng bạn đó, thêm đúng một bạn; mentor không thấy bạn đó: không đổi gì", () => {
    const circle = round2Circle(SEASON, [3], ids(94));
    const available = new Set(circle);
    const before = Array.from({ length: 45 }, (_, i) => round2Window(circle, available, round2WindowStart(i, circle.length)));
    const picked = before[10][4];
    available.delete(picked);
    const after = Array.from({ length: 45 }, (_, i) => round2Window(circle, available, round2WindowStart(i, circle.length)));
    for (let i = 0; i < 45; i += 1) {
      if (before[i].includes(picked)) {
        expect(after[i]).toHaveLength(15);
        expect(after[i]).not.toContain(picked);
        expect(after[i].filter((x) => before[i].includes(x))).toHaveLength(14);
      } else {
        expect(after[i]).toEqual(before[i]);
      }
    }
  });

  it("sau khi đã chọn một nửa nhóm 4: không bạn còn lại nào bị thấy ít hơn lúc mở vòng", () => {
    const circle = round2Circle(SEASON, [4], ids(175));
    const available = new Set(circle);
    const atOpen = Math.min(...Array.from(exposure(circle, available, 124).values()));
    // Chọn cố định (không ngẫu nhiên): mỗi lượt, mentor thứ (k·7 mod 124) chọn bạn thứ (k mod 15) trong danh sách.
    for (let k = 0; k < 87; k += 1) {
      const w = round2Window(circle, available, round2WindowStart((k * 7) % 124, circle.length));
      available.delete(w[k % w.length]);
    }
    expect(available.size).toBe(88);
    expect(Math.min(...Array.from(exposure(circle, available, 124).values()))).toBeGreaterThanOrEqual(atOpen);
  });
});

describe("4. ổn định", () => {
  it("vòng không phụ thuộc thứ tự đọc từ database, bỏ trùng; hai cụm khác nhau có vòng khác nhau", () => {
    const list = ids(40);
    const a = round2Circle(SEASON, [4], list);
    expect(round2Circle(SEASON, [4], [...list].reverse())).toEqual(a);
    expect(round2Circle(SEASON, [4], [...list, list[3]])).toEqual(a);
    expect(new Set(a)).toEqual(new Set(list));
    expect(round2Circle(SEASON, [5], list)).not.toEqual(a);
    // Cụm gộp: thứ tự nhóm truyền vào không làm đổi vòng.
    expect(round2Circle(SEASON, [6, 1], list)).toEqual(round2Circle(SEASON, [1, 6], list));
  });

  it("thứ tự mentor theo lúc tạo link (trùng giờ thì theo mã link); link tạo sau không đổi thứ tự người cũ", () => {
    const links = [
      { id: "L3", createdAt: "2026-10-15T02:00:00Z" },
      { id: "L2", createdAt: "2026-10-15T01:00:00Z" },
      { id: "L1", createdAt: "2026-10-15T01:00:00Z" }
    ];
    expect(round2MentorIndex(links, "L1")).toBe(0);
    expect(round2MentorIndex(links, "L2")).toBe(1);
    expect(round2MentorIndex(links, "L3")).toBe(2);
    expect(round2MentorIndex(links, "L9")).toBe(-1);
    const more = [...links, { id: "L0", createdAt: "2026-10-16T01:00:00Z" }];
    for (const l of links) expect(round2MentorIndex(more, l.id)).toBe(round2MentorIndex(links, l.id));
  });

  it("điểm xuất phát luôn nằm trong vòng; mentor khác nhau xuất phát ở chỗ khác nhau", () => {
    for (const n of [1, 4, 16, 175]) {
      for (let i = 0; i < 200; i += 1) {
        const s = round2WindowStart(i, n);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(n);
      }
    }
    expect(round2WindowStart(0, 0)).toBe(0);
    expect(round2WindowStart(-1, 100)).toBe(round2WindowStart(0, 100));
    const starts = new Set(Array.from({ length: 50 }, (_, i) => round2WindowStart(i, 175)));
    expect(starts.size).toBe(50);
  });
});
