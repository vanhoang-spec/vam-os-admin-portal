/**
 * Mentor cũ / mentor mới trong số người đăng ký Mentor Orientation.
 *
 * BTC chuẩn bị buổi orientation theo con số này. Hai cách nó sai mà không ai
 * thấy, và bộ test này canh cả hai:
 *   - đếm lệch với cột "Đăng ký" ngay phía trên (cũ + mới ≠ tổng);
 *   - mentor S12 lần đầu được duyệt bị tính là "cũ", làm số "mới" teo về 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  buildMentorSeasonsByEmail,
  isMentorOrientationEvent,
  splitMentorRegistrants
} from "@/lib/mentor-orientation-core";
import { getMentorOrientationSplits } from "@/lib/mentor-orientation";

const S11 = "season-11";
const S12 = "season-12";

const EVENTS = [
  { id: "e1", season_id: S12, event_type: "orientation", event_name: "Mentor Orientation" },
  { id: "e2", season_id: S12, event_type: "orientation", event_name: "Mentee Orientation" }
];

const PEOPLE = [
  { id: "p1", email_primary: " Old.Mentor@Example.com " },
  { id: "p2", email_primary: "new.s12@example.com" },
  { id: "p3", email_primary: "removed@example.com" },
  { id: "p4", email_primary: "mentee@example.com" }
];

const MEMBERSHIPS = [
  { id: "m1", person_id: "p1", season_id: S11, status: "completed", role: "mentor" },
  { id: "m2", person_id: "p2", season_id: S12, status: "active", role: "mentor" },
  { id: "m3", person_id: "p3", season_id: S11, status: "cancelled", role: "mentor" },
  { id: "m4", person_id: "p4", season_id: S11, status: "completed", role: "mentee" }
];

const REGISTRATIONS = [
  { id: "r1", event_id: "e1", email: "old.mentor@example.com", registration_status: "registered" }, // cũ
  { id: "r2", event_id: "e1", email: "new.s12@example.com", registration_status: "registered" },    // mới: chỉ có mùa này
  { id: "r3", event_id: "e1", email: "stranger@example.com", registration_status: "registered" },   // mới: không có trong CRM
  { id: "r4", event_id: "e1", email: "OLD.MENTOR@EXAMPLE.COM", registration_status: "cancelled" },  // không đếm
  { id: "r5", event_id: "e1", email: "removed@example.com", registration_status: "registered" },    // mới: vai trò đã huỷ
  { id: "r6", event_id: "e1", email: "mentee@example.com", registration_status: "confirmed" },      // mới: từng là mentee
  { id: "r7", event_id: "e2", email: "old.mentor@example.com", registration_status: "registered" }  // buổi mentee: bỏ qua
];

describe("1. nhận ra buổi Mentor Orientation", () => {
  it.each([
    [{ event_type: "mentor_orientation", event_name: "Bất kỳ" }, true],
    [{ event_type: "orientation", event_name: "Mentor Orientation" }, true],
    [{ event_type: "orientation", event_name: "Định hướng Mentor Mùa 12" }, true],
    [{ event_type: "orientation", event_name: "Mentee Orientation" }, false],
    [{ event_type: "orientation", event_name: "UEH Mentoring Orientation" }, false],
    [{ event_type: "orientation", event_name: "Mentor & Mentee Orientation" }, false],
    [{ event_type: "training", event_name: "Mentor Orientation" }, false],
    [{ event_type: "mentee_orientation", event_name: "Mentor Orientation" }, false]
  ])("%o → %s", (event, expected) => {
    expect(isMentorOrientationEvent(event)).toBe(expected);
  });
});

describe("2. đếm cũ / mới", () => {
  const seasons = buildMentorSeasonsByEmail(MEMBERSHIPS.filter((m) => m.role === "mentor"), PEOPLE);
  const splits = splitMentorRegistrants({
    events: [{ id: "e1", season_id: S12 }],
    registrations: REGISTRATIONS,
    mentorSeasonsByEmail: seasons
  });

  it("đúng từng người: 1 cũ, 4 mới", () => {
    expect(splits.get("e1")).toEqual({ returning: 1, fresh: 4 });
  });

  it("cũ + mới bằng đúng số đăng ký chưa huỷ — tập cột 'Đăng ký' đang đếm", () => {
    const shown = REGISTRATIONS.filter((r) => r.event_id === "e1" && r.registration_status !== "cancelled").length;
    const split = splits.get("e1")!;
    expect(split.returning + split.fresh).toBe(shown);
  });

  it("mentor chỉ có membership của CHÍNH mùa này vẫn là mentor mới", () => {
    // Đây là chỗ đọc sát chữ "trùng DS mentor trên CRM" sẽ sai: mentor S12 lần
    // đầu được duyệt đã có trong CRM, nhưng với BTC họ là người mới.
    const only = splitMentorRegistrants({
      events: [{ id: "e1", season_id: S12 }],
      registrations: [{ event_id: "e1", email: "new.s12@example.com", registration_status: "registered" }],
      mentorSeasonsByEmail: seasons
    });
    expect(only.get("e1")).toEqual({ returning: 0, fresh: 1 });
  });

  it("buổi không gắn mùa thì mọi mùa từng làm mentor đều tính là cũ", () => {
    const unscoped = splitMentorRegistrants({
      events: [{ id: "e1", season_id: null }],
      registrations: [{ event_id: "e1", email: "new.s12@example.com", registration_status: "registered" }],
      mentorSeasonsByEmail: seasons
    });
    expect(unscoped.get("e1")).toEqual({ returning: 1, fresh: 0 });
  });

  it("so email không phân biệt hoa thường và khoảng trắng", () => {
    expect(seasons.has("old.mentor@example.com")).toBe(true);
    expect(seasons.has(" Old.Mentor@Example.com ")).toBe(false);
  });

  it("vai trò mentor đã huỷ không làm ai thành mentor cũ", () => {
    expect(seasons.has("removed@example.com")).toBe(false);
  });

  it("buổi không được yêu cầu thì không có trong kết quả", () => {
    expect(splits.has("e2")).toBe(false);
  });

  it("email trống là mentor mới, không làm lệch tổng", () => {
    const blank = splitMentorRegistrants({
      events: [{ id: "e1", season_id: S12 }],
      registrations: [{ event_id: "e1", email: "", registration_status: "registered" }],
      mentorSeasonsByEmail: seasons
    });
    expect(blank.get("e1")).toEqual({ returning: 0, fresh: 1 });
  });
});

/** Bản giả đủ cho readAllPages kiểu keyset: trang đầu trả dữ liệu, trang sau (có .gt) trả rỗng. */
function fakeClient(tables: Record<string, Array<Record<string, unknown>>>, failOn?: string) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      let rows = tables[table] ?? [];
      let paged = false;
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return chain; },
        in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[column])); return chain; },
        gt: () => { paged = true; return chain; },
        order: () => chain,
        limit: async () =>
          failOn === table
            ? { data: null, error: { code: "XX000", message: "boom" } }
            : { data: paged ? [] : rows, error: null }
      };
      return chain;
    }
  };
}

const TABLES = {
  event_registrations: REGISTRATIONS,
  person_season_memberships: MEMBERSHIPS,
  people: PEOPLE
};

describe("3. đường đọc phía máy chủ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("không có buổi orientation nào: không mở kết nối, không đọc gì", async () => {
    const result = await getMentorOrientationSplits([EVENTS[1]]);
    expect(result).toEqual({ ok: true, splits: new Map() });
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("đọc đủ thì trả đúng số, chỉ cho buổi mentor orientation", async () => {
    const client = fakeClient(TABLES);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await getMentorOrientationSplits(EVENTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.splits.get("e1")).toEqual({ returning: 1, fresh: 4 });
      expect(result.splits.has("e2")).toBe(false);
    }
  });

  it("chỉ lọc membership có vai trò mentor", async () => {
    // p4 từng là mentee S11 cùng email với r6; lọt vai trò mentee vào là r6 thành "cũ".
    const client = fakeClient(TABLES);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await getMentorOrientationSplits([EVENTS[0]]);

    expect(result.ok && result.splits.get("e1")).toEqual({ returning: 1, fresh: 4 });
  });

  it.each(["event_registrations", "person_season_memberships", "people"])(
    "đọc %s hỏng: ok=false, không đưa ra con số nào",
    async (table) => {
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(TABLES, table) as never);

      const result = await getMentorOrientationSplits(EVENTS);

      expect(result).toEqual({ ok: false });
    }
  );

  it("không có client service-role: ok=false", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);
    expect(await getMentorOrientationSplits(EVENTS)).toEqual({ ok: false });
  });

  it("kết quả chỉ mang con số, không mang email nào", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(TABLES) as never);

    const result = await getMentorOrientationSplits(EVENTS);

    const serialized = JSON.stringify(result.ok ? Array.from(result.splits.entries()) : result);
    expect(serialized).not.toContain("@");
  });
});

describe("4. trang danh sách sự kiện", () => {
  const page = readFileSync("app/events/page.tsx", "utf8");

  it("dòng sự kiện chỉ nhận thêm con số, không nhận email", () => {
    expect(page).toContain("mentor_split: MentorSplit | null;");
    expect(page).not.toMatch(/event_registrations.*email|email.*registrationRows/);
  });

  it("đọc hỏng thì truyền null, để ô không hiện số", () => {
    expect(page).toContain("mentorSplits.ok ? mentorSplits.splits : null");
  });

  it("hiện Cũ / Mới ngay trong ô Đăng ký, lấy từ đúng dòng đó", () => {
    const cell = page.slice(page.indexOf('key: "reg_count"'), page.indexOf('key: "participant_total"'));
    expect(cell).toContain("row.mentor_split ?");
    expect(cell).toContain("Cũ {row.mentor_split.returning}");
    expect(cell).toContain("Mới {row.mentor_split.fresh}");
  });
});
