"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  BULK_AUDIENCE_LABELS,
  RECIPIENT_ROLE_WORDS,
  confirmBulkSend,
  describeRunResult,
  resolveAudienceChoice
} from "@/lib/bulk-mail-core";
import { readCustomListSpec, recipientKey, selectCustomRecipients } from "@/lib/bulk-mail-custom-core";
import {
  EXTERNAL_CONFIRM_FIELD,
  EXTERNAL_FILE_FIELD,
  EXTERNAL_RECIPIENTS_FIELD,
  appendExternalRecipients,
  externalEntriesToText,
  isExternalRecipient,
  namelessExternals,
  parseExternalRecipientTable,
  parseExternalRecipientText,
  templateUsesRecipientName,
  withExternalLabel
} from "@/lib/bulk-mail-external-core";
import { readEmailListXlsx } from "@/lib/ai/uploads";
import {
  buildCustomRecipientUniverse,
  createCustomEmailBatch,
  createEmailBatch,
  listBulkRecipients,
  listEmailBatches,
  runEmailBatch,
  searchCustomListPeople
} from "@/lib/bulk-mail";
import {
  initialCustomListPreviewState,
  initialCustomListSearchState,
  initialExternalFileState,
  type BulkMailActionState,
  type CustomListPreviewState,
  type CustomListSearchState,
  type ExternalFileState
} from "@/lib/bulk-mail-action-types";
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

/** Mẫu thư mở được một lô: có thật, đúng mùa, ĐÃ DUYỆT. Dùng chung cho mọi lệnh mở lô. */
async function approvedTemplate(
  templateId: string,
  seasonId: string
): Promise<
  | { ok: true; row: NonNullable<Awaited<ReturnType<typeof getEmailTemplate>>["row"]> }
  | { ok: false; state: BulkMailActionState }
> {
  const { row, error } = await getEmailTemplate(templateId);
  if (error) return { ok: false, state: fail(error) };
  if (!row) return { ok: false, state: fail("Không tìm thấy mẫu thư.") };
  if (row.seasonId !== seasonId) return { ok: false, state: fail("Mẫu thư này thuộc mùa khác.") };
  if (row.status !== "approved") {
    return { ok: false, state: fail("Mẫu thư này chưa được duyệt. Chỉ mẫu đã duyệt mới gửi được.") };
  }
  return { ok: true, row };
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

    const resolved = resolveAudienceChoice({
      audience: formData.get("audience"),
      eventId: formData.get("event_id"),
      coversSeries: formData.get("covers_series")
    });
    if (!resolved.ok) return fail(resolved.message);
    const { audience, eventId, coversSeries } = resolved.choice;

    const template = await approvedTemplate(templateId, auth.seasonId);
    if (!template.ok) return template.state;
    const row = template.row;

    // Tham số của nhóm `event` chỉ đi kèm khi nhóm là `event`. Nhóm khác nhận
    // đúng hai trường như trước, để không lô nào mang một sự kiện nó không dùng.
    const recipients = await listBulkRecipients(
      audience === "event"
        ? { seasonId: auth.seasonId, audience, eventId, coversSeries }
        : { seasonId: auth.seasonId, audience }
    );
    if (recipients.error) return fail(recipients.error);

    const expected = recipients.partition.sendable.length;
    const confirmation = confirmBulkSend({ typed: formData.get("confirm_count"), expected });
    if (!confirmation.ok) return fail(confirmation.message);

    const created = await createEmailBatch({
      seasonId: auth.seasonId,
      kind: row.kind,
      templateId: row.id,
      audience,
      ...(audience === "event" ? { audienceEventId: eventId, audienceCoversSeries: coversSeries } : {}),
      requestedCount: expected,
      note: `${recipients.label ?? BULK_AUDIENCE_LABELS[audience]} · ${row.name}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Danh sách tùy chỉnh (VAM00026)
//
// Ba lệnh dưới đây qua đúng cổng `authorize()` của các lệnh gửi cũ — chỉ người gửi được thư
// hàng loạt, trên mùa mình được vận hành. Bản xem trước và ô tìm người cũng qua cổng đó: chúng
// trả về họ tên và email của hàng trăm người, nên không được rộng hơn nút gửi.
// ─────────────────────────────────────────────────────────────────────────────

function failPreview(message: string, signature: string | null = null): CustomListPreviewState {
  return { ...initialCustomListPreviewState, message, signature };
}

/** Dựng bản xem trước: ai sẽ nhận, tính từ các nguồn đã tick và người thêm tay. Không ghi gì. */
export async function previewCustomListAction(
  _previousState: CustomListPreviewState,
  formData: FormData
): Promise<CustomListPreviewState> {
  const signature = String(formData.get("signature") ?? "") || null;
  try {
    const auth = await authorize();
    if (!auth.ok) return failPreview(auth.state.message ?? "Không có quyền.", signature);

    const parsed = readCustomListSpec(formData);
    if (!parsed.ok) return failPreview(parsed.message, signature);

    const external = parseExternalRecipientText(formData.get(EXTERNAL_RECIPIENTS_FIELD));
    if (!external.ok) return failPreview(external.message, signature);

    const universe = await buildCustomRecipientUniverse({ seasonId: auth.seasonId, spec: parsed.spec });
    if (universe.error) return failPreview(universe.error, signature);

    const hasExternal = external.entries.length > 0 || external.invalidCount > 0;
    const merged = appendExternalRecipients(universe.partition, external.entries);
    const rows = merged.partition.sendable;

    // Chỉ khi có người ngoài mới cần biết mẫu thư có dùng ô tên không. Không đọc được mẫu thì coi
    // như CÓ dùng: khoá nút gửi với người trống tên là lỗi an toàn, gửi "Xin chào ," thì không.
    const templateId = String(formData.get("template_id") ?? "").trim() || null;
    let nameRequired = false;
    if (hasExternal) {
      const template = templateId ? await getEmailTemplate(templateId) : { row: null, error: null };
      nameRequired = template.row ? templateUsesRecipientName(template.row.subject, template.row.body) : true;
    }

    return {
      ok: true,
      message: null,
      signature,
      label: withExternalLabel(universe.label, merged.added),
      rows: rows.map((row) => ({
        key: recipientKey(row),
        fullName: row.fullName,
        email: row.email,
        roleWord: RECIPIENT_ROLE_WORDS[row.role],
        ...(isExternalRecipient(row) ? { external: true } : {})
      })),
      unreachable: universe.partition.unreachable.slice(0, 30).map((row) => `${row.fullName}: ${row.reason}`),
      unreachableCount: universe.partition.unreachable.length,
      external: hasExternal
        ? {
            count: merged.added,
            problems: external.problems,
            invalidCount: external.invalidCount,
            duplicates: external.duplicates,
            overlap: merged.overlap,
            nameless: namelessExternals(rows).length
          }
        : null,
      nameRequired,
      templateId
    };
  } catch (error) {
    console.error("[previewCustomListAction]", error);
    return failPreview("Lỗi hệ thống. Vui lòng thử lại.", signature);
  }
}

/** Tìm người trong danh bạ (thuộc mùa) để thêm tay vào danh sách. */
export async function searchCustomListPeopleAction(
  _previousState: CustomListSearchState,
  formData: FormData
): Promise<CustomListSearchState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return { ...initialCustomListSearchState, message: auth.state.message };

    const found = await searchCustomListPeople({ seasonId: auth.seasonId, query: String(formData.get("q") ?? "") });
    if (found.error) return { ...initialCustomListSearchState, message: found.error };
    return {
      ok: true,
      message: found.rows.length ? null : "Không tìm thấy ai thuộc mùa này.",
      results: found.rows.map((row) => ({
        personId: row.personId,
        fullName: row.fullName,
        email: row.email,
        memberCode: row.memberCode,
        roleWord: RECIPIENT_ROLE_WORDS[row.role]
      }))
    };
  } catch (error) {
    console.error("[searchCustomListPeopleAction]", error);
    return { ...initialCustomListSearchState, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}

/**
 * Mở một lô "Danh sách tùy chỉnh", chốt danh sách vào lô, và gửi phần đầu.
 *
 * Form gửi lên nguồn, id người thêm tay và khoá của từng dòng còn giữ tick — KHÔNG gửi email.
 * Máy chủ dựng lại tập ứng viên từ database, và mọi khoá phải nằm trong đó (lib/bulk-mail-custom-core.ts):
 * id bịa, người ngoài mùa, hay dữ liệu đã đổi từ lúc xem trước đều làm cả lượt bị từ chối.
 * Con số người bấm gõ phải bằng đúng số dòng sẽ chốt vào lô.
 */
export async function startCustomBulkSendAction(
  _previousState: BulkMailActionState,
  formData: FormData
): Promise<BulkMailActionState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.state;

    const templateId = String(formData.get("template_id") ?? "").trim();
    if (!templateId) return fail("Chưa chọn mẫu thư.");

    const parsed = readCustomListSpec(formData);
    if (!parsed.ok) return fail(parsed.message);

    const template = await approvedTemplate(templateId, auth.seasonId);
    if (!template.ok) return template.state;
    const row = template.row;

    // Email ngoài VAM (VAM00027) đọc lại từ chữ form mang theo, bằng đúng bộ đọc của bước xem
    // trước; mọi khoá `external:` gửi lên phải nằm trong danh sách đọc lại đó.
    const external = parseExternalRecipientText(formData.get(EXTERNAL_RECIPIENTS_FIELD));
    if (!external.ok) return fail(external.message);

    const universe = await buildCustomRecipientUniverse({ seasonId: auth.seasonId, spec: parsed.spec });
    if (universe.error) return fail(universe.error);

    const merged = appendExternalRecipients(universe.partition, external.entries);
    const selected = selectCustomRecipients(merged.partition.sendable, formData.getAll("recipient_key"));
    if (!selected.ok) return fail(selected.message);

    const externals = selected.rows.filter(isExternalRecipient);
    if (externals.length) {
      const nameless = namelessExternals(externals);
      if (nameless.length && templateUsesRecipientName(row.subject, row.body)) {
        return fail(
          `${nameless.length} email ngoài VAM chưa có tên (vd. ${nameless[0].email}) mà mẫu thư dùng {{ten_nguoi_nhan}}. Thêm tên (cột “Họ tên” trong Excel, hoặc “email, Họ tên” khi gõ tay), bỏ tick họ, hoặc dùng mẫu thư không có ô tên.`
        );
      }
      // Xác nhận riêng cho người ngoài: gửi nhầm cho người lạ đắt hơn gửi nhầm cho thành viên.
      if (String(formData.get(EXTERNAL_CONFIRM_FIELD) ?? "").trim() !== String(externals.length)) {
        return fail(`Tick ô xác nhận đã kiểm ${externals.length} email ngoài VAM trước khi gửi.`);
      }
    }

    const expected = selected.rows.length;
    const confirmation = confirmBulkSend({ typed: formData.get("confirm_count"), expected });
    if (!confirmation.ok) return fail(confirmation.message);

    const created = await createCustomEmailBatch({
      seasonId: auth.seasonId,
      kind: row.kind,
      templateId: row.id,
      recipients: selected.rows,
      note: `${withExternalLabel(universe.label, externals.length)} · ${row.name}`,
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
    return { ok: true, message: describeRunResult(run), batchId: created.batch.id, problems: run.problems };
  } catch (error) {
    console.error("[startCustomBulkSendAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

/**
 * Đọc một file Excel danh sách email ngoài VAM (VAM00027). Không ghi gì, không gửi gì: trả về
 * danh sách đã đọc dưới dạng chữ để màn hình nối vào ô "Email ngoài VAM", cùng các dòng lỗi.
 * Byte của file chỉ đi qua lib/ai/uploads.ts › readEmailListXlsx. Cùng cổng quyền với nút gửi.
 */
export async function readExternalEmailFileAction(
  _previousState: ExternalFileState,
  formData: FormData
): Promise<ExternalFileState> {
  const failFile = (message: string): ExternalFileState => ({ ...initialExternalFileState, message });
  try {
    const auth = await authorize();
    if (!auth.ok) return failFile(auth.state.message ?? "Không có quyền.");

    const upload = await readEmailListXlsx(formData, EXTERNAL_FILE_FIELD);
    if (!upload.ok) return failFile(upload.message);

    const table = parseExternalRecipientTable(upload.table);
    if (!table.ok) return failFile(`${upload.name}: ${table.message}`);
    if (!table.entries.length) {
      return {
        ...failFile(`${upload.name}: không có email hợp lệ nào.`),
        problems: table.problems,
        invalidCount: table.invalidCount
      };
    }

    const nameless = table.entries.filter((entry) => !entry.name).length;
    return {
      ok: true,
      message: `Đã đọc ${table.entries.length} email từ ${upload.name}.`,
      token: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      fileName: upload.name,
      text: externalEntriesToText(table.entries),
      count: table.entries.length,
      nameless,
      problems: table.problems,
      invalidCount: table.invalidCount,
      duplicates: table.duplicates
    };
  } catch (error) {
    console.error("[readExternalEmailFileAction]", error);
    return failFile("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
