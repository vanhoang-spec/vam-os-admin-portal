/**
 * Chọn buổi cho một đơn đăng ký.
 *
 * Đây là phép kiểm bảo mật của một form CÔNG KHAI. Ca quan trọng nhất trong
 * file: một `event_id` gửi thẳng lên, không có trong danh sách buổi mà link
 * này phục vụ, phải bị từ chối — nếu không thì bất kỳ ai cũng đăng ký được vào
 * một sự kiện có link đang đóng, hoặc một sự kiện của mùa khác.
 */
import { describe, expect, it } from "vitest";
import { chooseSession, type ChoosableSession } from "@/lib/event-session-choice";

const ANCHOR = "00000000-0000-4000-8000-00000000000a";
const SECOND = "00000000-0000-4000-8000-00000000000b";
const STRANGER = "00000000-0000-4000-8000-0000000000ff";

function session(id: string, overrides: Partial<ChoosableSession> = {}): ChoosableSession {
  return { id, full: false, waitlistEnabled: false, ...overrides };
}

const TWO = [session(ANCHOR), session(SECOND)];

describe("link thường: buổi do link quyết định", () => {
  it("bỏ qua mọi giá trị gửi lên khi link không nhận cả chuỗi", () => {
    // Mặc định an toàn: thêm một tham số vào một link thường không được đổi
    // buổi mà nó nhận.
    const result = chooseSession({ sessions: null, anchorId: ANCHOR, choice: STRANGER });
    expect(result).toEqual({ ok: true, sessionId: ANCHOR });
  });

  it("bỏ qua cả khi không gửi gì", () => {
    expect(chooseSession({ sessions: null, anchorId: ANCHOR, choice: "" })).toEqual({
      ok: true,
      sessionId: ANCHOR
    });
  });
});

describe("link nhận cả chuỗi", () => {
  it("nhận buổi có trong danh sách", () => {
    expect(chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: SECOND })).toEqual({
      ok: true,
      sessionId: SECOND
    });
  });

  it("TỪ CHỐI một id không có trong danh sách link này phục vụ", () => {
    // Ca quan trọng nhất của file. Tin con số gửi lên nghĩa là gửi thẳng một
    // event_id bất kỳ là đăng ký được vào sự kiện có link đang đóng.
    const result = chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: STRANGER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("không thuộc chuỗi");
  });

  it("không tiết lộ id nào có thật qua thông báo lỗi", () => {
    // Một câu trả lời cho cả "buổi không tồn tại" lẫn "buổi của chuỗi khác".
    const missing = chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: STRANGER });
    const nonsense = chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: "không-phải-uuid" });
    expect(missing.ok).toBe(false);
    expect(nonsense.ok).toBe(false);
    if (!missing.ok && !nonsense.ok) expect(missing.message).toBe(nonsense.message);
  });

  it("bắt buộc phải chọn", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const result = chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: empty });
      expect(result.ok, String(empty)).toBe(false);
      if (!result.ok) expect(result.message).toContain("chọn buổi");
    }
  });

  it("so khớp chính xác, không cắt xén hay đoán", () => {
    for (const near of [ANCHOR.toUpperCase(), ` ${ANCHOR}x`, ANCHOR.slice(0, -1)]) {
      expect(chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: near }).ok, near).toBe(false);
    }
  });

  it("cắt khoảng trắng thừa hai đầu", () => {
    expect(chooseSession({ sessions: TWO, anchorId: ANCHOR, choice: `  ${SECOND}  ` })).toEqual({
      ok: true,
      sessionId: SECOND
    });
  });
});

describe("buổi đã đầy", () => {
  it("từ chối buổi đầy không có danh sách chờ, dù form đã khoá ô đó", () => {
    // Form khoá ô chỉ là thứ người dùng nhìn thấy; nó không phải hàng rào.
    const sessions = [session(ANCHOR), session(SECOND, { full: true })];
    const result = chooseSession({ sessions, anchorId: ANCHOR, choice: SECOND });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("đủ chỗ");
  });

  it("cho phép buổi đầy KHI có danh sách chờ", () => {
    const sessions = [session(ANCHOR), session(SECOND, { full: true, waitlistEnabled: true })];
    expect(chooseSession({ sessions, anchorId: ANCHOR, choice: SECOND })).toEqual({
      ok: true,
      sessionId: SECOND
    });
  });
});

describe("lý do từ chối", () => {
  // Nơi gọi chỉ được đi tiếp với một lý do duy nhất: buổi đầy — vì người đã giữ
  // chỗ sẵn ở đó nộp lại là sửa đăng ký cũ. Các lý do còn lại là từ chối dứt khoát,
  // và không kèm id nào để đi tiếp.
  it("buổi đầy: kèm đúng id buổi đã kiểm, để nơi gọi xét tiếp người đã có chỗ", () => {
    const sessions = [session(ANCHOR), session(SECOND, { full: true })];
    const result = chooseSession({ sessions, anchorId: ANCHOR, choice: SECOND });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_full");
      expect(result.sessionId).toBe(SECOND);
    }
  });

  it.each([
    [STRANGER, "not_in_series"],
    ["", "no_choice"]
  ])("%s → %s, và KHÔNG kèm id nào", (choice, reason) => {
    const result = chooseSession({ sessions: TWO, anchorId: ANCHOR, choice });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason);
      expect(result.sessionId).toBeUndefined();
    }
  });

  it("chuỗi rỗng → no_sessions", () => {
    const result = chooseSession({ sessions: [], anchorId: ANCHOR, choice: ANCHOR });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_sessions");
  });
});

describe("chuỗi không còn buổi nào", () => {
  it("nói rõ thay vì lặng lẽ rơi về buổi neo", () => {
    // Rơi về buổi neo nghĩa là ghi một đơn vào một buổi đã huỷ.
    const result = chooseSession({ sessions: [], anchorId: ANCHOR, choice: ANCHOR });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("không còn buổi nào");
  });
});
