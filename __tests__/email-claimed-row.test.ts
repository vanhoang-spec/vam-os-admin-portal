/**
 * Đường đặt-chỗ-trước-khi-gửi trong lib/email.ts — phần chỉ có trên main.
 *
 * Nhánh s12 ghi sổ SAU khi gửi xong. Lượt gửi bù không dùng được cách đó: hai
 * người bấm cách nhau vài giây sẽ cùng đọc một ảnh chụp cũ rồi cùng gửi thư cho
 * ứng viên, mà sổ chỉ hiện một dòng. Nên lượt gửi bù đặt chỗ trước bằng một
 * dòng `queued`, để index unique dưới database chặn người thứ hai NGAY LÚC đặt
 * chỗ — trước khi kịp gọi nhà cung cấp.
 *
 * Những ca dưới đây khoá đúng tính chất ấy: khi có chỗ đã đặt thì kết quả phải
 * được chốt lên chính dòng đó, không bao giờ sinh dòng thứ hai.
 *
 * Phân loại: DIRECT PRODUCTION TESTS (gọi thẳng export thật).
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendApplicationConfirmation } from "@/lib/email";

type Recorded = {
  inserts: Record<string, unknown>[];
  updates: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>;
};

const recorded: Recorded = { inserts: [], updates: [] };

function makeClient() {
  const chain: Record<string, unknown> = {};

  chain.insert = (payload: Record<string, unknown>) => {
    recorded.inserts.push(payload);
    return Promise.resolve({ data: null, error: null });
  };

  chain.update = (payload: Record<string, unknown>) => {
    const filters: Array<[string, unknown]> = [];
    const thenable = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return thenable;
      },
      then(resolve: (value: { data: null; error: null }) => unknown) {
        recorded.updates.push({ payload, filters });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
    };
    return thenable;
  };

  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const CLAIM_ID = "00000000-0000-4000-8000-00000000c1a1";
const APPLICATION_ID = "00000000-0000-4000-8000-000000000a01";

const INPUT = {
  toEmail: "ung.vien@example.test",
  applicantName: "Nguyễn Văn A",
  role: "mentee" as const,
  seasonLabel: "UEH Mentoring Mùa 12",
  applicationId: APPLICATION_ID
};

let fetchMock: Mock;

/**
 * Chỉ đụng vào đúng những biến này, và trả lại từng biến một.
 *
 * Gán đè cả `process.env` bằng một object mới sẽ phá cách ly giữa các file
 * test — kho có một bài kiểm riêng chặn đúng việc đó
 * (__tests__/harness-state-isolation.test.ts).
 */
const TOUCHED_ENV = [
  "VAM_OS_EMAIL_ENABLED",
  "VERCEL_ENV",
  "VAM_OS_EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "VAM_OS_EMAIL_FROM",
  "VAM_OS_EMAIL_REPLY_TO"
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>();

function enableSending() {
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "UEH Mentoring <mentoring@alumni-mentoring.edu.vn>";
}

beforeEach(() => {
  recorded.inserts = [];
  recorded.updates = [];
  ORIGINAL_ENV.clear();
  for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
  (getSupabaseServiceRoleClient as unknown as Mock).mockReturnValue(makeClient());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  enableSending();
});

afterEach(() => {
  // Duyệt mảng rồi tra Map, chứ không duyệt thẳng Map: tsconfig của kho này
  // đặt target dưới es2015 nên iterate Map cần cờ downlevelIteration. Cùng
  // khuôn với __tests__/email-delivery.test.ts.
  for (const key of TOUCHED_ENV) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gửi kèm chỗ đã đặt trước", () => {
  it("chốt kết quả lên chính dòng đã đặt, không sinh dòng thứ hai", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "<abc@smtp-relay.brevo.com>" })
    });

    await sendApplicationConfirmation({ ...INPUT, claimedRowId: CLAIM_ID });

    expect(recorded.inserts).toHaveLength(0);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0].payload).toMatchObject({
      status: "sent",
      provider: "brevo",
      provider_message_id: "<abc@smtp-relay.brevo.com>",
      to_email: INPUT.toEmail
    });
  });

  it("khoá đúng dòng đó và chỉ khi nó còn đang chờ", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<x@y>" }) });

    await sendApplicationConfirmation({ ...INPUT, claimedRowId: CLAIM_ID });

    // `status = queued` trong mệnh đề lọc là thứ ngăn một tiến trình thứ hai
    // ghi đè lên kết quả đã chốt.
    expect(recorded.updates[0].filters).toEqual([
      ["id", CLAIM_ID],
      ["status", "queued"]
    ]);
  });

  it("nhà cung cấp từ chối thì ghi failed lên cùng dòng ấy", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: "invalid_parameter", message: "Sender not valid" })
    });

    const result = await sendApplicationConfirmation({ ...INPUT, claimedRowId: CLAIM_ID });

    expect(result.ok).toBe(false);
    expect(recorded.inserts).toHaveLength(0);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0].payload.status).toBe("failed");
    expect(String(recorded.updates[0].payload.error)).toContain("400");
  });

  it("cổng gửi tắt thì ghi skipped lên cùng dòng ấy, và không gọi nhà cung cấp", async () => {
    delete process.env.VAM_OS_EMAIL_ENABLED;

    const result = await sendApplicationConfirmation({ ...INPUT, claimedRowId: CLAIM_ID });

    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0].payload.status).toBe("skipped");
  });

  it("không có chỗ đặt trước thì vẫn chèn dòng mới như cũ", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<x@y>" }) });

    await sendApplicationConfirmation(INPUT);

    expect(recorded.updates).toHaveLength(0);
    expect(recorded.inserts).toHaveLength(1);
    expect(recorded.inserts[0]).toMatchObject({
      kind: "mentee_application_confirmation",
      status: "sent",
      related_table: "applications",
      related_id: APPLICATION_ID
    });
  });
});
