import "server-only";

/**
 * Báo lỗi / góp ý cải thiện (chủ chương trình 27/10/2026) — phần máy chủ.
 *
 * Hai bảng bật RLS và không cấp gì cho anon/authenticated, nên mọi đọc/ghi đi bằng service role SAU
 * KHI tự kiểm quyền ở đây (fail-closed — thiếu tài khoản, không active, vai trò không đủ, không có
 * client: đều là "không"):
 *   - nguoiGui(): mọi tài khoản ban tổ chức đang active — gửi báo lỗi, xem / bổ sung báo lỗi của CHÍNH MÌNH;
 *   - nguoiXuLy(): canManageBaoLoi — xem hết, đổi trạng thái, trả lời, hỏi lại.
 * Nội dung báo lỗi là dữ liệu người dùng gõ; không chỗ nào ở đây diễn giải nó thành lệnh.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { capLinkTaiAnh, linkXemAnh, type LinkTaiAnh } from "@/lib/bao-loi-anh";
import type {
  BaoLoiCanXem,
  BaoLoiChiTiet,
  BaoLoiDong,
  CapNhatBaoLoiInput,
  KetQuaBaoLoi,
  TraoDoiBaoLoi
} from "@/lib/bao-loi-action-types";
import {
  BAO_LOI_TOI_DA_24H,
  BO_SUNG_TOI_DA_MOI_BAO_LOI,
  TRANG_THAI_DONG,
  chuanMaBaoLoi,
  kiemBaoLoiMoi,
  kiemBoSung,
  kiemCauHoi,
  laTrangThaiBaoLoi,
  vaCapNhat,
  type LoaiBaoLoi,
  type TrangThaiBaoLoi
} from "@/lib/bao-loi-core";
import { sendBaoLoiHoiLai } from "@/lib/email";
import { canManageBaoLoi } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;
type Row = Record<string, unknown>;
type Nguoi = { client: ServiceClient; id: string; email: string; ten: string; vai: string };

const KHONG_QUYEN: KetQuaBaoLoi<never> = { ok: false, error: "Bạn không có quyền làm việc này." };
const LOI_MAY_CHU: KetQuaBaoLoi<never> = { ok: false, error: "Máy chủ đang bận — bạn thử lại sau ít phút nhé." };

async function nguoiGui(): Promise<Nguoi | null> {
  const admin = await getCurrentAdminUser();
  if (!admin || admin.status !== "active") return null;
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  return {
    client,
    id: String(admin.id),
    email: String(admin.email ?? "").trim(),
    ten: String(admin.full_name ?? "").trim() || String(admin.email ?? ""),
    vai: String(admin.role ?? "")
  };
}

async function nguoiXuLy(): Promise<Nguoi | null> {
  const nguoi = await nguoiGui();
  return nguoi && canManageBaoLoi(nguoi.vai) ? nguoi : null;
}

export async function coQuyenXuLyBaoLoi(): Promise<boolean> {
  return (await nguoiXuLy()) !== null;
}

const str = (v: unknown) => (v == null ? null : String(v));

function toTraoDoi(r: Row, anhLink: Map<string, string>): TraoDoiBaoLoi {
  return {
    id: String(r.id),
    ben: r.ben === "hoi" ? "hoi" : "tra_loi",
    ten: str(r.ten),
    noiDung: String(r.noi_dung ?? ""),
    anh: ((r.anh as string[] | null) ?? []).map((p) => anhLink.get(p) ?? ""),
    taoLuc: String(r.tao_luc ?? "")
  };
}

/** Cấp link tải ảnh lên kho riêng, trong thư mục của chính người đang đăng nhập. */
export async function xinLinkTaiAnh(soAnh: number): Promise<KetQuaBaoLoi<LinkTaiAnh[]>> {
  const nguoi = await nguoiGui();
  if (!nguoi) return KHONG_QUYEN;
  const links = await capLinkTaiAnh(nguoi.id, soAnh);
  return links ? { ok: true, value: links } : LOI_MAY_CHU;
}

/** Gửi một báo lỗi mới. Trả mã VAM00012. */
export async function guiBaoLoi(input: Record<string, unknown>): Promise<KetQuaBaoLoi<{ ma: string }>> {
  const nguoi = await nguoiGui();
  if (!nguoi) return KHONG_QUYEN;
  const kiem = kiemBaoLoiMoi(nguoi.id, input);
  if (!kiem.ok) return kiem;
  // Chống gửi tràn: tối đa BAO_LOI_TOI_DA_24H báo lỗi mỗi tài khoản trong 24 giờ.
  const tu = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: e1 } = await nguoi.client
    .from("bao_loi")
    .select("id", { count: "exact", head: true })
    .eq("nguoi_gui", nguoi.id)
    .gte("tao_luc", tu);
  if (e1) return LOI_MAY_CHU;
  if ((count ?? 0) >= BAO_LOI_TOI_DA_24H) {
    return { ok: false, error: "Bạn đã gửi nhiều báo lỗi trong hôm nay. Ban xử lý đang xem — bạn thử lại vào ngày mai nhé." };
  }
  const v = kiem.value;
  const { data, error } = await nguoi.client
    .from("bao_loi")
    .insert({
      nguoi_gui: nguoi.id,
      ten_gui: nguoi.ten,
      email_gui: nguoi.email || null,
      vai: nguoi.vai || "khong_ro",
      loai: v.loai,
      tieu_de: v.tieuDe,
      noi_dung: v.noiDung,
      trang: v.trang,
      thiet_bi: v.thietBi,
      anh: v.anh
    })
    .select("ma")
    .single();
  if (error || !data) return LOI_MAY_CHU;
  return { ok: true, value: { ma: String((data as Row).ma) } };
}

/** Pop-up lúc mở VAM OS: trả lời chưa xem + báo lỗi đang chờ mình bổ sung. Lỗi → rỗng, không làm phiền. */
export async function baoLoiCanXem(): Promise<BaoLoiCanXem> {
  const rong: BaoLoiCanXem = { traLoi: [], canBoSung: [] };
  const nguoi = await nguoiGui();
  if (!nguoi) return rong;
  const { data: traLoi, error: e1 } = await nguoi.client
    .from("bao_loi")
    .select("id,ma,tieu_de,trang_thai,tra_loi,tao_luc")
    .eq("nguoi_gui", nguoi.id)
    .not("tra_loi", "is", null)
    .is("da_xem_luc", null)
    .order("tra_loi_luc", { ascending: true })
    .limit(5);
  const { data: cho, error: e2 } = await nguoi.client
    .from("bao_loi")
    .select("id,ma,tieu_de")
    .eq("nguoi_gui", nguoi.id)
    .eq("trang_thai", "cho_bo_sung")
    .order("cap_nhat_luc", { ascending: true })
    .limit(5);
  if (e1 || e2) return rong;
  const choRows = (cho ?? []) as Row[];
  const cauHoi = new Map<string, string>();
  if (choRows.length) {
    const { data: hoi } = await nguoi.client
      .from("bao_loi_trao_doi")
      .select("bao_loi_id,noi_dung,tao_luc")
      .in("bao_loi_id", choRows.map((r) => String(r.id)))
      .eq("ben", "hoi")
      .order("tao_luc", { ascending: true });
    for (const h of (hoi ?? []) as Row[]) cauHoi.set(String(h.bao_loi_id), String(h.noi_dung ?? ""));
  }
  return {
    traLoi: ((traLoi ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      ma: String(r.ma),
      tieuDe: String(r.tieu_de ?? ""),
      trangThai: (laTrangThaiBaoLoi(r.trang_thai) ? r.trang_thai : "da_xu_ly") as TrangThaiBaoLoi,
      traLoi: String(r.tra_loi ?? ""),
      taoLuc: String(r.tao_luc ?? "")
    })),
    canBoSung: choRows.map((r) => ({ id: String(r.id), ma: String(r.ma), tieuDe: String(r.tieu_de ?? ""), cauHoi: cauHoi.get(String(r.id)) ?? "" }))
  };
}

/** Người gửi bấm "Đã hiểu" trên pop-up trả lời. Chỉ chạm đúng một cột, chỉ báo lỗi của chính mình. */
export async function daXemTraLoi(ids: string[]): Promise<void> {
  const nguoi = await nguoiGui();
  if (!nguoi || ids.length === 0) return;
  await nguoi.client
    .from("bao_loi")
    .update({ da_xem_luc: new Date().toISOString() })
    .in("id", ids.slice(0, 5))
    .eq("nguoi_gui", nguoi.id)
    .not("tra_loi", "is", null);
}

async function docTraoDoi(client: ServiceClient, baoLoiId: string): Promise<Row[]> {
  const { data, error } = await client
    .from("bao_loi_trao_doi")
    .select("id,ben,ten,noi_dung,anh,tao_luc")
    .eq("bao_loi_id", baoLoiId)
    .order("tao_luc", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function dungChiTiet(client: ServiceClient, r: Row): Promise<BaoLoiChiTiet> {
  const traoDoi = await docTraoDoi(client, String(r.id));
  const anhGoc = (r.anh as string[] | null) ?? [];
  const tatCa = [...anhGoc, ...traoDoi.flatMap((t) => (t.anh as string[] | null) ?? [])];
  const links = await linkXemAnh(tatCa);
  const anhLink = new Map(tatCa.map((p, i) => [p, links[i] ?? ""]));
  let trungVoiMa: string | null = null;
  if (r.trung_voi) {
    const { data } = await client.from("bao_loi").select("ma").eq("id", String(r.trung_voi)).maybeSingle();
    trungVoiMa = data ? String((data as Row).ma) : null;
  }
  return {
    id: String(r.id),
    ma: String(r.ma),
    loai: r.loai as LoaiBaoLoi,
    tieuDe: String(r.tieu_de ?? ""),
    noiDung: String(r.noi_dung ?? ""),
    trang: str(r.trang),
    thietBi: (r.thiet_bi as Record<string, unknown> | null) ?? {},
    anh: anhGoc.map((p) => anhLink.get(p) ?? ""),
    trangThai: (laTrangThaiBaoLoi(r.trang_thai) ? r.trang_thai : "moi") as TrangThaiBaoLoi,
    trungVoiMa,
    traLoi: str(r.tra_loi),
    daXemLuc: str(r.da_xem_luc),
    ghiChuNoiBo: str(r.ghi_chu_noi_bo),
    commitSua: str(r.commit_sua),
    xuLyBoi: r.xu_ly_boi === "tu-dong" ? "Tự động (lịch rà / phát hành)" : str(r.xu_ly_boi),
    tenGui: str(r.ten_gui),
    emailGui: str(r.email_gui),
    vai: String(r.vai ?? ""),
    taoLuc: String(r.tao_luc ?? ""),
    traoDoi: traoDoi.map((t) => toTraoDoi(t, anhLink))
  };
}

const COT = "id,ma,loai,tieu_de,noi_dung,trang,thiet_bi,anh,trang_thai,trung_voi,tra_loi,da_xem_luc,ghi_chu_noi_bo,commit_sua,xu_ly_boi,ten_gui,email_gui,vai,tao_luc";

/** Báo lỗi của CHÍNH người đang đăng nhập (trang /bao-loi?ticket=…). null = không có / không phải của mình. */
export async function baoLoiCuaToi(maRaw: string): Promise<BaoLoiChiTiet | null> {
  const nguoi = await nguoiGui();
  const ma = chuanMaBaoLoi(maRaw);
  if (!nguoi || !ma) return null;
  const { data, error } = await nguoi.client.from("bao_loi").select(COT).eq("ma", ma).eq("nguoi_gui", nguoi.id).maybeSingle();
  if (error || !data) return null;
  const ct = await dungChiTiet(nguoi.client, data as Row);
  // Người gửi không xem ghi chú nội bộ.
  return { ...ct, ghiChuNoiBo: null, commitSua: null };
}

/** Người gửi trả lời / bổ sung (chữ + hình). Báo lỗi đang chờ bổ sung thì về "Đang xử lý". */
export async function boSungBaoLoi(id: string, input: Record<string, unknown>): Promise<KetQuaBaoLoi> {
  const nguoi = await nguoiGui();
  if (!nguoi) return KHONG_QUYEN;
  const kiem = kiemBoSung(nguoi.id, input);
  if (!kiem.ok) return kiem;
  const { data: b, error } = await nguoi.client.from("bao_loi").select("id,trang_thai").eq("id", id).eq("nguoi_gui", nguoi.id).maybeSingle();
  if (error) return LOI_MAY_CHU;
  if (!b) return { ok: false, error: "Không tìm thấy báo lỗi này." };
  if (TRANG_THAI_DONG.includes((b as Row).trang_thai as TrangThaiBaoLoi)) {
    return { ok: false, error: "Báo lỗi này đã đóng — nếu vẫn còn lỗi, bạn gửi một báo lỗi mới nhé." };
  }
  const { count } = await nguoi.client
    .from("bao_loi_trao_doi")
    .select("id", { count: "exact", head: true })
    .eq("bao_loi_id", id)
    .eq("ben", "tra_loi");
  if ((count ?? 0) >= BO_SUNG_TOI_DA_MOI_BAO_LOI) return { ok: false, error: "Báo lỗi này đã nhận nhiều lượt bổ sung — ban xử lý sẽ liên hệ bạn." };
  const { error: e2 } = await nguoi.client
    .from("bao_loi_trao_doi")
    .insert({ bao_loi_id: id, ben: "tra_loi", nguoi: nguoi.id, ten: nguoi.ten, noi_dung: kiem.value.noiDung, anh: kiem.value.anh });
  if (e2) return LOI_MAY_CHU;
  await nguoi.client
    .from("bao_loi")
    .update({ trang_thai: "dang_xu_ly", cap_nhat_luc: new Date().toISOString() })
    .eq("id", id)
    .eq("trang_thai", "cho_bo_sung");
  return { ok: true, value: null };
}

// ---------- Phía người xử lý (canManageBaoLoi) ----------

export async function dsBaoLoi(): Promise<KetQuaBaoLoi<BaoLoiDong[]>> {
  const nguoi = await nguoiXuLy();
  if (!nguoi) return KHONG_QUYEN;
  const { data, error } = await nguoi.client
    .from("bao_loi")
    .select("id,ma,loai,tieu_de,trang,anh,trang_thai,trung_voi,tra_loi,da_xem_luc,ten_gui,vai,tao_luc")
    .order("tao_luc", { ascending: false })
    .limit(1000);
  if (error) return LOI_MAY_CHU;
  const rows = (data ?? []) as Row[];
  const { data: td, error: e2 } = await nguoi.client
    .from("bao_loi_trao_doi")
    .select("bao_loi_id,ben,tao_luc")
    .order("tao_luc", { ascending: true })
    .limit(5000);
  if (e2) return LOI_MAY_CHU;
  const dem = new Map<string, { n: number; cuoi: "hoi" | "tra_loi" }>();
  for (const t of (td ?? []) as Row[]) {
    const k = String(t.bao_loi_id);
    dem.set(k, { n: (dem.get(k)?.n ?? 0) + 1, cuoi: t.ben === "hoi" ? "hoi" : "tra_loi" });
  }
  const maTheoId = new Map(rows.map((r) => [String(r.id), String(r.ma)]));
  return {
    ok: true,
    value: rows.map((r) => ({
      id: String(r.id),
      ma: String(r.ma),
      loai: r.loai as LoaiBaoLoi,
      tieuDe: String(r.tieu_de ?? ""),
      trang: str(r.trang),
      soAnh: ((r.anh as string[] | null) ?? []).length,
      trangThai: (laTrangThaiBaoLoi(r.trang_thai) ? r.trang_thai : "moi") as TrangThaiBaoLoi,
      trungVoiMa: r.trung_voi ? maTheoId.get(String(r.trung_voi)) ?? null : null,
      traLoi: str(r.tra_loi),
      daXemLuc: str(r.da_xem_luc),
      tenGui: str(r.ten_gui),
      vai: String(r.vai ?? ""),
      taoLuc: String(r.tao_luc ?? ""),
      soTraoDoi: dem.get(String(r.id))?.n ?? 0,
      luotCuoi: dem.get(String(r.id))?.cuoi ?? null
    }))
  };
}

export async function chiTietBaoLoi(maRaw: string): Promise<KetQuaBaoLoi<BaoLoiChiTiet | null>> {
  const nguoi = await nguoiXuLy();
  if (!nguoi) return KHONG_QUYEN;
  const ma = chuanMaBaoLoi(maRaw);
  if (!ma) return { ok: true, value: null };
  const { data, error } = await nguoi.client.from("bao_loi").select(COT).eq("ma", ma).maybeSingle();
  if (error) return LOI_MAY_CHU;
  return { ok: true, value: data ? await dungChiTiet(nguoi.client, data as Row) : null };
}

/** Hỏi lại người gửi: ghi câu hỏi vào luồng, chuyển "Chờ người gửi bổ sung", gửi thư báo người gửi. */
export async function hoiLaiBaoLoi(id: string, cauHoiRaw: string): Promise<KetQuaBaoLoi<{ thu: boolean }>> {
  const nguoi = await nguoiXuLy();
  if (!nguoi) return KHONG_QUYEN;
  const kiem = kiemCauHoi(cauHoiRaw);
  if (!kiem.ok) return kiem;
  const { data: b, error } = await nguoi.client.from("bao_loi").select("id,ma,tieu_de,trang_thai,ten_gui,email_gui,nguoi_gui").eq("id", id).maybeSingle();
  if (error) return LOI_MAY_CHU;
  if (!b) return { ok: false, error: "Không tìm thấy báo lỗi này." };
  const row = b as Row;
  if (!row.nguoi_gui) return { ok: false, error: "Tài khoản người gửi không còn — không hỏi lại được." };
  if (TRANG_THAI_DONG.includes(row.trang_thai as TrangThaiBaoLoi)) return { ok: false, error: "Báo lỗi đã đóng — mở lại (đổi trạng thái) rồi mới hỏi." };
  const now = new Date().toISOString();
  const { error: e1 } = await nguoi.client
    .from("bao_loi_trao_doi")
    .insert({ bao_loi_id: id, ben: "hoi", nguoi: nguoi.id, ten: nguoi.ten, noi_dung: kiem.value });
  if (e1) return LOI_MAY_CHU;
  const { error: e2 } = await nguoi.client
    .from("bao_loi")
    .update({ trang_thai: "cho_bo_sung", xu_ly_boi: nguoi.id, dong_luc: null, cap_nhat_luc: now })
    .eq("id", id);
  if (e2) return LOI_MAY_CHU;
  let thu = false;
  const email = String(row.email_gui ?? "").trim();
  if (email) {
    const sent = await sendBaoLoiHoiLai({
      toEmail: email,
      recipientName: String(row.ten_gui ?? ""),
      baoLoiId: id,
      ma: String(row.ma),
      tieuDe: String(row.tieu_de ?? ""),
      cauHoi: kiem.value
    });
    thu = sent.ok;
  }
  return { ok: true, value: { thu } };
}

/** Lưu trạng thái / trả lời / ghi chú. Đóng báo lỗi gốc kèm trả lời → báo lỗi trùng chưa có trả lời nhận cùng trả lời. */
export async function capNhatBaoLoi(input: CapNhatBaoLoiInput): Promise<KetQuaBaoLoi> {
  const nguoi = await nguoiXuLy();
  if (!nguoi) return KHONG_QUYEN;
  if (!laTrangThaiBaoLoi(input.trangThai)) return { ok: false, error: "Trạng thái không hợp lệ." };
  const { data: b, error } = await nguoi.client.from("bao_loi").select("id,trang_thai,tra_loi,dong_luc").eq("id", input.id).maybeSingle();
  if (error) return LOI_MAY_CHU;
  if (!b) return { ok: false, error: "Không tìm thấy báo lỗi này." };
  let trungVoiId: string | null | undefined = undefined;
  if (input.trungVoi !== null) {
    if (input.trungVoi === "") trungVoiId = null;
    else {
      const ma = chuanMaBaoLoi(input.trungVoi);
      if (!ma) return { ok: false, error: "Mã báo lỗi trùng không đúng (VD: VAM00012)." };
      const { data: g } = await nguoi.client.from("bao_loi").select("id").eq("ma", ma).maybeSingle();
      if (!g || String((g as Row).id) === input.id) return { ok: false, error: "Mã báo lỗi trùng không đúng (VD: VAM00012)." };
      trungVoiId = String((g as Row).id);
    }
  }
  if (input.trangThai === "trung" && !trungVoiId && input.trungVoi !== null) return { ok: false, error: "Trạng thái “Trùng” cần mã báo lỗi gốc." };
  const now = new Date().toISOString();
  const hienTai = b as { trang_thai: TrangThaiBaoLoi; tra_loi: string | null; dong_luc: string | null };
  const patch = vaCapNhat(hienTai, { trangThai: input.trangThai, traLoi: input.traLoi, ghiChu: input.ghiChu, trungVoiId }, nguoi.id, now);
  const { error: e2 } = await nguoi.client.from("bao_loi").update(patch).eq("id", input.id);
  if (e2) return LOI_MAY_CHU;
  const traLoiMoi = (patch.tra_loi ?? hienTai.tra_loi) as string | null;
  if (traLoiMoi && ["da_xu_ly", "khong_tai_hien", "khong_phai_loi"].includes(input.trangThai)) {
    await nguoi.client
      .from("bao_loi")
      .update({ trang_thai: "trung", tra_loi: traLoiMoi, tra_loi_luc: now, da_xem_luc: null, dong_luc: now, xu_ly_boi: nguoi.id, cap_nhat_luc: now })
      .eq("trung_voi", input.id)
      .is("tra_loi", null);
  }
  return { ok: true, value: null };
}
