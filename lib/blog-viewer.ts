import "server-only";

import { getCurrentAdminUser, getCurrentSupabaseAuthUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { ANONYMOUS, type Viewer } from "@/lib/blog-core";

/**
 * Người đang đọc trang blog là ai.
 *
 * ---------------------------------------------------------------------------
 * FAIL-CLOSED, VÀ Ở ĐÂY NÓ CÓ NGHĨA CỤ THỂ
 * ---------------------------------------------------------------------------
 * Bất cứ bước nào hỏng — không đọc được phiên, không tra được vai trò — thì trả
 * về người ẩn danh. Người ẩn danh chỉ thấy bài công khai.
 *
 * Chiều ngược lại mới là chiều nguy hiểm: một sự cố hạ tầng khiến hệ thống coi
 * người lạ là người đã đăng nhập sẽ đẩy bài nội bộ ra internet, và bài nội bộ
 * ra ngoài là không thu hồi được.
 */
export async function resolveBlogViewer(): Promise<Viewer> {
  let signedIn = false;
  try {
    const authUser = await getCurrentSupabaseAuthUser();
    signedIn = Boolean(authUser?.id);
  } catch {
    return ANONYMOUS;
  }

  if (!signedIn) return ANONYMOUS;

  let canManage = false;
  try {
    const adminUser = await getCurrentAdminUser();
    canManage = canEditRecaps(adminUser);
  } catch {
    // Có phiên đăng nhập thật thì vẫn đọc được bài nội bộ; chỉ là không xem
    // được bản nháp. Hạ xuống, không hạ hẳn về ẩn danh.
    canManage = false;
  }

  return { signedIn: true, canManage };
}
