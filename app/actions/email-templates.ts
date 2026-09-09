"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  isTemplateKind,
  validateTemplate,
  type TemplateKind
} from "@/lib/email-templates-core";
import {
  approveEmailTemplate,
  archiveEmailTemplate,
  createEmailTemplate,
  getEmailTemplate,
  getMailSeason,
  updateEmailTemplate
} from "@/lib/email-templates";
import type { EmailTemplateActionState } from "@/lib/email-template-action-types";
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

    const checked = validateTemplate({
      kind,
      name: formData.get("name"),
      subject: formData.get("subject"),
      body: formData.get("body")
    });
    if (!checked.ok) return fail(checked.message);

    const templateId = String(formData.get("template_id") ?? "").trim();

    if (!templateId) {
      const created = await createEmailTemplate({
        seasonId: auth.seasonId,
        kind,
        name: checked.name,
        subject: checked.subject,
        body: checked.body,
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

    const updated = await updateEmailTemplate({
      id: templateId,
      name: checked.name,
      subject: checked.subject,
      body: checked.body,
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
