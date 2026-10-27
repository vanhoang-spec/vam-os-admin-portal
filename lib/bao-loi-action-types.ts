/**
 * Báo lỗi — kiểu dữ liệu trả về cho server action (file "use server" chỉ được xuất hàm async, nên kiểu
 * nằm riêng ở đây).
 */
import type { LoaiBaoLoi, TrangThaiBaoLoi } from "@/lib/bao-loi-core";

export type KetQuaBaoLoi<T = null> = { ok: true; value: T } | { ok: false; error: string };

export type TraoDoiBaoLoi = { id: string; ben: "hoi" | "tra_loi"; ten: string | null; noiDung: string; anh: string[]; taoLuc: string };

/** Ticket đã có trả lời mà người gửi chưa xem, hoặc đang chờ người gửi bổ sung — pop-up lúc mở VAM OS. */
export type BaoLoiCanXem = {
  traLoi: { id: string; ma: string; tieuDe: string; trangThai: TrangThaiBaoLoi; traLoi: string; taoLuc: string }[];
  canBoSung: { id: string; ma: string; tieuDe: string; cauHoi: string }[];
};

/** Một báo lỗi kèm luồng hỏi – đáp; anh là link xem ký sẵn 1 giờ (chuỗi rỗng = không ký được). */
export type BaoLoiChiTiet = {
  id: string;
  ma: string;
  loai: LoaiBaoLoi;
  tieuDe: string;
  noiDung: string;
  trang: string | null;
  thietBi: Record<string, unknown>;
  anh: string[];
  trangThai: TrangThaiBaoLoi;
  trungVoiMa: string | null;
  traLoi: string | null;
  daXemLuc: string | null;
  ghiChuNoiBo: string | null;
  commitSua: string | null;
  xuLyBoi: string | null;
  tenGui: string | null;
  emailGui: string | null;
  vai: string;
  taoLuc: string;
  traoDoi: TraoDoiBaoLoi[];
};

/** Một dòng của bảng quản trị. */
export type BaoLoiDong = {
  id: string;
  ma: string;
  loai: LoaiBaoLoi;
  tieuDe: string;
  trang: string | null;
  soAnh: number;
  trangThai: TrangThaiBaoLoi;
  trungVoiMa: string | null;
  traLoi: string | null;
  daXemLuc: string | null;
  tenGui: string | null;
  vai: string;
  taoLuc: string;
  soTraoDoi: number;
  luotCuoi: "hoi" | "tra_loi" | null;
};

export type CapNhatBaoLoiInput = {
  id: string;
  trangThai: TrangThaiBaoLoi;
  /** null = giữ nguyên; "" = xoá trả lời */
  traLoi: string | null;
  ghiChu: string | null;
  /** mã báo lỗi gốc khi trạng thái là "trung"; "" = bỏ liên kết trùng */
  trungVoi: string | null;
};
