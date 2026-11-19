"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  MAX_NAME_LENGTH,
  isTemplateKind,
  validateTemplate,
  type TemplateKind
} from "@/lib/email-templates-core";
import { VI_CHUA_AP_MIGRATION_THIET_KE, kiemMauThietKe } from "@/lib/mail-soan-thao-core";
import {
  approveEmailTemplate,
  archiveEmailTemplate,
  createEmailTemplate,
  getEmailTemplate,
  getMailSeason,
  updateEmailTemplate
} from "@/lib/email-templates";
import type { EmailTemplateActionState } from "@/lib/email-template-action-types";
import { capLinkTaiAnhThu } from "@/lib/mail-anh";
import { canApproveEmailTemplate, canComposeEmailTemplate } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";

function fail(message: string): EmailTemplateActionState {
  return { ok: false, message, templateId: null, warnings: [] };
}

/**
 * Cổng chung cho mọi thao tác ghi trên mẫu thư.
 *
 * Hai câu hỏi khác nhau, hỏi cả hai: vai trò toàn cục có được làm việc này
 * không, và người này có phạm vi trên mùa đang thao tác không. Bỏ câu thứ hai
 * là để một người được cấp quyền cho mùa khác viết thư gửi cho mùa này.
 */
async function authorize(needsApproval: boolean): Promise<
  | { ok: true; adminUserId: string; seasonId: string }
  | { ok: false; state: EmailTemplateActionState }
> {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) return { ok: false, state: fail("Bạn chưa đăng nhập.") };

  const allowed = needsApproval
    ? canApproveEmailTemplate(adminUser.role)
    : canComposeEmailTemplate(adminUser.role);
  if (!allowed) {
    return {
      ok: false,
      state: fail(
        needsApproval
          ? "Bạn không có quyền duyệt mẫu thư. Chỉ quản trị viên duyệt được."
          : "Bạn không có quyền soạn mẫu thư."
      )
    };
  }

  const season = await getMailSeason();
  if (!season.ok) return { ok: false, state: fail(season.error) };

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) return { ok: false, state: fail(scopeContext.scopeError) };
  if (!(await canOperateSeason(scopeContext, season.id))) {
    return { ok: false, state: fail("Bạn không có phạm vi vận hành trên mùa này.") };
  }

  return { ok: true, adminUserId: adminUser.id, seasonId: season.id };
}

function refresh() {
  revalidatePath("/operations/mail");
  revalidatePath("/operations/emails");
}

/**
 * Lưu một mẫu thư — tạo mới khi không có `template_id`, sửa khi có.
 *
 * Nội dung được kiểm bằng đúng hàm mà màn hình dùng để kiểm lúc gõ. Kiểm ở
 * trình duyệt là để người soạn thấy lỗi sớm; kiểm ở đây mới là thứ giữ dữ liệu,
 * vì một server action nhận được bất kỳ FormData nào gửi tới nó.
 */
export async function saveEmailTemplateAction(
  _previousState: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const auth = await authorize(false);
    if (!auth.ok) return auth.state;

    const rawKind = String(formData.get("kind") ?? "").trim();
    if (!isTemplateKind(rawKind)) return fail("Loại thư không hợp lệ.");
    const kind: TemplateKind = rawKind;

    // Chế độ thiết kế (VAM00038): HTML được LỌC Ở ĐÂY, và bản chữ thuần rút từ HTML đã lọc — không
    // tin ô `body` trình duyệt gửi kèm. Chế độ chữ thuần đi đúng đường cũ.
    const design = String(formData.get("che_do") ?? "") === "thiet_ke";
    const checked = design
      ? kiemMauThietKe({
          kind,
          name: formData.get("name"),
          subject: formData.get("subject"),
          bodyHtml: formData.get("body_html")
        })
      : validateTemplate({
          kind,
          name: formData.get("name"),
          subject: formData.get("subject"),
          body: formData.get("body")
        });
    if (!checked.ok) return fail(checked.message);
    const bodyHtml: string | null = "bodyHtml" in checked ? String(checked.bodyHtml) : null;

    const templateId = String(formData.get("template_id") ?? "").trim();

    if (!templateId) {
      const created = await createEmailTemplate({
        seasonId: auth.seasonId,
        kind,
        name: checked.name,
        subject: checked.subject,
        body: checked.body,
        ...(bodyHtml ? { bodyHtml } : {}),
        actorAdminUserId: auth.adminUserId
      });
      if (created.error || !created.id) return fail(created.error ?? "Không lưu được mẫu thư.");

      refresh();
      return {
        ok: true,
        message: "Đã tạo bản nháp. Mẫu thư cần được quản trị viên duyệt trước khi gửi.",
        templateId: created.id,
        warnings: checked.warnings
      };
    }

    // Sửa chỉ mẫu của mùa mình: id trong form là thứ người gửi tự đặt được.
    const current = await getEmailTemplate(templateId);
    if (current.error) return fail(current.error);
    if (!current.row) return fail("Không tìm thấy mẫu thư.");
    if (current.row.seasonId !== auth.seasonId) return fail("Mẫu thư này thuộc mùa khác.");

    const updated = await updateEmailTemplate({
      id: templateId,
      name: checked.name,
      subject: checked.subject,
      body: checked.body,
      // Chữ thuần: null = bỏ thiết kế nếu mẫu đang có; mẫu chữ thuần cũ thì cột không bị chạm.
      bodyHtml: design ? bodyHtml : null,
      actorAdminUserId: auth.adminUserId
    });
    if (!updated.ok) return fail(updated.error ?? "Không lưu được mẫu thư.");

    refresh();
    return {
      ok: true,
      message: updated.revoked
        ? "Đã lưu. Mẫu thư này đã được duyệt trước đó, nên nó quay lại thành bản nháp và cần duyệt lại."
        : "Đã lưu bản nháp.",
      templateId,
      warnings: checked.warnings
    };
  } catch (error) {
    console.error("[saveEmailTemplateAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/**
 * Duyệt một mẫu thư.
 *
 * Người duyệt phải gõ lại tiêu đề thư để xác nhận. Nghe phiền, và đó là chủ ý:
 * bấm duyệt là cho phép đoạn văn bản này đi tới hàng trăm hộp thư, và không có
 * đường lùi. Gõ lại tiêu đề buộc mắt phải nhìn vào thứ mình đang đồng ý.
 */
export async function approveEmailTemplateAction(
  _previousState: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const auth = await authorize(true);
    if (!auth.ok) return auth.state;

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const { row, error } = await getEmailTemplate(templateId);
    if (error) return fail(error);
    if (!row) return fail("Không tìm thấy mẫu thư.");
    if (row.seasonId !== auth.seasonId) {
      return fail("Mẫu thư này thuộc mùa khác.");
    }

    const typed = String(formData.get("confirm_subject") ?? "").replace(/\s+/g, " ").trim();
    if (typed !== row.subject) {
      return fail("Tiêu đề gõ lại chưa khớp. Vui lòng chép đúng tiêu đề của mẫu thư.");
    }

    const result = await approveEmailTemplate({
      id: templateId,
      actorAdminUserId: auth.adminUserId
    });
    if (!result.ok) return fail(result.error ?? "Không duyệt được mẫu thư.");

    refresh();
    return {
      ok: true,
      message: "Đã duyệt. Mẫu thư này giờ dùng được cho một lượt gửi hàng loạt.",
      templateId,
      warnings: []
    };
  } catch (error) {
    console.error("[approveEmailTemplateAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/** Cất một mẫu thư đi. Không xoá: nó có thể đã được dùng cho một lượt gửi. */
export async function archiveEmailTemplateAction(
  _previousState: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const auth = await authorize(true);
    if (!auth.ok) return auth.state;

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const { row, error } = await getEmailTemplate(templateId);
    if (error) return fail(error);
    if (!row) return fail("Không tìm thấy mẫu thư.");
    if (row.seasonId !== auth.seasonId) return fail("Mẫu thư này thuộc mùa khác.");

    const result = await archiveEmailTemplate({
      id: templateId,
      actorAdminUserId: auth.adminUserId
    });
    if (!result.ok) return fail(result.error ?? "Không lưu trữ được mẫu thư.");

    refresh();
    return { ok: true, message: "Đã cất mẫu thư vào lưu trữ.", templateId: null, warnings: [] };
  } catch (error) {
    console.error("[archiveEmailTemplateAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

function copyName(name: string): string {
  const suffix = " (bản sao)";
  const base = name.length + suffix.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - suffix.length).trim() : name;
  return `${base}${suffix}`;
}

/**
 * "Dùng mẫu này" (VAM00038): tạo một bản nháp MỚI chép chữ, ảnh, bố cục của mẫu đã lưu.
 *
 * Bản sao là một mẫu thư riêng: sửa nó không đụng tới mẫu gốc, và nó phải được duyệt riêng trước khi
 * gửi — người duyệt đọc đúng bức thư sẽ đi. Ảnh không bị chép: hai bản cùng trỏ tới một ảnh trong kho
 * công khai, và ảnh trong kho không bao giờ bị ghi đè (mỗi lần thay ảnh là một tệp mới).
 */
export async function copyEmailTemplateAction(
  _previousState: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const auth = await authorize(false);
    if (!auth.ok) return auth.state;

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const { row, error } = await getEmailTemplate(templateId);
    if (error) return fail(error);
    if (!row) return fail("Không tìm thấy mẫu thư.");
    if (row.seasonId !== auth.seasonId) return fail("Mẫu thư này thuộc mùa khác.");

    const base = {
      seasonId: auth.seasonId,
      kind: row.kind,
      name: copyName(row.name),
      subject: row.subject,
      body: row.body,
      ...(row.bodyHtml ? { bodyHtml: row.bodyHtml } : {}),
      actorAdminUserId: auth.adminUserId
    };
    let created = await createEmailTemplate({ ...base, sourceTemplateId: row.id });
    // Database chưa có cột mới mà mẫu là chữ thuần: vẫn chép được, chỉ không nhớ mẫu gốc.
    if (created.error === VI_CHUA_AP_MIGRATION_THIET_KE && !row.bodyHtml) created = await createEmailTemplate(base);
    if (created.error || !created.id) return fail(created.error ?? "Không tạo được thư từ mẫu.");

    refresh();
    return {
      ok: true,
      message: `Đã tạo bản nháp mới từ mẫu “${row.name}”. Sửa bản này không làm đổi mẫu gốc.`,
      templateId: created.id,
      warnings: []
    };
  } catch (error) {
    console.error("[copyEmailTemplateAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/**
 * "Cập nhật mẫu gốc" (VAM00038): chép nội dung ĐÃ LƯU của bản sao về mẫu gốc của nó.
 *
 * Chỉ chạy khi người dùng bấm nút này: lưu bản sao không bao giờ chạm tới gốc. Đọc nội dung từ
 * database chứ không từ form, để thứ chép về gốc đúng là bản đã lưu (và đã lọc). Gốc đang duyệt thì
 * rơi về bản nháp như mọi lần sửa — `updateEmailTemplate` lo việc đó và ghi nhật ký.
 */
export async function updateSourceTemplateAction(
  _previousState: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const auth = await authorize(false);
    if (!auth.ok) return auth.state;

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const copy = await getEmailTemplate(templateId);
    if (copy.error) return fail(copy.error);
    if (!copy.row) return fail("Không tìm thấy mẫu thư.");
    if (copy.row.seasonId !== auth.seasonId) return fail("Mẫu thư này thuộc mùa khác.");
    if (!copy.row.sourceTemplateId) return fail("Thư này không được tạo từ mẫu nào.");

    const source = await getEmailTemplate(copy.row.sourceTemplateId);
    if (source.error) return fail(source.error);
    if (!source.row) return fail("Mẫu gốc không còn nữa.");
    if (source.row.seasonId !== auth.seasonId) return fail("Mẫu gốc thuộc mùa khác.");

    const updated = await updateEmailTemplate({
      id: source.row.id,
      name: source.row.name,
      subject: copy.row.subject,
      body: copy.row.body,
      bodyHtml: copy.row.bodyHtml,
      fromCopyId: copy.row.id,
      actorAdminUserId: auth.adminUserId
    });
    if (!updated.ok) return fail(updated.error ?? "Không cập nhật được mẫu gốc.");

    refresh();
    return {
      ok: true,
      message: updated.revoked
        ? `Đã cập nhật mẫu gốc “${source.row.name}”. Mẫu gốc đã được duyệt trước đó nên quay về bản nháp, cần duyệt lại.`
        : `Đã cập nhật mẫu gốc “${source.row.name}”.`,
      templateId: copy.row.id,
      warnings: []
    };
  } catch (error) {
    console.error("[updateSourceTemplateAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/**
 * Cấp link tải một ảnh lên kho công khai 'mail-anh' để chèn vào thân thư (VAM00038).
 *
 * Cùng cổng với việc soạn mẫu thư: ai soạn được thư thì chèn được ảnh, trên mùa mình vận hành. Máy chủ
 * không nhận byte ảnh: trình duyệt PUT thẳng lên link ký sẵn, rồi chèn địa chỉ công khai vào thư.
 */
export async function requestMailImageUploadAction(input: {
  name: string;
  size: number;
  mime: string;
}): Promise<{ ok: true; signedUrl: string; publicUrl: string } | { ok: false; message: string }> {
  try {
    const auth = await authorize(false);
    if (!auth.ok) return { ok: false, message: auth.state.message ?? "Không có quyền." };
    const link = await capLinkTaiAnhThu({
      seasonId: auth.seasonId,
      file: { name: String(input?.name ?? ""), size: Number(input?.size), mime: String(input?.mime ?? "") }
    });
    if (!link.ok) return link;
    return { ok: true, signedUrl: link.signedUrl, publicUrl: link.publicUrl };
  } catch (error) {
    console.error("[requestMailImageUploadAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}
