"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  BULK_AUDIENCE_LABELS,
  confirmBulkSend,
  describeRunResult,
  isBulkAudience,
  type BulkAudience
} from "@/lib/bulk-mail-core";
import {
  createEmailBatch,
  listBulkRecipients,
  listEmailBatches,
  runEmailBatch
} from "@/lib/bulk-mail";
import type { BulkMailActionState } from "@/lib/bulk-mail-action-types";
import { getEmailTemplate, getMailSeason } from "@/lib/email-templates";
import { renderTemplate, sampleValues } from "@/lib/email-templates-core";
import { sendTemplatedEmail } from "@/lib/email";
import { canSendBulkEmail } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";

function fail(message: string): BulkMailActionState {
  return { ok: false, message, batchId: null, problems: [] };
}

async function authorize(): Promise<
  | { ok: true; adminUserId: string; adminEmail: string; seasonId: string; seasonCode: string }
  | { ok: false; state: BulkMailActionState }
> {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) return { ok: false, state: fail("Bạn chưa đăng nhập.") };
  if (!canSendBulkEmail(adminUser.role)) {
    return {
      ok: false,
      state: fail("Bạn không có quyền gửi thư hàng loạt. Chỉ quản trị viên gửi được.")
    };
  }

  const season = await getMailSeason();
  if (!season.ok) return { ok: false, state: fail(season.error) };

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) return { ok: false, state: fail(scopeContext.scopeError) };
  if (!(await canOperateSeason(scopeContext, season.id))) {
    return { ok: false, state: fail("Bạn không có phạm vi vận hành trên mùa này.") };
  }

  return {
    ok: true,
    adminUserId: adminUser.id,
    adminEmail: String(adminUser.email ?? ""),
    seasonId: season.id,
    seasonCode: season.code
  };
}

function refresh() {
  revalidatePath("/operations/mail");
  revalidatePath("/operations/emails");
}

/**
 * Gửi một bản thử cho chính người đang bấm.
 *
 * Bước này có mặt vì xem trước trên màn hình không trả lời được câu hỏi thật:
 * thư này trông thế nào trong Gmail, chữ ký ra sao, có rơi vào Spam không. Gửi
 * cho chính mình trả lời được, và nó không chạm tới một người tham gia nào.
 *
 * Bản thử KHÔNG mang `batchId`: nó không thuộc lô nào, không được đếm vào lô
 * nào, và nó vẫn để lại một dòng trong sổ thư — bản thử cũng là thư thật đi qua
 * nhà cung cấp, giấu nó đi là làm sổ nói dối.
 */
export async function sendTestEmailAction(
  _previousState: BulkMailActionState,
  formData: FormData
): Promise<BulkMailActionState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.state;
    if (!auth.adminEmail) {
      return fail("Tài khoản của bạn chưa có địa chỉ email để nhận bản thử.");
    }

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const { row, error } = await getEmailTemplate(templateId);
    if (error) return fail(error);
    if (!row) return fail("Không tìm thấy mẫu thư.");
    if (row.seasonId !== auth.seasonId) return fail("Mẫu thư này thuộc mùa khác.");

    // Bản thử dùng dữ liệu mẫu, không mượn dữ liệu của một người tham gia nào.
    const filled = renderTemplate({
      kind: row.kind,
      subject: row.subject,
      body: row.body,
      values: sampleValues(row.kind)
    });
    if (!filled.ok) return fail(filled.message);

    const result = await sendTemplatedEmail({
      kind: row.kind,
      toEmail: auth.adminEmail,
      subject: `[THỬ] ${filled.subject}`,
      body: filled.body
    });

    refresh();
    if (result.skipped) {
      return fail(`Chưa gửi được bản thử: ${result.reason ?? "cấu hình đang chặn gửi thư."}`);
    }
    if (!result.ok) return fail(result.reason ?? "Không gửi được bản thử.");

    return {
      ok: true,
      message: `Đã gửi bản thử tới ${auth.adminEmail}. Kiểm cả hộp thư rác.`,
      batchId: null,
      problems: []
    };
  } catch (error) {
    console.error("[sendTestEmailAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/**
 * Mở một lô mới và gửi phần đầu tiên của nó.
 *
 * Ba hàng rào trước khi một lá thư nào rời khỏi hệ thống:
 *   1. mẫu thư phải ở trạng thái ĐÃ DUYỆT — chữ chưa ai đọc thì không đi;
 *   2. người bấm phải gõ lại đúng số người nhận;
 *   3. đối tượng nhận thư được chốt vào lô, nên lần chạy sau không đổi được.
 */
export async function startBulkSendAction(
  _previousState: BulkMailActionState,
  formData: FormData
): Promise<BulkMailActionState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.state;

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const rawAudience = String(formData.get("audience") ?? "").trim();
    if (!isBulkAudience(rawAudience)) return fail("Chưa chọn đối tượng nhận thư.");
    const audience: BulkAudience = rawAudience;

    const { row, error } = await getEmailTemplate(templateId);
    if (error) return fail(error);
    if (!row) return fail("Không tìm thấy mẫu thư.");
    if (row.seasonId !== auth.seasonId) return fail("Mẫu thư này thuộc mùa khác.");
    if (row.status !== "approved") {
      return fail("Mẫu thư này chưa được duyệt. Chỉ mẫu đã duyệt mới gửi được.");
    }

    const recipients = await listBulkRecipients({ seasonId: auth.seasonId, audience });
    if (recipients.error) return fail(recipients.error);

    const expected = recipients.partition.sendable.length;
    const confirmation = confirmBulkSend({ typed: formData.get("confirm_count"), expected });
    if (!confirmation.ok) return fail(confirmation.message);

    const created = await createEmailBatch({
      seasonId: auth.seasonId,
      kind: row.kind,
      templateId: row.id,
      audience,
      requestedCount: expected,
      note: `${BULK_AUDIENCE_LABELS[audience]} · ${row.name}`,
      actorAdminUserId: auth.adminUserId
    });
    if (created.error || !created.batch) return fail(created.error ?? "Không mở được lô gửi.");

    const run = await runEmailBatch({
      batch: created.batch,
      seasonCode: auth.seasonCode,
      subject: row.subject,
      body: row.body
    });

    refresh();
    if (run.error) {
      return { ok: false, message: run.error, batchId: created.batch.id, problems: run.problems };
    }

    // Người thiếu địa chỉ hoặc thiếu tên chưa từng nằm trong lô. Nói ra ở đây,
    // vì "đã gửi cho tất cả" mà thật ra là thiếu vài người là câu trả lời sai
    // cho câu hỏi quan trọng nhất sau một lượt gửi.
    const problems = [
      ...run.problems,
      ...recipients.partition.unreachable
        .slice(0, 10)
        .map((row_) => `${row_.fullName}: ${row_.reason}`)
    ];

    return {
      ok: true,
      message: describeRunResult(run),
      batchId: created.batch.id,
      problems
    };
  } catch (error) {
    console.error("[startBulkSendAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/** Gửi tiếp một lô đang chạy dở. */
export async function continueBulkSendAction(
  _previousState: BulkMailActionState,
  formData: FormData
): Promise<BulkMailActionState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.state;

    const batchId = String(formData.get("batch_id") ?? "").trim();
    if (!batchId) return fail("Chưa chọn lô gửi.");

    // Đọc lại lô từ database chứ không tin con số nào trên màn hình: màn hình
    // có thể đã cũ hơn một lần chạy khác.
    const { rows, error } = await listEmailBatches(auth.seasonId, 50);
    if (error) return fail(error);

    const batch = rows.find((row) => row.id === batchId);
    if (!batch) return fail("Không tìm thấy lô gửi trong mùa này.");
    if (batch.status !== "running") return fail("Lô này đã kết thúc.");
    if (!batch.templateId) return fail("Lô này không còn mẫu thư để gửi.");

    const template = await getEmailTemplate(batch.templateId);
    if (template.error) return fail(template.error);
    if (!template.row) return fail("Mẫu thư của lô này không còn nữa.");
    if (template.row.status !== "approved") {
      return fail("Mẫu thư của lô này đã bị sửa và cần được duyệt lại trước khi gửi tiếp.");
    }

    const run = await runEmailBatch({
      batch,
      seasonCode: auth.seasonCode,
      subject: template.row.subject,
      body: template.row.body
    });

    refresh();
    if (run.error) return { ok: false, message: run.error, batchId, problems: run.problems };

    return { ok: true, message: describeRunResult(run), batchId, problems: run.problems };
  } catch (error) {
    console.error("[continueBulkSendAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
