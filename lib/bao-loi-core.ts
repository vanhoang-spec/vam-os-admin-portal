/**
 * Báo lỗi / góp ý cải thiện (chủ chương trình 27/10/2026) — phần thuần, không I/O.
 *
 * Mọi thứ đến từ trình duyệt (loại, tiêu đề, mô tả, đường dẫn ảnh, trang) là thứ người gửi tự đặt
 * được: kiểm lại hết ở đây trước khi ghi. Đường dẫn ảnh phải nằm đúng thư mục <id tài khoản>/ của
 * chính người gửi và có tên do máy chủ sinh — nếu không, một người có thể gắn ảnh của người khác
 * vào báo lỗi của mình rồi đọc nó qua link ký sẵn.
 */

export type LoaiBaoLoi = "khong_mo_duoc" | "hien_thi_sai" | "du_lieu_sai" | "gui_thu" | "dang_nhap" | "de_xuat" | "khac";

export const LOAI_BAO_LOI: { id: LoaiBaoLoi; ten: string }[] = [
  { id: "khong_mo_duoc", ten: "Trang không mở được / bị treo / chạy chậm" },
  { id: "hien_thi_sai", ten: "Hiển thị sai (chữ, hình, nút bị lệch / che)" },
  { id: "du_lieu_sai", ten: "Dữ liệu / số liệu sai" },
  { id: "gui_thu", ten: "Gửi thư / email" },
  { id: "dang_nhap", ten: "Đăng nhập / phân quyền" },
  { id: "de_xuat", ten: "Đề xuất cải thiện (điểm cần làm tốt hơn)" },
  { id: "khac", ten: "Vấn đề khác" }
];
export const TEN_LOAI_BAO_LOI = Object.fromEntries(LOAI_BAO_LOI.map((l) => [l.id, l.ten])) as Record<LoaiBaoLoi, string>;

export type TrangThaiBaoLoi =
  | "moi"
  | "dang_xu_ly"
  | "can_chu"
  | "cho_bo_sung"
  | "da_xu_ly"
  | "khong_tai_hien"
  | "khong_phai_loi"
  | "trung";

export const TEN_TRANG_THAI_BAO_LOI: Record<TrangThaiBaoLoi, string> = {
  moi: "Mới",
  dang_xu_ly: "Đang xử lý",
  can_chu: "Chờ chủ chương trình",
  cho_bo_sung: "Chờ người gửi bổ sung",
  da_xu_ly: "Đã xử lý",
  khong_tai_hien: "Không tái hiện được",
  khong_phai_loi: "Không phải lỗi",
  trung: "Trùng báo lỗi khác"
};
export const TRANG_THAI_MO: TrangThaiBaoLoi[] = ["moi", "dang_xu_ly", "can_chu", "cho_bo_sung"];
export const TRANG_THAI_DONG: TrangThaiBaoLoi[] = ["da_xu_ly", "khong_tai_hien", "khong_phai_loi", "trung"];

export const SO_ANH_TOI_DA = 5;
export const BAO_LOI_TOI_DA_24H = 10;
export const BO_SUNG_TOI_DA_MOI_BAO_LOI = 20;
export const BAO_LOI_KHO_ANH = "bao-loi";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MA_RE = /^VAM\d{5}$/;

export function laMaBaoLoi(value: unknown): value is string {
  return typeof value === "string" && MA_RE.test(value);
}

export function chuanMaBaoLoi(value: unknown): string | null {
  const ma = String(value ?? "").trim().toUpperCase();
  return MA_RE.test(ma) ? ma : null;
}

export function laLoaiBaoLoi(value: unknown): value is LoaiBaoLoi {
  return LOAI_BAO_LOI.some((l) => l.id === value);
}

export function laTrangThaiBaoLoi(value: unknown): value is TrangThaiBaoLoi {
  return typeof value === "string" && value in TEN_TRANG_THAI_BAO_LOI;
}

/** Tên tệp ảnh do máy chủ sinh cho người gửi `actorId`: <actorId>/<uuid>.jpg. */
export function duongDanAnhMoi(actorId: string, uuid: string): string {
  return `${actorId}/${uuid}.jpg`;
}

/** Đường dẫn ảnh hợp lệ của người gửi `actorId`: đúng thư mục của họ, tên dạng uuid, đuôi jpg. */
export function laAnhCuaNguoiGui(actorId: string, path: unknown): boolean {
  if (typeof path !== "string" || !new RegExp(`^${UUID}$`).test(actorId)) return false;
  return new RegExp(`^${actorId}/${UUID}\\.jpg$`).test(path);
}

/** Gọn khoảng trắng của một dòng tiêu đề. */
function gonDong(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Thông tin máy: chỉ giữ vài khoá đã biết, giá trị ngắn — không để trình duyệt nhét dữ liệu tuỳ ý vào. */
export function gonThietBi(value: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!value || typeof value !== "object") return out;
  const src = value as Record<string, unknown>;
  for (const key of ["ua", "man_hinh", "khung", "dpr", "ngoai_tuyen", "luc"]) {
    const v = src[key];
    if (typeof v === "string") out[key] = v.slice(0, 300);
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

export type BaoLoiMoi = {
  loai: LoaiBaoLoi;
  tieuDe: string;
  noiDung: string;
  trang: string | null;
  anh: string[];
  thietBi: Record<string, string | number | boolean>;
};

export type KiemTraKetQua<T> = { ok: true; value: T } | { ok: false; error: string };

/** Kiểm báo lỗi người dùng gửi lên. */
export function kiemBaoLoiMoi(actorId: string, input: Record<string, unknown>): KiemTraKetQua<BaoLoiMoi> {
  if (!laLoaiBaoLoi(input.loai)) return { ok: false, error: "Bạn chọn loại vấn đề nhé." };
  const tieuDe = gonDong(input.tieuDe, 120);
  if (tieuDe.length < 3) return { ok: false, error: "Bạn ghi tiêu đề ngắn gọn cho lỗi nhé (ít nhất 3 chữ)." };
  const noiDung = String(input.noiDung ?? "").replace(/\r\n/g, "\n").trim();
  if (noiDung.length > 4000) return { ok: false, error: "Mô tả dài quá 4.000 ký tự — bạn rút gọn giúp nhé." };
  const anh = kiemAnh(actorId, input.anh);
  if (!anh.ok) return anh;
  const trangRaw = String(input.trang ?? "").trim();
  const trang = trangRaw.startsWith("/") && !trangRaw.startsWith("//") ? trangRaw.slice(0, 300) : null;
  return { ok: true, value: { loai: input.loai, tieuDe, noiDung, trang, anh: anh.value, thietBi: gonThietBi(input.thietBi) } };
}

export function kiemAnh(actorId: string, value: unknown): KiemTraKetQua<string[]> {
  const list = Array.isArray(value) ? value : [];
  if (list.length > SO_ANH_TOI_DA) return { ok: false, error: `Tối đa ${SO_ANH_TOI_DA} hình mỗi lần.` };
  if (!list.every((p) => laAnhCuaNguoiGui(actorId, p))) return { ok: false, error: "Chưa tải được hình — bạn chọn lại hình rồi gửi nhé." };
  if (new Set(list).size !== list.length) return { ok: false, error: "Hình bị trùng — bạn chọn lại hình nhé." };
  return { ok: true, value: list as string[] };
}

/** Kiểm phần người gửi trả lời bổ sung: chữ hoặc hình, ít nhất một thứ. */
export function kiemBoSung(actorId: string, input: Record<string, unknown>): KiemTraKetQua<{ noiDung: string; anh: string[] }> {
  const noiDung = String(input.noiDung ?? "").replace(/\r\n/g, "\n").trim();
  if (noiDung.length > 4000) return { ok: false, error: "Câu trả lời dài quá 4.000 ký tự — bạn rút gọn giúp nhé." };
  const anh = kiemAnh(actorId, input.anh);
  if (!anh.ok) return anh;
  if (!noiDung && anh.value.length === 0) return { ok: false, error: "Bạn ghi câu trả lời hoặc thêm hình nhé." };
  return { ok: true, value: { noiDung, anh: anh.value } };
}

/** Câu hỏi lại người gửi. */
export function kiemCauHoi(value: unknown): KiemTraKetQua<string> {
  const cauHoi = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (cauHoi.length < 3) return { ok: false, error: "Bạn ghi câu hỏi cho người gửi nhé (ít nhất 3 chữ)." };
  if (cauHoi.length > 4000) return { ok: false, error: "Câu hỏi dài quá 4.000 ký tự." };
  return { ok: true, value: cauHoi };
}

/**
 * Bản vá một báo lỗi khi người xử lý bấm Lưu. null = giữ nguyên; trả lời "" = xoá trả lời. Đổi trả
 * lời thì người gửi thấy pop-up lại (da_xem_luc về null). Đóng thì ghi dong_luc (giữ mốc cũ nếu có).
 */
export function vaCapNhat(
  hienTai: { trang_thai: TrangThaiBaoLoi; tra_loi: string | null; dong_luc: string | null },
  v: { trangThai: TrangThaiBaoLoi; traLoi: string | null; ghiChu: string | null; trungVoiId: string | null | undefined },
  boi: string,
  now: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = { trang_thai: v.trangThai, xu_ly_boi: boi, cap_nhat_luc: now };
  if (v.traLoi !== null) {
    const moi = v.traLoi.trim() || null;
    if (moi !== hienTai.tra_loi) {
      patch.tra_loi = moi;
      patch.tra_loi_luc = moi ? now : null;
      patch.da_xem_luc = null;
    }
  }
  if (v.ghiChu !== null) patch.ghi_chu_noi_bo = v.ghiChu.trim() || null;
  if (v.trungVoiId !== undefined) patch.trung_voi = v.trungVoiId;
  patch.dong_luc = TRANG_THAI_DONG.includes(v.trangThai) ? hienTai.dong_luc ?? now : null;
  return patch;
}

/** Gom đường dẫn trang để đếm tần suất: bỏ ?query. */
export function gonTrang(trang: string | null): string {
  return trang ? trang.split("?")[0] || "/" : "(không rõ)";
}
