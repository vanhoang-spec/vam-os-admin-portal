/**
 * Thư báo cho người chấm sau khi giao một lô.
 *
 * Hai điều phải giữ:
 * - Gửi cho đúng người, với mùa, vai trò và hạn đọc lại từ database.
 * - Không gửi được thì nói rõ vì sao, và KHÔNG ném lỗi: việc giao đã xong rồi.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  sendReviewBatchAssigned: vi.fn(),
  getPublicOrigin: vi.fn(async () => "https://os.example.org")
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: () => mocks.client }));
vi.mock("@/lib/email", () => ({ sendReviewBatchAssigned: mocks.sendReviewBatchAssigned }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: mocks.getPublicOrigin }));

import { notifyReviewerOfAssignment } from "@/lib/review-assignment-notice";

type Row = Record<string, unknown>;
type Read = { table: string; filters: Array<[string, unknown]> };

/** Honors `.eq()` filters, so a read by the wrong id finds nothing. */
function fakeClient(tables: Record<string, Row[]>, failing: string[] = []) {
  const reads: Read[] = [];
  return {
    reads,
    from(table: string) {
      const read: Read = { table, filters: [] };
      reads.push(read);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        read.filters.push([column, value]);
        return chain;
      };
      chain.maybeSingle = async () => {
        if (failing.includes(table)) return { data: null, error: { message: "boom" } };
        const match = (tables[table] ?? []).find((row) =>
          read.filters.every(([column, value]) => row[column] === value)
        );
        return { data: match ?? null, error: null };
      };
      return chain;
    }
  };
}

const DB: Record<string, Row[]> = {
  admin_users: [
    { id: "rev-other", email: "other@example.com", full_name: "Người khác" },
    { id: "rev-1", email: "my@example.com", full_name: "Võ Nguyễn Hoàng Mỹ" }
  ],
  applications: [
    { id: "app-other", role_applied: "mentee", season_id: "season-11" },
    { id: "app-1", role_applied: "mentor", season_id: "season-12" }
  ],
  seasons: [
    { id: "season-11", name: "UEH Mentoring S11", code: "UEHM-S11" },
    { id: "season-12", name: "UEH Mentoring S12", code: "UEHM-S12" }
  ]
};

const INPUT = {
  reviewerAdminUserId: "rev-1",
  applicationIds: ["app-1", "app-2"],
  applicationsAssigned: 2,
  dueAt: "2026-09-20T16:59:59.000Z",
  assignmentBatchId: "batch-1"
};

function withRows(overrides: Record<string, Row[]>) {
  return { ...DB, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = fakeClient(DB);
  mocks.sendReviewBatchAssigned.mockResolvedValue({ ok: true, skipped: false });
  mocks.getPublicOrigin.mockResolvedValue("https://os.example.org");
});

describe("gửi cho đúng người, đúng nội dung", () => {
  it("người vừa được giao nhận thư, với mùa, vai trò và hạn của chính lô đó", async () => {
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice).toEqual({ status: "sent", reviewerLabel: "Võ Nguyễn Hoàng Mỹ" });
    expect(mocks.sendReviewBatchAssigned).toHaveBeenCalledTimes(1);
    expect(mocks.sendReviewBatchAssigned.mock.calls[0][0]).toEqual({
      toEmail: "my@example.com",
      reviewerName: "Võ Nguyễn Hoàng Mỹ",
      seasonLabel: "UEH Mentoring S12",
      assignmentCount: 2,
      dueLabel: "20/09/2026",
      roleApplied: "mentor",
      assignmentBatchId: "batch-1",
      requestOrigin: "https://os.example.org"
    });
  });

  it("hạn in theo giờ Việt Nam, không theo giờ máy chủ", async () => {
    // 00:30 ngày 21/09 giờ Việt Nam — ở UTC vẫn là ngày 20.
    await notifyReviewerOfAssignment({ ...INPUT, dueAt: "2026-09-20T17:30:00.000Z" });
    expect(mocks.sendReviewBatchAssigned.mock.calls[0][0].dueLabel).toBe("21/09/2026");
  });

  it("không hạn: thư không mang hạn", async () => {
    await notifyReviewerOfAssignment({ ...INPUT, dueAt: null });
    expect(mocks.sendReviewBatchAssigned.mock.calls[0][0].dueLabel).toBeNull();
  });

  it("mùa không có tên thì dùng mã mùa", async () => {
    mocks.client = fakeClient(
      withRows({ seasons: [{ id: "season-12", name: null, code: "UEHM-S12" }] })
    );
    await notifyReviewerOfAssignment(INPUT);
    expect(mocks.sendReviewBatchAssigned.mock.calls[0][0].seasonLabel).toBe("UEHM-S12");
  });

  it("hồ sơ không gắn mùa: vẫn gửi, để mẫu thư tự nói 'mùa mới'", async () => {
    mocks.client = fakeClient(
      withRows({ applications: [{ id: "app-1", role_applied: "mentor", season_id: null }] })
    );
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice.status).toBe("sent");
    expect(mocks.sendReviewBatchAssigned.mock.calls[0][0].seasonLabel).toBe("");
  });

  it("người chấm không có tên: gọi bằng email", async () => {
    mocks.client = fakeClient(
      withRows({ admin_users: [{ id: "rev-1", email: "my@example.com", full_name: "  " }] })
    );
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice).toEqual({ status: "sent", reviewerLabel: "my@example.com" });
    expect(mocks.sendReviewBatchAssigned.mock.calls[0][0].reviewerName).toBe("my@example.com");
  });
});

describe("không gửi được thì nói rõ, và không ném lỗi", () => {
  it("người chấm chưa có email: không gửi, nói đúng lý do", async () => {
    mocks.client = fakeClient(
      withRows({ admin_users: [{ id: "rev-1", email: null, full_name: "Võ Nguyễn Hoàng Mỹ" }] })
    );
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice).toEqual({
      status: "not_sent",
      reviewerLabel: "Võ Nguyễn Hoàng Mỹ",
      reason: "Người chấm chưa có địa chỉ email."
    });
    expect(mocks.sendReviewBatchAssigned).not.toHaveBeenCalled();
  });

  it("không đọc được người chấm: không gửi", async () => {
    mocks.client = fakeClient(DB, ["admin_users"]);
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice.status).toBe("not_sent");
    expect(mocks.sendReviewBatchAssigned).not.toHaveBeenCalled();
  });

  it("không đọc được hồ sơ vừa giao: không gửi thư mang vai trò đoán bừa", async () => {
    mocks.client = fakeClient(DB, ["applications"]);
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice.status).toBe("not_sent");
    expect(mocks.sendReviewBatchAssigned).not.toHaveBeenCalled();
  });

  it("gửi thư đang tắt: KHÔNG báo là đã gửi", async () => {
    mocks.sendReviewBatchAssigned.mockResolvedValue({ ok: true, skipped: true, reason: "Chưa bật gửi thư." });
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice).toEqual({ status: "not_sent", reviewerLabel: "Võ Nguyễn Hoàng Mỹ", reason: "Chưa bật gửi thư." });
  });

  it("nhà cung cấp từ chối: nói lý do", async () => {
    mocks.sendReviewBatchAssigned.mockResolvedValue({ ok: false, skipped: false, reason: "Brevo từ chối địa chỉ." });
    const notice = await notifyReviewerOfAssignment(INPUT);

    expect(notice.status).toBe("not_sent");
    if (notice.status === "not_sent") expect(notice.reason).toBe("Brevo từ chối địa chỉ.");
  });

  it("hàm gửi ném lỗi: bắt lại, không ném ra ngoài", async () => {
    mocks.sendReviewBatchAssigned.mockRejectedValue(new Error("network down"));
    await expect(notifyReviewerOfAssignment(INPUT)).resolves.toMatchObject({ status: "not_sent" });
  });

  it("không có kết nối database: không gửi, không ném", async () => {
    mocks.client = null;
    await expect(notifyReviewerOfAssignment(INPUT)).resolves.toMatchObject({ status: "not_sent" });
    expect(mocks.sendReviewBatchAssigned).not.toHaveBeenCalled();
  });
});
