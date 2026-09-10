/**
 * Các lệnh gửi hàng loạt — những gì chúng từ chối trước khi một lá thư nào đi.
 *
 * Ba hàng rào được khoá ở đây. Bỏ bất kỳ cái nào là mail đã nằm trong hộp thư
 * của người thật, và không có đường thu hồi.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn()
}));
vi.mock("@/lib/email-templates", () => ({
  getMailSeason: vi.fn(),
  getEmailTemplate: vi.fn()
}));
vi.mock("@/lib/bulk-mail", () => ({
  listBulkRecipients: vi.fn(),
  listEmailBatches: vi.fn(),
  createEmailBatch: vi.fn(),
  runEmailBatch: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getEmailTemplate, getMailSeason } from "@/lib/email-templates";
import {
  createEmailBatch,
  listBulkRecipients,
  listEmailBatches,
  runEmailBatch
} from "@/lib/bulk-mail";
import { sendTemplatedEmail } from "@/lib/email";
import {
  continueBulkSendAction,
  sendTestEmailAction,
  startBulkSendAction
} from "@/app/actions/bulk-mail";
import { initialBulkMailActionState } from "@/lib/bulk-mail-action-types";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const OTHER_SEASON = "00000000-0000-4000-8000-0000000000bb";
const TEMPLATE = "00000000-0000-4000-8000-0000000000cc";
const BATCH = "00000000-0000-4000-8000-0000000000dd";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function signedInAs(role: string, email = "admin@vam.org") {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "u1",
    email,
    full_name: "A",
    role,
    status: "active",
    auth_user_id: null
  } as never);
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    row: {
      id: TEMPLATE,
      seasonId: SEASON,
      kind: "general_announcement",
      name: "Nhắc hạn",
      subject: "Thông báo UEHM-S12",
      body: "Chào {{ten_nguoi_nhan}}.",
      status: "approved",
      createdBy: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: "",
      updatedAt: "",
      approverName: null,
      ...overrides
    },
    error: null
  };
}

function recipients(sendable: number, unreachable = 0) {
  return {
    partition: {
      sendable: Array.from({ length: sendable }, (_, i) => ({
        personId: `p${i}`,
        fullName: `Người ${i}`,
        email: `n${i}@example.com`,
        role: "mentee" as const
      })),
      unreachable: Array.from({ length: unreachable }, (_, i) => ({
        personId: `u${i}`,
        fullName: `Thiếu ${i}`,
        reason: "Chưa có địa chỉ email hợp lệ"
      }))
    },
    error: null
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH,
    seasonId: SEASON,
    kind: "general_announcement",
    templateId: TEMPLATE,
    audience: "mentee",
    status: "running",
    requestedCount: 30,
    sentCount: 25,
    skippedCount: 0,
    failedCount: 0,
    note: null,
    createdAt: "",
    completedAt: null,
    ...overrides
  };
}

const START = { template_id: TEMPLATE, audience: "mentee", confirm_count: "30" };

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs("admin");
  vi.mocked(getMailSeason).mockResolvedValue({ ok: true, id: SEASON, code: "UEHM-S12" });
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(getEmailTemplate).mockResolvedValue(template() as never);
  vi.mocked(listBulkRecipients).mockResolvedValue(recipients(30) as never);
  vi.mocked(createEmailBatch).mockResolvedValue({ batch: batch({ sentCount: 0 }), error: null } as never);
  vi.mocked(runEmailBatch).mockResolvedValue({
    ok: true,
    sent: 25,
    failed: 0,
    skipped: 0,
    remaining: 5,
    problems: [],
    error: null
  } as never);
  vi.mocked(listEmailBatches).mockResolvedValue({ rows: [batch()], error: null } as never);
  vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("ai được bấm nút gửi", () => {
  it.each(["viewer", "reviewer", "support_team", "core_team"])(
    "từ chối vai trò %s",
    async (role) => {
      // core_team soạn được nhưng không gửi được: đây là cổng hẹp nhất trong
      // module, hẹp bằng đợt gửi bù thư xác nhận.
      signedInAs(role);
      const result = await startBulkSendAction(initialBulkMailActionState, form(START));
      expect(result.ok).toBe(false);
      expect(createEmailBatch).not.toHaveBeenCalled();
    }
  );

  it.each(["admin", "super_admin"])("cho phép vai trò %s", async (role) => {
    signedInAs(role);
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.ok).toBe(true);
    expect(createEmailBatch).toHaveBeenCalledTimes(1);
  });

  it("từ chối khi không có phạm vi vận hành trên mùa", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.ok).toBe(false);
    expect(createEmailBatch).not.toHaveBeenCalled();
  });
});

describe("chỉ mẫu thư đã duyệt mới gửi được", () => {
  it.each(["draft", "archived"])("từ chối mẫu ở trạng thái %s", async (status) => {
    // Chữ chưa ai đọc thì không đi tới hàng trăm hộp thư.
    vi.mocked(getEmailTemplate).mockResolvedValue(template({ status }) as never);
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("duyệt");
    expect(createEmailBatch).not.toHaveBeenCalled();
  });

  it("từ chối mẫu thư thuộc mùa khác", async () => {
    vi.mocked(getEmailTemplate).mockResolvedValue(template({ seasonId: OTHER_SEASON }) as never);
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.ok).toBe(false);
    expect(createEmailBatch).not.toHaveBeenCalled();
  });
});

describe("xác nhận số người nhận", () => {
  it("từ chối khi gõ sai số, và không mở lô", async () => {
    const result = await startBulkSendAction(
      initialBulkMailActionState,
      form({ ...START, confirm_count: "3" })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("30");
    expect(createEmailBatch).not.toHaveBeenCalled();
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("từ chối khi bỏ trống ô xác nhận", async () => {
    const result = await startBulkSendAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, audience: "mentee" })
    );
    expect(result.ok).toBe(false);
    expect(createEmailBatch).not.toHaveBeenCalled();
  });

  it("đếm lại người nhận ở máy chủ, không tin con số màn hình gửi lên", async () => {
    // Màn hình có thể đã cũ. Con số phải khớp với danh sách máy chủ vừa đọc,
    // nếu không thì bước xác nhận chỉ là gõ lại một con số vô nghĩa.
    vi.mocked(listBulkRecipients).mockResolvedValue(recipients(31) as never);
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("31");
  });

  it("từ chối đối tượng nhận thư không hợp lệ", async () => {
    const result = await startBulkSendAction(
      initialBulkMailActionState,
      form({ ...START, audience: "reviewer" })
    );
    expect(result.ok).toBe(false);
    expect(listBulkRecipients).not.toHaveBeenCalled();
  });
});

describe("mở lô", () => {
  it("chốt đối tượng nhận thư vào lô", async () => {
    await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(createEmailBatch).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "mentee", seasonId: SEASON, requestedCount: 30 })
    );
  });

  it("nêu tên người không nhận được thư, không lặng lẽ bỏ qua", async () => {
    vi.mocked(listBulkRecipients).mockResolvedValue(recipients(30, 2) as never);
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.ok).toBe(true);
    expect(result.problems.join(" ")).toContain("Thiếu 0");
    expect(result.problems.join(" ")).toContain("Chưa có địa chỉ email");
  });

  it("báo còn bao nhiêu người chưa nhận", async () => {
    const result = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(result.message).toContain("5");
    expect(result.batchId).toBe(BATCH);
  });
});

describe("gửi tiếp một lô dở", () => {
  it("từ chối lô đã kết thúc", async () => {
    vi.mocked(listEmailBatches).mockResolvedValue({
      rows: [batch({ status: "completed" })],
      error: null
    } as never);
    const result = await continueBulkSendAction(initialBulkMailActionState, form({ batch_id: BATCH }));
    expect(result.ok).toBe(false);
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("từ chối lô không thuộc mùa đang vận hành", async () => {
    // Lô được tìm trong danh sách của mùa này; không thấy thì không chạy.
    vi.mocked(listEmailBatches).mockResolvedValue({ rows: [], error: null } as never);
    const result = await continueBulkSendAction(initialBulkMailActionState, form({ batch_id: BATCH }));
    expect(result.ok).toBe(false);
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("từ chối khi mẫu thư của lô đã bị sửa và mất dấu duyệt", async () => {
    // Nửa còn lại của quy tắc "sửa là mất duyệt": nếu không chặn ở đây, phần
    // sau của lô đi với chữ mới mà không ai đọc, còn phần đầu đã đi với chữ cũ.
    vi.mocked(getEmailTemplate).mockResolvedValue(template({ status: "draft" }) as never);
    const result = await continueBulkSendAction(initialBulkMailActionState, form({ batch_id: BATCH }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("duyệt lại");
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("chạy tiếp với đúng lô đọc lại từ database", async () => {
    const result = await continueBulkSendAction(initialBulkMailActionState, form({ batch_id: BATCH }));
    expect(result.ok).toBe(true);
    expect(runEmailBatch).toHaveBeenCalledWith(
      expect.objectContaining({ batch: expect.objectContaining({ id: BATCH, sentCount: 25 }) })
    );
  });

  it.each(["core_team", "support_team"])("không cho vai trò %s gửi tiếp", async (role) => {
    signedInAs(role);
    const result = await continueBulkSendAction(initialBulkMailActionState, form({ batch_id: BATCH }));
    expect(result.ok).toBe(false);
    expect(runEmailBatch).not.toHaveBeenCalled();
  });
});

describe("gửi thử cho chính mình", () => {
  it("gửi tới địa chỉ của người đang bấm, không tới ai khác", async () => {
    signedInAs("admin", "hoang@vam.org");
    const result = await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(result.ok).toBe(true);
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].toEmail).toBe("hoang@vam.org");
  });

  it("không thuộc lô nào", async () => {
    await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].batchId).toBeUndefined();
    expect(createEmailBatch).not.toHaveBeenCalled();
  });

  it("đánh dấu rõ trong tiêu đề là bản thử", async () => {
    await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].subject).toContain("[THỬ]");
  });

  it("gửi thử được cả mẫu chưa duyệt — đó là lúc cần thử nhất", async () => {
    vi.mocked(getEmailTemplate).mockResolvedValue(template({ status: "draft" }) as never);
    const result = await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(result.ok).toBe(true);
  });

  it("nói rõ khi cấu hình đang chặn gửi thư, thay vì báo thành công", async () => {
    vi.mocked(sendTemplatedEmail).mockResolvedValue({
      ok: true,
      skipped: true,
      reason: "Chưa bật gửi thư."
    } as never);
    const result = await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Chưa bật gửi thư");
  });

  it.each(["core_team", "support_team"])("không cho vai trò %s gửi thử", async (role) => {
    signedInAs(role);
    const result = await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(result.ok).toBe(false);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });
});
