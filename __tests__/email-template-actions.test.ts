/**
 * Các thao tác trên mẫu thư — cổng quyền và những gì chúng từ chối.
 *
 * Đây là tầng duy nhất đứng giữa một FormData bất kỳ và kho mẫu thư. Màn hình
 * có kiểm lúc gõ, nhưng màn hình không phải hàng rào: một server action nhận
 * được bất kỳ thứ gì gửi tới nó.
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
  getEmailTemplate: vi.fn(),
  createEmailTemplate: vi.fn(),
  updateEmailTemplate: vi.fn(),
  approveEmailTemplate: vi.fn(),
  archiveEmailTemplate: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  approveEmailTemplate,
  archiveEmailTemplate,
  createEmailTemplate,
  getEmailTemplate,
  getMailSeason,
  updateEmailTemplate
} from "@/lib/email-templates";
import {
  approveEmailTemplateAction,
  archiveEmailTemplateAction,
  saveEmailTemplateAction
} from "@/app/actions/email-templates";
import { initialEmailTemplateActionState } from "@/lib/email-template-action-types";

const SEASON_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_SEASON_ID = "00000000-0000-4000-8000-0000000000bb";
const TEMPLATE_ID = "00000000-0000-4000-8000-0000000000cc";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000dd";

const VALID_BODY = "Chào {{ten_nguoi_nhan}},\n\nBan tổ chức xin thông báo lịch mới.";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function saveForm(overrides: Record<string, string> = {}) {
  return form({
    kind: "general_announcement",
    name: "Nhắc hạn nộp hồ sơ",
    subject: "Thông báo {{mua}}",
    body: VALID_BODY,
    ...overrides
  });
}

function signedInAs(role: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: ADMIN_ID,
    email: "a@vam.org",
    full_name: "A",
    role,
    status: "active",
    auth_user_id: null
  } as never);
}

function storedTemplate(overrides: Record<string, unknown> = {}) {
  return {
    row: {
      id: TEMPLATE_ID,
      seasonId: SEASON_ID,
      kind: "general_announcement",
      name: "Nhắc hạn nộp hồ sơ",
      subject: "Thông báo UEHM-S12",
      body: VALID_BODY,
      status: "draft",
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

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs("core_team");
  vi.mocked(getMailSeason).mockResolvedValue({ ok: true, id: SEASON_ID, code: "UEHM-S12" });
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(createEmailTemplate).mockResolvedValue({ id: TEMPLATE_ID, error: null });
  vi.mocked(updateEmailTemplate).mockResolvedValue({ ok: true, revoked: false, error: null });
  vi.mocked(approveEmailTemplate).mockResolvedValue({ ok: true, error: null });
  vi.mocked(archiveEmailTemplate).mockResolvedValue({ ok: true, error: null });
  vi.mocked(getEmailTemplate).mockResolvedValue(storedTemplate() as never);
});

describe("saveEmailTemplateAction — ai được soạn", () => {
  it("từ chối người chưa đăng nhập", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    const result = await saveEmailTemplateAction(initialEmailTemplateActionState, saveForm());
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it.each(["viewer", "reviewer"])("từ chối vai trò %s", async (role) => {
    signedInAs(role);
    const result = await saveEmailTemplateAction(initialEmailTemplateActionState, saveForm());
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it.each(["support_team", "core_team", "admin", "super_admin"])(
    "cho phép vai trò %s soạn bản nháp",
    async (role) => {
      signedInAs(role);
      const result = await saveEmailTemplateAction(initialEmailTemplateActionState, saveForm());
      expect(result.ok).toBe(true);
      expect(createEmailTemplate).toHaveBeenCalledTimes(1);
    }
  );

  it("từ chối khi không có phạm vi trên mùa đang thao tác", async () => {
    // Vai trò đúng nhưng được cấp cho mùa khác: bỏ câu hỏi này là để người ta
    // viết thư gửi cho mùa mình không phụ trách.
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const result = await saveEmailTemplateAction(initialEmailTemplateActionState, saveForm());
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("dừng lại khi không đọc được phạm vi, thay vì coi như không có quyền", async () => {
    vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: "Lỗi hệ thống." } as never);
    const result = await saveEmailTemplateAction(initialEmailTemplateActionState, saveForm());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Lỗi hệ thống");
  });
});

describe("saveEmailTemplateAction — kiểm lại nội dung ở máy chủ", () => {
  it("từ chối loại thư không có trong danh mục", async () => {
    const result = await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ kind: "mentee_selected" })
    );
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("từ chối ô điền không có trong danh mục, kể cả khi màn hình đã cho qua", async () => {
    const result = await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ body: "Chào {{so_dien_thoai}}" })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("{{so_dien_thoai}}");
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("từ chối thẻ HTML gửi thẳng lên bỏ qua màn hình", async () => {
    const result = await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ body: '<a href="http://kia.example">bấm đây</a>' })
    );
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("từ chối thư trống", async () => {
    const result = await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ body: "   " })
    );
    expect(result.ok).toBe(false);
  });

  it("lưu bản đã chuẩn hoá, không lưu nguyên chuỗi thô", async () => {
    await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ subject: "  Thông báo\n{{mua}}  ", name: "  Tên   có   khoảng trắng  " })
    );
    expect(createEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Thông báo {{mua}}",
        name: "Tên có khoảng trắng",
        seasonId: SEASON_ID
      })
    );
  });

  it("trả lời kèm lời nhắc khi thư chưa dùng một ô nên dùng", async () => {
    const result = await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ body: "Ban tổ chức xin thông báo {{mua}}." })
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toContain("ten_nguoi_nhan");
  });
});

describe("saveEmailTemplateAction — sửa một mẫu đã có", () => {
  it("gọi đường sửa khi có template_id, không tạo bản mới", async () => {
    await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ template_id: TEMPLATE_ID })
    );
    expect(updateEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEMPLATE_ID })
    );
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("nói rõ khi bản sửa làm mất dấu duyệt", async () => {
    // Người soạn phải biết ngay rằng thư này không còn gửi được cho tới khi có
    // người duyệt lại — chứ không phát hiện lúc lượt gửi báo không có mẫu.
    vi.mocked(updateEmailTemplate).mockResolvedValue({ ok: true, revoked: true, error: null });
    const result = await saveEmailTemplateAction(
      initialEmailTemplateActionState,
      saveForm({ template_id: TEMPLATE_ID })
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("duyệt lại");
  });
});

describe("approveEmailTemplateAction", () => {
  beforeEach(() => signedInAs("admin"));

  it.each(["support_team", "core_team"])("không cho vai trò %s duyệt", async (role) => {
    signedInAs(role);
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID, confirm_subject: "Thông báo UEHM-S12" })
    );
    expect(result.ok).toBe(false);
    expect(approveEmailTemplate).not.toHaveBeenCalled();
  });

  it("duyệt được khi tiêu đề gõ lại khớp", async () => {
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID, confirm_subject: "Thông báo UEHM-S12" })
    );
    expect(result.ok).toBe(true);
    expect(approveEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEMPLATE_ID })
    );
  });

  it("từ chối khi tiêu đề gõ lại không khớp", async () => {
    // Đây là bước duy nhất buộc mắt người duyệt nhìn vào đúng bản họ đang cho
    // phép gửi đi. Bỏ nó thì "duyệt" chỉ còn là một cú bấm.
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID, confirm_subject: "Thông báo gì đó" })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa khớp");
    expect(approveEmailTemplate).not.toHaveBeenCalled();
  });

  it("bỏ qua khác biệt khoảng trắng khi so tiêu đề", async () => {
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID, confirm_subject: "  Thông báo   UEHM-S12 " })
    );
    expect(result.ok).toBe(true);
  });

  it("từ chối mẫu thư thuộc mùa khác", async () => {
    vi.mocked(getEmailTemplate).mockResolvedValue(
      storedTemplate({ seasonId: OTHER_SEASON_ID }) as never
    );
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID, confirm_subject: "Thông báo UEHM-S12" })
    );
    expect(result.ok).toBe(false);
    expect(approveEmailTemplate).not.toHaveBeenCalled();
  });

  it("từ chối khi không tìm thấy mẫu thư", async () => {
    vi.mocked(getEmailTemplate).mockResolvedValue({ row: null, error: null } as never);
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID, confirm_subject: "Thông báo UEHM-S12" })
    );
    expect(result.ok).toBe(false);
    expect(approveEmailTemplate).not.toHaveBeenCalled();
  });

  it("từ chối khi chưa chọn mẫu thư nào", async () => {
    const result = await approveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ confirm_subject: "Thông báo UEHM-S12" })
    );
    expect(result.ok).toBe(false);
    expect(getEmailTemplate).not.toHaveBeenCalled();
  });
});

describe("archiveEmailTemplateAction", () => {
  it("chỉ vai trò duyệt được mới cất mẫu thư đi", async () => {
    signedInAs("core_team");
    const denied = await archiveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID })
    );
    expect(denied.ok).toBe(false);
    expect(archiveEmailTemplate).not.toHaveBeenCalled();

    signedInAs("admin");
    const allowed = await archiveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID })
    );
    expect(allowed.ok).toBe(true);
    expect(archiveEmailTemplate).toHaveBeenCalledTimes(1);
  });

  it("từ chối mẫu thư thuộc mùa khác", async () => {
    signedInAs("admin");
    vi.mocked(getEmailTemplate).mockResolvedValue(
      storedTemplate({ seasonId: OTHER_SEASON_ID }) as never
    );
    const result = await archiveEmailTemplateAction(
      initialEmailTemplateActionState,
      form({ template_id: TEMPLATE_ID })
    );
    expect(result.ok).toBe(false);
    expect(archiveEmailTemplate).not.toHaveBeenCalled();
  });
});
