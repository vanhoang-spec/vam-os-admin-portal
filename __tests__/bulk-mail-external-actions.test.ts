/**
 * Lệnh của Danh sách tùy chỉnh khi có email ngoài VAM (VAM00027): xem trước, gửi, đọc file Excel.
 *
 * Phần dựng danh sách VAM (lib/bulk-mail) và bộ đọc byte (lib/ai/uploads) được giả; lib/bulk-mail-core,
 * lib/bulk-mail-custom-core, lib/bulk-mail-external-core là hàng thật. Canh điều lệnh làm:
 *   - người ngoài được gộp với người VAM, bỏ trùng giữa các nguồn, email sai được báo;
 *   - lệnh gửi đọc lại chữ form mang theo; khoá `external:` lạ, thiếu ô xác nhận người ngoài, hay người
 *     ngoài trống tên với mẫu có ô tên → KHÔNG mở lô;
 *   - danh sách chốt vào lô đúng là danh sách đã xem; người ngoài không mang id/mã của ai;
 *   - cùng cổng quyền với nút gửi cũ (kể cả lệnh đọc file).
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
vi.mock("@/lib/ai/uploads", () => ({ readEmailListXlsx: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getEmailTemplate, getMailSeason } from "@/lib/email-templates";
import { buildCustomRecipientUniverse, createCustomEmailBatch, runEmailBatch } from "@/lib/bulk-mail";
import { readEmailListXlsx } from "@/lib/ai/uploads";
import {
  previewCustomListAction,
  readExternalEmailFileAction,
  startCustomBulkSendAction
} from "@/app/actions/bulk-mail";
import {
  initialBulkMailActionState,
  initialCustomListPreviewState,
  initialExternalFileState
} from "@/lib/bulk-mail-action-types";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEASON = u(1);
const TEMPLATE = u(2);
const P1 = u(11);

const VAM = [{ personId: P1, fullName: "An Mentor", email: "an@x.org", role: "mentor" as const, relationTable: "people" as const }];
const EXTERNAL_TEXT = ["khach@y.vn, Khách Mời", "AN@x.org, Tên Excel Khác", "sai@congty", "binh@z.vn"].join("\n");

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
  return data;
}

const KEYS = [`people:${P1}`, "external:khach@y.vn", "external:binh@z.vn"];
const sendForm = (overrides: Record<string, string | string[]> = {}) =>
  form({
    template_id: TEMPLATE,
    audience: "custom",
    src_mentor: "true",
    external_recipients: EXTERNAL_TEXT,
    recipient_key: KEYS,
    confirm_count: "3",
    confirm_external: "2",
    ...overrides
  });

function template(body: string) {
  vi.mocked(getEmailTemplate).mockResolvedValue({
    row: { id: TEMPLATE, seasonId: SEASON, kind: "general_announcement", name: "Mời", subject: "Thông báo {{mua}}", body, status: "approved" },
    error: null
  } as never);
}

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
  template("Chào bạn, thư mùa {{mua}}.");
  vi.mocked(buildCustomRecipientUniverse).mockResolvedValue({
    partition: { sendable: VAM, unreachable: [] },
    error: null,
    label: "Danh sách tùy chỉnh: mentor"
  });
  vi.mocked(createCustomEmailBatch).mockResolvedValue({ batch: { id: "b1" }, error: null } as never);
  vi.mocked(runEmailBatch).mockResolvedValue({ ok: true, sent: 3, failed: 0, skipped: 0, remaining: 0, problems: [], error: null });
});

describe("xem trước", () => {
  it("gộp người VAM và người ngoài; trùng email với VAM thì theo VAM; email sai được báo", async () => {
    const state = await previewCustomListAction(
      initialCustomListPreviewState,
      form({ src_mentor: "true", external_recipients: EXTERNAL_TEXT, template_id: TEMPLATE, signature: "s" })
    );
    expect(state.ok).toBe(true);
    expect(state.rows).toEqual([
      { key: `people:${P1}`, fullName: "An Mentor", email: "an@x.org", roleWord: "mentor" },
      { key: "external:khach@y.vn", fullName: "Khách Mời", email: "khach@y.vn", roleWord: "khách mời", external: true },
      { key: "external:binh@z.vn", fullName: "", email: "binh@z.vn", roleWord: "khách mời", external: true }
    ]);
    expect(state.external).toEqual({
      count: 2,
      problems: ["Dòng 3: “sai@congty” không phải email hợp lệ"],
      invalidCount: 1,
      duplicates: 0,
      overlap: 1,
      nameless: 1
    });
    expect(state.nameRequired).toBe(false);
    expect(state.label).toBe("Danh sách tùy chỉnh: mentor + 2 email ngoài VAM");
  });

  it("mẫu có ô tên → nameRequired; không đọc được mẫu → coi như có (fail-closed)", async () => {
    template("Chào {{ten_nguoi_nhan}},");
    const withName = await previewCustomListAction(initialCustomListPreviewState, form({ external_recipients: "a@y.vn", template_id: TEMPLATE }));
    expect(withName.nameRequired).toBe(true);
    vi.mocked(getEmailTemplate).mockResolvedValue({ row: null, error: "boom" } as never);
    const unknown = await previewCustomListAction(initialCustomListPreviewState, form({ external_recipients: "a@y.vn", template_id: TEMPLATE }));
    expect(unknown.nameRequired).toBe(true);
  });

  it("chỉ có email ngoài cũng xem trước được; không có người ngoài thì không đọc mẫu thư (luồng cũ không đổi)", async () => {
    vi.mocked(buildCustomRecipientUniverse).mockResolvedValue({ partition: { sendable: [], unreachable: [] }, error: null, label: "Danh sách tùy chỉnh" });
    const onlyExternal = await previewCustomListAction(initialCustomListPreviewState, form({ external_recipients: "a@y.vn" }));
    expect(onlyExternal.rows.map((row) => row.key)).toEqual(["external:a@y.vn"]);
    vi.mocked(getEmailTemplate).mockClear();
    vi.mocked(buildCustomRecipientUniverse).mockResolvedValue({ partition: { sendable: VAM, unreachable: [] }, error: null, label: "x" });
    const vamOnly = await previewCustomListAction(initialCustomListPreviewState, form({ src_mentor: "true", template_id: TEMPLATE }));
    expect(vamOnly.external).toBeNull();
    expect(vamOnly.rows).toEqual([{ key: `people:${P1}`, fullName: "An Mentor", email: "an@x.org", roleWord: "mentor" }]);
    expect(getEmailTemplate).not.toHaveBeenCalled();
  });

  it("quá trần người ngoài một lô: báo lỗi, không dựng danh sách", async () => {
    const lines = Array.from({ length: 301 }, (_, index) => `k${index}@y.vn`).join("\n");
    const state = await previewCustomListAction(initialCustomListPreviewState, form({ external_recipients: lines }));
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/tối đa 300/);
    expect(buildCustomRecipientUniverse).not.toHaveBeenCalled();
  });
});

describe("gửi", () => {
  it("chốt đúng danh sách đã xem: người VAM theo hồ sơ, người ngoài theo chữ, không id, không mã", async () => {
    const state = await startCustomBulkSendAction(initialBulkMailActionState, sendForm());
    expect(state.ok).toBe(true);
    const call = vi.mocked(createCustomEmailBatch).mock.calls[0][0];
    expect(call.recipients).toEqual([
      VAM[0],
      { personId: "", fullName: "Khách Mời", email: "khach@y.vn", role: "external", relationTable: "external" },
      { personId: "", fullName: "", email: "binh@z.vn", role: "external", relationTable: "external" }
    ]);
    expect(call.note).toBe("Danh sách tùy chỉnh: mentor + 2 email ngoài VAM · Mời");
  });

  it("bỏ tick một người ngoài: chỉ chốt người còn tick, số xác nhận theo đó", async () => {
    const state = await startCustomBulkSendAction(
      initialBulkMailActionState,
      sendForm({ recipient_key: [`people:${P1}`, "external:khach@y.vn"], confirm_count: "2", confirm_external: "1" })
    );
    expect(state.ok).toBe(true);
    expect(vi.mocked(createCustomEmailBatch).mock.calls[0][0].recipients.map((row) => row.email)).toEqual(["an@x.org", "khach@y.vn"]);
  });

  it.each([
    ["khoá external không có trong chữ form mang theo", { recipient_key: [...KEYS, "external:la@q.vn"], confirm_count: "4" }],
    ["khoá external của email đã trùng người VAM", { recipient_key: [...KEYS, "external:an@x.org"], confirm_count: "4" }],
    ["chữ người ngoài bị bỏ khỏi form gửi", { external_recipients: "" }],
    ["thiếu ô xác nhận người ngoài", { confirm_external: "" }],
    ["ô xác nhận người ngoài sai số", { confirm_external: "3" }],
    ["số xác nhận tổng sai", { confirm_count: "2" }]
  ])("%s → không mở lô", async (_label, overrides) => {
    const state = await startCustomBulkSendAction(initialBulkMailActionState, sendForm(overrides as Record<string, string | string[]>));
    expect(state.ok).toBe(false);
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("người ngoài trống tên mà mẫu thư dùng {{ten_nguoi_nhan}} → từ chối cả lượt, nói rõ email nào", async () => {
    template("Chào {{ten_nguoi_nhan}},");
    const state = await startCustomBulkSendAction(initialBulkMailActionState, sendForm());
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/1 email ngoài VAM chưa có tên \(vd\. binh@z\.vn\)/);
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
    // Bỏ tick người trống tên thì gửi được.
    const fixed = await startCustomBulkSendAction(
      initialBulkMailActionState,
      sendForm({ recipient_key: [`people:${P1}`, "external:khach@y.vn"], confirm_count: "2", confirm_external: "1" })
    );
    expect(fixed.ok).toBe(true);
  });

  it("lô không có người ngoài không cần ô xác nhận người ngoài (luồng VAM00026 không đổi)", async () => {
    const state = await startCustomBulkSendAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, audience: "custom", src_mentor: "true", recipient_key: [`people:${P1}`], confirm_count: "1" })
    );
    expect(state.ok).toBe(true);
    expect(vi.mocked(createCustomEmailBatch).mock.calls[0][0].recipients).toEqual(VAM);
  });
});

describe("đọc file Excel", () => {
  const fileForm = () => form({});

  it("trả về chữ email<TAB>tên, dòng lỗi theo số dòng Excel; không ghi, không gửi", async () => {
    vi.mocked(readEmailListXlsx).mockResolvedValue({
      ok: true,
      name: "khach.xlsx",
      table: ["1\tHọ tên\tEmail", "2\tKhách Một\tmot@y.vn", "3\t\thai@y.vn", "4\tBa\tba@sai", "5\tMột Lần Nữa\tMOT@y.vn"].join("\n")
    });
    const state = await readExternalEmailFileAction(initialExternalFileState, fileForm());
    expect(readEmailListXlsx).toHaveBeenCalledWith(expect.any(FormData), "external_file");
    expect(state).toMatchObject({
      ok: true,
      fileName: "khach.xlsx",
      text: "mot@y.vn\tKhách Một\nhai@y.vn",
      count: 2,
      nameless: 1,
      invalidCount: 1,
      duplicates: 1,
      problems: ["Dòng 4: “ba@sai” không phải email hợp lệ"]
    });
    expect(state.token).toBeTruthy();
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("file bị bộ đọc từ chối: chuyển nguyên lời báo", async () => {
    vi.mocked(readEmailListXlsx).mockResolvedValue({ ok: false, message: "khach.xlsx (quá 2MB)" });
    const state = await readExternalEmailFileAction(initialExternalFileState, fileForm());
    expect(state).toMatchObject({ ok: false, message: "khach.xlsx (quá 2MB)", text: "" });
  });

  it("file không có email hợp lệ nào: báo, kèm dòng lỗi", async () => {
    vi.mocked(readEmailListXlsx).mockResolvedValue({ ok: true, name: "k.xlsx", table: "1\tEmail\n2\tsai@" });
    const state = await readExternalEmailFileAction(initialExternalFileState, fileForm());
    expect(state.ok).toBe(false);
    expect(state.problems).toHaveLength(1);
  });
});

describe("cổng quyền: giống nút gửi hàng loạt", () => {
  it.each(["core_team", "support_team", "reviewer"])("%s không đọc file, không xem trước, không gửi người ngoài", async (role) => {
    signedInAs(role);
    expect((await readExternalEmailFileAction(initialExternalFileState, form({}))).ok).toBe(false);
    expect((await previewCustomListAction(initialCustomListPreviewState, form({ external_recipients: "a@y.vn" }))).ok).toBe(false);
    expect((await startCustomBulkSendAction(initialBulkMailActionState, sendForm())).ok).toBe(false);
    expect(readEmailListXlsx).not.toHaveBeenCalled();
    expect(buildCustomRecipientUniverse).not.toHaveBeenCalled();
    expect(createCustomEmailBatch).not.toHaveBeenCalled();
  });

  it("thiếu phạm vi vận hành mùa thì cũng không đọc file", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect((await readExternalEmailFileAction(initialExternalFileState, form({}))).ok).toBe(false);
    expect(readEmailListXlsx).not.toHaveBeenCalled();
  });
});
