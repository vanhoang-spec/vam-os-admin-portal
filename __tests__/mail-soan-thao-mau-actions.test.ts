/**
 * VAM00038 — mẫu thư thiết kế ở tầng server action: lưu (lọc ở máy chủ), dùng mẫu (bản sao mới, gốc
 * không đổi), cập nhật mẫu gốc (chỉ khi bấm), cấp link tải ảnh. Kho mẫu là bản giả; khẳng định chính
 * các lệnh ghi được phát ra — và các lệnh KHÔNG được phát ra.
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
vi.mock("@/lib/mail-anh", () => ({ capLinkTaiAnhThu: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { createEmailTemplate, getEmailTemplate, getMailSeason, updateEmailTemplate } from "@/lib/email-templates";
import { capLinkTaiAnhThu } from "@/lib/mail-anh";
import {
  copyEmailTemplateAction,
  requestMailImageUploadAction,
  saveEmailTemplateAction,
  updateSourceTemplateAction
} from "@/app/actions/email-templates";
import { initialEmailTemplateActionState as INITIAL } from "@/lib/email-template-action-types";
import { VI_CHUA_AP_MIGRATION_THIET_KE } from "@/lib/mail-soan-thao-core";

const SEASON_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_SEASON = "00000000-0000-4000-8000-0000000000bb";
const ORIGINAL_ID = "00000000-0000-4000-8000-0000000000c1";
const COPY_ID = "00000000-0000-4000-8000-0000000000c2";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000dd";

const RICH = '<p>Chào <strong>{{ten_nguoi_nhan}}</strong></p><div data-vam-anh=""><img src="https://kho.test/a.png" width="300" data-align="center"></div>';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ORIGINAL_ID,
    seasonId: SEASON_ID,
    kind: "general_announcement",
    name: "Thư mời sự kiện",
    subject: "Thông báo {{mua}}",
    body: "Chào {{ten_nguoi_nhan}}",
    bodyHtml: RICH,
    sourceTemplateId: null,
    status: "approved",
    createdBy: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: "",
    updatedAt: "",
    approverName: null,
    ...overrides
  };
}

function stored(rows: Array<ReturnType<typeof row>>) {
  vi.mocked(getEmailTemplate).mockImplementation(async (id: string) => ({
    row: (rows.find((candidate) => candidate.id === id) ?? null) as never,
    error: null
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ADMIN_ID, email: "a@vam.test", role: "core_team", status: "active" } as never);
  vi.mocked(getMailSeason).mockResolvedValue({ ok: true, id: SEASON_ID, code: "UEHM-S12" });
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(createEmailTemplate).mockResolvedValue({ id: COPY_ID, error: null });
  vi.mocked(updateEmailTemplate).mockResolvedValue({ ok: true, revoked: false, error: null });
  stored([row()]);
});

describe("lưu mẫu thiết kế", () => {
  it("lọc HTML ở máy chủ và rút bản chữ từ HTML đã lọc, không tin ô body của form", async () => {
    const result = await saveEmailTemplateAction(
      INITIAL,
      form({
        kind: "general_announcement",
        che_do: "thiet_ke",
        name: "Thư thiết kế",
        subject: "Thông báo {{mua}}",
        body_html: `${RICH}<script>alert(1)</script><p onclick="x()">Hết</p>`,
        body: "CHỮ GIẢ KHÔNG DÙNG"
      })
    );
    expect(result.ok).toBe(true);
    const input = vi.mocked(createEmailTemplate).mock.calls[0][0];
    expect(input.bodyHtml).toContain("<strong>{{ten_nguoi_nhan}}</strong>");
    expect(input.bodyHtml).not.toMatch(/script|onclick/);
    expect(input.body).toBe("Chào {{ten_nguoi_nhan}}\n\nHết");
  });

  it("từ chối HTML có ô điền lạ, không ghi gì", async () => {
    const result = await saveEmailTemplateAction(
      INITIAL,
      form({ kind: "general_announcement", che_do: "thiet_ke", name: "X", subject: "Y", body_html: "<p>{{so_dien_thoai}}</p>" })
    );
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
    expect(updateEmailTemplate).not.toHaveBeenCalled();
  });

  it("mẫu chữ thuần mới đi đúng đường cũ: không mang bodyHtml", async () => {
    await saveEmailTemplateAction(
      INITIAL,
      form({ kind: "general_announcement", name: "X", subject: "Thông báo {{mua}}", body: "Chào {{ten_nguoi_nhan}}" })
    );
    expect(vi.mocked(createEmailTemplate).mock.calls[0][0]).not.toHaveProperty("bodyHtml");
  });

  it("sửa một mẫu ở chế độ chữ thuần gửi bodyHtml null (bỏ thiết kế nếu có)", async () => {
    await saveEmailTemplateAction(
      INITIAL,
      form({ kind: "general_announcement", template_id: ORIGINAL_ID, name: "X", subject: "Thông báo {{mua}}", body: "Chào {{ten_nguoi_nhan}}" })
    );
    expect(vi.mocked(updateEmailTemplate).mock.calls[0][0]).toMatchObject({ id: ORIGINAL_ID, bodyHtml: null });
  });

  it("không sửa được mẫu của mùa khác", async () => {
    stored([row({ seasonId: OTHER_SEASON })]);
    const result = await saveEmailTemplateAction(
      INITIAL,
      form({ kind: "general_announcement", template_id: ORIGINAL_ID, che_do: "thiet_ke", name: "X", subject: "Y", body_html: RICH })
    );
    expect(result.ok).toBe(false);
    expect(updateEmailTemplate).not.toHaveBeenCalled();
  });
});

describe("dùng mẫu đã lưu — mẫu gốc không đổi", () => {
  it("tạo bản nháp MỚI chép chữ, ảnh, bố cục và nhớ mẫu gốc; không ghi gì lên gốc", async () => {
    const result = await copyEmailTemplateAction(INITIAL, form({ template_id: ORIGINAL_ID }));
    expect(result).toMatchObject({ ok: true, templateId: COPY_ID });
    expect(createEmailTemplate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createEmailTemplate).mock.calls[0][0]).toMatchObject({
      seasonId: SEASON_ID,
      name: "Thư mời sự kiện (bản sao)",
      subject: "Thông báo {{mua}}",
      body: "Chào {{ten_nguoi_nhan}}",
      bodyHtml: RICH,
      sourceTemplateId: ORIGINAL_ID
    });
    expect(updateEmailTemplate).not.toHaveBeenCalled();
  });

  it("sửa bản sao chỉ ghi lên bản sao", async () => {
    stored([row(), row({ id: COPY_ID, sourceTemplateId: ORIGINAL_ID, status: "draft" })]);
    await saveEmailTemplateAction(
      INITIAL,
      form({ kind: "general_announcement", template_id: COPY_ID, che_do: "thiet_ke", name: "Bản sao", subject: "Mới {{mua}}", body_html: "<p>Chào {{ten_nguoi_nhan}}, nội dung mới</p>" })
    );
    expect(updateEmailTemplate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateEmailTemplate).mock.calls[0][0].id).toBe(COPY_ID);
  });

  it("không chép được mẫu của mùa khác", async () => {
    stored([row({ seasonId: OTHER_SEASON })]);
    const result = await copyEmailTemplateAction(INITIAL, form({ template_id: ORIGINAL_ID }));
    expect(result.ok).toBe(false);
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("database chưa có cột mới: mẫu chữ thuần vẫn chép được (không nhớ gốc); mẫu thiết kế thì báo rõ", async () => {
    stored([row({ bodyHtml: null })]);
    vi.mocked(createEmailTemplate)
      .mockResolvedValueOnce({ id: null, error: VI_CHUA_AP_MIGRATION_THIET_KE })
      .mockResolvedValueOnce({ id: COPY_ID, error: null });
    const plain = await copyEmailTemplateAction(INITIAL, form({ template_id: ORIGINAL_ID }));
    expect(plain.ok).toBe(true);
    expect(vi.mocked(createEmailTemplate).mock.calls[1][0]).not.toHaveProperty("sourceTemplateId");

    vi.mocked(createEmailTemplate).mockReset();
    vi.mocked(createEmailTemplate).mockResolvedValue({ id: null, error: VI_CHUA_AP_MIGRATION_THIET_KE });
    stored([row()]);
    const rich = await copyEmailTemplateAction(INITIAL, form({ template_id: ORIGINAL_ID }));
    expect(rich).toMatchObject({ ok: false, message: VI_CHUA_AP_MIGRATION_THIET_KE });
    expect(createEmailTemplate).toHaveBeenCalledTimes(1);
  });
});

describe("cập nhật mẫu gốc — chỉ khi chủ động bấm", () => {
  const copy = row({ id: COPY_ID, sourceTemplateId: ORIGINAL_ID, subject: "Bản mới {{mua}}", body: "Mới", bodyHtml: "<p>Mới</p>", status: "draft" });

  it("chép nội dung ĐÃ LƯU của bản sao về gốc (giữ tên gốc), báo cần duyệt lại", async () => {
    stored([row(), copy]);
    vi.mocked(updateEmailTemplate).mockResolvedValue({ ok: true, revoked: true, error: null });
    const result = await updateSourceTemplateAction(INITIAL, form({ template_id: COPY_ID }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("duyệt lại");
    expect(updateEmailTemplate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateEmailTemplate).mock.calls[0][0]).toMatchObject({
      id: ORIGINAL_ID,
      name: "Thư mời sự kiện",
      subject: "Bản mới {{mua}}",
      body: "Mới",
      bodyHtml: "<p>Mới</p>",
      fromCopyId: COPY_ID
    });
    expect(createEmailTemplate).not.toHaveBeenCalled();
  });

  it("thư không tạo từ mẫu nào thì không ghi gì", async () => {
    const result = await updateSourceTemplateAction(INITIAL, form({ template_id: ORIGINAL_ID }));
    expect(result.ok).toBe(false);
    expect(updateEmailTemplate).not.toHaveBeenCalled();
  });

  it("mẫu gốc thuộc mùa khác hoặc không còn thì không ghi gì", async () => {
    stored([row({ seasonId: OTHER_SEASON }), copy]);
    expect((await updateSourceTemplateAction(INITIAL, form({ template_id: COPY_ID }))).ok).toBe(false);
    stored([copy]);
    expect((await updateSourceTemplateAction(INITIAL, form({ template_id: COPY_ID }))).ok).toBe(false);
    expect(updateEmailTemplate).not.toHaveBeenCalled();
  });
});

describe("cấp link tải ảnh", () => {
  it("người soạn được thư thì được cấp link, theo mùa đang vận hành", async () => {
    vi.mocked(capLinkTaiAnhThu).mockResolvedValue({ ok: true, path: "p", signedUrl: "https://kho.test/up", publicUrl: "https://kho.test/pub" });
    const result = await requestMailImageUploadAction({ name: "a.png", size: 10, mime: "image/png" });
    expect(result).toEqual({ ok: true, signedUrl: "https://kho.test/up", publicUrl: "https://kho.test/pub" });
    expect(vi.mocked(capLinkTaiAnhThu).mock.calls[0][0]).toEqual({ seasonId: SEASON_ID, file: { name: "a.png", size: 10, mime: "image/png" } });
  });

  it("vai trò không soạn được thư, hoặc không có phạm vi mùa, thì không cấp", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ADMIN_ID, role: "viewer", status: "active" } as never);
    expect((await requestMailImageUploadAction({ name: "a.png", size: 10, mime: "image/png" })).ok).toBe(false);
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ADMIN_ID, role: "core_team", status: "active" } as never);
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect((await requestMailImageUploadAction({ name: "a.png", size: 10, mime: "image/png" })).ok).toBe(false);
    expect(capLinkTaiAnhThu).not.toHaveBeenCalled();
  });
});
