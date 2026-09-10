import "server-only";

import { canEditRecaps } from "@/lib/auth-constants";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/event-supporters.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ai được quét mã điểm danh cho một buổi cụ thể.
 *
 * Quyền này là một dòng ghép người-với-buổi, không phải một giá trị trong
 * `admin_users.role`: người đứng quét ở cửa cần đúng một quyền — quét mã của
 * buổi đó — và một vai trò toàn cục sẽ cho họ quyền ấy ở mọi buổi của mọi mùa.
 */

const VI_ERROR = "Không đọc được danh sách người hỗ trợ.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[event-supporters]", scope, {
    code: err?.code,
    message: err?.message ?? String(error)
  });
}

/**
 * Những vai trò được thêm làm người hỗ trợ điểm danh.
 *
 * Chỉ support team. Quản trị sự kiện (super_admin, admin, core_team) đã quét
 * được sẵn qua `canEditRecaps`, nên thêm họ vào đây chỉ tạo ra một dòng thừa;
 * còn reviewer và viewer là hai nhóm khác hẳn — reviewer là mentor chấm hồ sơ,
 * viewer là quyền đọc — không ai trong hai nhóm đó đứng ở cửa quét mã.
 *
 * Muốn nới ra thì thêm vai trò vào đúng mảng này, không rải điều kiện ra chỗ
 * khác.
 */
export const SUPPORTER_ELIGIBLE_ROLES = ["support_team"] as const;

/** Một người có thể chọn vào danh sách hỗ trợ. */
export type SupporterCandidate = {
  adminUserId: string;
  fullName: string;
  email: string;
};

export type EventSupporter = {
  id: string;
  adminUserId: string;
  fullName: string;
  email: string;
  createdAt: string;
};

/**
 * Người này có được quét mã của buổi này không.
 *
 * Hai đường, và đường nào cũng đủ: quản trị sự kiện (`canEditRecaps` — cùng
 * cổng đang gác việc sửa sự kiện và điểm danh thủ công), HOẶC được ghép làm
 * người hỗ trợ đúng buổi này.
 *
 * Fail-closed: không đọc được bảng thì trả về false. Một lỗi hạ tầng không
 * được biến thành quyền — nhất là ở một cổng mà bên kia là việc ghi dữ liệu
 * tham dự.
 */
export async function canScanEvent(
  adminUser: CurrentAdminUser | null,
  eventId: string
): Promise<boolean> {
  if (!adminUser?.id) return false;
  if (canEditRecaps(adminUser)) return true;

  // Tài khoản đã khoá thì không quét được, dù dòng ghép còn đó: dòng ghép mở
  // thêm quyền, nó không thay cho việc có một tài khoản đang hoạt động.
  if (adminUser.status !== "active") return false;

  const client = getSupabaseServiceRoleClient();
  if (!client) return false;

  const { data, error } = await client
    .from("event_supporters")
    .select("id")
    .eq("event_id", eventId)
    .eq("admin_user_id", adminUser.id)
    .maybeSingle();

  if (error) {
    log("canScanEvent", error);
    return false;
  }
  return Boolean(data);
}

/**
 * Ai còn có thể được thêm vào buổi này.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO LÀ Ô CHỌN CHỨ KHÔNG PHẢI Ô GÕ EMAIL
 * ---------------------------------------------------------------------------
 * Ô gõ email bắt người vận hành nhớ chính xác địa chỉ của một người khác, rồi
 * gõ lại không sai một ký tự. Gõ sai thì hệ thống báo "chưa có tài khoản" —
 * một câu đúng về mặt kỹ thuật nhưng dẫn người ta đi sai hướng, vì tài khoản
 * vẫn ở đó, chỉ là email vừa gõ không phải của nó.
 *
 * Danh sách support team đã nằm sẵn trong CRM. Chọn từ danh sách thì không có
 * gì để gõ sai.
 *
 * Người đã trong danh sách hỗ trợ của buổi này bị loại khỏi ô chọn: chọn lại
 * họ là một thao tác vô nghĩa, và để họ trong đó làm người ta tưởng chưa thêm.
 */
export async function listSupporterCandidates(
  eventId: string
): Promise<{ rows: SupporterCandidate[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], error: VI_ERROR };

  const { data, error } = await client
    .from("admin_users")
    .select("id, full_name, email")
    .in("role", [...SUPPORTER_ELIGIBLE_ROLES])
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (error) {
    log("listSupporterCandidates", error);
    return { rows: [], error: VI_ERROR };
  }

  const { data: taken, error: takenError } = await client
    .from("event_supporters")
    .select("admin_user_id")
    .eq("event_id", eventId);

  if (takenError) {
    log("listSupporterCandidates:taken", takenError);
    return { rows: [], error: VI_ERROR };
  }

  const already = new Set(
    ((taken ?? []) as Array<{ admin_user_id: string }>).map((row) => String(row.admin_user_id))
  );

  const rows = (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>;

  return {
    rows: rows
      .filter((row) => !already.has(String(row.id)))
      .map((row) => ({
        adminUserId: String(row.id),
        fullName: String(row.full_name ?? "").trim(),
        email: String(row.email ?? "").trim()
      })),
    error: null
  };
}

export async function listEventSupporters(
  eventId: string
): Promise<{ rows: EventSupporter[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], error: VI_ERROR };

  const { data, error } = await client
    .from("event_supporters")
    .select("id, admin_user_id, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    log("listEventSupporters", error);
    return { rows: [], error: VI_ERROR };
  }

  const rows = (data ?? []) as Array<{ id: string; admin_user_id: string; created_at: string }>;
  if (!rows.length) return { rows: [], error: null };

  // Một truy vấn cho cả danh sách, không phải một truy vấn mỗi dòng.
  const { data: people, error: peopleError } = await client
    .from("admin_users")
    .select("id, full_name, email")
    .in("id", rows.map((row) => row.admin_user_id));

  if (peopleError) {
    log("listEventSupporters:names", peopleError);
    return { rows: [], error: VI_ERROR };
  }

  const byId = new Map(
    ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
      (person) => [String(person.id), person]
    )
  );

  return {
    rows: rows.map((row) => {
      const person = byId.get(row.admin_user_id);
      return {
        id: row.id,
        adminUserId: row.admin_user_id,
        fullName: String(person?.full_name ?? "").trim(),
        email: String(person?.email ?? "").trim(),
        createdAt: row.created_at
      };
    }),
    error: null
  };
}

/**
 * Ghép một người vào buổi này.
 *
 * Nhận id của tài khoản, lấy từ ô chọn — xem `listSupporterCandidates`.
 *
 * Vẫn kiểm lại vai trò và trạng thái ở đây, không tin vào việc ô chọn đã lọc.
 * Cái đến từ biểu mẫu là thứ người gửi tự đặt được, nên một danh sách đã lọc
 * trên màn hình không phải một phép kiểm — và bên kia cổng này là quyền ghi dữ
 * liệu tham dự.
 *
 * Người chưa có tài khoản thì KHÔNG tự tạo tài khoản hộ. Tạo tài khoản là một
 * việc khác, có cổng riêng, và làm lén nó ở đây nghĩa là một cú bấm "thêm
 * người hỗ trợ" cấp ra một lối đăng nhập mới mà không ai xét.
 */
export async function addEventSupporter(input: {
  eventId: string;
  adminUserId: string;
  addedBy: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: VI_ERROR };

  const adminUserId = String(input.adminUserId ?? "").trim();
  if (!adminUserId) return { ok: false, message: "Chưa chọn người hỗ trợ." };

  const { data, error } = await client
    .from("admin_users")
    .select("id, status, role, full_name, email")
    .eq("id", adminUserId)
    .maybeSingle();

  if (error) {
    log("addEventSupporter:lookup", error);
    return { ok: false, message: VI_ERROR };
  }
  if (!data) {
    return { ok: false, message: "Không tìm thấy tài khoản này." };
  }

  const person = data as {
    id: string;
    status: string;
    role: string;
    full_name: string | null;
    email: string | null;
  };
  const email = String(person.email ?? "").trim();

  if (person.status !== "active") {
    return { ok: false, message: `Tài khoản ${email || adminUserId} đang không hoạt động.` };
  }
  if (!(SUPPORTER_ELIGIBLE_ROLES as readonly string[]).includes(person.role)) {
    return {
      ok: false,
      message: "Chỉ tài khoản Support team mới thêm được vào danh sách hỗ trợ điểm danh."
    };
  }

  const { error: insertError } = await client.from("event_supporters").insert({
    event_id: input.eventId,
    admin_user_id: person.id,
    added_by: input.addedBy
  });

  // 23505 = đã có trong danh sách. Thêm lại là thao tác vô hại.
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    log("addEventSupporter:insert", insertError);
    return { ok: false, message: VI_ERROR };
  }

  const name = String(person.full_name ?? "").trim() || email;
  return {
    ok: true,
    message: insertError ? `${name} đã có trong danh sách hỗ trợ.` : `Đã thêm ${name} vào danh sách hỗ trợ.`
  };
}

export async function removeEventSupporter(input: {
  eventId: string;
  supporterId: string;
}): Promise<{ ok: boolean; message: string }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: VI_ERROR };

  const { error } = await client
    .from("event_supporters")
    .delete()
    .eq("id", input.supporterId)
    // Buộc khớp cả sự kiện: một id đoán trúng cũng không xoá được người hỗ trợ
    // của một buổi khác.
    .eq("event_id", input.eventId);

  if (error) {
    log("removeEventSupporter", error);
    return { ok: false, message: VI_ERROR };
  }
  return { ok: true, message: "Đã bỏ khỏi danh sách hỗ trợ." };
}
