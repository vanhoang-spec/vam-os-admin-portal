import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  decideIdentity,
  identityRefusalMessage,
  normalizeLoginEmail,
  type IdentityDecision,
  type PersonCandidate
} from "@/lib/participant-auth-core";

/**
 * lib/participant-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đường có I/O của phép nối danh tính participant.
 *
 * Phần quyết định nằm ở `lib/participant-auth-core.ts` và không chạm database.
 * File này chỉ làm ba việc: đọc mối nối đã có, đọc những người trùng email, và
 * ghi mối nối mới khi phép quyết định cho phép.
 *
 * Chưa màn hình nào gọi tới đây. Đăng nhập được dựng ở lát cắt sau — xem
 * `docs` của PR. Tách như vậy để phần quyết định AI THẤY DỮ LIỆU CỦA AI được
 * đọc và thử riêng, chứ không lẫn vào một thay đổi có giao diện.
 */

const VI_ERROR = "Không xác định được tài khoản lúc này.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[participant-auth]", scope, {
    code: err?.code,
    message: err?.message ?? String(error)
  });
}

export type ParticipantIdentity = {
  decision: IdentityDecision;
  /** Người đã nhận ra được, nếu có. */
  personId: string | null;
  /** Câu hiện cho người bị chặn. Null khi nhận ra được. */
  refusal: string | null;
  /** Lỗi hạ tầng, khác hẳn với "không nhận ra". */
  error: string | null;
};

/**
 * Tra xem tài khoản đăng nhập này là ai, và nối lại nếu chắc chắn.
 *
 * ---------------------------------------------------------------------------
 * FAIL-CLOSED
 * ---------------------------------------------------------------------------
 * Đọc không được bảng thì trả về lỗi, KHÔNG trả về "không nhận ra". Hai thứ
 * khác nhau: một cái là dữ liệu nói không có, một cái là ta không đọc được dữ
 * liệu. Gộp chúng lại nghĩa là một sự cố hạ tầng hiện ra thành lời báo "chưa
 * nhận ra bạn", và người vận hành đi dọn danh bạ trong khi thứ hỏng là kết nối.
 *
 * Không bao giờ trả về `personId` khi có lỗi.
 */
export async function resolveParticipantIdentity(input: {
  authUserId: string;
  authEmail: string | null;
}): Promise<ParticipantIdentity> {
  const authUserId = String(input.authUserId ?? "").trim();
  if (!authUserId) {
    return { decision: { kind: "no_email" }, personId: null, refusal: VI_ERROR, error: null };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { decision: { kind: "no_match" }, personId: null, refusal: null, error: VI_ERROR };
  }

  // ── 1. Mối nối đã có ────────────────────────────────────────────────────
  const { data: link, error: linkError } = await client
    .from("account_person_auth_links")
    .select("person_id, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (linkError) {
    log("đọc mối nối", linkError);
    return { decision: { kind: "no_match" }, personId: null, refusal: null, error: VI_ERROR };
  }

  const linkedRow = link as { person_id?: string; status?: string } | null;

  // Mối nối bị đánh dấu ngừng hoạt động thì coi như không có, và KHÔNG dò email
  // lại: ban tổ chức đã chủ động ngắt nó, dò lại là lặng lẽ nối lại ngay lượt
  // đăng nhập sau.
  if (linkedRow && linkedRow.status === "inactive") {
    const decision: IdentityDecision = { kind: "no_match" };
    return {
      decision,
      personId: null,
      refusal: identityRefusalMessage(decision),
      error: null
    };
  }

  const linkedPersonId = linkedRow?.person_id ? String(linkedRow.person_id) : null;

  // ── 2. Những người trùng email ──────────────────────────────────────────
  const email = normalizeLoginEmail(input.authEmail);
  let candidates: PersonCandidate[] = [];

  if (!linkedPersonId && email) {
    // `ilike` không có ký tự đại diện nên nó là phép so bằng, không phân biệt
    // hoa thường. Lấy VỀ HẾT chứ không `maybeSingle`: chính số lượng kết quả là
    // thứ phép quyết định cần — một kết quả thì nối, nhiều hơn thì từ chối.
    const { data: people, error: peopleError } = await client
      .from("people")
      .select("id, email_primary")
      .ilike("email_primary", email);

    if (peopleError) {
      log("dò email trong danh bạ", peopleError);
      return { decision: { kind: "no_match" }, personId: null, refusal: null, error: VI_ERROR };
    }

    candidates = ((people ?? []) as Array<{ id: string; email_primary: string | null }>).map(
      (row) => ({ id: String(row.id), emailPrimary: row.email_primary })
    );
  }

  const decision = decideIdentity({
    authEmail: input.authEmail,
    linkedPersonId,
    candidates
  });

  // ── 3. Ghi mối nối mới ──────────────────────────────────────────────────
  if (decision.kind === "link_now") {
    const nowIso = new Date().toISOString();
    const { error: insertError } = await client.from("account_person_auth_links").insert({
      auth_user_id: authUserId,
      person_id: decision.personId,
      status: "active",
      link_source: "self_register",
      activated_at: nowIso
    });

    // 23505 = đã có dòng. Hai lượt đăng nhập gần như cùng lúc của cùng một
    // người đều chạy tới đây; dòng đã có nghĩa là lượt kia thắng, và kết quả
    // vẫn đúng như nhau.
    if (insertError && (insertError as { code?: string }).code !== "23505") {
      log("ghi mối nối", insertError);
      return { decision, personId: null, refusal: null, error: VI_ERROR };
    }
  }

  const personId =
    decision.kind === "linked" || decision.kind === "link_now" ? decision.personId : null;

  return {
    decision,
    personId,
    refusal: identityRefusalMessage(decision),
    error: null
  };
}

/**
 * Ghi mốc lần đầu một người đăng nhập bằng tài khoản được mời.
 *
 * Mối nối tạo từ lời mời không có `activated_at`; không ghi mốc này thì màn hình
 * mời hiện người đó là "chưa vào" mãi, và ban tổ chức cứ gửi lại thư cho một
 * người đang dùng tài khoản.
 *
 * Gọi từ đường đăng nhập, KHÔNG từ `resolveParticipantIdentity`: hàm kia chạy ở
 * khung màn hình của mọi lượt tải trang, và một lệnh ghi không có chỗ trong
 * đường đọc.
 *
 * Ghi hẹp: chỉ cột `activated_at`, chỉ khi còn trống, chỉ trên mối nối đang
 * hoạt động của đúng cặp tài khoản-người. Không bao giờ ném lỗi — đây là một
 * tín hiệu, không phải một quyền, và nó không được chặn ai đăng nhập.
 */
export async function recordParticipantActivation(input: { authUserId: string; personId: string }): Promise<void> {
  try {
    const client = getSupabaseServiceRoleClient();
    if (!client) return;

    const { error } = await client
      .from("account_person_auth_links")
      .update({ activated_at: new Date().toISOString() })
      .eq("auth_user_id", input.authUserId)
      .eq("person_id", input.personId)
      .eq("status", "active")
      .is("activated_at", null);

    if (error) log("ghi lần đăng nhập đầu", error);
  } catch (error) {
    log("ghi lần đăng nhập đầu", error);
  }
}
