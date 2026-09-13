/**
 * Mã QR check-in là tuỳ chọn của từng sự kiện.
 *
 * Ba cách công tắc này hỏng mà không ai thấy, và bộ test canh cả ba:
 *   - tắt QR làm mất luôn thư xác nhận — thư từng chỉ đi SAU khi cấp được mã;
 *   - thư vẫn hứa "vé", vẫn đính kèm QR khi sự kiện không dùng QR;
 *   - một dòng thiếu cột (dữ liệu cũ, select hẹp) bị coi là TẮT, lặng lẽ lấy
 *     mất tấm vé của người đăng ký mà không ai quyết định chuyện đó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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
vi.mock("@/lib/event-checkin", () => ({ ensureCheckinCode: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    resolveEmailBaseUrl: vi.fn(() => "https://os.example.org"),
    sendEventRegistrationConfirmation: vi.fn(async () => ({ ok: true, skipped: false }))
  };
});

import { ensureCheckinCode } from "@/lib/event-checkin";
import { sendEventRegistrationConfirmation } from "@/lib/email";
import { buildEventRegistrationConfirmationEmail, buildEventScheduleChangeEmail } from "@/lib/email-core";
import { checkinCodeUrl, usesQrCheckin } from "@/lib/event-checkin-code";
import { issueTicketAndConfirm } from "@/lib/events";

const ORIGIN = "https://os.example.org";
const CODE = "A7K2M9PQRS";

describe("1. công tắc", () => {
  it.each([
    [{ qr_checkin_enabled: true }, true],
    [{ qr_checkin_enabled: false }, false],
    [{ qr_checkin_enabled: null }, true],
    [{}, true],
    [null, true],
    [undefined, true]
  ])("%o → %s", (event, expected) => {
    // Chỉ `false` là tắt. Vắng mặt là bật: tắt vì thiếu cột là lấy mất vé của
    // người đăng ký mà không ai quyết định.
    expect(usesQrCheckin(event as never)).toBe(expected);
  });
});

describe("2. cấp vé và gửi thư khi có người đăng ký", () => {
  const EVENT = {
    id: "e1",
    event_name: "Mentor Orientation",
    event_format: "offline",
    location_name: "Phòng B1-502",
    starts_at: "2026-09-20T01:00:00.000Z",
    ends_at: "2026-09-20T04:30:00.000Z"
  };
  const run = (event: Record<string, unknown>) =>
    issueTicketAndConfirm({
      registrationId: "r1",
      event,
      toEmail: "a@example.com",
      fullName: "Nguyễn Văn A",
      pendingApproval: false
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ensureCheckinCode).mockResolvedValue({ code: CODE, shortCode: "A7K2", error: null });
  });

  it("TẮT QR: không cấp mã, nhưng VẪN gửi thư xác nhận — thư không mang vé", async () => {
    await run({ ...EVENT, qr_checkin_enabled: false });

    expect(ensureCheckinCode).not.toHaveBeenCalled();
    expect(sendEventRegistrationConfirmation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEventRegistrationConfirmation).mock.calls[0][0]).toMatchObject({
      toEmail: "a@example.com",
      ticketUrl: null,
      ticketCode: null,
      shortCode: null,
      qrPngBase64: null
    });
  });

  it("BẬT QR: cấp mã và gửi đúng tấm vé của mã đó, kèm ảnh QR", async () => {
    await run({ ...EVENT, qr_checkin_enabled: true });

    expect(ensureCheckinCode).toHaveBeenCalledWith("r1");
    const sent = vi.mocked(sendEventRegistrationConfirmation).mock.calls[0][0];
    expect(sent.ticketUrl).toBe(checkinCodeUrl(ORIGIN, CODE));
    expect(sent.ticketCode).toBe(CODE);
    expect(sent.shortCode).toBe("A7K2");
    expect(typeof sent.qrPngBase64).toBe("string");
    expect(String(sent.qrPngBase64).length).toBeGreaterThan(100);
  });

  it("dòng KHÔNG mang cột (sự kiện cũ): coi là bật, vẫn cấp vé", async () => {
    await run({ ...EVENT });

    expect(ensureCheckinCode).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEventRegistrationConfirmation).mock.calls[0][0].ticketUrl).toBe(checkinCodeUrl(ORIGIN, CODE));
  });

  it("BẬT QR mà không cấp được mã: không gửi một lá thư hứa vé mà không có vé", async () => {
    vi.mocked(ensureCheckinCode).mockResolvedValue({ code: null, shortCode: null, error: "x" });

    await run({ ...EVENT, qr_checkin_enabled: true });

    expect(sendEventRegistrationConfirmation).not.toHaveBeenCalled();
  });
});

describe("3. thư xác nhận", () => {
  const base = {
    recipientName: "Nguyễn Văn A",
    eventName: "Mentor Orientation",
    whenLabel: "20/09/2026 08:00 – 11:30",
    placeLabel: "Phòng B1-502"
  };

  it("CÓ vé: giữ nguyên như trước — tiêu đề vé, mã QR, đường dẫn vé, ảnh đính kèm", () => {
    const message = buildEventRegistrationConfirmationEmail({
      ...base,
      ticketUrl: `${ORIGIN}/ve/${CODE}`,
      ticketCode: CODE,
      shortCode: "A7K2",
      qrPngBase64: "iVBORw0KGgo="
    });
    expect(message.subject).toBe("Vé tham dự Mentor Orientation");
    expect(message.text).toContain("MÃ QR THAM DỰ");
    expect(message.text).toContain(`${ORIGIN}/ve/${CODE}`);
    expect(message.text).toContain("A7K2");
    expect(message.attachments).toEqual([{ filename: `ve-${CODE}.png`, contentBase64: "iVBORw0KGgo=" }]);
  });

  it("KHÔNG có vé: tiêu đề không hứa vé, không nhắc QR, không đính kèm, nói rõ điểm danh theo danh sách", () => {
    const message = buildEventRegistrationConfirmationEmail({ ...base });

    expect(message.subject).toBe("Xác nhận đăng ký Mentor Orientation");
    expect(message.subject).not.toContain("Vé");
    expect(message.text).not.toContain("MÃ QR THAM DỰ");
    expect(message.text).not.toContain("/ve/");
    expect(message.text).not.toContain("MÃ DỰ PHÒNG");
    expect(message.html).not.toContain("Mở vé trên trình duyệt");
    expect(message.attachments).toBeUndefined();
    expect(message.text).toContain("không dùng mã QR check-in");
    expect(message.html).toContain("không dùng mã QR check-in");
  });

  it("KHÔNG có vé mà nơi gọi lỡ truyền ảnh QR: vẫn không đính kèm", () => {
    const message = buildEventRegistrationConfirmationEmail({ ...base, qrPngBase64: "iVBORw0KGgo=" });
    expect(message.attachments).toBeUndefined();
  });

  it("chờ duyệt thì tiêu đề vẫn là 'đã nhận đăng ký', có vé hay không", () => {
    expect(buildEventRegistrationConfirmationEmail({ ...base, pendingApproval: true }).subject)
      .toBe("Đã nhận đăng ký Mentor Orientation");
  });
});

describe("4. thư báo đổi lịch", () => {
  const base = {
    recipientName: "Nguyễn Văn A",
    eventName: "Mentor Orientation",
    whenLabel: "27/09/2026 08:00 – 11:30"
  };

  it("người KHÔNG có vé: không nhắc tới mã QR họ chưa từng nhận", () => {
    const message = buildEventScheduleChangeEmail({ ...base });
    expect(message.text.toLowerCase()).not.toContain("mã qr");
    expect(message.text.toLowerCase()).not.toContain("vẫn dùng được");
    expect(message.html.toLowerCase()).not.toContain("mã qr");
    expect(message.text).toContain("không cần đăng ký lại");
  });

  it("người CÓ vé: vẫn nói vé cũ dùng được, như trước", () => {
    const message = buildEventScheduleChangeEmail({ ...base, ticketUrl: `${ORIGIN}/ve/${CODE}`, shortCode: "A7K2" });
    expect(message.text.toLowerCase()).toContain("vẫn dùng được");
    expect(message.text).toContain("A7K2");
    expect(message.text).toContain(`${ORIGIN}/ve/${CODE}`);
  });
});

describe("5. lưu và hiển thị công tắc", () => {
  const events = readFileSync("lib/events.ts", "utf8");
  const actions = readFileSync("app/actions/events.ts", "utf8");
  const form = readFileSync("app/events/event-form.tsx", "utf8");
  const page = readFileSync("app/events/[id]/page.tsx", "utf8");

  it("tạo mới lưu công tắc, vắng mặt thì là bật", () => {
    expect(events).toContain('qr_checkin_enabled: String(input.qr_checkin_enabled) !== "false",');
  });

  it("sửa chỉ ghi khi form có gửi ô này", () => {
    expect(events).toContain('if (Object.prototype.hasOwnProperty.call(input, "qr_checkin_enabled")) {');
    expect(events).toContain('updates.qr_checkin_enabled = String(input.qr_checkin_enabled) !== "false";');
  });

  it("cả action tạo lẫn action sửa đều đọc ô này", () => {
    const line = 'qr_checkin_enabled: formData.has("qr_checkin_enabled") ? "true" : "false",';
    expect(actions.split(line).length - 1).toBe(2);
  });

  it("form có ô chọn, mở sẵn theo giá trị hiện tại, vắng mặt thì tick", () => {
    const field = form.slice(form.indexOf('name="qr_checkin_enabled"') - 200, form.indexOf('name="qr_checkin_enabled"') + 200);
    expect(field).toContain('type="checkbox"');
    expect(field).toContain("defaultChecked={event?.qr_checkin_enabled !== false}");
  });

  it("trang sự kiện: tắt QR thì không vẽ mã nào", () => {
    expect(page).toContain("const qrEnabled = usesQrCheckin(detail.event);");
    expect(page).toContain("qrEnabled && checkinUrl ? await QRCode.toDataURL(");
    expect(page).toContain("qrEnabled={qrEnabled}");
  });

  it("trang sự kiện: nút máy quét chỉ ở nhánh bật, nhánh tắt dẫn tới điểm danh thủ công", () => {
    const start = page.indexOf("{qrEnabled ? (");
    const middle = page.indexOf(") : (", start);
    const end = page.indexOf(")}", middle);
    expect(start).toBeGreaterThan(-1);
    expect(page.slice(start, middle)).toContain("/scan");
    expect(page.slice(middle, end)).not.toContain("/scan");
    expect(page.slice(middle, end)).toContain("/attendance");
  });
});

describe("6. migration", () => {
  const sql = readFileSync("supabase/migrations/20260913180000_event_qr_checkin_toggle.sql", "utf8");

  it("thêm cột boolean NOT NULL mặc định TRUE — mọi sự kiện có sẵn giữ nguyên QR", () => {
    expect(sql).toContain("add column if not exists qr_checkin_enabled boolean not null default true");
  });

  it("tự kiểm cả kiểu, NOT NULL lẫn mặc định", () => {
    const selfCheck = sql.slice(sql.indexOf("$self_check$"));
    expect(selfCheck).toContain("v_type <> 'boolean'");
    expect(selfCheck).toContain("v_nullable <> 'NO'");
    expect(selfCheck).toContain("<> 'true'");
  });

  it("không đụng tới dữ liệu nào", () => {
    expect(sql).not.toMatch(/update\s+public\.events|delete\s+from|drop\s+(table|column)|truncate/i);
  });
});
