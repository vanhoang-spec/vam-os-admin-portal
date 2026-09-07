/**
 * Vòng chạy gửi bù — tầng chạm database.
 *
 * Bảo đảm quan trọng nhất ở đây là ĐẶT CHỖ TRƯỚC KHI GỬI. Nếu chỉ đọc rồi gửi,
 * hai người bấm cách nhau vài giây sẽ cùng thấy một ảnh chụp cũ và cùng gửi thư
 * cho ứng viên, mà sổ chỉ hiện một dòng. Những ca dưới đây khoá: có đặt chỗ
 * trước, va 23505 thì KHÔNG gọi nhà cung cấp, và id chỗ đã đặt được chuyền
 * xuống để kết quả chốt lên đúng dòng đó.
 *
 * Phân loại: DIRECT PRODUCTION TESTS (gọi export thật, mock hạ tầng).
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendApplicationConfirmation: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendApplicationConfirmation } from "@/lib/email";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { runConfirmationBackfill } from "@/lib/confirmation-backfill";
import { CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE } from "@/lib/confirmation-backfill-core";

const SEASON_ID = "00000000-0000-4000-8000-0000000000s1".replace("s1", "51");

type Call = {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

type Scenario = {
  applications: Array<Record<string, unknown>>;
  liveRelatedIds: string[];
  /** Mã lỗi trả về cho lần insert đặt chỗ thứ n (1-based); undefined = thành công. */
  claimErrors: Record<number, string>;
};

let calls: Call[] = [];
let scenario: Scenario;
let claimCount = 0;

function makeChain(table: string, op: string, payload?: unknown) {
  const call: Call = { table, op, payload, filters: [] };
  calls.push(call);

  const result = () => {
    if (table === "seasons") return { data: { id: SEASON_ID }, error: null };

    if (table === "applications") {
      // Trang thứ hai luôn rỗng: bộ thu thập dừng khi trang ngắn hơn kích thước.
      const isFirstPage = call.filters.every(([k]) => k !== "__page2");
      return { data: isFirstPage ? scenario.applications : [], error: null };
    }

    if (table === "outbound_emails" && op === "select") {
      return {
        data: scenario.liveRelatedIds.map((id) => ({ related_id: id })),
        error: null
      };
    }

    if (table === "outbound_emails" && op === "insert") {
      claimCount += 1;
      const code = scenario.claimErrors[claimCount];
      if (code) return { data: null, error: { code, message: "claim refused" } };
      return { data: { id: `claim-${claimCount}` }, error: null };
    }

    return { data: null, error: null };
  };

  const chain: Record<string, unknown> = {};
  const passthrough = ["select", "eq", "in", "not", "gte", "lt", "order", "range"];
  for (const method of passthrough) {
    chain[method] = (a?: unknown, b?: unknown) => {
      call.filters.push([method, a ?? b]);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result());
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return chain;
}

function makeClient() {
  return {
    from: (table: string) => ({
      select: (...args: unknown[]) => makeChain(table, "select", args[0]),
      insert: (payload: unknown) => makeChain(table, "insert", payload),
      update: (payload: unknown) => makeChain(table, "update", payload)
    })
  } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

function application(id: string, role = "mentee") {
  return {
    id,
    role_applied: role,
    full_name: `Người ${id}`,
    email_primary: `${id}@example.test`,
    submitted_at: "2026-08-20",
    status: "submitted"
  };
}

beforeEach(() => {
  calls = [];
  claimCount = 0;
  scenario = { applications: [], liveRelatedIds: [], claimErrors: {} };
  vi.clearAllMocks();
  (getSupabaseServiceRoleClient as unknown as Mock).mockImplementation(() => makeClient());
  (getCurrentAdminUser as unknown as Mock).mockResolvedValue({ id: "admin-1", role: "admin" });
  (sendApplicationConfirmation as unknown as Mock).mockResolvedValue({ ok: true, skipped: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.VAM_OS_EMAIL_ENABLED;
});

describe("đặt chỗ trước khi gửi", () => {
  it("chèn một dòng queued TRƯỚC khi gọi nhà cung cấp", async () => {
    scenario.applications = [application("a1")];

    await runConfirmationBackfill({ seasonId: SEASON_ID });

    const claim = calls.find((c) => c.table === "outbound_emails" && c.op === "insert");
    expect(claim).toBeDefined();
    expect(claim!.payload).toMatchObject({
      status: "queued",
      related_table: "applications",
      related_id: "a1",
      kind: "mentee_application_confirmation"
    });
  });

  it("chuyền id chỗ đã đặt xuống, để kết quả chốt lên đúng dòng đó", async () => {
    scenario.applications = [application("a1")];

    await runConfirmationBackfill({ seasonId: SEASON_ID });

    expect(sendApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect((sendApplicationConfirmation as unknown as Mock).mock.calls[0][0]).toMatchObject({
      applicationId: "a1",
      role: "mentee",
      claimedRowId: "claim-1"
    });
  });

  it("va 23505 thì KHÔNG gọi nhà cung cấp — đó là toàn bộ mục đích của việc đặt chỗ", async () => {
    scenario.applications = [application("a1")];
    scenario.claimErrors = { 1: "23505" };

    const result = await runConfirmationBackfill({ seasonId: SEASON_ID });

    expect(sendApplicationConfirmation).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary.claimed_elsewhere).toBe(1);
  });

  it("lỗi đặt chỗ khác 23505 được đếm riêng, cũng không gửi", async () => {
    scenario.applications = [application("a1")];
    scenario.claimErrors = { 1: "42501" };

    const result = await runConfirmationBackfill({ seasonId: SEASON_ID });

    expect(sendApplicationConfirmation).not.toHaveBeenCalled();
    if (result.ok) expect(result.summary.claim_failed).toBe(1);
  });
});

describe("dọn chỗ đặt treo", () => {
  it("mở đầu mỗi lượt bằng việc đánh hỏng những dòng queued quá hạn", async () => {
    await runConfirmationBackfill({ seasonId: SEASON_ID });

    const sweep = calls.find((c) => c.table === "outbound_emails" && c.op === "update");
    expect(sweep).toBeDefined();
    expect(sweep!.payload).toMatchObject({ status: "failed" });
    // Chỉ chạm dòng đang chờ, chỉ hai loại thư xác nhận, và chỉ dòng cũ.
    const filterKeys = sweep!.filters.map(([k]) => k);
    expect(filterKeys).toContain("eq");
    expect(filterKeys).toContain("in");
    expect(filterKeys).toContain("lt");
  });
});

describe("bỏ qua đơn đã có thư", () => {
  it("không gửi lại cho đơn đang có dòng còn sống", async () => {
    scenario.applications = [application("a1"), application("a2")];
    scenario.liveRelatedIds = ["a1"];

    await runConfirmationBackfill({ seasonId: SEASON_ID });

    expect(sendApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect((sendApplicationConfirmation as unknown as Mock).mock.calls[0][0]).toMatchObject({
      applicationId: "a2"
    });
  });
});

describe("kết quả gửi", () => {
  it("cổng tắt thì đếm là bỏ qua chứ không phải lỗi", async () => {
    scenario.applications = [application("a1")];
    (sendApplicationConfirmation as unknown as Mock).mockResolvedValue({
      ok: true,
      skipped: true,
      reason: "VAM_OS_EMAIL_ENABLED chưa bật"
    });

    const result = await runConfirmationBackfill({ seasonId: SEASON_ID });

    if (result.ok) {
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.failed).toBe(0);
      expect(result.gateOpen).toBe(false);
    }
  });

  it("gửi hỏng thì đếm là lỗi", async () => {
    scenario.applications = [application("a1")];
    (sendApplicationConfirmation as unknown as Mock).mockResolvedValue({ ok: false, skipped: false });

    const result = await runConfirmationBackfill({ seasonId: SEASON_ID });

    if (result.ok) expect(result.summary.failed).toBe(1);
  });
});

describe("ngân sách thời gian", () => {
  it("dừng giữa chừng thay vì để function bị cắt ngang", async () => {
    scenario.applications = [application("a1"), application("a2"), application("a3")];

    // Đồng hồ nhảy vọt sau lần đọc đầu tiên, mô phỏng một lời gọi treo lâu.
    let ticks = 0;
    const now = () => {
      ticks += 1;
      return ticks <= 2 ? 0 : 10_000_000;
    };

    const result = await runConfirmationBackfill({ seasonId: SEASON_ID, now });

    expect(sendApplicationConfirmation).toHaveBeenCalledTimes(1);
    if (result.ok) expect(result.stoppedByBudget).toBe(true);
  });
});

describe("ghi audit", () => {
  it("ghi đúng action_type mà migration đã nới từ vựng cho", async () => {
    scenario.applications = [application("a1")];

    await runConfirmationBackfill({ seasonId: SEASON_ID });

    const audit = calls.find((c) => c.table === "admin_audit_log" && c.op === "insert");
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({
      action_type: CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE,
      actor_admin_user_id: "admin-1"
    });
  });

  it("ghi kèm số liệu để tra lại được sau này", async () => {
    scenario.applications = [application("a1")];

    await runConfirmationBackfill({ seasonId: SEASON_ID });

    const audit = calls.find((c) => c.table === "admin_audit_log" && c.op === "insert");
    const details = (audit!.payload as { details: Record<string, unknown> }).details;
    expect(details).toMatchObject({ requested: 1, sent: 1, gate_open: false });
    expect(details).toHaveProperty("since");
  });
});
