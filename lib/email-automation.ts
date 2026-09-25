import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  AUTOMATION_SLOTS,
  type AutomationSlot,
  findAutomationSlot,
  renderAutomationContent,
  validateAutomationContent
} from "@/lib/email-automation-core";
import { type AutomationContent, defaultAutomationContent } from "@/lib/email-automation-defaults";
import { textToHtmlEmail } from "@/lib/email-core";
import { canComposeEmailTemplate } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/email-automation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc và ghi nội dung sửa được của thư tự động.
 *
 * ---------------------------------------------------------------------------
 * KHÔNG CACHE, VÀ ĐÓ LÀ MỘT LỰA CHỌN
 * ---------------------------------------------------------------------------
 * Mỗi lần gửi đọc lại một dòng theo khoá duy nhất. Có thể cache để bớt truy vấn
 * trong một lượt gửi hàng trăm thư, nhưng lời hứa với người vận hành là "lưu
 * xong là thư sau dùng nội dung mới" — một cache dù chỉ 60 giây cũng biến lời
 * hứa đó thành "khoảng một phút sau", và họ sẽ phát hiện điều đó bằng cách gửi
 * thử rồi thấy nội dung cũ.
 *
 * Một select theo khoá duy nhất rẻ hơn nhiều so với chính lời gọi HTTP sang
 * Brevo đứng ngay sau nó.
 *
 * ---------------------------------------------------------------------------
 * HỎNG THÌ GỬI BẢN MẶC ĐỊNH, KHÔNG PHẢI KHÔNG GỬI
 * ---------------------------------------------------------------------------
 * `resolveAutomationEmail` trả về bản dựng sẵn của hàm dựng thư trong MỌI tình
 * huống bất thường: không đọc được bảng, nội dung đã lưu thiếu dữ liệu cho một
 * ô, id lạ. Một lá thư tự động không bao giờ được phép KHÔNG ĐI vì có người vừa
 * sửa hỏng nội dung của nó — người nhận không biết là có một lá thư đang thiếu.
 */

const OVERRIDES = "email_automation_overrides";
const LOG = "email_automation_override_log";

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

function log(message: string, error?: unknown) {
  console.error(`[email-automation] ${message}`, error ?? "");
}

function client() {
  try {
    return getSupabaseServiceRoleClient();
  } catch (error) {
    log("service client unavailable", error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Đọc
// ─────────────────────────────────────────────────────────────────────────────

type OverrideRow = {
  slot_id: string;
  subject: string;
  body: string;
  updated_at: string | null;
  updated_by: string | null;
};

async function readOverrides(slotIds?: string[]): Promise<Map<string, OverrideRow> | null> {
  const db = client();
  if (!db) return null;

  // try/catch chứ không chỉ kiểm `error`: một lỗi NÉM RA từ client — mất mạng,
  // schema cache lệch — sẽ thoát lên tận hàm gửi và giết cả lượt gửi. Lá thư
  // khi đó không đi, và người nhận không biết là có một lá thư đang thiếu.
  // Không đọc được nội dung đã sửa thì gửi bản mặc định, không phải không gửi.
  try {
    let query = db.from(OVERRIDES).select("slot_id,subject,body,updated_at,updated_by");
    if (slotIds && slotIds.length) query = query.in("slot_id", slotIds);

    const { data, error } = await query;
    if (error) {
      log("read overrides failed", error);
      return null;
    }

    const map = new Map<string, OverrideRow>();
    for (const row of (data ?? []) as OverrideRow[]) map.set(String(row.slot_id), row);
    return map;
  } catch (error) {
    log("read overrides threw", error);
    return null;
  }
}

export type AutomationSlotView = {
  slot: AutomationSlot;
  content: AutomationContent;
  /** true khi nội dung đến từ bảng, false khi đang dùng bản mặc định trong mã. */
  customised: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  /** Bản mặc định, để màn hình so sánh và để nút "trả về mặc định" có nghĩa. */
  fallback: AutomationContent;
  /** Bản xem trước đã dựng, dùng giá trị ví dụ. */
  preview: { subject: string; html: string; text: string } | null;
};

export type AutomationListResult =
  | { ok: false; message: string }
  | { ok: true; views: AutomationSlotView[] };

/** Giá trị ví dụ để xem trước — chữ "(ví dụ)" đi kèm, không thuộc về ai. */
function previewValues(slot: AutomationSlot): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of slot.placeholders) {
    values[p.key] = p.key.startsWith("link_")
      ? "https://os.alumni-mentoring.edu.vn/vi-du-khong-mo-duoc"
      : `[${p.label} (ví dụ)]`;
  }
  return values;
}

function buildPreview(slotId: string, content: AutomationContent, slot: AutomationSlot) {
  const rendered = renderAutomationContent({
    slotId,
    subject: content.subject,
    body: content.body,
    values: previewValues(slot)
  });
  if (!rendered.ok) return null;
  return { subject: rendered.subject, text: rendered.text, html: textToHtmlEmail(rendered.text) };
}

export async function listAutomationContent(): Promise<AutomationListResult> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canComposeEmailTemplate(admin.role)) {
    return { ok: false, message: "Bạn không có quyền xem nội dung thư tự động." };
  }

  const overrides = await readOverrides();
  if (!overrides) return { ok: false, message: SAFE_ERROR };

  // Tên người sửa: đọc một lượt, không phải mỗi dòng một truy vấn.
  const editorIds = Array.from(
    new Set(
      Array.from(overrides.values())
        .map((row) => row.updated_by)
        .filter((id): id is string => Boolean(id))
    )
  );
  const names = new Map<string, string>();
  if (editorIds.length) {
    const db = client();
    const { data } = db
      ? await db.from("admin_users").select("id,full_name,email").in("id", editorIds)
      : { data: null };
    for (const row of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      names.set(String(row.id), String(row.full_name || row.email || "").trim() || "—");
    }
  }

  const views: AutomationSlotView[] = [];
  for (const slot of AUTOMATION_SLOTS) {
    const fallback = defaultAutomationContent(slot.id);
    // Một lá thư không dựng được bản mặc định là lỗi lập trình, không phải một
    // trạng thái người dùng gặp — bài test hợp đồng bắt nó trước khi tới đây.
    if (!fallback) continue;

    const row = overrides.get(slot.id);
    const content = row ? { subject: row.subject, body: row.body } : fallback;

    views.push({
      slot,
      content,
      customised: Boolean(row),
      updatedAt: row?.updated_at ?? null,
      updatedByName: row?.updated_by ? names.get(row.updated_by) ?? null : null,
      fallback,
      preview: buildPreview(slot.id, content, slot)
    });
  }

  return { ok: true, views };
}

export type AutomationHistoryRow = {
  id: string;
  action: "save" | "revert";
  subjectBefore: string | null;
  bodyBefore: string | null;
  subjectAfter: string | null;
  bodyAfter: string | null;
  changedByName: string | null;
  changedAt: string;
};

/**
 * Lịch sử gần đây của MỌI lá thư, trong ĐÚNG MỘT truy vấn.
 *
 * Màn hình mở 17 lá cùng lúc; hỏi lịch sử từng lá là 17 lượt đi database cho
 * một trang mà phần lớn thời gian chẳng ai mở tới lịch sử.
 */
export async function listRecentHistory(
  perSlot = 5
): Promise<Map<string, AutomationHistoryRow[]>> {
  const db = client();
  if (!db) return new Map();

  const { data, error } = await db
    .from(LOG)
    .select("id,slot_id,action,subject_before,body_before,subject_after,body_after,changed_by_name,changed_at")
    .order("changed_at", { ascending: false })
    .limit(300);
  if (error) {
    log("read recent history failed", error);
    return new Map();
  }

  const grouped = new Map<string, AutomationHistoryRow[]>();
  for (const row of (data ?? []) as any[]) {
    const key = String(row.slot_id);
    const list = grouped.get(key) ?? [];
    if (list.length >= perSlot) continue;
    list.push({
      id: String(row.id),
      action: row.action === "revert" ? "revert" : "save",
      subjectBefore: row.subject_before ?? null,
      bodyBefore: row.body_before ?? null,
      subjectAfter: row.subject_after ?? null,
      bodyAfter: row.body_after ?? null,
      changedByName: row.changed_by_name ?? null,
      changedAt: String(row.changed_at)
    });
    grouped.set(key, list);
  }
  return grouped;
}

export async function getAutomationHistory(
  slotId: unknown
): Promise<{ ok: false; message: string } | { ok: true; rows: AutomationHistoryRow[] }> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canComposeEmailTemplate(admin.role)) {
    return { ok: false, message: "Bạn không có quyền xem lịch sử thư tự động." };
  }
  const slot = findAutomationSlot(slotId);
  if (!slot) return { ok: false, message: "Không xác định được lá thư." };

  const db = client();
  if (!db) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await db
    .from(LOG)
    .select("id,action,subject_before,body_before,subject_after,body_after,changed_by_name,changed_at")
    .eq("slot_id", slot.id)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) {
    log("read history failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    rows: ((data ?? []) as any[]).map((row) => ({
      id: String(row.id),
      action: row.action === "revert" ? "revert" : "save",
      subjectBefore: row.subject_before ?? null,
      bodyBefore: row.body_before ?? null,
      subjectAfter: row.subject_after ?? null,
      bodyAfter: row.body_after ?? null,
      changedByName: row.changed_by_name ?? null,
      changedAt: String(row.changed_at)
    }))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghi
// ─────────────────────────────────────────────────────────────────────────────

export type AutomationWriteResult = { ok: boolean; message: string };

async function writeLog(input: {
  slotId: string;
  action: "save" | "revert";
  before: AutomationContent | null;
  after: AutomationContent | null;
  actorId: string | null;
  actorName: string | null;
}) {
  const db = client();
  if (!db) return;
  const { error } = await db.from(LOG).insert({
    slot_id: input.slotId,
    action: input.action,
    subject_before: input.before?.subject ?? null,
    body_before: input.before?.body ?? null,
    subject_after: input.after?.subject ?? null,
    body_after: input.after?.body ?? null,
    changed_by: input.actorId,
    changed_by_name: input.actorName
  });
  // Nhật ký hỏng KHÔNG được làm hỏng thao tác đã ghi thành công — nhưng phải
  // hiện ra ở log máy chủ, vì một lịch sử thiếu dòng là một lịch sử nói dối.
  if (error) log("write history failed", error);
}

export async function saveAutomationContent(input: {
  slotId: unknown;
  subject: unknown;
  body: unknown;
}): Promise<AutomationWriteResult> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canComposeEmailTemplate(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa nội dung thư tự động." };
  }

  const validation = validateAutomationContent(input);
  if (!validation.ok) return { ok: false, message: validation.message };

  const slot = findAutomationSlot(input.slotId)!;
  const db = client();
  if (!db) return { ok: false, message: SAFE_ERROR };

  const existing = await readOverrides([slot.id]);
  if (!existing) return { ok: false, message: SAFE_ERROR };
  const before = existing.get(slot.id);

  const { error } = await db.from(OVERRIDES).upsert(
    {
      slot_id: slot.id,
      subject: validation.subject,
      body: validation.body,
      updated_by: admin.id,
      updated_at: new Date().toISOString()
    },
    { onConflict: "slot_id" }
  );
  if (error) {
    log("save override failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog({
    slotId: slot.id,
    action: "save",
    before: before ? { subject: before.subject, body: before.body } : null,
    after: { subject: validation.subject, body: validation.body },
    actorId: admin.id ?? null,
    actorName: (admin as any).full_name ?? (admin as any).email ?? null
  });

  return { ok: true, message: "Đã lưu. Thư gửi từ bây giờ dùng nội dung này." };
}

/**
 * Trả về bản mặc định = XOÁ dòng, không phải ghi đè bằng một bản chép của mã nguồn.
 *
 * Nếu ghi đè, bản "mặc định" đó đóng băng lại: ngày ai đó sửa hàm dựng thư, lá
 * thư này vẫn gửi câu chữ cũ, và không ai nhớ vì sao.
 */
export async function revertAutomationContent(slotId: unknown): Promise<AutomationWriteResult> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canComposeEmailTemplate(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa nội dung thư tự động." };
  }

  const slot = findAutomationSlot(slotId);
  if (!slot) return { ok: false, message: "Không xác định được lá thư." };

  const db = client();
  if (!db) return { ok: false, message: SAFE_ERROR };

  const existing = await readOverrides([slot.id]);
  if (!existing) return { ok: false, message: SAFE_ERROR };
  const before = existing.get(slot.id);
  if (!before) return { ok: true, message: "Lá thư này đang dùng bản mặc định." };

  const { error } = await db.from(OVERRIDES).delete().eq("slot_id", slot.id);
  if (error) {
    log("revert override failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog({
    slotId: slot.id,
    action: "revert",
    before: { subject: before.subject, body: before.body },
    after: null,
    actorId: admin.id ?? null,
    actorName: (admin as any).full_name ?? (admin as any).email ?? null
  });

  return { ok: true, message: "Đã trả về bản mặc định của hệ thống." };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dùng lúc gửi
// ─────────────────────────────────────────────────────────────────────────────

export type ResolvedEmail = { subject: string; text: string; html: string };

/**
 * Nội dung THẬT SỰ gửi đi cho một lá thư.
 *
 * `fallback` là bản do hàm dựng thư trong `lib/email-core.ts` tạo ra. Nó được
 * trả về nguyên vẹn trong mọi tình huống bất thường — xem đầu file.
 *
 * Phần HTML dựng từ chính chữ đã điền bằng `textToHtmlEmail`, nên người vận
 * hành chỉ phải gõ chữ thuần và KHÔNG có đường nào để một thẻ họ gõ trở thành
 * thẻ chạy được: hàm đó escape mọi thứ trước rồi mới đặt lại thẻ của nó.
 */
export async function resolveAutomationEmail(input: {
  slotId: string;
  values: Record<string, unknown>;
  fallback: ResolvedEmail;
}): Promise<ResolvedEmail> {
  const slot = findAutomationSlot(input.slotId);
  if (!slot) {
    log(`slot khong co trong danh muc: ${input.slotId}`);
    return input.fallback;
  }

  const overrides = await readOverrides([slot.id]);
  if (!overrides) return input.fallback;

  const row = overrides.get(slot.id);
  if (!row) return input.fallback;

  const rendered = renderAutomationContent({
    slotId: slot.id,
    subject: row.subject,
    body: row.body,
    values: input.values
  });
  if (!rendered.ok) {
    log(`noi dung da luu cua "${slot.id}" khong dung duoc (${rendered.reason}) — gui ban mac dinh`);
    return input.fallback;
  }

  return { subject: rendered.subject, text: rendered.text, html: textToHtmlEmail(rendered.text) };
}
