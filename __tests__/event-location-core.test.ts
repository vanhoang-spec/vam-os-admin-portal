/**
 * Nơi diễn ra một sự kiện.
 *
 * Đường dẫn bản đồ ở đây đi thẳng vào thư mời gửi hàng loạt — nó là một đường
 * dẫn chương trình đặt trước mặt hàng trăm người kèm uy tín của mình. Ca test
 * quan trọng nhất trong file này là ca từ chối một URL không phải bản đồ.
 */
import { describe, expect, it } from "vitest";
import {
  EVENT_FORMATS,
  EVENT_FORMAT_LABELS,
  deriveMapUrl,
  describePlace,
  isEventFormat,
  needsJoinUrl,
  needsVenue,
  normalizeJoinUrl,
  normalizeMapUrl,
  resolveMapUrl
} from "@/lib/event-location";
import { EVENT_TYPE_OPTIONS, eventTypeLabel } from "@/lib/event-constants";

describe("hình thức tổ chức", () => {
  it("có đúng ba hình thức, mỗi hình thức một nhãn tiếng Việt", () => {
    expect(EVENT_FORMATS).toEqual(["offline", "online", "hybrid"]);
    for (const format of EVENT_FORMATS) {
      expect(EVENT_FORMAT_LABELS[format].trim()).not.toBe("");
    }
  });

  it("chỉ sự kiện có mặt tại chỗ mới cần địa chỉ", () => {
    expect(needsVenue("offline")).toBe(true);
    expect(needsVenue("hybrid")).toBe(true);
    expect(needsVenue("online")).toBe(false);
  });

  it("chỉ sự kiện có phần trực tuyến mới cần đường dẫn phòng họp", () => {
    expect(needsJoinUrl("online")).toBe(true);
    expect(needsJoinUrl("hybrid")).toBe(true);
    expect(needsJoinUrl("offline")).toBe(false);
  });

  it("hybrid cần cả hai — đó là lý do nó tồn tại", () => {
    expect(needsVenue("hybrid") && needsJoinUrl("hybrid")).toBe(true);
  });

  it("isEventFormat từ chối giá trị lạ", () => {
    expect(EVENT_FORMATS.every(isEventFormat)).toBe(true);
    expect(isEventFormat("onsite")).toBe(false);
    expect(isEventFormat(null)).toBe(false);
  });
});

describe("normalizeMapUrl — chỉ nhận đường dẫn Google Maps", () => {
  it("nhận các dạng đường dẫn bản đồ thật", () => {
    for (const url of [
      "https://www.google.com/maps/place/UEH",
      "https://maps.google.com/?q=59C+Nguyen+Dinh+Chieu",
      "https://maps.app.goo.gl/abc123",
      "https://goo.gl/maps/xyz"
    ]) {
      const result = normalizeMapUrl(url);
      expect(result.ok, url).toBe(true);
    }
  });

  it("từ chối một miền bất kỳ", () => {
    // Ô này nằm trên form của BTC và giá trị của nó đi vào thư gửi hàng trăm
    // người. Nhận URL nào cũng được là biến ô "địa điểm" thành chỗ đặt đường
    // dẫn bất kỳ vào thư của chương trình.
    const result = normalizeMapUrl("https://dia-chi-la.example/maps");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Google Maps");
  });

  it("từ chối google.com nhưng không phải trang bản đồ", () => {
    expect(normalizeMapUrl("https://www.google.com/search?q=abc").ok).toBe(false);
  });

  it("từ chối http, chỉ nhận https", () => {
    expect(normalizeMapUrl("http://www.google.com/maps/place/UEH").ok).toBe(false);
  });

  it("từ chối chuỗi không phải đường dẫn", () => {
    expect(normalizeMapUrl("59C Nguyễn Đình Chiểu").ok).toBe(false);
  });

  it("không nhầm một miền chứa tên google là google", () => {
    expect(normalizeMapUrl("https://google.com.kegian.example/maps").ok).toBe(false);
    expect(normalizeMapUrl("https://notgoogle.com/maps").ok).toBe(false);
  });

  it("bỏ trống là hợp lệ và cho ra null", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const result = normalizeMapUrl(empty);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.url).toBeNull();
    }
  });
});

describe("deriveMapUrl — chỉ cần gõ địa chỉ", () => {
  it("dựng đường dẫn tìm kiếm chính thức của Google", () => {
    const url = deriveMapUrl("59C Nguyễn Đình Chiểu, Quận 3");
    expect(url).toContain("https://www.google.com/maps/search/?api=1&query=");
  });

  it("mã hoá địa chỉ, không dán thô vào query string", () => {
    const url = deriveMapUrl("59C Nguyễn Đình Chiểu, Quận 3") ?? "";
    expect(url).not.toContain(" ");
    expect(url).toContain(encodeURIComponent("59C Nguyễn Đình Chiểu, Quận 3"));
  });

  it("đường dẫn dựng ra tự nó phải qua được vòng kiểm", () => {
    // Nếu không thì hai nửa của cùng một tính năng không nói cùng một thứ tiếng.
    const url = deriveMapUrl("Hội trường A");
    expect(normalizeMapUrl(url).ok).toBe(true);
  });

  it("không có địa chỉ thì không có đường dẫn", () => {
    expect(deriveMapUrl("")).toBeNull();
    expect(deriveMapUrl(null)).toBeNull();
  });
});

describe("resolveMapUrl — đường dẫn dán tay thắng", () => {
  it("dùng đường dẫn BTC dán, bỏ qua địa chỉ", () => {
    // BTC dán nó chính vì địa chỉ tự do trỏ sai chỗ; để địa chỉ đè lên là làm
    // hỏng đúng việc sửa đó.
    const url = resolveMapUrl({
      mapUrl: "https://maps.app.goo.gl/abc123",
      address: "một địa chỉ khác"
    });
    expect(url).toBe("https://maps.app.goo.gl/abc123");
  });

  it("suy ra từ địa chỉ khi không có đường dẫn dán tay", () => {
    const url = resolveMapUrl({ mapUrl: "", address: "Hội trường A" });
    expect(url).toContain("maps/search");
  });

  it("đường dẫn dán tay không hợp lệ thì lùi về địa chỉ, không trả về nó", () => {
    // Một URL đã bị từ chối ở tầng lưu thì cũng không được lọt ra ở tầng hiển
    // thị — đây là hàng rào thứ hai cho cùng một mối lo.
    const url = resolveMapUrl({
      mapUrl: "https://dia-chi-la.example",
      address: "Hội trường A"
    });
    expect(url).toContain("google.com/maps");
    expect(url).not.toContain("dia-chi-la.example");
  });

  it("không có gì cả thì trả về null", () => {
    expect(resolveMapUrl({ mapUrl: "", address: "" })).toBeNull();
  });
});

describe("normalizeJoinUrl", () => {
  it("nhận mọi nhà cung cấp họp trực tuyến", () => {
    // Danh sách đóng ở đây sẽ chặn đúng những buổi hợp lệ: chương trình dùng
    // Zoom, Meet, Teams và cả đường dẫn nội bộ của doanh nghiệp đối tác.
    for (const url of [
      "https://meet.google.com/abc-defg-hij",
      "https://zoom.us/j/123456789",
      "https://teams.microsoft.com/l/meetup-join/abc",
      "https://hop.doanh-nghiep.example/phong/1"
    ]) {
      expect(normalizeJoinUrl(url).ok, url).toBe(true);
    }
  });

  it("vẫn bắt buộc https", () => {
    expect(normalizeJoinUrl("http://zoom.us/j/1").ok).toBe(false);
  });

  it("bỏ trống là hợp lệ", () => {
    const result = normalizeJoinUrl("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBeNull();
  });
});

describe("describePlace", () => {
  it("gộp tên và địa chỉ cho sự kiện tại chỗ", () => {
    expect(
      describePlace({
        format: "offline",
        locationName: "Hội trường A",
        locationAddress: "59C Nguyễn Đình Chiểu",
        mapUrl: null,
        joinUrl: null
      })
    ).toBe("Hội trường A — 59C Nguyễn Đình Chiểu");
  });

  it("không nhắc địa điểm của sự kiện thuần trực tuyến", () => {
    expect(
      describePlace({
        format: "online",
        locationName: "Hội trường A",
        locationAddress: "59C",
        mapUrl: null,
        joinUrl: "https://meet.google.com/x"
      })
    ).toBe("Trực tuyến");
  });

  it("trả về chuỗi rỗng khi chưa có gì để nói", () => {
    // Chỗ giữ chỗ trông như dữ liệu thật còn tệ hơn một ô trống.
    expect(
      describePlace({
        format: "offline",
        locationName: null,
        locationAddress: null,
        mapUrl: null,
        joinUrl: null
      })
    ).toBe("");
  });
});

describe("danh mục loại sự kiện", () => {
  it("có đủ các loại chương trình thật sự tổ chức", () => {
    const values = EVENT_TYPE_OPTIONS.map((option) => option.value);
    for (const wanted of [
      "mentee_orientation",
      "mentor_orientation",
      "kickoff",
      "closing",
      "training",
      "interview_day",
      "cross_mentoring"
    ]) {
      expect(values, wanted).toContain(wanted);
    }
  });

  it("giữ lại orientation cũ — các sự kiện đã diễn ra đang mang giá trị đó", () => {
    expect(EVENT_TYPE_OPTIONS.map((option) => option.value)).toContain("orientation");
  });

  it("không có giá trị trùng", () => {
    const values = EVENT_TYPE_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("mọi loại đều có nhãn tiếng Việt", () => {
    for (const option of EVENT_TYPE_OPTIONS) {
      expect(eventTypeLabel(option.value)).toBe(option.label);
    }
  });

  it("loại chưa biết thì trả về chính giá trị, không nuốt mất nó", () => {
    expect(eventTypeLabel("loai_la")).toBe("loai_la");
    expect(eventTypeLabel("")).toBe("—");
  });
});
