import "server-only";

/**
 * Chặn người chưa có trên hệ thống ở form tùy chỉnh (VAM00009 mục 4.2, tùy chọn riêng từng form).
 *
 * Ticket yêu cầu không coi "email tồn tại" là đủ, và form công khai thì ai cũng gõ được email người khác.
 * Hợp lệ khi đủ cả ba: email khớp people.email_primary, họ tên khớp người đó (bỏ dấu, không phân biệt hoa
 * thường), và người đó có đơn đã duyệt (mentor hoặc mentee) ở mùa hiện tại. Mùa lấy theo cùng một cửa với
 * Vòng 2, nên form không tự giữ khái niệm "mùa" riêng. Người đã rút khỏi chương trình mà đơn vẫn ở trạng
 * thái duyệt thì vẫn qua cổng: bản thân đơn không ghi việc rút.
 */
import { escapeIlikePattern, normalizeEmail } from "@/lib/identity";
import { sameName } from "@/lib/custom-form-event";
import { SEASON_CONFIG } from "@/lib/season-config";
import type { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

/** Đúng nguyên văn ticket. */
export const KNOWN_PERSON_MESSAGE = "Thông tin của bạn chưa có trên hệ thống. Vui lòng liên hệ BTC để được hỗ trợ.";

/** Lỗi đọc database thì NÉM ra, không trả false lẫn true: bên gọi phải dừng, một lỗi hạ tầng không thành quyền. */
export async function isKnownPerson(client: ServiceClient, email: string, fullName: string): Promise<boolean> {
  const wanted = normalizeEmail(email);
  const { data: people, error: peopleError } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .ilike("email_primary", escapeIlikePattern(wanted))
    .limit(20);
  if (peopleError) throw peopleError;
  const ids = ((people ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null }>)
    .filter((p) => normalizeEmail(p.email_primary) === wanted && sameName(p.full_name, fullName))
    .map((p) => String(p.id));
  if (!ids.length) return false;
  const { data: season, error: seasonError } = await client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).maybeSingle();
  if (seasonError) throw seasonError;
  if (!season) throw new Error("SEASON_UNAVAILABLE");
  const { data: approved, error: appsError } = await client
    .from("applications")
    .select("id")
    .eq("season_id", String(season.id))
    .in("person_id", ids)
    .in("status", ["approved_as_mentor", "approved_as_mentee"])
    .limit(1);
  if (appsError) throw appsError;
  return (approved ?? []).length > 0;
}
