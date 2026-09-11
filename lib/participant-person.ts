import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * Tên để chào một người, đọc từ danh bạ.
 *
 * Tách riêng khỏi `lib/participant-home.ts` vì hai câu hỏi khác nhau: một cái
 * là "người này tham gia gì", một cái là "gọi họ là gì". Khung màn hình cần cái
 * thứ hai kể cả khi cái thứ nhất chưa có gì để trả lời.
 *
 * Trả về `null` chứ không phải chuỗi rỗng khi không đọc được: chỗ gọi tự chọn
 * lời chào thay thế, thay vì hiện ra "Chào ,".
 */
export async function getPersonDisplayName(personId: string): Promise<string | null> {
  const id = String(personId ?? "").trim();
  if (!id) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("people")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[participant-person] đọc tên", {
      code: (error as { code?: string }).code,
      message: (error as { message?: string }).message
    });
    return null;
  }

  const name = String((data as { full_name?: string } | null)?.full_name ?? "").trim();
  return name || null;
}

/**
 * Tên của người đang đăng nhập, cho khung màn hình.
 *
 * Khung được vẽ trước cả nội dung trang, và nó chỉ cần một cái tên. Nếu bất cứ
 * bước nào không xong — chưa đăng nhập, chưa nối được danh tính, đọc hỏng — thì
 * trả về `null` và khung hiện không có tên. Khung không phải chỗ báo lỗi; trang
 * bên trong mới là chỗ nói cho người đọc biết chuyện gì đang xảy ra.
 */
export async function getParticipantDisplayName(): Promise<string | null> {
  try {
    const { getCurrentSupabaseAuthUser } = await import("@/lib/admin-auth");
    const { resolveParticipantIdentity } = await import("@/lib/participant-auth");

    const authUser = await getCurrentSupabaseAuthUser();
    if (!authUser?.id) return null;

    const identity = await resolveParticipantIdentity({
      authUserId: authUser.id,
      authEmail: authUser.email ?? null
    });
    if (!identity.personId) return null;

    return await getPersonDisplayName(identity.personId);
  } catch {
    return null;
  }
}
