/**
 * `runEmailBatch` — một lô chạy tới đâu, dừng ở đâu, và không gửi lại cho ai.
 *
 * Đây là chỗ duy nhất trong hệ thống thật sự gọi nhà cung cấp email nhiều lần
 * trong một vòng lặp. Ba tính chất phải đúng, và cả ba đều chỉ hỏng ở lần chạy
 * thứ hai — nơi không ai nhìn: đi tiếp đúng chỗ đã dừng, không ai nhận hai lá,
 * và lô chỉ được đánh dấu xong khi thật sự hết người.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { runEmailBatch, type EmailBatchRow } from "@/lib/bulk-mail";
import { BULK_SEND_CHUNK, BULK_TIME_BUDGET_MS } from "@/lib/bulk-mail-core";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const BATCH = "00000000-0000-4000-8000-0000000000bb";

type Tables = {
  memberships: Array<{ person_id: string; role: string }>;
  people: Array<{ id: string; full_name: string | null; email_primary: string | null }>;
  handled: Array<{ to_email: string; status?: string; error?: string | null }>;
};

const updates: Array<Record<string, unknown>> = [];

/**
 * Một client Supabase giả vừa đủ cho đường đi của `runEmailBatch`.
 *
 * Mỗi lời gọi trả về chính nó cho tới khi được await, nên thứ tự các mệnh đề
 * không quan trọng — điều duy nhất ca test quan tâm là bảng nào đang được đọc.
 */
function fakeClient(tables: Tables) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const method of ["select", "eq", "in", "order", "limit", "range"]) {
        chain[method] = vi.fn(passthrough);
      }
      chain.update = vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return chain;
      });
      chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) => {
        const data =
          table === "person_season_memberships"
            ? tables.memberships
            : table === "people"
              ? tables.people
              : table === "outbound_emails"
                ? tables.handled
                : [];
        return Promise.resolve(resolve({ data, error: null }));
      };
      return chain;
    }
  };
}

function batch(overrides: Partial<EmailBatchRow> = {}): EmailBatchRow {
  return {
    id: BATCH,
    seasonId: SEASON,
    kind: "general_announcement",
    templateId: "t1",
    audience: "mentee",
    audienceEventId: null,
    audienceCoversSeries: false,
    status: "running",
    requestedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    note: null,
    createdAt: "",
    completedAt: null,
    ...overrides
  };
}

/** N người, ai cũng gửi được. */
function population(count: number): Tables {
  return {
    memberships: Array.from({ length: count }, (_, i) => ({
      person_id: `p${i}`,
      role: "mentee"
    })),
    people: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      full_name: `Người ${String(i).padStart(3, "0")}`,
      email_primary: `nguoi${i}@example.com`
    })),
    handled: []
  };
}

function run(tables: Tables, overrides: Partial<Parameters<typeof runEmailBatch>[0]> = {}) {
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(tables) as never);
  return runEmailBatch({
    batch: batch(),
    seasonCode: "UEHM-S12",
    subject: "Thông báo {{mua}}",
    body: "Chào {{ten_nguoi_nhan}}.",
    ...overrides
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("lô phải nhớ nó gửi cho ai", () => {
  it("từ chối chạy một lô không ghi đối tượng nhận thư", async () => {
    // Đoán bằng một giá trị mặc định là gửi thư cho những người chưa từng nằm
    // trong lô ấy.
    const result = await run(population(3), { batch: batch({ audience: null }) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("đối tượng nhận thư");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });
});

describe("giới hạn một lần chạy", () => {
  it("gửi hết khi danh sách nhỏ hơn chỉ tiêu", async () => {
    const result = await run(population(3));
    expect(result.sent).toBe(3);
    expect(result.remaining).toBe(0);
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(3);
  });

  it("dừng đúng chỉ tiêu và báo còn bao nhiêu người", async () => {
    const result = await run(population(BULK_SEND_CHUNK + 12));
    expect(result.sent).toBe(BULK_SEND_CHUNK);
    expect(result.remaining).toBe(12);
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(BULK_SEND_CHUNK);
  });

  it("dừng khi hết ngân sách thời gian, dù chưa đủ chỉ tiêu", async () => {
    let clock = 0;
    const result = await run(population(BULK_SEND_CHUNK), {
      now: () => {
        const value = clock;
        clock += BULK_TIME_BUDGET_MS / 2;
        return value;
      }
    });
    expect(result.sent).toBeLessThan(BULK_SEND_CHUNK);
    expect(result.remaining).toBeGreaterThan(0);
  });
});

describe("không ai nhận hai lá", () => {
  it("bỏ qua người đã có kết quả trong lô", async () => {
    const tables = population(5);
    tables.handled = [{ to_email: "nguoi0@example.com" }, { to_email: "nguoi3@example.com" }];

    const result = await run(tables);
    expect(result.sent).toBe(3);

    const addressed = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0].toEmail);
    expect(addressed).not.toContain("nguoi0@example.com");
    expect(addressed).not.toContain("nguoi3@example.com");
  });

  it("không gửi gì khi lô đã đi hết danh sách", async () => {
    const tables = population(3);
    tables.handled = tables.people.map((row) => ({ to_email: row.email_primary! }));

    const result = await run(tables);
    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(0);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("một người mang hai vai trò vẫn chỉ nhận một lá", async () => {
    const tables = population(1);
    tables.memberships.push({ person_id: "p0", role: "mentee" });

    const result = await run(tables);
    expect(result.sent).toBe(1);
  });
});

describe("mỗi lá thư mang batch_id của lô", () => {
  it("nối từng lần gửi vào lô, để lần chạy sau biết đã tới đâu", async () => {
    await run(population(2));
    for (const call of vi.mocked(sendTemplatedEmail).mock.calls) {
      expect(call[0].batchId).toBe(BATCH);
    }
  });

  it("điền tên thật của từng người vào thư", async () => {
    await run(population(2));
    const bodies = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0].body);
    expect(bodies).toContain("Chào Người 000.");
    expect(bodies).toContain("Chào Người 001.");
    for (const body of bodies) expect(body).not.toMatch(/\{\{|\}\}/);
  });

  it("điền mã mùa vào tiêu đề", async () => {
    await run(population(1));
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].subject).toBe("Thông báo UEHM-S12");
  });
});

describe("một bức thư hỏng không dừng cả lô", () => {
  it("đếm lỗi, nêu tên, và đi tiếp", async () => {
    vi.mocked(sendTemplatedEmail)
      .mockResolvedValueOnce({ ok: false, skipped: false, reason: "địa chỉ bị chặn" } as never)
      .mockResolvedValue({ ok: true, skipped: false } as never);

    const result = await run(population(3));
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.problems[0]).toContain("Người 000");
    expect(result.problems[0]).toContain("địa chỉ bị chặn");
  });

  it("đếm riêng thư bị cấu hình chặn, không gọi đó là lỗi", async () => {
    vi.mocked(sendTemplatedEmail).mockResolvedValue({
      ok: true,
      skipped: true,
      reason: "Chưa bật gửi thư"
    } as never);

    const result = await run(population(2));
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.sent).toBe(0);
  });

  it("không gửi bức thư còn thiếu dữ liệu, và không ghi sổ cho nó", async () => {
    // Không ghi sổ là chủ ý: lần chạy sau gặp lại đúng người này, nên sửa dữ
    // liệu của họ rồi chạy tiếp là xong, không phải mở lô mới.
    const tables = population(2);
    tables.people[0].full_name = "   ";

    const result = await run(tables);
    expect(result.sent).toBe(1);
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].toEmail).toBe("nguoi1@example.com");
  });
});

describe("cập nhật lô", () => {
  it("cộng dồn vào con số đã có, không ghi đè", async () => {
    await run(population(2), { batch: batch({ sentCount: 40, failedCount: 3 }) });
    expect(updates.at(-1)).toMatchObject({ sent_count: 42, failed_count: 3 });
  });

  it("đánh dấu xong chỉ khi thật sự hết người", async () => {
    await run(population(2));
    expect(updates.at(-1)).toMatchObject({ status: "completed" });
    expect(updates.at(-1)?.completed_at).toBeTruthy();
  });

  it("để lô ở trạng thái đang chạy khi còn người chưa nhận", async () => {
    await run(population(BULK_SEND_CHUNK + 1));
    expect(updates.at(-1)).toMatchObject({ status: "running", completed_at: null });
  });
});

describe("lô to chạy liền mạch (85 thư / lần, 20/11/2026)", () => {
  it("chỉ tiêu một lần chạy là 85, ngân sách 30 giây = 60 − 20 (một lời gọi treo) − 10", () => {
    expect(BULK_SEND_CHUNK).toBe(85);
    expect(BULK_TIME_BUDGET_MS).toBe(30_000);
  });

  it("nhà cung cấp trả 429: dừng ngay, lá bị 429 KHÔNG tính là lỗi và vẫn còn trong số còn lại", async () => {
    vi.mocked(sendTemplatedEmail)
      .mockResolvedValueOnce({ ok: true, skipped: false } as never)
      .mockResolvedValueOnce({ ok: false, skipped: false, reason: "quá giới hạn", providerStatus: 429 } as never);
    const result = await run(population(10));
    expect(result).toMatchObject({ ok: true, sent: 1, failed: 0, remaining: 9, rateLimited: true, error: null });
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(2);
    // Lô chưa xong thì vẫn running.
    expect(updates.at(-1)).toMatchObject({ status: "running", sent_count: 1, failed_count: 0 });
  });

  it("lần sau gửi lại người bị 429: dòng sổ 429 không tính là đã xử lý, dòng lỗi khác vẫn tính", async () => {
    const tables = population(4);
    tables.handled = [
      { to_email: "nguoi0@example.com", status: "sent", error: null },
      { to_email: "nguoi1@example.com", status: "failed", error: "Resend HTTP 429: rate_limit_exceeded" },
      { to_email: "nguoi2@example.com", status: "failed", error: "Resend HTTP 422: validation_error" }
    ];
    const result = await run(tables);
    const addressed = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0].toEmail).sort();
    expect(addressed).toEqual(["nguoi1@example.com", "nguoi3@example.com"]);
    expect(result).toMatchObject({ sent: 2, remaining: 0 });
  });

  it("5 lá lỗi nhà cung cấp liên tiếp: dừng (providerTrouble), không đốt cả lô thành lỗi", async () => {
    vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: false, skipped: false, reason: "lỗi", providerStatus: 500 } as never);
    const result = await run(population(30));
    expect(result).toMatchObject({ sent: 0, failed: 5, remaining: 25, providerTrouble: true });
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(5);
  });

  it("lỗi lẻ tẻ xen thư thành công không bị coi là nhà cung cấp hỏng", async () => {
    for (let i = 0; i < 12; i += 1) {
      vi.mocked(sendTemplatedEmail).mockResolvedValueOnce(
        (i % 3 === 2 ? { ok: true, skipped: false } : { ok: false, skipped: false, reason: "lỗi", providerStatus: 500 }) as never
      );
    }
    const result = await run(population(12));
    expect(result.providerTrouble).toBeUndefined();
    expect(result).toMatchObject({ sent: 4, failed: 8, remaining: 0 });
  });

  it("lá lỗi điền ô được đếm riêng (fillFailed) — không ghi sổ, lần sau gặp lại", async () => {
    // Ô không có trong danh mục của loại thư → renderTemplate chặn cả 3 lá, không lá nào ghi sổ.
    const result = await run(population(3), { body: "Chào {{ten_nguoi_nhan}}, {{o_khong_co}}." });
    expect(result).toMatchObject({ sent: 0, failed: 3, fillFailed: 3 });
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("lỗi khác 429 không dừng lần chạy", async () => {
    vi.mocked(sendTemplatedEmail)
      .mockResolvedValueOnce({ ok: false, skipped: false, reason: "hộp thư sai", providerStatus: 422 } as never);
    const result = await run(population(4));
    expect(result).toMatchObject({ sent: 3, failed: 1, remaining: 0 });
    expect(result.rateLimited).toBeUndefined();
  });

  it("ngân sách tính từ mốc lệnh bắt đầu: lệnh đã tốn gần hết thời gian thì không bắt đầu lá nào", async () => {
    const result = await run(population(5), { now: () => 100_000, startedAt: 100_000 - BULK_TIME_BUDGET_MS });
    expect(result).toMatchObject({ ok: true, sent: 0, remaining: 5 });
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("mốc bắt đầu còn trong ngân sách thì gửi bình thường", async () => {
    const result = await run(population(5), { now: () => 100_000, startedAt: 100_000 - (BULK_TIME_BUDGET_MS - 1) });
    expect(result).toMatchObject({ sent: 5, remaining: 0 });
  });
});
