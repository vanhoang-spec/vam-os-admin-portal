import "server-only";

/**
 * lib/person-delete.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Xoá hẳn một người khỏi hệ thống.
 *
 * ---------------------------------------------------------------------------
 * ĐƯỜNG NÀY ĐỂ DỌN HỒ SƠ SAI, KHÔNG PHẢI ĐỂ CHO AI ĐÓ NGHỈ
 * ---------------------------------------------------------------------------
 * Cho một mentor nghỉ mùa này thì dùng "Chuyển sang Không tham dự" hoặc "Huỷ tư
 * cách" — khôi phục được, và giữ lại lịch sử. Xoá hẳn là để dọn hồ sơ trùng, hồ
 * sơ nhập sai, tài khoản thử nghiệm: những dòng đáng lẽ không bao giờ tồn tại.
 *
 * Vì vậy hàm ở database (`vam097_delete_person`) TỪ CHỐI khi người đó còn dữ
 * liệu chương trình — cặp ghép, đơn ứng tuyển, recap, lượt điểm danh, tài khoản
 * đăng nhập. File này không tự quyết định gì trong chuyện đó: nó hỏi cùng một
 * hàm bản kê mà database dùng khi từ chối, nên màn hình không thể hứa một lệnh
 * xoá mà database sẽ chặn.
 *
 * ---------------------------------------------------------------------------
 * HAI NỬA CỦA CỔNG QUYỀN
 * ---------------------------------------------------------------------------
 * Nửa vai trò ở `lib/permissions.ts` (mentor → admin/core team; mentee → thêm
 * support team). Nửa phạm vi mùa ở trong hàm database. Cả hai đều chạy, và nửa
 * trong database là nửa quyết định: một lời gọi đi vòng qua giao diện vẫn bị
 * chặn ở đó.
 */

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canDeletePerson } from "@/lib/permissions";

type Json = Record<string, any>;

const SAFE_ERROR = "Không thực hiện được. Vui lòng thử lại; nếu lỗi lặp lại, xem server logs.";
const NO_PERMISSION = "Bạn không có quyền xoá hồ sơ này khỏi hệ thống.";

function log(message: string, error?: unknown) {
  const err = error as { code?: string; message?: string } | undefined;
  console.error(
    `[person-delete] ${message}`,
    err ? { code: err.code ?? null, message: err.message ?? String(error) } : ""
  );
}

/** Nhãn tiếng Việt của từng khoá trong bản kê. Khoá lạ thì hiện nguyên khoá. */
export const BLOCKER_LABELS: Record<string, string> = {
  cap_ghep: "cặp ghép mentor–mentee",
  don_ung_tuyen: "đơn ứng tuyển",
  recap: "recap đã nộp",
  tham_du_su_kien: "lượt tham dự sự kiện",
  da_diem_danh: "lượt đã điểm danh ở sự kiện",
  phan_cong_van_hanh: "phân công trong ban vận hành",
  viec_can_lam: "việc cần làm gắn với người này",
  tai_khoan_dang_nhap: "tài khoản đăng nhập đã liên kết",
  bai_blog: "bài blog đứng tên người này"
};

export const REMOVE_LABELS: Record<string, string> = {
  membership: "membership theo mùa",
  nhat_ky_membership: "dòng nhật ký membership",
  loi_moi_mua: "lời mời tham gia mùa",
  vai_tro: "vai trò đã gán",
  ghi_chu_crm: "ghi chú CRM",
  ho_so_mentor: "hồ sơ mentor",
  ho_so_mentee: "hồ sơ mentee",
  dang_ky_su_kien: "lượt đăng ký sự kiện"
};

export type CountEntry = { key: string; label: string; total: number };

export type PersonDeleteReport = {
  found: boolean;
  personId: string;
  fullName: string;
  email: string | null;
  isMentor: boolean;
  isMentee: boolean;
  otherRoles: string[];
  /** Thứ khiến hồ sơ này KHÔNG được xoá. Rỗng nghĩa là xoá được. */
  blockers: CountEntry[];
  /** Thứ sẽ mất theo. Chỉ liệt kê những mục khác 0. */
  removes: CountEntry[];
  /** Dòng còn lại nhưng mất liên kết tới người này. */
  orphans: CountEntry[];
  canDelete: boolean;
};

function entries(source: unknown, labels: Record<string, string>, keepZero = false): CountEntry[] {
  const raw = (source ?? {}) as Json;
  return Object.keys(raw)
    .map((key) => ({ key, label: labels[key] ?? key, total: Number(raw[key]) || 0 }))
    .filter((entry) => keepZero || entry.total > 0)
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key));
}

function toReport(personId: string, payload: Json): PersonDeleteReport {
  const person = (payload.person ?? {}) as Json;
  const otherRoles = Array.isArray(payload.other_roles) ? payload.other_roles.map(String) : [];
  return {
    found: payload.found === true,
    personId,
    fullName: String(person.full_name ?? "").trim(),
    email: String(person.email ?? "").trim() || null,
    isMentor: payload.is_mentor === true,
    isMentee: payload.is_mentee === true,
    otherRoles,
    blockers: entries(payload.blockers, BLOCKER_LABELS),
    removes: entries(payload.removes, REMOVE_LABELS),
    orphans: entries(payload.orphans, { dang_ky_mat_lien_ket: "lượt đăng ký sự kiện mất liên kết" }),
    canDelete: payload.can_delete === true
  };
}

/**
 * Bản kê "xoá người này thì mất gì".
 *
 * Trả về cả khi KHÔNG xoá được — màn hình cần nói rõ vướng cái gì, chứ một câu
 * "không xoá được" trần trụi thì người vận hành không biết phải làm gì tiếp.
 */
export async function getPersonDeleteReport(
  personId: unknown
): Promise<{ ok: boolean; message?: string; report?: PersonDeleteReport; allowed?: boolean }> {
  const id = String(personId ?? "").trim();
  if (!id) return { ok: false, message: "Thiếu mã hồ sơ." };

  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client.rpc("vam097_person_delete_report", { p_person_id: id });
  if (error) {
    log("report rpc failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const payload = (data ?? {}) as Json;
  if (payload.found !== true) return { ok: false, message: "Không tìm thấy hồ sơ này." };

  const report = toReport(id, payload);
  return {
    ok: true,
    report,
    // Nửa vai trò, tính trên dữ liệu đã lưu. Nửa phạm vi mùa do database giữ.
    allowed: canDeletePerson(actor.role, {
      isMentor: report.isMentor,
      isMentee: report.isMentee,
      hasOtherRole: report.otherRoles.length > 0
    })
  };
}

/**
 * Xoá thật.
 *
 * Người gọi phải gửi kèm `confirmName` đúng bằng họ tên đang lưu. Một hộp thoại
 * "Bạn chắc chứ?" thì người ta bấm Yes theo phản xạ; gõ lại tên bắt họ nhìn một
 * lần nữa xem mình đang đứng ở hồ sơ nào — cùng lý do với việc nhập lại ngày
 * trước khi gửi remind.
 */
export async function deletePersonFromSystem(input: {
  personId: unknown;
  reason: unknown;
  confirmName: unknown;
}): Promise<{ ok: boolean; message: string }> {
  const id = String(input.personId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const typed = String(input.confirmName ?? "").trim();
  if (!id) return { ok: false, message: "Thiếu mã hồ sơ." };
  if (!reason) return { ok: false, message: "Vui lòng ghi lý do xoá." };

  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };

  const loaded = await getPersonDeleteReport(id);
  if (!loaded.ok || !loaded.report) return { ok: false, message: loaded.message ?? SAFE_ERROR };
  const report = loaded.report;

  if (!loaded.allowed) return { ok: false, message: NO_PERMISSION };

  // So không phân biệt hoa thường và khoảng trắng thừa: người gõ lại một cái tên
  // tiếng Việt trên điện thoại không nên trượt vì một dấu cách.
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
  if (!typed || normalize(typed) !== normalize(report.fullName)) {
    return { ok: false, message: "Họ tên gõ lại chưa khớp hồ sơ này. Kiểm lại đúng người bạn định xoá." };
  }

  if (!report.canDelete) {
    return {
      ok: false,
      message: `Không xoá được: hồ sơ này còn ${report.blockers
        .map((entry) => `${entry.total} ${entry.label}`)
        .join(", ")}. Dùng Huỷ tư cách hoặc Chuyển sang Không tham dự thay vì xoá.`
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client.rpc("vam097_delete_person", {
    p_actor: actor.id,
    p_person_id: id,
    p_reason: reason
  });

  if (error) {
    log("delete rpc failed", error);
    const text = String((error as { message?: string }).message ?? "");
    // Hàm database nói tiếng Việt sẵn cho những lý do người vận hành cần biết;
    // giữ nguyên câu đó thay vì thay bằng một câu chung chung.
    if (text.includes("Không xoá được") || text.includes("Bạn không có quyền") || text.includes("Không tìm thấy")) {
      return { ok: false, message: text };
    }
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    message: `Đã xoá ${report.fullName} khỏi hệ thống, kèm ${report.removes
      .map((entry) => `${entry.total} ${entry.label}`)
      .join(", ") || "các dữ liệu đi kèm"}.`
  };
}
