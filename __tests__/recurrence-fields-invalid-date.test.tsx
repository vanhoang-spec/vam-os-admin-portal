/** @vitest-environment jsdom */
/**
 * Ô đặt lịch lặp không được sập vì một ngày gõ dở.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Lúc kiểm trên production, gõ ngày vào ô "Thời điểm bắt đầu" làm CẢ TRANG tạo
 * sự kiện rơi vào error boundary — chỉ còn lại một nút "Thử lại".
 *
 * Nguyên nhân: `new Date(giá_trị).toISOString()`. `toISOString` không trả về
 * chuỗi rỗng khi gặp một Date không hợp lệ — nó NÉM `RangeError`. Và một ô
 * `datetime-local` giữ giá trị dở dang trong lúc người dùng còn đang gõ, nên
 * nó chắc chắn sẽ có lúc mang một giá trị không đọc được.
 *
 * Người soạn không làm gì sai cả: họ chỉ gõ một ngày.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

import { RecurrenceFields } from "@/app/events/recurrence-fields";

afterEach(cleanup);

/** Những gì một ô datetime-local có thể mang trong lúc người ta đang gõ. */
const HALF_TYPED = [
  "2026-09-20T",
  "2026-09-",
  "2026-",
  "0009-09-20T08:00",
  "09/20/2026",
  "chưa rõ",
  "T08:00",
  "2026-13-45T99:99"
];

describe("giá trị gõ dở không được làm sập component", () => {
  it.each(HALF_TYPED)("dựng được với startsAt = %j", (startsAt) => {
    expect(() => render(<RecurrenceFields startsAt={startsAt} endsAt="" />)).not.toThrow();
  });

  it.each(HALF_TYPED)("dựng được với endsAt = %j", (endsAt) => {
    expect(() =>
      render(<RecurrenceFields startsAt="2026-09-20T08:00" endsAt={endsAt} />)
    ).not.toThrow();
  });

  it("dựng được khi cả hai ô đều rỗng", () => {
    expect(() => render(<RecurrenceFields startsAt="" endsAt="" />)).not.toThrow();
  });

  it("nói rõ chưa xem trước được, thay vì im lặng hoặc sập", () => {
    render(<RecurrenceFields startsAt="2026-09-" endsAt="" />);
    // Hộp "Sự kiện lặp lại" chưa tick thì phần xem trước chưa hiện; điều được
    // khẳng định ở đây là component vẫn vẽ ra được.
    expect(screen.getByText("Sự kiện lặp lại")).toBeTruthy();
  });
});

describe("giá trị hợp lệ vẫn chạy đúng", () => {
  it("nhận một ngày giờ đầy đủ", () => {
    expect(() =>
      render(<RecurrenceFields startsAt="2026-09-20T08:00" endsAt="2026-09-20T11:30" />)
    ).not.toThrow();
    expect(screen.getByText("Sự kiện lặp lại")).toBeTruthy();
  });
});
