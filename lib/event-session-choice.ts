/**
 * lib/event-session-choice.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Buổi nào trong chuỗi mà một đơn đăng ký thuộc về.
 *
 * Tách khỏi `lib/events.ts` vì đây là phép kiểm bảo mật của một form CÔNG KHAI:
 * bất kỳ ai cũng gửi lên được bất kỳ giá trị nào, và tin con số gửi lên nghĩa
 * là gửi thẳng một `event_id` bất kỳ là đăng ký được vào một sự kiện có link
 * đang đóng, hoặc một sự kiện của mùa khác.
 *
 * Module thuần, không I/O — để chỗ quan trọng nhất kiểm được mà không cần
 * database.
 */

export type ChoosableSession = {
  id: string;
  full: boolean;
  waitlistEnabled: boolean;
};

export type SessionChoice =
  | { ok: true; sessionId: string }
  | { ok: false; message: string };

/**
 * Chọn buổi cho một đơn đăng ký.
 *
 * `sessions` null nghĩa là link thường: buổi đã do chính link quyết định, và
 * mọi giá trị gửi lên đều bị bỏ qua. Đó là mặc định an toàn — thêm một tham số
 * vào một link thường không được đổi buổi mà nó nhận.
 */
export function chooseSession(input: {
  /** Các buổi mà LINK NÀY phục vụ. Null với link thường. */
  sessions: ChoosableSession[] | null;
  /** Buổi mà link neo vào — dùng khi không có gì để chọn. */
  anchorId: string;
  /** Giá trị người dùng gửi lên. Không tin. */
  choice: unknown;
}): SessionChoice {
  if (!input.sessions) return { ok: true, sessionId: input.anchorId };

  if (!input.sessions.length) {
    return { ok: false, message: "Chuỗi sự kiện này hiện không còn buổi nào để đăng ký." };
  }

  const choice = String(input.choice ?? "").trim();
  if (!choice) return { ok: false, message: "Vui lòng chọn buổi bạn muốn tham dự." };

  const match = input.sessions.find((session) => session.id === choice);
  if (!match) {
    // Cùng một câu trả lời cho "buổi không tồn tại" và "buổi của chuỗi khác":
    // phân biệt hai câu đó là nói cho người gửi biết id nào có thật.
    return { ok: false, message: "Buổi bạn chọn không thuộc chuỗi sự kiện này." };
  }

  if (match.full && !match.waitlistEnabled) {
    // Form đã khoá ô này, nhưng form không phải hàng rào: nó chỉ là thứ người
    // dùng nhìn thấy.
    return { ok: false, message: "Buổi bạn chọn đã đủ chỗ. Vui lòng chọn buổi khác." };
  }

  return { ok: true, sessionId: match.id };
}
