// @vitest-environment jsdom
/**
 * Phần đầu link đăng ký phải nói đủ số buổi.
 *
 * ---------------------------------------------------------------------------
 * CHUYỆN ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Mentor Orientation có hai buổi: 20/09 và 27/09. Link đăng ký là MỘT link cho
 * cả chuỗi. Nhưng phần đầu trang chỉ đọc `starts_at` của buổi neo, nên nó in ra
 * đúng một dòng — `27/09/2026` — và người mở link đọc thấy sự kiện chỉ có một
 * ngày đó.
 *
 * Biểu mẫu phía dưới vẫn cho chọn buổi, nhưng dòng to nhất ở đầu trang đã nói
 * sai rồi. Người đọc lướt qua phần đầu là chuyện bình thường; một dòng thời
 * gian nói thiếu không phải chuyện nhỏ khi nó quyết định người ta xếp lịch
 * ngày nào.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EventPlaceBlock } from "../app/events/event-place";
import { formatTimeRange } from "../lib/utils";
import type { Event } from "../lib/types";

afterEach(cleanup);

/** 08:00–11:30 giờ Việt Nam, đúng dạng đang lưu trong bảng. */
const BUOI_1_START = "2026-09-20T01:00:00.000Z";
const BUOI_1_END = "2026-09-20T04:30:00.000Z";
const BUOI_2_START = "2026-09-27T01:00:00.000Z";
const BUOI_2_END = "2026-09-27T04:30:00.000Z";

function orientation(overrides: Partial<Event> = {}): Event {
  return {
    id: "e1",
    event_name: "Mentor Orientation",
    event_format: "offline",
    starts_at: BUOI_2_START,
    ends_at: BUOI_2_END,
    location_name: "Phòng B1-502 - Cơ sở B UEH",
    location_address: "279 Nguyễn Tri Phương, Phường 5, Quận 10, TP. Hồ Chí Minh",
    ...overrides
  } as Event;
}

const SESSIONS = [
  { id: "s1", seriesIndex: 1, startsAt: BUOI_1_START, endsAt: BUOI_1_END },
  { id: "s2", seriesIndex: 2, startsAt: BUOI_2_START, endsAt: BUOI_2_END }
];

describe("chuỗi nhiều buổi", () => {
  it("hiện ĐỦ ngày của mọi buổi, không chỉ buổi neo", () => {
    render(<EventPlaceBlock event={orientation()} sessions={SESSIONS} />);

    // Đây là ca tái hiện lỗi: trước đây chỉ có 27/09 xuất hiện.
    expect(screen.getByText(/20\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/27\/09\/2026/)).toBeTruthy();
  });

  it("nói rõ đây là chuỗi mấy buổi", () => {
    render(<EventPlaceBlock event={orientation()} sessions={SESSIONS} />);
    expect(screen.getByText("Chuỗi 2 buổi")).toBeTruthy();
  });

  it("đánh số từng buổi để người đọc đối chiếu với ô chọn bên dưới", () => {
    render(<EventPlaceBlock event={orientation()} sessions={SESSIONS} />);
    expect(screen.getByText("Buổi 1")).toBeTruthy();
    expect(screen.getByText("Buổi 2")).toBeTruthy();
  });

  it("mỗi buổi có đủ giờ bắt đầu và giờ kết thúc", () => {
    render(<EventPlaceBlock event={orientation()} sessions={SESSIONS} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // 01:00Z là 08:00 giờ Việt Nam; 04:30Z là 11:30.
    expect(within(items[0]).getByText(/08:00 – 11:30/)).toBeTruthy();
    expect(within(items[1]).getByText(/08:00 – 11:30/)).toBeTruthy();
  });

  it("có thứ trong tuần, vì người ta nhớ lịch theo thứ", () => {
    render(<EventPlaceBlock event={orientation()} sessions={SESSIONS} />);
    // 20/09/2026 và 27/09/2026 đều là Chủ nhật.
    expect(screen.getAllByText(/Chủ nhật/)).toHaveLength(2);
  });

  it("thứ tự buổi lấy theo series_index, không theo vị trí trong mảng", () => {
    render(
      <EventPlaceBlock
        event={orientation()}
        sessions={[
          { id: "s2", seriesIndex: 2, startsAt: BUOI_2_START, endsAt: BUOI_2_END },
          { id: "s3", seriesIndex: 3, startsAt: "2026-10-04T01:00:00.000Z", endsAt: null }
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Buổi 2")).toBeTruthy();
    expect(within(items[1]).getByText("Buổi 3")).toBeTruthy();
  });

  it("địa điểm vẫn hiện như cũ", () => {
    render(<EventPlaceBlock event={orientation()} sessions={SESSIONS} />);
    expect(screen.getByText("Phòng B1-502 - Cơ sở B UEH")).toBeTruthy();
    expect(screen.getByText(/279 Nguyễn Tri Phương/)).toBeTruthy();
  });
});

describe("buổi đơn lẻ giữ nguyên như cũ", () => {
  it("không truyền danh sách thì vẫn một dòng thời gian", () => {
    render(<EventPlaceBlock event={orientation()} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Chuỗi/)).toBeNull();
    expect(screen.getByText(/27\/09\/2026 08:00 – 11:30/)).toBeTruthy();
  });

  it("chuỗi chỉ còn một buổi cũng không cần danh sách", () => {
    // Một danh sách một dòng chỉ làm rối, và "Chuỗi 1 buổi" là câu vô nghĩa.
    render(<EventPlaceBlock event={orientation()} sessions={[SESSIONS[1]]} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/27\/09\/2026 08:00 – 11:30/)).toBeTruthy();
  });

  it("danh sách rỗng cũng vậy", () => {
    render(<EventPlaceBlock event={orientation()} sessions={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("trang đăng ký thật sự đưa danh sách buổi vào phần đầu", () => {
  it("thẻ EventPlaceBlock trên trang công khai có nhận sessions", () => {
    // Thành phần vẽ đúng vẫn vô nghĩa nếu trang quên truyền danh sách vào.
    // Đọc thẳng lời gọi đó, không đọc cả file, để câu khẳng định này không
    // vô tình khớp với một chỗ khác.
    const source = readFileSync("app/register/[token]/page.tsx", "utf8");
    const call = source.match(/<EventPlaceBlock[^>]*\/>/);
    expect(call, "không tìm thấy lời gọi <EventPlaceBlock /> nào").toBeTruthy();
    expect(call?.[0]).toContain("sessions={data.sessions}");
  });
});

describe("formatTimeRange — một cửa duy nhất cho khoảng thời gian", () => {
  it("cùng ngày thì không lặp lại ngày", () => {
    expect(formatTimeRange(BUOI_1_START, BUOI_1_END)).toBe("20/09/2026 08:00 – 11:30");
  });

  it("không có giờ kết thúc thì chỉ hiện giờ bắt đầu", () => {
    expect(formatTimeRange(BUOI_1_START, null)).toBe("20/09/2026 08:00");
  });

  it("vắt qua nửa đêm thì hiện đủ cả hai ngày", () => {
    // 22:00 ngày 20/09 đến 01:00 ngày 21/09 giờ Việt Nam. Bỏ mất ngày thứ hai
    // ở đây là bảo người ta rằng sự kiện kết thúc trước cả lúc nó bắt đầu.
    expect(formatTimeRange("2026-09-20T15:00:00.000Z", "2026-09-20T18:00:00.000Z")).toBe(
      "20/09/2026 22:00 – 21/09/2026 01:00"
    );
  });
});
