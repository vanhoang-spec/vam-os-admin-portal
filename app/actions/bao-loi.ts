"use server";

/**
 * Báo lỗi — server action gọi từ nút / hộp báo lỗi và trang quản trị. Mỗi hàm chỉ chuyển tiếp sang
 * lib/bao-loi.ts, nơi tự kiểm quyền; không hàm nào ở đây tin dữ liệu trình duyệt gửi lên.
 */
import { revalidatePath } from "next/cache";
import {
  baoLoiCanXem,
  baoLoiCuaToi,
  boSungBaoLoi,
  capNhatBaoLoi,
  chiTietBaoLoi,
  daXemTraLoi,
  guiBaoLoi,
  hoiLaiBaoLoi,
  xinLinkTaiAnh
} from "@/lib/bao-loi";
import type { BaoLoiCanXem, BaoLoiChiTiet, CapNhatBaoLoiInput, KetQuaBaoLoi } from "@/lib/bao-loi-action-types";
import type { LinkTaiAnh } from "@/lib/bao-loi-anh";

export async function xinLinkTaiAnhAction(soAnh: number): Promise<KetQuaBaoLoi<LinkTaiAnh[]>> {
  return xinLinkTaiAnh(Number(soAnh) || 0);
}

export async function guiBaoLoiAction(input: Record<string, unknown>): Promise<KetQuaBaoLoi<{ ma: string }>> {
  const kq = await guiBaoLoi(input ?? {});
  if (kq.ok) revalidatePath("/admin/bao-loi");
  return kq;
}

export async function baoLoiCanXemAction(): Promise<BaoLoiCanXem> {
  return baoLoiCanXem();
}

export async function daXemTraLoiAction(ids: string[]): Promise<void> {
  await daXemTraLoi(Array.isArray(ids) ? ids.map(String) : []);
}

export async function baoLoiCuaToiAction(ma: string): Promise<BaoLoiChiTiet | null> {
  return baoLoiCuaToi(String(ma ?? ""));
}

export async function boSungBaoLoiAction(id: string, input: Record<string, unknown>): Promise<KetQuaBaoLoi> {
  const kq = await boSungBaoLoi(String(id ?? ""), input ?? {});
  if (kq.ok) revalidatePath("/admin/bao-loi");
  return kq;
}

export async function chiTietBaoLoiAction(ma: string): Promise<KetQuaBaoLoi<BaoLoiChiTiet | null>> {
  return chiTietBaoLoi(String(ma ?? ""));
}

export async function hoiLaiBaoLoiAction(id: string, cauHoi: string): Promise<KetQuaBaoLoi<{ thu: boolean }>> {
  const kq = await hoiLaiBaoLoi(String(id ?? ""), String(cauHoi ?? ""));
  if (kq.ok) revalidatePath("/admin/bao-loi");
  return kq;
}

export async function capNhatBaoLoiAction(input: CapNhatBaoLoiInput): Promise<KetQuaBaoLoi> {
  const kq = await capNhatBaoLoi(input);
  if (kq.ok) revalidatePath("/admin/bao-loi");
  return kq;
}
