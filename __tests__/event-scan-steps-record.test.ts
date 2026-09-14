/**
 * Ghi một lượt quét theo các lần quét BTC đã thiết lập cho sự kiện.
 *
 * Đọc CHÍNH CÁC LỆNH GHI mà `recordScan` phát ra, không chỉ giá trị trả về. Ba
 * quyết định của chủ dự án (14/09/2026) được canh ở đây:
 *   - chỉ ghi vào lần quét đang có trong thiết lập của sự kiện;
 *   - mọi lần quét đều tính là đã tham dự, và không ghi đè giờ check-in;
 *   - chưa qua Check in thì vẫn ghi, chỉ nhắc.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { countScansByStation, listEventScans, recordScan } from "@/lib/event-checkin";

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const OTHER_EVENT = "00000000-0000-4000-8000-0000000000e2";
const REGISTRATION_ID = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-0000000000dd";
const CODE = "A7K2M9PQRS";

const REGISTRATION = {
  id: REGISTRATION_ID,
  event_id: EVENT,
  full_name: "Nguyễn Văn A",
  registration_status: "registered"
};

type Filter = [op: "eq" | "neq", column: string, value: unknown];
type Write = { table: string; op: "insert" | "update"; payload: Record<string, unknown>; filters: Filter[] };

function makeClient(opts: {
  steps?: unknown;
  eventError?: boolean;
  eventMissing?: boolean;
  registration?: Record<string, unknown> | null;
  insertError?: { code: string; message?: string } | null;
  history?: Array<{ station: string; scanned_at: string }>;
  historyError?: boolean;
}) {
  const writes: Write[] = [];

  const from = (table: string) => {
    let write: Write | null = null;
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        write?.filters.push(["eq", column, value]);
        return chain;
      },
      neq: (column: string, value: unknown) => {
        write?.filters.push(["neq", column, value]);
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        write = { table, op: "insert", payload, filters: [] };
        writes.push(write);
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        write = { table, op: "update", payload, filters: [] };
        writes.push(write);
        return chain;
      },
      maybeSingle: async () => {
        if (table === "events") {
          if (opts.eventError) return { data: null, error: { message: "đọc sự kiện hỏng" } };
          if (opts.eventMissing) return { data: null, error: null };
          return { data: { id: EVENT, checkin_steps: opts.steps }, error: null };
        }
        if (table === "event_registrations") {
          return { data: opts.registration === undefined ? REGISTRATION : opts.registration, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        let result: unknown = { data: null, error: null };
        if (write?.op === "insert") result = { data: null, error: opts.insertError ?? null };
        else if (!write && table === "event_scans") {
          result = opts.historyError
            ? { data: null, error: { message: "đọc lịch sử hỏng" } }
            : { data: opts.history ?? [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      }
    };
    return chain;
  };

  return { client: { from }, writes };
}

function use(opts: Parameters<typeof makeClient>[0]) {
  const fake = makeClient(opts);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);
  return fake;
}

const scan = (station: string) => recordScan({ eventId: EVENT, scanned: CODE, station, adminUserId: ADMIN });
const inserts = (fake: ReturnType<typeof makeClient>) => fake.writes.filter((write) => write.op === "insert");
const marks = (fake: ReturnType<typeof makeClient>) => fake.writes.filter((write) => write.op === "update");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("1. chỉ ghi vào lần quét đang có trong thiết lập", () => {
  it("sự kiện chỉ cần Check out: ghi đúng một lượt Check out", async () => {
    const fake = use({ steps: ["checkout"], history: [{ station: "checkout", scanned_at: "2026-09-20T04:00:00Z" }] });

    const result = await scan("checkout");

    expect(result).toMatchObject({ ok: true, repeat: false, station: "checkout", stationLabel: "Quét lần 1 · Check out" });
    expect(inserts(fake)).toEqual([
      {
        table: "event_scans",
        op: "insert",
        payload: { event_id: EVENT, registration_id: REGISTRATION_ID, station: "checkout", scanned_by: ADMIN },
        filters: []
      }
    ]);
  });

  it("mục lặp lại: lần talkshow thứ hai ghi vào khoá riêng của nó", async () => {
    const fake = use({ steps: ["talkshow", "talkshow"] });

    const result = await scan("talkshow_2");

    expect(result).toMatchObject({ ok: true, stationLabel: "Quét lần 2 · Check talkshow" });
    expect(inserts(fake)[0].payload.station).toBe("talkshow_2");
  });

  it("máy quét mở từ trước khi BTC bỏ lần quét đó: không ghi gì, bảo tải lại trang", async () => {
    const fake = use({ steps: ["entrance", "checkout"] });

    const result = await scan("gift_counter");

    expect(result).toMatchObject({ ok: false, reason: "stale_step" });
    if (!result.ok) expect(result.message).toContain("Tải lại trang máy quét");
    expect(fake.writes).toEqual([]);
  });

  it("trạm của máy quét cũ không còn ghi được", async () => {
    const fake = use({ steps: null });

    expect(await scan("booth_program")).toMatchObject({ ok: false, reason: "stale_step" });
    expect(fake.writes).toEqual([]);
  });

  it("sự kiện chưa thiết lập: Check in là lần quét duy nhất", async () => {
    const fake = use({ steps: null });

    expect(await scan("entrance")).toMatchObject({ ok: true, stationLabel: "Quét lần 1 · Check in" });
    expect(inserts(fake)[0].payload.station).toBe("entrance");
  });

  it("không gửi lần quét nào: là lần quét đầu tiên của thiết lập", async () => {
    const fake = use({ steps: ["checkout", "entrance"] });

    await scan("");

    expect(inserts(fake)[0].payload.station).toBe("checkout");
  });

  it("không đọc được thiết lập của sự kiện: không ghi gì", async () => {
    const fake = use({ steps: ["entrance"], eventError: true });

    expect(await scan("entrance")).toMatchObject({ ok: false, reason: "error" });
    expect(fake.writes).toEqual([]);
  });

  it("vé của sự kiện khác, hoặc đăng ký đã huỷ: không ghi gì", async () => {
    const other = use({ steps: ["entrance"], registration: { ...REGISTRATION, event_id: OTHER_EVENT } });
    expect(await scan("entrance")).toMatchObject({ ok: false, reason: "wrong_event" });
    expect(other.writes).toEqual([]);

    const cancelled = use({ steps: ["entrance"], registration: { ...REGISTRATION, registration_status: "cancelled" } });
    expect(await scan("entrance")).toMatchObject({ ok: false, reason: "cancelled" });
    expect(cancelled.writes).toEqual([]);
  });
});

describe("2. mọi lần quét đều tính là đã tham dự", () => {
  it.each([
    [["checkout"], "checkout"],
    [["entrance", "gift_counter"], "gift_counter"],
    [["entrance", "talkshow"], "entrance"]
  ])("thiết lập %j, quét %s: đánh dấu đã tham dự", async (steps, station) => {
    const fake = use({ steps });

    await scan(station);

    expect(marks(fake)).toHaveLength(1);
    expect(marks(fake)[0]).toMatchObject({
      table: "event_registrations",
      payload: { attendance_status: "checked_in", checkin_source: "admin_manual" }
    });
  });

  it("không ghi đè giờ check-in của người đã check-in: lệnh chỉ chạm dòng CHƯA check-in", async () => {
    const fake = use({ steps: ["entrance", "checkout"] });

    await scan("checkout");

    expect(marks(fake)[0].filters).toEqual([
      ["eq", "id", REGISTRATION_ID],
      ["neq", "attendance_status", "checked_in"]
    ]);
  });

  it("quét lại: không phải lỗi, và vẫn đánh dấu tham dự với cùng điều kiện lọc", async () => {
    const fake = use({ steps: ["entrance"], insertError: { code: "23505" } });

    expect(await scan("entrance")).toMatchObject({ ok: true, repeat: true });
    expect(marks(fake)).toHaveLength(1);
    expect(marks(fake)[0].filters).toContainEqual(["neq", "attendance_status", "checked_in"]);
  });

  it("ghi lượt quét hỏng thật: không đánh dấu tham dự", async () => {
    const fake = use({ steps: ["entrance"], insertError: { code: "42501", message: "không có quyền" } });

    expect(await scan("entrance")).toMatchObject({ ok: false, reason: "error" });
    expect(marks(fake)).toEqual([]);
  });
});

describe("3. nhắc chưa Check in", () => {
  it("tới quầy quà mà chưa qua Check in: vẫn ghi, và nhắc", async () => {
    const fake = use({
      steps: ["entrance", "gift_counter"],
      history: [{ station: "gift_counter", scanned_at: "2026-09-20T02:00:00Z" }]
    });

    const result = await scan("gift_counter");

    expect(result).toMatchObject({ ok: true, missingCheckIn: true });
    expect(inserts(fake)).toHaveLength(1);
  });

  it("đã qua Check in — kể cả bằng trạm cửa vào của máy quét cũ: không nhắc", async () => {
    use({
      steps: ["entrance", "gift_counter"],
      history: [
        { station: "entrance", scanned_at: "2026-09-20T01:00:00Z" },
        { station: "gift_counter", scanned_at: "2026-09-20T02:00:00Z" }
      ]
    });

    expect(await scan("gift_counter")).toMatchObject({ ok: true, missingCheckIn: false });
  });

  it("sự kiện không có lần Check in nào: không nhắc", async () => {
    use({ steps: ["checkout"], history: [{ station: "checkout", scanned_at: "2026-09-20T04:00:00Z" }] });

    expect(await scan("checkout")).toMatchObject({ ok: true, missingCheckIn: false });
  });

  it("không đọc được lịch sử quét: không nhắc sai người đã qua cửa", async () => {
    use({ steps: ["entrance", "gift_counter"], historyError: true });

    expect(await scan("gift_counter")).toMatchObject({ ok: true, missingCheckIn: false });
  });

  it("huy hiệu mang nhãn theo thiết lập của sự kiện", async () => {
    use({
      steps: ["entrance", "gift_counter"],
      history: [
        { station: "gift_counter", scanned_at: "2026-09-20T02:00:00Z" },
        { station: "entrance", scanned_at: "2026-09-20T01:00:00Z" }
      ]
    });

    const result = await scan("gift_counter");

    expect(result.ok && result.badges.map((badge) => badge.label)).toEqual([
      "Quét lần 1 · Check in",
      "Quét lần 2 · Check quầy đổi quà"
    ]);
  });
});

describe("4. đọc lịch sử quét theo trang", () => {
  function pagedClient(total: number, serverCap: number, failOnCall?: number) {
    const calls: Array<[number, number]> = [];
    const client = {
      from: () => {
        const chain: any = {
          select: () => chain,
          in: () => chain,
          order: () => chain,
          range: (from: number, to: number) => {
            calls.push([from, to]);
            if (failOnCall === calls.length) return Promise.resolve({ data: null, error: { message: "hỏng" } });
            const end = Math.min(to + 1, from + serverCap, total);
            const rows = [];
            for (let index = from; index < end; index += 1) {
              rows.push({ id: index, registration_id: `r${index}`, station: index % 2 ? "checkout" : "entrance", scanned_at: "2026-09-20T01:00:00Z" });
            }
            return Promise.resolve({ data: rows, error: null });
          }
        };
        return chain;
      }
    };
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
    return calls;
  }

  it("hơn 1.000 lượt quét: đọc đủ, không trùng, không sót", async () => {
    pagedClient(2500, 1000);

    const { scans, error } = await listEventScans([EVENT]);

    expect(error).toBeNull();
    expect(scans).toHaveLength(2500);
    expect(new Set(scans.map((row) => row.registrationId)).size).toBe(2500);
  });

  it("máy chủ giới hạn thấp hơn 1.000 dòng mỗi lần: vẫn đọc đủ", async () => {
    pagedClient(2500, 400);

    const { scans } = await listEventScans([EVENT]);

    expect(scans).toHaveLength(2500);
    expect(new Set(scans.map((row) => row.registrationId)).size).toBe(2500);
  });

  it("một trang đọc hỏng: báo lỗi, không trả phần đã đọc như thể đủ", async () => {
    pagedClient(2500, 1000, 2);

    expect(await listEventScans([EVENT])).toEqual({ scans: [], error: expect.any(String) });
  });

  it("số đếm theo trạm đi qua cùng đường đọc theo trang", async () => {
    pagedClient(1500, 1000);

    const { counts } = await countScansByStation(EVENT);

    expect(counts.reduce((sum, row) => sum + row.total, 0)).toBe(1500);
    expect(counts).toContainEqual({ station: "entrance", total: 750 });
  });
});
