/**
 * Lệnh mở lô gửi với các nhóm có tham số.
 *
 * Canh hai điều: nhóm sự kiện không bao giờ mở lô mà thiếu sự kiện, và nhóm không
 * mang tham số không bao giờ mang theo một sự kiện — kể cả khi form lỡ gửi lên.
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
import { createEmailBatch, listBulkRecipients, runEmailBatch } from "@/lib/bulk-mail";
import { startBulkSendAction } from "@/app/actions/bulk-mail";
import { initialBulkMailActionState } from "@/lib/bulk-mail-action-types";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const TEMPLATE = "00000000-0000-4000-8000-0000000000cc";
const EVENT = "00000000-0000-4000-8000-0000000000ee";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "u1", email: "admin@vam.org", full_name: "A", role: "admin", status: "active", auth_user_id: null
  } as never);
  vi.mocked(getMailSeason).mockResolvedValue({ ok: true, id: SEASON, code: "UEHM-S12" });
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(getEmailTemplate).mockResolvedValue({
    row: {
      id: TEMPLATE, seasonId: SEASON, kind: "general_announcement", name: "Nhắc hạn",
      subject: "Thông báo", body: "Chào {{ten_nguoi_nhan}}.", status: "approved"
    },
    error: null
  } as never);
  vi.mocked(listBulkRecipients).mockResolvedValue({
    partition: {
      sendable: [
        { personId: "r1", fullName: "Người Một", email: "one@x.org", role: "attendee", relationTable: "event_registrations" },
        { personId: "r2", fullName: "Người Hai", email: "two@x.org", role: "attendee", relationTable: "event_registrations" }
      ],
      unreachable: []
    },
    error: null,
    label: "Người đã đăng ký Mentor Orientation · 20/09/2026 (cả chuỗi)"
  } as never);
  vi.mocked(createEmailBatch).mockResolvedValue({ batch: { id: "b1" }, error: null } as never);
  vi.mocked(runEmailBatch).mockResolvedValue({
    ok: true, sent: 2, failed: 0, skipped: 0, remaining: 0, problems: [], error: null
  } as never);
});

describe("nhóm người đã đăng ký một sự kiện", () => {
  it("thiếu sự kiện: từ chối trước khi đếm người nhận, không mở lô", async () => {
    const result = await startBulkSendAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, audience: "event", confirm_count: "2" })
    );
    expect(result.ok).toBe(false);
    expect(listBulkRecipients).not.toHaveBeenCalled();
    expect(createEmailBatch).not.toHaveBeenCalled();
  });

  it("đếm và chốt vào lô ĐÚNG sự kiện và cờ chuỗi mà form gửi lên", async () => {
    const result = await startBulkSendAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, audience: "event", event_id: EVENT, covers_series: "true", confirm_count: "2" })
    );
    expect(result.ok).toBe(true);
    expect(listBulkRecipients).toHaveBeenCalledWith({
      seasonId: SEASON,
      audience: "event",
      eventId: EVENT,
      coversSeries: true
    });
    expect(createEmailBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "event",
        audienceEventId: EVENT,
        audienceCoversSeries: true,
        note: "Người đã đăng ký Mentor Orientation · 20/09/2026 (cả chuỗi) · Nhắc hạn"
      })
    );
  });

  it("vẫn phải gõ đúng số người nhận", async () => {
    const result = await startBulkSendAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, audience: "event", event_id: EVENT, confirm_count: "3" })
    );
    expect(result.ok).toBe(false);
    expect(createEmailBatch).not.toHaveBeenCalled();
  });
});

describe("nhóm không mang tham số", () => {
  it("form lỡ gửi kèm sự kiện: bỏ đi, lô Ban tổ chức không mang sự kiện nào", async () => {
    await startBulkSendAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, audience: "staff", event_id: EVENT, covers_series: "true", confirm_count: "2" })
    );
    expect(listBulkRecipients).toHaveBeenCalledWith({ seasonId: SEASON, audience: "staff" });
    const arg = vi.mocked(createEmailBatch).mock.calls[0][0];
    expect(arg).not.toHaveProperty("audienceEventId");
    expect(arg).not.toHaveProperty("audienceCoversSeries");
  });
});
