/**
 * lib/reviewer-invite-dispatch-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của việc cấp quyền reviewer/interviewer HÀNG LOẠT: khớp một danh
 * sách email dán vào ô nhập với đúng mentor của mùa, và một lần bấm xử lý được
 * bao nhiêu người.
 *
 * ---------------------------------------------------------------------------
 * DÙNG CHUNG MỘT HẠN MỨC THẬT VỚI BỘ GỬI THƯ MỜI MENTEE
 * ---------------------------------------------------------------------------
 * `lib/mentee-invite-dispatch-core.ts` tự giới hạn ở
 * `DAILY_EMAIL_LIMIT - DISPATCH_RESERVE` (920/1.000) để CHỪA phần còn lại (80)
 * cho đúng loại thư này — thư mời reviewer/interviewer. Vì vậy bộ này KHÔNG
 * trừ thêm một lần chừa nữa; nó nhìn thẳng vào phần hạn mức THẬT còn trống
 * trong `DAILY_EMAIL_LIMIT`, đọc từ cùng một số "đã gửi trong 24 giờ trượt"
 * (mọi loại thư, không riêng loại nào). Trừ hai lần cùng một khoảng chừa sẽ
 * làm bộ này báo hết hạn mức trong khi trần chung vẫn còn chỗ gửi thật.
 *
 * ---------------------------------------------------------------------------
 * MỘT NGƯỜI ĐƯỢC XỬ LÝ = MỘT THƯ CÓ THỂ PHẢI GỬI, DÙ CHƯA CHẮC
 * ---------------------------------------------------------------------------
 * Không biết trước ai trong danh sách đã có tài khoản VÀ đã từng đăng nhập
 * (trường hợp đó `enableMentorAsReviewer` không gửi thư) cho tới khi xử lý
 * xong người đó. Coi mỗi người là một thư — an toàn hơn là đúng: thà xử lý ít
 * hơn mức trần chung thật sự cho phép, còn hơn vượt trần vì đếm nhầm.
 *
 * Module thuần, không I/O.
 */
import { DAILY_EMAIL_LIMIT } from "@/lib/mentee-invite-dispatch-core";

/** Số người xử lý tối đa một lần bấm — trần thời gian của một request, không phải trần lịch sự. */
export const BULK_GRANT_MAX_PER_RUN = 20;

/**
 * Một lần bấm xử lý (cấp quyền, và có thể gửi thư) được bao nhiêu người.
 *
 * Không bao giờ âm, không bao giờ vượt `BULK_GRANT_MAX_PER_RUN`. Trả 0 nghĩa
 * là hạn mức thư thật của hệ thống đã hết cho hôm nay.
 */
export function bulkGrantAllowance(sentInWindow: number): number {
  const sent = Number.isFinite(sentInWindow) && sentInWindow > 0 ? Math.floor(sentInWindow) : 0;
  const room = DAILY_EMAIL_LIMIT - sent;
  return Math.max(0, Math.min(BULK_GRANT_MAX_PER_RUN, room));
}

/** Chuẩn hoá một email để so khớp — cắt khoảng trắng hai đầu, chữ thường. */
export function normalizeEmailForMatch(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * Tách danh sách dán vào ô nhập thành các email riêng — mỗi dòng, hoặc cách
 * nhau bởi dấu phẩy/chấm phẩy/khoảng trắng (khớp cả khi dán thẳng một cột từ
 * bảng tính). Bỏ trùng, bỏ chuỗi rỗng và chuỗi không có "@".
 */
export function parseEmailList(raw: string): string[] {
  const found = new Set<string>();
  for (const piece of String(raw ?? "").split(/[\s,;]+/)) {
    const email = normalizeEmailForMatch(piece);
    if (email && email.includes("@")) found.add(email);
  }
  return Array.from(found);
}

export type BulkGrantCandidatePool = ReadonlyArray<{ personId: string; email: string }>;

export type BulkGrantMatchResult = {
  /** person_id khớp được, theo đúng thứ tự email được nhập — không trùng nhau. */
  matched: Array<{ personId: string; email: string }>;
  /** Email nhập vào nhưng không khớp mentor nào của mùa đã chọn. */
  notFound: string[];
};

/**
 * Khớp danh sách email với đúng mentor của mùa (nguồn: `getReviewerPool`).
 * Tự chuẩn hoá CẢ HAI phía — không giả định người gọi đã chuẩn hoá `emails`,
 * vì bản thân việc "khớp không phân biệt hoa thường" là lý do hàm này tồn
 * tại. Không khớp được thì liệt kê rõ ràng — im lặng bỏ qua một email gõ sai
 * hay một người ngoài mùa là bỏ sót một mentor thật.
 */
export function matchEmailsToPool(emails: readonly string[], pool: BulkGrantCandidatePool): BulkGrantMatchResult {
  const byEmail = new Map<string, string>();
  for (const row of pool) {
    const email = normalizeEmailForMatch(row.email);
    if (email) byEmail.set(email, row.personId);
  }

  const matched: Array<{ personId: string; email: string }> = [];
  const notFound: string[] = [];
  const seenPersonIds = new Set<string>();

  for (const raw of emails) {
    const email = normalizeEmailForMatch(raw);
    const personId = email ? byEmail.get(email) : undefined;
    if (!personId) {
      notFound.push(email || String(raw));
      continue;
    }
    // Hai email khác nhau (vd. viết hoa khác) trỏ về cùng một người: chỉ xử lý một lần.
    if (seenPersonIds.has(personId)) continue;
    seenPersonIds.add(personId);
    matched.push({ personId, email });
  }

  return { matched, notFound };
}
