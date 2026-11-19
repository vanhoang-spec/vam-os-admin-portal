import "server-only";

/**
 * Mail › tệp đính kèm (VAM00037) — chỗ DUY NHẤT trong mã chạm kho riêng 'mail-dinh-kem' và bảng
 * public.email_attachments.
 *
 * Máy chủ VAM không bao giờ nhận, đọc hay phục vụ byte của tệp: nó chỉ
 *   - cấp link TẢI LÊN ký sẵn cho đường dẫn do chính nó sinh, trong thư mục <mùa>/<người tải>/;
 *   - đọc SIÊU DỮ LIỆU (cỡ, MIME) bằng `list` để kiểm lại điều trình duyệt khai;
 *   - xoá tệp người dùng bỏ khỏi danh sách trước khi gửi;
 *   - cấp link TẢI XUỐNG ký sẵn cho nhà cung cấp thư tự lấy tệp lúc gửi.
 * Mục 3e của __tests__/image-optimizer-attack-surface.test.ts khoá file này.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { EmailAttachment } from "@/lib/email-core";
import {
  MAIL_DINH_KEM_BUCKET,
  doiChieuTepTrongKho,
  duongDanTepMoi,
  dungDinhKemThu,
  kiemThemTep,
  laLoiThieuBang,
  laTepCuaNguoiTai,
  thuMucCuaTep,
  type TepDaKiem,
  type TepKhaiBao,
  type TepThamChieu,
  type TepTrongKho
} from "@/lib/mail-dinh-kem-core";

/**
 * Link tải xuống cho nhà cung cấp sống 24 giờ: Brevo / Resend lấy tệp ngay khi nhận yêu cầu, nhưng
 * một hàng đợi phía họ chậm vài giờ không được làm thư mất tệp. Link mới được cấp ở MỖI lần chạy lô,
 * nên "Gửi tiếp" hôm sau không dùng link cũ đã hết hạn.
 */
const LINK_NHA_CUNG_CAP_GIAY = 24 * 3600;

const LOI_KHO = "Chưa mở được kho tệp đính kèm. Thử lại sau ít phút; nếu vẫn lỗi, báo quản trị kỹ thuật.";

function log(scope: string, error: unknown) {
  const e = error as { code?: string; message?: string } | null;
  console.error(`[mail-dinh-kem] ${scope}`, { code: e?.code ?? null, message: e?.message ?? String(error) });
}

export type LinkTaiTep = { path: string; signedUrl: string; name: string; size: number; mime: string };

/**
 * Cấp link tải lên cho các tệp người dùng vừa chọn (đã kiểm tên/cỡ/số lượng cùng danh sách đang có).
 * `current` là cỡ các tệp đã tải trước đó trong cùng lá thư, để tổng không vượt giới hạn.
 */
export async function capLinkTaiTep(input: {
  seasonId: string;
  actorId: string;
  current: Array<{ size: number }>;
  files: TepKhaiBao[];
}): Promise<{ ok: true; links: LinkTaiTep[]; problems: string[] } | { ok: false; message: string }> {
  const { accepted, problems } = kiemThemTep(input.current, input.files);
  if (!accepted.length) return { ok: false, message: problems[0] ?? "Chưa chọn tệp nào." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: LOI_KHO };

  const links: LinkTaiTep[] = [];
  for (const file of accepted) {
    const path = duongDanTepMoi(input.seasonId, input.actorId, randomUUID(), file.name);
    const { data, error } = await client.storage.from(MAIL_DINH_KEM_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      log("createSignedUploadUrl", error);
      return { ok: false, message: LOI_KHO };
    }
    links.push({ path, signedUrl: data.signedUrl, name: file.name, size: file.size, mime: file.mime });
  }
  return { ok: true, links, problems };
}

/**
 * Đối chiếu danh sách form gửi lên với tệp THẬT trong kho. Mỗi tệp nằm một mình trong thư mục uuid
 * của nó, nên `list(thư mục)` trả đúng siêu dữ liệu tệp đó mà không đọc byte nào.
 */
export async function kiemTepDaTai(refs: TepThamChieu[]): Promise<{ ok: true; files: TepDaKiem[] } | { ok: false; message: string }> {
  if (!refs.length) return { ok: true, files: [] };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: LOI_KHO };

  const stored: TepTrongKho[] = [];
  for (const ref of refs) {
    const folder = thuMucCuaTep(ref.path);
    const { data, error } = await client.storage.from(MAIL_DINH_KEM_BUCKET).list(folder, { limit: 5 });
    if (error) {
      log("list", error);
      return { ok: false, message: LOI_KHO };
    }
    const fileName = ref.path.slice(folder.length + 1);
    const row = ((data ?? []) as Array<{ name?: string; metadata?: { size?: number; mimetype?: string } | null }>).find(
      (item) => item.name === fileName
    );
    if (row) {
      stored.push({ path: ref.path, size: Number(row.metadata?.size ?? 0), mimetype: row.metadata?.mimetype ?? null });
    }
  }
  return doiChieuTepTrongKho(refs, stored);
}

/** Bỏ một tệp chưa gửi khỏi kho. Chỉ tệp trong thư mục của chính người bấm, và chưa gắn vào lô nào. */
export async function boTepDaTai(input: { seasonId: string; actorId: string; path: string }): Promise<{ ok: boolean }> {
  if (!laTepCuaNguoiTai(input.seasonId, input.actorId, input.path)) return { ok: false };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false };

  // Tệp đã gắn vào một lô là tệp mà "Gửi tiếp" còn cần: không xoá. Không đọc được bảng → không xoá.
  const bound = await client.from("email_attachments").select("id").eq("storage_path", input.path).limit(1);
  if (bound.error && !laLoiThieuBang(bound.error)) {
    log("boTepDaTai:check", bound.error);
    return { ok: false };
  }
  if ((bound.data ?? []).length) return { ok: false };

  const { error } = await client.storage.from(MAIL_DINH_KEM_BUCKET).remove([input.path]);
  if (error) {
    log("remove", error);
    return { ok: false };
  }
  return { ok: true };
}

/** Link tải xuống ký sẵn cho nhà cung cấp, theo đúng thứ tự tệp. Thiếu link nào là lỗi — không gửi thư thiếu tệp. */
async function linkChoNhaCungCap(files: Array<{ path: string; name: string; mime: string }>): Promise<
  { ok: true; attachments: EmailAttachment[] } | { ok: false; message: string }
> {
  if (!files.length) return { ok: true, attachments: [] };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: LOI_KHO };
  const { data, error } = await client.storage
    .from(MAIL_DINH_KEM_BUCKET)
    .createSignedUrls(files.map((file) => file.path), LINK_NHA_CUNG_CAP_GIAY);
  if (error || !data) {
    log("createSignedUrls", error);
    return { ok: false, message: "Không lấy được tệp đính kèm trong kho, nên chưa gửi. Thử lại sau ít phút." };
  }
  const urls = new Map((data as Array<{ path?: string | null; signedUrl?: string | null }>).map((row) => [row.path ?? "", row.signedUrl ?? ""]));
  const withUrl = files.map((file) => ({ ...file, url: urls.get(file.path) ?? "" }));
  const missing = withUrl.find((file) => !file.url);
  if (missing) return { ok: false, message: `Không tìm thấy tệp “${missing.name}” trong kho, nên chưa gửi.` };
  return { ok: true, attachments: dungDinhKemThu(withUrl) };
}

/** Đính kèm cho bản gửi thử: tệp đã kiểm, chưa gắn vào lô nào. */
export async function dinhKemChoThuThu(files: TepDaKiem[]) {
  return linkChoNhaCungCap(files);
}

/**
 * Chốt tệp vào lô vừa mở: mỗi tệp một dòng trong public.email_attachments. "Gửi tiếp" đọc lại từ
 * đây, nên mọi lần chạy của lô — kể cả hôm sau — gửi đúng bộ tệp đã chốt cho từng người nhận.
 */
export async function ganTepVaoLo(input: {
  batchId: string;
  seasonId: string;
  actorId: string;
  files: TepDaKiem[];
}): Promise<{ error: string | null }> {
  if (!input.files.length) return { error: null };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: LOI_KHO };
  const { error } = await client.from("email_attachments").insert(
    input.files.map((file, position) => ({
      batch_id: input.batchId,
      season_id: input.seasonId,
      uploaded_by: input.actorId,
      position,
      storage_path: file.path,
      file_name: file.name,
      content_type: file.mime,
      size_bytes: file.size
    }))
  );
  if (error) {
    log("ganTepVaoLo", error);
    // Lô vừa mở mà không chốt được tệp thì đóng lại ngay: để nó "đang chạy" là mời ai đó bấm
    // "Gửi tiếp" và gửi thư thiếu tệp. Chưa lá thư nào đi ở bước này.
    const { error: closeError } = await client
      .from("email_batches")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", input.batchId);
    if (closeError) log("ganTepVaoLo:close", closeError);
    return {
      error: laLoiThieuBang(error)
        ? "Chưa bật tính năng đính kèm (thiếu bảng email_attachments). Lô đã đóng, chưa lá thư nào đi. Báo quản trị kỹ thuật áp migration."
        : "Không chốt được tệp đính kèm vào lô. Lô đã đóng, chưa lá thư nào đi."
    };
  }
  return { error: null };
}

/**
 * Tệp đã chốt của một lô, kèm link mới cho nhà cung cấp. Bảng chưa có (migration chưa áp) nghĩa là
 * chưa lô nào có tệp → trả rỗng, để gửi thư không đính kèm chạy y như trước. Lỗi đọc khác → báo lỗi:
 * một lô có tệp mà gửi đi thiếu tệp là lá thư sai không rút lại được.
 */
export async function tepCuaLo(batchId: string): Promise<{ attachments: EmailAttachment[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { attachments: [], error: LOI_KHO };
  const { data, error } = await client
    .from("email_attachments")
    .select("storage_path, file_name, content_type, position")
    .eq("batch_id", batchId)
    .order("position", { ascending: true });
  if (error) {
    if (laLoiThieuBang(error)) return { attachments: [], error: null };
    log("tepCuaLo", error);
    return { attachments: [], error: "Không đọc được tệp đính kèm của lô này, nên chưa gửi. Thử lại sau ít phút." };
  }
  const rows = (data ?? []) as Array<{ storage_path: string; file_name: string; content_type: string }>;
  if (!rows.length) return { attachments: [], error: null };
  const linked = await linkChoNhaCungCap(
    rows.map((row) => ({ path: String(row.storage_path), name: String(row.file_name), mime: String(row.content_type) }))
  );
  return linked.ok ? { attachments: linked.attachments, error: null } : { attachments: [], error: linked.message };
}
