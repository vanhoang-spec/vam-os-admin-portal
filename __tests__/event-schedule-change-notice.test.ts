/**
 * Thư báo đổi lịch cho những người đang giữ vé.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI NHẤT: GỬI HAI LẦN
 * ---------------------------------------------------------------------------
 * Người vận hành đổi giờ, bấm gửi, mạng chập, họ bấm lại. Nếu dấu "đã báo" ghi
 * ở cuối lô thay vì ghi ngay sau từng lá thư, thì lượt thứ hai gửi lại cho
 * chính những người vừa nhận — và một người nhận hai thư báo đổi lịch sẽ đi hỏi
 * ban tổ chức xem lịch đổi mấy lần.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI THỨ HAI: LẦN ĐỔI THỨ HAI KHÔNG AI ĐƯỢC BÁO
 * ---------------------------------------------------------------------------
 * Một cờ đúng/sai trả lời được "đã báo chưa" nhưng không trả lời được "đã báo
 * về lần đổi nào". Dấu ở đây ghi CHÍNH mốc giờ người đó được báo, nên lịch đổi
 * lần thứ hai lại nhận ra đúng những người ấy là chưa biết.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn(),
  canOperateAnyScope: vi.fn(async () => true)
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({
  resolveEmailBaseUrl: vi.fn(() => "https://os.example.org"),
  sendEventRegistrationConfirmation: vi.fn(async () => ({ ok: true, skipped: false })),
  sendEventScheduleChange: vi.fn(async () => ({ ok: true, skipped: false }))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendEventScheduleChange } from "@/lib/email";
import { SCHEDULE_NOTICE_CHUNK, notifyScheduleChange } from "@/lib/events";
import { buildEventScheduleChangeEmail } from "@/lib/email-core";

const EVENT = "00000000-0000-4000-8000-0000000000aa";
const SEASON = "00000000-0000-4000-8000-0000000000bb";

/** 08:00 giờ Việt Nam ngày 27/09/2026 — giờ MỚI sau khi đổi. */
const NEW_START = "2026-09-27T01:00:00.000Z";
/** Giờ cũ, 08:00 ngày 20/09. */
const OLD_START = "2026-09-20T01:00:00.000Z";

type Write = { table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> };

function makeClient(registrations: Array<Record<string, unknown>>) {
  const writes: Write[] = [];

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" = "select";
    let current: Write | null = null;

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((column: string, value: unknown) => {
      current?.filters.push([column, value]);
      return chain;
    });
    chain.neq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      mode = "update";
      current = { table: name, payload, filters: [] };
      writes.push(current);
      return chain;
    });
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      mode = "insert";
      current = { table: name, payload, filters: [] };
      writes.push(current);
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => {
      if (mode !== "select") return { data: null, error: null };
      if (name !== "events") return { data: null, error: null };
      return {
        data: {
          id: EVENT,
          season_id: SEASON,
          event_name: "Mentor Orientation",
          event_format: "offline",
          starts_at: NEW_START,
          ends_at: "2026-09-27T04:30:00.000Z",
          location_name: "Phòng B1-502",
          location_address: "279 Nguyễn Tri Phương, P.5, Q.10"
        },
        error: null
      };
    });
    chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) => {
      if (mode !== "select") return Promise.resolve(resolve({ data: null, error: null }));
      const data = name === "event_registrations" ? registrations : [];
      return Promise.resolve(resolve({ data, error: null }));
    };
    return chain;
  }

  return { from: vi.fn((name: string) => table(name)), writes };
}

function holder(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    full_name: `Người ${id}`,
    email: `${id}@example.com`,
    short_code: "A7K2",
    checkin_code: "A7K2M9PQRS",
    schedule_notified_for: OLD_START,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "u1",
    email: "a@vam.org",
    full_name: "A",
    role: "admin",
    status: "active",
    auth_user_id: null
  } as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(sendEventScheduleChange).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("ai được gửi", () => {
  it("gửi cho người còn giữ dấu của giờ CŨ", async () => {
    const fake = makeClient([holder("r1"), holder("r2")]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT, previousStartsAt: OLD_START });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(2);
    expect(vi.mocked(sendEventScheduleChange)).toHaveBeenCalledTimes(2);
  });

  it("KHÔNG gửi lại cho người đã được báo về giờ hiện tại", async () => {
    const fake = makeClient([
      holder("r1", { schedule_notified_for: NEW_START }),
      holder("r2", { schedule_notified_for: NEW_START })
    ]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(0);
    expect(vi.mocked(sendEventScheduleChange)).not.toHaveBeenCalled();
  });

  it("người chưa từng được báo lần nào cũng nằm trong danh sách", async () => {
    // Dấu rỗng nghĩa là chưa từng được báo — đúng những người cần nhất, và là
    // những người một phép lọc "khác giá trị này" cẩu thả sẽ bỏ sót.
    const fake = makeClient([holder("r1", { schedule_notified_for: null })]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });
    expect(result.sent).toBe(1);
  });

  it("lần đổi lịch THỨ HAI vẫn nhận ra đúng những người đó", async () => {
    // Họ đã được báo về giờ 27/09. Giờ lại đổi, và mốc hiện tại của buổi giờ là
    // một giá trị khác — nên họ trở lại danh sách cần báo.
    const fake = makeClient([holder("r1", { schedule_notified_for: "2026-10-04T01:00:00.000Z" })]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });
    expect(result.sent).toBe(1);
  });

  it("thiếu email thì tính là lỗi, không âm thầm bỏ qua", async () => {
    const fake = makeClient([holder("r1", { email: null })]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
  });
});

describe("gửi lại an toàn", () => {
  it("đánh dấu NGAY sau mỗi lá thư, không đợi hết lô", async () => {
    const fake = makeClient([holder("r1"), holder("r2"), holder("r3")]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await notifyScheduleChange({ eventId: EVENT });

    const marks = fake.writes.filter(
      (write) => write.table === "event_registrations" && "schedule_notified_for" in write.payload
    );
    // Ba lá thư, ba lần đánh dấu — mỗi người một lệnh riêng.
    expect(marks).toHaveLength(3);
    for (const mark of marks) {
      expect(mark.payload).toEqual({ schedule_notified_for: NEW_START });
    }
    expect(marks[0].filters).toContainEqual(["id", "r1"]);
    expect(marks[2].filters).toContainEqual(["id", "r3"]);
  });

  it("thư gửi hỏng thì KHÔNG đánh dấu — lượt sau còn gửi lại được", async () => {
    vi.mocked(sendEventScheduleChange).mockResolvedValue({
      ok: false,
      skipped: false,
      reason: "hộp thư từ chối"
    } as never);

    const fake = makeClient([holder("r1")]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });

    expect(result.failed).toBe(1);
    const marks = fake.writes.filter((write) => "schedule_notified_for" in write.payload);
    expect(marks).toEqual([]);
  });

  it("đông người thì gửi theo lô, và nói rõ còn bao nhiêu", async () => {
    const many = Array.from({ length: SCHEDULE_NOTICE_CHUNK + 7 }, (_, index) =>
      holder(`r${index}`)
    );
    const fake = makeClient(many);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });

    expect(result.sent).toBe(SCHEDULE_NOTICE_CHUNK);
    expect(result.remaining).toBe(7);
    expect(result.message).toContain("Còn 7 người");
  });
});

describe("cổng vào", () => {
  it("ID không hợp lệ thì dừng trước khi chạm database", async () => {
    const fake = makeClient([]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: "khong-phai-uuid" });

    expect(result.ok).toBe(false);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("không có quyền vận hành mùa đó thì không gửi gì", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const fake = makeClient([holder("r1")]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await notifyScheduleChange({ eventId: EVENT });

    expect(result.ok).toBe(false);
    expect(vi.mocked(sendEventScheduleChange)).not.toHaveBeenCalled();
  });
});

describe("nội dung thư", () => {
  const built = () =>
    buildEventScheduleChangeEmail({
      recipientName: "Nguyễn Văn A",
      eventName: "Mentor Orientation",
      whenLabel: "27/09/2026 08:00 – 11:30",
      previousWhenLabel: "20/09/2026 08:00 – 11:30",
      placeLabel: "Phòng B1-502",
      shortCode: "A7K2",
      ticketUrl: "https://os.example.org/ve/A7K2M9PQRS"
    });

  it("tiêu đề nói ngay là đổi lịch, kèm giờ mới", () => {
    // Người đọc lướt hộp thư trên điện thoại chỉ thấy dòng tiêu đề.
    const message = built();
    expect(message.subject).toContain("Đổi lịch");
    expect(message.subject).toContain("27/09/2026 08:00");
  });

  it("giờ MỚI đứng trước giờ cũ trong thân thư", () => {
    const message = built();
    const newAt = message.text.indexOf("27/09/2026 08:00");
    const oldAt = message.text.indexOf("20/09/2026 08:00");
    expect(newAt).toBeGreaterThan(-1);
    expect(oldAt).toBeGreaterThan(-1);
    expect(newAt).toBeLessThan(oldAt);
  });

  it("nói rõ vé cũ vẫn dùng được", () => {
    // Đây là câu hỏi đầu tiên người nhận nghĩ tới. Thư không trả lời thì ban tổ
    // chức phải trả lời từng người một.
    // So không phân biệt hoa thường: câu này đang viết hoa để làm tiêu đề đoạn,
    // và điều cần khẳng định là thư CÓ NÓI, không phải nó viết hoa hay thường.
    const message = built();
    const lower = message.text.toLowerCase();
    expect(lower).toContain("vẫn dùng được");
    expect(lower).toContain("không đổi");
  });

  it("nhắc lại mã dự phòng cũ, không cấp mã mới", () => {
    const message = built();
    expect(message.text).toContain("A7K2");
  });

  it("KHÔNG đính kèm lại ảnh QR", () => {
    // Mã không đổi. Gửi lại một ảnh nữa cho cùng một tấm vé là cách chắc chắn
    // để hôm sự kiện có người mở nhầm ảnh cũ.
    const message = built();
    expect(message.attachments ?? []).toEqual([]);
  });

  it("không có giờ cũ thì thư vẫn gửi được, chỉ nói giờ mới", () => {
    const message = buildEventScheduleChangeEmail({
      recipientName: "Nguyễn Văn A",
      eventName: "Mentor Orientation",
      whenLabel: "27/09/2026 08:00 – 11:30"
    });
    expect(message.text).toContain("27/09/2026 08:00");
    expect(message.text).not.toContain("Thời gian cũ");
  });
});
