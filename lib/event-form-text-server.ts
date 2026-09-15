import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps, type CurrentAdminUser } from "@/lib/auth-constants";
import { FORM_TEXT_FIELDS, changedFormText, parseFormTextInput } from "@/lib/event-form-text";
import { isValidUuid, writeAdminAudit } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/event-form-text-server.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ai được sửa phần chữ của form đăng ký, và đường ghi hẹp của việc đó.
 *
 * 15/09/2026: form đăng ký Mentor Orientation đã gửi đi vẫn ghi "AGENDA – 20.09.2026
 * & 27.09.2026" sau khi buổi 20/09 dời sang 04/10. Đoạn đó nằm trong mô tả của TỪNG
 * buổi — mỗi buổi giữ một bản riêng — và cách duy nhất để sửa là form "Sửa sự kiện",
 * nơi ô mô tả nằm cuối cùng và một lần lưu ghi lại cả tên, giờ, địa điểm, sức chứa.
 *
 * Hàm này chỉ ghi các cột chữ trong `FORM_TEXT_FIELDS`, và chỉ những cột thật sự đổi.
 */

const VI_ERROR = "Không lưu được nội dung form. Thử lại.";

const COLUMNS = ["id", "season_id", "series_id", ...FORM_TEXT_FIELDS.map((spec) => spec.key)].join(", ");

type EventTextRow = Record<string, unknown> & { id: string; season_id?: string | null; series_id?: string | null };

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[event-form-text]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

/**
 * Cùng cổng với việc sửa sự kiện: super_admin, admin, core_team vận hành được mùa
 * của buổi đó. Fail-closed: không đọc được phạm vi thì trả về false.
 */
export async function canEditRegistrationFormText(
  adminUser: CurrentAdminUser | null,
  event: { season_id?: string | null }
): Promise<boolean> {
  if (!adminUser?.id || !canEditRecaps(adminUser)) return false;
  try {
    return await canOperateSeason(await getAdminScopeContext(), event.season_id ?? null);
  } catch (error) {
    log("canEditRegistrationFormText:scope", error);
    return false;
  }
}

/**
 * Lưu phần chữ của form đăng ký.
 *
 * `applyToSeries`: ghi cùng những đoạn vừa sửa vào mọi buổi trong chuỗi. Link chung
 * của chuỗi đọc mô tả từ buổi đã tạo link, còn link riêng của từng buổi đọc bản của
 * buổi đó — sửa một buổi mà quên buổi kia là để hai link nói hai điều khác nhau.
 * Chỉ những đoạn đã đổi mới được chép sang: đoạn không đụng tới của buổi khác giữ
 * nguyên, kể cả khi nó đang khác buổi này.
 *
 * Kiểm quyền trước, kiểm nội dung sau: người không có quyền nhận câu "không có quyền"
 * dù nội dung gửi lên sai hay đúng.
 */
export async function updateRegistrationFormText(input: {
  eventId: unknown;
  texts: unknown;
  applyToSeries: boolean;
}): Promise<{ ok: boolean; message: string; eventIds: string[] }> {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) return { ok: false, message: "Bạn chưa đăng nhập.", eventIds: [] };

  const eventId = String(input.eventId ?? "").trim();
  if (!isValidUuid(eventId)) return { ok: false, message: "ID sự kiện không hợp lệ.", eventIds: [] };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: VI_ERROR, eventIds: [] };

  const { data: anchor, error: readError } = await client
    .from("events")
    .select(COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  if (readError) {
    log("read", readError);
    return { ok: false, message: VI_ERROR, eventIds: [] };
  }
  if (!anchor) return { ok: false, message: "Không tìm thấy sự kiện.", eventIds: [] };
  const anchorRow = anchor as unknown as EventTextRow;

  if (!(await canEditRegistrationFormText(adminUser, anchorRow))) {
    return { ok: false, message: "Bạn không có quyền sửa nội dung form của sự kiện này.", eventIds: [] };
  }

  const parsed = parseFormTextInput(input.texts);
  if (!parsed.ok) return { ok: false, message: parsed.message, eventIds: [] };

  const changes = changedFormText(anchorRow, parsed.texts);
  if (Object.keys(changes).length === 0) {
    return { ok: true, message: "Nội dung form không có gì thay đổi.", eventIds: [] };
  }

  let targets: EventTextRow[] = [anchorRow];
  const seriesId = String(anchorRow.series_id ?? "").trim();
  if (input.applyToSeries && seriesId) {
    const { data: sessions, error: seriesError } = await client.from("events").select(COLUMNS).eq("series_id", seriesId);
    if (seriesError) {
      log("read series", seriesError);
      return { ok: false, message: VI_ERROR, eventIds: [] };
    }
    const rows = ((sessions ?? []) as unknown as EventTextRow[]).filter((row) => row.id !== anchorRow.id);
    targets = [anchorRow, ...rows];

    // Một buổi của chuỗi nằm ở mùa người này không vận hành: không ghi buổi nào cả,
    // thay vì ghi một nửa chuỗi rồi báo đã xong.
    const seasons = new Set(rows.map((row) => row.season_id ?? null));
    seasons.delete(anchorRow.season_id ?? null);
    for (const season of Array.from(seasons)) {
      if (!(await canEditRegistrationFormText(adminUser, { season_id: season }))) {
        return {
          ok: false,
          message: "Bạn không có quyền sửa một buổi khác trong chuỗi. Bỏ chọn “Áp dụng cho cả chuỗi” để chỉ sửa buổi này.",
          eventIds: []
        };
      }
    }
  }

  const ids = targets.map((row) => row.id);
  const { data: updated, error: updateError } = await client
    .from("events")
    .update(changes)
    .in("id", ids)
    .select(COLUMNS);

  const afterRows = (updated ?? []) as unknown as EventTextRow[];
  if (updateError || afterRows.length === 0) {
    log("update", updateError ?? "không có dòng nào được cập nhật");
    return { ok: false, message: VI_ERROR, eventIds: [] };
  }

  const beforeById = new Map(targets.map((row) => [row.id, row]));
  for (const after of afterRows) {
    await writeAdminAudit(client, { actionType: "update_event", beforeData: beforeById.get(after.id) ?? null, afterData: after });
  }

  const savedIds = afterRows.map((row) => row.id);
  return {
    ok: true,
    message:
      savedIds.length > 1
        ? `Đã lưu nội dung form cho cả ${savedIds.length} buổi trong chuỗi.`
        : "Đã lưu nội dung form.",
    eventIds: savedIds
  };
}
