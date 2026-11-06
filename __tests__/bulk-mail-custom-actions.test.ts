/**
 * Lệnh của danh sách tùy chỉnh (VAM00026): cổng quyền, kiểm lại danh sách form gửi lên, xác nhận số.
 *
 * Phần dựng danh sách (lib/bulk-mail) được giả — ở đây chỉ canh điều lệnh làm với nó: không mở lô
 * khi danh sách gửi lên có một khoá lạ, khi số gõ lại sai, hoặc khi người bấm không có quyền; và
 * email chốt vào lô là email của tập máy chủ dựng, không phải thứ form mang theo.
 * lib/bulk-mail-custom-core là hàng thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ getMailSeason: vi.fn(), getEmailTemplate: vi.fn() }));
vi.mock("@/lib/bulk-mail", () => ({
  buildCustomRecipientUniverse: vi.fn(),
  createCustomEmailBatch: vi.fn(),
  createEmailBatch: vi.fn(),
  listBulkRecipients: vi.fn(),
  listEmailBatches: vi.fn(),
  runEmailBatch: vi.fn(),
  searchCustomListPeople: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getEmailTemplate, getMailSeason } from "@/lib/email-templates";
import {
  buildCustomRecipientUniverse,
  createCustomEmailBatch,
  createEmailBatch,
  listBulkRecipients,
  runEmailBatch,
  searchCustomListPeople
} from "@/lib/bulk-mail";
import {
  previewCustomListAction,
  searchCustomListPeopleAction,
  startBulkSendAction,
  startCustomBulkSendAction
} from "@/app/actions/bulk-mail";
import {
  initialBulkMailActionState,
  initialCustomListPreviewState,
  initialCustomListSearchState
} from "@/lib/bulk-mail-action-types";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEASON = u(1);
const TEMPLATE = u(2);
const P1 = u(11);
const R1 = u(12);
const A1 = u(13);

const UNIVERSE = [
  { personId: P1, fullName: "An Mentor", email: "an@x.org", role: "mentor" as const },
  { personId: R1, fullName: "Lan Đã Đến", email: "lan@x.org", role: "attendee" as const, relationTable: "event_registrations" as const },
  { personId: A1, fullName: "Khoa BTC", email: "khoa@x.org", role: "staff" as const, relationTable: "admin_users" as const }
];

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
  return data;
}

const ALL_KEYS = [`people:${P1}`, `event_registrations:${R1}`, `admin_users:${A1}`];
const sendForm = (overrides: Record<string, string | string[]> = {}) =>
  form({
    template_id: TEMPLATE,
    audience: "custom",
    src_mentor: "true",
    src_staff: "true",
    src_event_id: u(50),
    src_event_checkin: "checked_in",
    recipient_key: ALL_KEYS,
    confirm_count: "3",
    ...overrides
  });

function signedInAs(role: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "u1", email: "admin@vam.org", full_name: "A", role, status: "active", auth_user_id: null
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  signedInAs("admin");
  vi.mocked(getMailSeason).mockResolvedValue({ ok: true, id: SEASON, code: "UEHM-S12" });
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(getEmailTemplate).mockResolvedValue({
    row: { id: TEMPLATE, seasonId: SEASON, kind: "general_announcement", name: "Mời họp", subject: "Thông báo", body: "Chào {{ten_nguoi_nhan}}.", status: "approved" },
    error: null
  } as never);
  vi.mocked(buildCustomRecipientUniverse).mockResolvedValue({
    partition: { sendable: UNIVERSE, unreachable: [{ personId: u(99), fullName: "Không Email", reason: "Chưa có địa chỉ email hợp lệ" }] },
    error: null,
    label: "Danh sách tùy chỉnh: mentor + BTC"
  });
  vi.mocked(createCustomEmailBatch).mockResolvedValue({ batch: { id: "b1" }, error: null } as never);
  vi.mocked(runEmailBatch).mockResolvedValue({ ok: true, sent: 3, failed: 0, skipped: 0, remaining: 0, problems: [], error: null });
});

describe("cổng quyền: cùng cổng với nút gửi hàng loạt", () => {
  it.each(["core_team", "support_team", "reviewer"])("%s không xem trước, không tìm người, không gửi được", async (role) => {
    signedInAs(role);
    expect((await previewCustomListAction(initialCustomListPreviewState, sendForm())).ok).toBe(false);
    expect((await searchCustomListPeopleAction(initialCustomListSearchState, form({ q: "an" }))).ok).toBe(false);
    expect((await startCustomBulkSendAction(initialBulkMailActionState, sendForm())).ok).toBe(false);
    expect(buildCustomRecipientUniverse).not.toHaveBeenCalled();
    expect(searchCustomListPeople).not.toHaveBeenCalled();
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
  });

  it("không có phạm vi vận hành trên mùa: từ chối", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect((await startCustomBulkSendAction(initialBulkMailActionState, sendForm())).ok).toBe(false);
    expect((await previewCustomListAction(initialCustomListPreviewState, sendForm())).ok).toBe(false);
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
  });
});

describe("xem trước", () => {
  it("dựng từ đúng nguồn của form, trả về khoá + tên + email + chữ vai trò, và vọng lại chữ ký", async () => {
    const state = await previewCustomListAction(initialCustomListPreviewState, sendForm({ signature: "sig-1" }));
    expect(buildCustomRecipientUniverse).toHaveBeenCalledWith({
      seasonId: SEASON,
      spec: { mentor: true, mentee: false, staff: true, event: { eventId: u(50), coversSeries: false, checkin: "checked_in" }, addedPersonIds: [] }
    });
    expect(state).toMatchObject({ ok: true, signature: "sig-1", unreachableCount: 1 });
    expect(state.rows).toEqual([
      { key: `people:${P1}`, fullName: "An Mentor", email: "an@x.org", roleWord: "mentor" },
      { key: `event_registrations:${R1}`, fullName: "Lan Đã Đến", email: "lan@x.org", roleWord: "người tham dự" },
      { key: `admin_users:${A1}`, fullName: "Khoa BTC", email: "khoa@x.org", roleWord: "ban tổ chức" }
    ]);
  });
});

describe("gửi", () => {
  it("đủ điều kiện: chốt ĐÚNG các dòng của tập máy chủ, email lấy từ đó chứ không từ form", async () => {
    const result = await startCustomBulkSendAction(
      initialBulkMailActionState,
      sendForm({ email: "ke-gian@ngoai.com", to_email: "ke-gian@ngoai.com" })
    );
    expect(result.ok).toBe(true);
    const arg = vi.mocked(createCustomEmailBatch).mock.calls[0][0];
    expect(arg.recipients).toEqual(UNIVERSE);
    expect(arg).toMatchObject({ seasonId: SEASON, templateId: TEMPLATE, note: "Danh sách tùy chỉnh: mentor + BTC · Mời họp", actorAdminUserId: "u1" });
    expect(JSON.stringify(arg)).not.toContain("ngoai.com");
    expect(runEmailBatch).toHaveBeenCalledWith(expect.objectContaining({ batch: { id: "b1" } }));
  });

  it("bỏ tick một người: người đó không được chốt, số xác nhận là số còn lại", async () => {
    const result = await startCustomBulkSendAction(
      initialBulkMailActionState,
      sendForm({ recipient_key: [`people:${P1}`, `admin_users:${A1}`], confirm_count: "2" })
    );
    expect(result.ok).toBe(true);
    expect(vi.mocked(createCustomEmailBatch).mock.calls[0][0].recipients.map((row) => row.email)).toEqual(["an@x.org", "khoa@x.org"]);
  });

  it.each([
    ["id bịa", [...ALL_KEYS, `people:${u(777)}`], "4"],
    ["người ngoài tập ứng viên (vd. mùa khác)", [`people:${u(778)}`], "1"],
    ["email thay cho khoá", ["ke-gian@ngoai.com"], "1"],
    ["không còn ai", [], "0"]
  ])("%s: từ chối, không mở lô, không gửi", async (_label, keys, count) => {
    const result = await startCustomBulkSendAction(initialBulkMailActionState, sendForm({ recipient_key: keys, confirm_count: count }));
    expect(result.ok).toBe(false);
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it.each([["2"], ["4"], [""], ["3 người"]])("số xác nhận '%s' không khớp 3: chặn", async (typed) => {
    const result = await startCustomBulkSendAction(initialBulkMailActionState, sendForm({ confirm_count: typed }));
    expect(result.ok).toBe(false);
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
  });

  it("máy chủ không dựng được danh sách (vd. người thêm tay ngoài mùa): báo đúng lỗi, không mở lô", async () => {
    vi.mocked(buildCustomRecipientUniverse).mockResolvedValue({
      partition: { sendable: [], unreachable: [] },
      error: "1 người thêm tay không còn trong hệ thống hoặc không thuộc mùa này. Bỏ họ ra rồi xem lại danh sách.",
      label: "Danh sách tùy chỉnh"
    });
    const result = await startCustomBulkSendAction(initialBulkMailActionState, sendForm({ added_person_id: u(31) }));
    expect(result.message).toContain("không thuộc mùa này");
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
  });

  it("mẫu thư chưa duyệt: từ chối trước khi dựng danh sách", async () => {
    vi.mocked(getEmailTemplate).mockResolvedValue({
      row: { id: TEMPLATE, seasonId: SEASON, kind: "general_announcement", name: "x", subject: "x", body: "x", status: "draft" },
      error: null
    } as never);
    const result = await startCustomBulkSendAction(initialBulkMailActionState, sendForm());
    expect(result.ok).toBe(false);
    expect(buildCustomRecipientUniverse).not.toHaveBeenCalled();
  });
});

describe("nút gửi của các nhóm cũ không mở được lô custom", () => {
  it("audience=custom qua startBulkSendAction: từ chối trước khi đọc hay ghi gì", async () => {
    const result = await startBulkSendAction(initialBulkMailActionState, sendForm());
    expect(result.ok).toBe(false);
    expect(listBulkRecipients).not.toHaveBeenCalled();
    expect(createEmailBatch).not.toHaveBeenCalled();
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
  });
});
