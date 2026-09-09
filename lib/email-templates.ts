import "server-only";

import {
  TEMPLATE_SPECS,
  isTemplateKind,
  type TemplateKind,
  type TemplateStatus
} from "@/lib/email-templates-core";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/email-templates.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc và ghi kho mẫu thư cho màn hình /operations/mail.
 *
 * Ba bảng đều bật RLS và không có policy nào, nên chỉ service_role chạm tới
 * được — đúng hợp đồng migration 20260909150000 đặt ra.
 *
 * Mọi hàm ghi trong file này đều ghi kèm một dòng nhật ký. Nhật ký là bảng
 * chỉ-ghi-thêm có trigger chặn UPDATE/DELETE ở tầng database, nên nó là câu
 * trả lời duy nhất còn lại cho "ai đã duyệt cái thư đó".
 */

const VI_READ_ERROR = "Không đọc được kho mẫu thư.";
const VI_WRITE_ERROR = "Không lưu được mẫu thư.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[email-templates]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

export type EmailTemplateRow = {
  id: string;
  seasonId: string;
  kind: TemplateKind;
  name: string;
  subject: string;
  body: string;
  status: TemplateStatus;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Tên người duyệt, tra từ admin_users. Null khi chưa duyệt. */
  approverName: string | null;
};

type RawRow = {
  id: string;
  season_id: string;
  kind: string;
  name: string;
  subject: string;
  body: string;
  status: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, season_id, kind, name, subject, body, status, created_by, approved_by, approved_at, created_at, updated_at";

/**
 * Chuyển một dòng thô thành dòng dùng được, hoặc bỏ qua nó.
 *
 * Một dòng mang `kind` mà bản build này chưa biết là chuyện có thật khi
 * database đã chạy migration mới còn app thì chưa deploy xong. Bỏ qua nó tốt
 * hơn là để `TEMPLATE_SPECS[kind]` trả về undefined rồi vỡ ở tận màn hình.
 */
function toRow(raw: RawRow): EmailTemplateRow | null {
  if (!isTemplateKind(raw.kind)) return null;
  return {
    id: raw.id,
    seasonId: raw.season_id,
    kind: raw.kind,
    name: raw.name,
    subject: raw.subject,
    body: raw.body,
    status: raw.status as TemplateStatus,
    createdBy: raw.created_by,
    approvedBy: raw.approved_by,
    approvedAt: raw.approved_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    approverName: null
  };
}

export async function listEmailTemplates(
  seasonId: string
): Promise<{ rows: EmailTemplateRow[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], error: VI_READ_ERROR };

  const { data, error } = await client
    .from("email_templates")
    .select(COLUMNS)
    .eq("season_id", seasonId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (error) {
    log("listEmailTemplates", error);
    return { rows: [], error: VI_READ_ERROR };
  }

  const rows = ((data ?? []) as RawRow[]).map(toRow).filter((row): row is EmailTemplateRow => row !== null);
  return { rows: await withApproverNames(rows), error: null };
}

/**
 * Gắn tên người duyệt vào các dòng đã đọc.
 *
 * Một truy vấn cho cả danh sách, không phải một truy vấn mỗi dòng. Tra tên
 * thất bại thì các dòng vẫn về nguyên vẹn với tên rỗng: không đọc được tên
 * người duyệt là chuyện nhỏ, còn không hiện được kho mẫu thư là chuyện lớn.
 */
async function withApproverNames(rows: EmailTemplateRow[]): Promise<EmailTemplateRow[]> {
  const ids = Array.from(
    new Set(rows.map((row) => row.approvedBy).filter((id): id is string => Boolean(id)))
  );
  if (!ids.length) return rows;

  const client = getSupabaseServiceRoleClient();
  if (!client) return rows;

  const { data, error } = await client
    .from("admin_users")
    .select("id, full_name, email")
    .in("id", ids);

  if (error) {
    log("withApproverNames", error);
    return rows;
  }

  const byId = new Map<string, string>();
  for (const raw of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    byId.set(String(raw.id), raw.full_name?.trim() || raw.email?.trim() || "");
  }

  return rows.map((row) => ({
    ...row,
    approverName: row.approvedBy ? byId.get(row.approvedBy) || null : null
  }));
}

export async function getEmailTemplate(
  id: string
): Promise<{ row: EmailTemplateRow | null; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { row: null, error: VI_READ_ERROR };

  const { data, error } = await client
    .from("email_templates")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    log("getEmailTemplate", error);
    return { row: null, error: VI_READ_ERROR };
  }
  if (!data) return { row: null, error: null };

  return { row: toRow(data as RawRow), error: null };
}

type LogAction = "created" | "ai_drafted" | "edited" | "approved" | "archived";

/**
 * Ghi một dòng nhật ký.
 *
 * Cố ý KHÔNG làm hỏng thao tác gọi nó khi ghi nhật ký thất bại: mẫu thư đã lưu
 * rồi, và báo "không lưu được" lúc này là nói dối. Lỗi được ghi ra console để
 * còn lần ra, còn người dùng thì thấy đúng điều đã xảy ra.
 */
async function writeLog(input: {
  templateId: string;
  action: LogAction;
  actorAdminUserId: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return;

  const { error } = await client.from("email_template_log").insert({
    template_id: input.templateId,
    action: input.action,
    actor_admin_user_id: input.actorAdminUserId,
    detail: input.detail ?? null
  });

  if (error) log(`writeLog:${input.action}`, error);
}

export async function createEmailTemplate(input: {
  seasonId: string;
  kind: TemplateKind;
  name: string;
  subject: string;
  body: string;
  actorAdminUserId: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { id: null, error: VI_WRITE_ERROR };

  const { data, error } = await client
    .from("email_templates")
    .insert({
      season_id: input.seasonId,
      kind: input.kind,
      name: input.name,
      subject: input.subject,
      body: input.body,
      status: "draft",
      created_by: input.actorAdminUserId
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    log("createEmailTemplate", error);
    return { id: null, error: VI_WRITE_ERROR };
  }

  await writeLog({
    templateId: data.id,
    action: "created",
    actorAdminUserId: input.actorAdminUserId,
    detail: { kind: input.kind, name: input.name }
  });

  return { id: data.id, error: null };
}

/**
 * Sửa nội dung một mẫu thư.
 *
 * Sửa một mẫu ĐÃ DUYỆT thì nó rơi lại thành bản nháp, và dấu duyệt bị xoá.
 *
 * Đây là quy tắc giữ cho cả module trung thực: người duyệt đọc một đoạn văn
 * bản cụ thể rồi mới đồng ý. Nếu đoạn văn ấy sửa được sau lưng họ, chữ ký duyệt
 * không còn nói lên điều gì — và thứ gửi tới hàng trăm hộp thư sẽ là chữ chưa
 * ai đọc. Ràng buộc `email_templates_approved_shape_check` bắt hai cột đi cùng
 * nhau, nên xoá dấu duyệt phải xoá cả hai.
 */
export async function updateEmailTemplate(input: {
  id: string;
  name: string;
  subject: string;
  body: string;
  actorAdminUserId: string | null;
}): Promise<{ ok: boolean; revoked: boolean; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, revoked: false, error: VI_WRITE_ERROR };

  const { row, error: readError } = await getEmailTemplate(input.id);
  if (readError) return { ok: false, revoked: false, error: readError };
  if (!row) return { ok: false, revoked: false, error: "Không tìm thấy mẫu thư." };
  if (row.status === "archived") {
    return { ok: false, revoked: false, error: "Mẫu thư đã lưu trữ, không sửa được." };
  }

  const revoked = row.status === "approved";

  const { error } = await client
    .from("email_templates")
    .update({
      name: input.name,
      subject: input.subject,
      body: input.body,
      status: "draft",
      approved_by: null,
      approved_at: null
    })
    .eq("id", input.id);

  if (error) {
    log("updateEmailTemplate", error);
    return { ok: false, revoked: false, error: VI_WRITE_ERROR };
  }

  await writeLog({
    templateId: input.id,
    action: "edited",
    actorAdminUserId: input.actorAdminUserId,
    detail: { revoked_approval: revoked }
  });

  return { ok: true, revoked, error: null };
}

export async function approveEmailTemplate(input: {
  id: string;
  actorAdminUserId: string | null;
}): Promise<{ ok: boolean; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: VI_WRITE_ERROR };

  const { row, error: readError } = await getEmailTemplate(input.id);
  if (readError) return { ok: false, error: readError };
  if (!row) return { ok: false, error: "Không tìm thấy mẫu thư." };
  if (row.status === "approved") return { ok: true, error: null };
  if (row.status === "archived") {
    return { ok: false, error: "Mẫu thư đã lưu trữ, không duyệt được." };
  }

  const { error } = await client
    .from("email_templates")
    .update({
      status: "approved",
      approved_by: input.actorAdminUserId,
      approved_at: new Date().toISOString()
    })
    .eq("id", input.id)
    // Chỉ duyệt được thứ vẫn đang là bản nháp lúc lệnh chạm tới database. Hai
    // người mở cùng một mẫu, một người sửa, một người bấm duyệt — điều kiện này
    // là thứ giữ cho người thứ hai không đóng dấu lên bản mình chưa đọc.
    .eq("status", "draft");

  if (error) {
    log("approveEmailTemplate", error);
    return { ok: false, error: VI_WRITE_ERROR };
  }

  await writeLog({
    templateId: input.id,
    action: "approved",
    actorAdminUserId: input.actorAdminUserId,
    detail: { subject: row.subject }
  });

  return { ok: true, error: null };
}

export async function archiveEmailTemplate(input: {
  id: string;
  actorAdminUserId: string | null;
}): Promise<{ ok: boolean; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: VI_WRITE_ERROR };

  // `approved_at` phải về null cùng lúc: ràng buộc hình dạng chỉ cho phép
  // `approved_at` khác null khi trạng thái đúng là 'approved'.
  const { error } = await client
    .from("email_templates")
    .update({ status: "archived", approved_by: null, approved_at: null })
    .eq("id", input.id);

  if (error) {
    log("archiveEmailTemplate", error);
    return { ok: false, error: VI_WRITE_ERROR };
  }

  await writeLog({
    templateId: input.id,
    action: "archived",
    actorAdminUserId: input.actorAdminUserId
  });

  return { ok: true, error: null };
}

/** Số mẫu thư đang có theo trạng thái, cho phần đầu trang. */
export async function countEmailTemplatesByStatus(
  seasonId: string
): Promise<Record<TemplateStatus, number>> {
  const empty: Record<TemplateStatus, number> = { draft: 0, approved: 0, archived: 0 };
  const client = getSupabaseServiceRoleClient();
  if (!client) return empty;

  const { data, error } = await client
    .from("email_templates")
    .select("status")
    .eq("season_id", seasonId);

  if (error) {
    log("countEmailTemplatesByStatus", error);
    return empty;
  }

  for (const raw of (data ?? []) as { status: string }[]) {
    if (raw.status === "draft" || raw.status === "approved" || raw.status === "archived") {
      empty[raw.status] += 1;
    }
  }
  return empty;
}

/** Nhãn tiếng Việt của một loại thư, cho màn hình. */
export function templateKindLabel(kind: TemplateKind): string {
  return TEMPLATE_SPECS[kind]?.label ?? kind;
}

/**
 * Mùa mà màn hình Mail đang làm việc.
 *
 * Cùng một nguồn với đợt gửi bù thư xác nhận (`lib/confirmation-backfill.ts`):
 * mã mùa trong cấu hình, không phải mùa mới nhất trong bảng. Đoán bằng
 * "mới nhất" nghĩa là một mùa vừa được tạo để chuẩn bị đã lặng lẽ trở thành nơi
 * thư gửi đi.
 */
export async function getMailSeason(): Promise<
  { ok: true; id: string; code: string } | { ok: false; error: string }
> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: VI_READ_ERROR };

  const code = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  const { data, error } = await client
    .from("seasons")
    .select("id, code")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    log("getMailSeason", error);
    return { ok: false, error: VI_READ_ERROR };
  }
  if (!data?.id) return { ok: false, error: `Không tìm thấy mùa ${code}.` };

  return { ok: true, id: String(data.id), code: String(data.code ?? code) };
}
