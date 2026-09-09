/**
 * Mã điểm danh cá nhân.
 *
 * Ca quan trọng nhất trong file: một mã QR bất kỳ ngoài đời — vé xe buýt, mã
 * thanh toán — không được biến thành một lượt điểm danh.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKIN_CODE_LENGTH,
  DEFAULT_STATIONS,
  ENTRANCE_STATION,
  checkinCodeUrl,
  collectBadges,
  generateCheckinCode,
  isCheckinCode,
  normalizeStation,
  readCheckinCode,
  stationLabel
} from "@/lib/event-checkin-code";

/** Nguồn ngẫu nhiên biết trước, để mã sinh ra kiểm được từng ký tự. */
function fixedBytes(values: number[]) {
  let index = 0;
  return (size: number) => {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      out[i] = values[index % values.length];
      index += 1;
    }
    return out;
  };
}

function realRandom(size: number) {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

describe("generateCheckinCode", () => {
  it("sinh đúng độ dài đã khai báo", () => {
    for (let round = 0; round < 50; round += 1) {
      expect(generateCheckinCode(realRandom)).toHaveLength(CHECKIN_CODE_LENGTH);
    }
  });

  it("chỉ dùng các ký tự không nhầm được bằng mắt", () => {
    // Mã này được đọc bằng mắt và gõ tay khi máy quét chịu thua. `0` với `O`,
    // `1` với `I` với `L` phân biệt được bằng phông chữ thì sẽ bị gõ sai.
    for (let round = 0; round < 200; round += 1) {
      expect(generateCheckinCode(realRandom)).not.toMatch(/[01OIL]/);
    }
  });

  it("mã sinh ra tự nó phải qua được vòng kiểm", () => {
    for (let round = 0; round < 100; round += 1) {
      expect(isCheckinCode(generateCheckinCode(realRandom))).toBe(true);
    }
  });

  it("bỏ qua byte rơi vào phần dư thay vì chia dư trên mọi byte", () => {
    // 255 nằm ngoài giới hạn (31 * 8 = 248), nên nó phải bị bỏ qua. Chia dư
    // đơn thuần sẽ biến nó thành một ký tự và làm các ký tự đầu bảng xuất hiện
    // nhiều hơn phần còn lại.
    const code = generateCheckinCode(fixedBytes([255, 0]));
    expect(code).toHaveLength(CHECKIN_CODE_LENGTH);
    expect(new Set(code.split(""))).toEqual(new Set(["2"]));
  });

  it("hai mã liên tiếp không trùng nhau", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCheckinCode(realRandom)));
    expect(codes.size).toBe(500);
  });
});

describe("isCheckinCode", () => {
  it("từ chối mã sai độ dài", () => {
    expect(isCheckinCode("ABC")).toBe(false);
    expect(isCheckinCode("ABCDEFGHJKM")).toBe(false);
  });

  it("từ chối ký tự ngoài bảng", () => {
    expect(isCheckinCode("ABCDEFGHJ0")).toBe(false);
    expect(isCheckinCode("ABCDEFGHJ-")).toBe(false);
    expect(isCheckinCode("abcdefghjk")).toBe(false);
  });

  it("từ chối giá trị không phải chuỗi", () => {
    expect(isCheckinCode(null)).toBe(false);
    expect(isCheckinCode(123)).toBe(false);
  });
});

describe("readCheckinCode — đọc thứ máy quét thấy", () => {
  const CODE = "ABCDEFGHJK";

  it("đọc được đường dẫn vé của chính hệ thống", () => {
    expect(readCheckinCode(`https://os.example.vn/ve/${CODE}`)).toBe(CODE);
  });

  it("đọc được đường dẫn vé từ môi trường khác hoặc tên miền cũ", () => {
    // Vé đã gửi đi thì sống lâu hơn một lần đổi tên miền.
    expect(readCheckinCode(`https://ten-mien-cu.example/ve/${CODE}`)).toBe(CODE);
  });

  it("chấp nhận dấu gạch chéo ở cuối", () => {
    expect(readCheckinCode(`https://os.example.vn/ve/${CODE}/`)).toBe(CODE);
  });

  it("bỏ qua query string và fragment", () => {
    expect(readCheckinCode(`https://os.example.vn/ve/${CODE}?utm=x#y`)).toBe(CODE);
  });

  it("đọc được mã trần khi ai đó gõ tay", () => {
    expect(readCheckinCode(CODE)).toBe(CODE);
    expect(readCheckinCode(`  ${CODE.toLowerCase()}  `)).toBe(CODE);
  });

  it("TỪ CHỐI một mã QR bất kỳ ngoài đời", () => {
    // Đây là ca quan trọng nhất của file: máy quét chĩa vào bất cứ đâu cũng
    // đọc ra một chuỗi, và không chuỗi nào trong số đó được thành một lượt
    // điểm danh.
    for (const junk of [
      "https://example.com/gi-do",
      "00020101021138540010A00000072701",
      "BEGIN:VCARD\nFN:Ai đó\nEND:VCARD",
      "https://os.example.vn/events/123",
      "tel:0900000000",
      ""
    ]) {
      expect(readCheckinCode(junk), junk).toBeNull();
    }
  });

  it("không dò tìm mã ở giữa một chuỗi lạ", () => {
    // Một mã QR tình cờ chứa mười ký tự hợp lệ không phải là vé.
    expect(readCheckinCode(`rác ${CODE} rác`)).toBeNull();
    expect(readCheckinCode(`https://example.com/x?code=${CODE}`)).toBeNull();
  });

  it("từ chối đường dẫn đúng dạng nhưng mã sai", () => {
    expect(readCheckinCode("https://os.example.vn/ve/QUA-NGAN")).toBeNull();
    expect(readCheckinCode("https://os.example.vn/ve/ABCDEFGHJ0")).toBeNull();
  });

  it("đường dẫn dựng ra tự nó phải đọc lại được", () => {
    expect(readCheckinCode(checkinCodeUrl("https://os.example.vn", CODE))).toBe(CODE);
    expect(readCheckinCode(checkinCodeUrl("https://os.example.vn/", CODE))).toBe(CODE);
  });
});

describe("trạm quét", () => {
  it("cửa vào là trạm mặc định và có trong danh sách", () => {
    expect(DEFAULT_STATIONS[0].value).toBe(ENTRANCE_STATION);
    expect(stationLabel(ENTRANCE_STATION)).toContain("đã tham dự");
  });

  it("chuẩn hoá tên trạm gõ tay", () => {
    // `Booth A` và `booth a` mà thành hai trạm thì bảng điều khiển đếm sai.
    // Nhiều khoảng trắng liền nhau gộp thành MỘT gạch dưới, nên gõ thừa dấu
    // cách cũng không sinh ra một trạm thứ hai.
    for (const typed of ["  Booth  A ", "booth a", "BOOTH A", "Booth   A"]) {
      const result = normalizeStation(typed);
      expect(result.ok, typed).toBe(true);
      if (result.ok) expect(result.station, typed).toBe("booth_a");
    }
  });

  it("cho phép trạm ngoài danh sách", () => {
    // Mỗi sự kiện có hoạt động bên lề riêng; danh sách đóng sẽ chặn đúng những
    // sự kiện làm nhiều thứ nhất.
    expect(normalizeStation("khu_trai_nghiem_vr").ok).toBe(true);
  });

  it("từ chối tên trạm rỗng, quá dài, hoặc có ký tự lạ", () => {
    expect(normalizeStation("").ok).toBe(false);
    expect(normalizeStation("x".repeat(61)).ok).toBe(false);
    expect(normalizeStation("booth/đối tác").ok).toBe(false);
  });

  it("nhãn của trạm lạ là chính tên nó, không nuốt mất", () => {
    expect(stationLabel("khu_vr")).toBe("khu_vr");
  });
});

describe("collectBadges", () => {
  it("mỗi trạm một huy hiệu, xếp theo thứ tự đã đi qua", () => {
    const badges = collectBadges([
      { station: "booth_partner", scannedAt: "2026-09-20T04:00:00Z" },
      { station: "entrance", scannedAt: "2026-09-20T01:00:00Z" },
      { station: "booth_program", scannedAt: "2026-09-20T02:00:00Z" }
    ]);
    expect(badges.map((badge) => badge.station)).toEqual([
      "entrance",
      "booth_program",
      "booth_partner"
    ]);
  });

  it("quét lại cùng một trạm chỉ tính một huy hiệu, giữ lần đầu", () => {
    // Lần thứ hai thường là quét lại vì máy không đọc được; mốc thời gian có
    // ý nghĩa là lúc người đó thật sự tới trạm.
    //
    // Thử theo CẢ HAI thứ tự đưa vào. Chỉ đưa lần muộn trước thì một bản cài
    // đặt "lần ghi sau đè lần trước" cũng cho ra đúng kết quả, và ca test trông
    // như đang bảo vệ điều gì đó trong khi không.
    for (const order of [
      ["2026-09-20T01:00:00Z", "2026-09-20T02:00:00Z"],
      ["2026-09-20T02:00:00Z", "2026-09-20T01:00:00Z"]
    ]) {
      const badges = collectBadges(order.map((scannedAt) => ({ station: "entrance", scannedAt })));
      expect(badges).toHaveLength(1);
      expect(badges[0].scannedAt, order.join(" rồi ")).toBe("2026-09-20T01:00:00Z");
    }
  });

  it("bỏ qua dòng không có tên trạm", () => {
    expect(collectBadges([{ station: "  ", scannedAt: "2026-09-20T01:00:00Z" }])).toEqual([]);
  });

  it("chưa quét đâu thì chưa có huy hiệu nào", () => {
    expect(collectBadges([])).toEqual([]);
  });

  it("gắn nhãn tiếng Việt cho từng huy hiệu", () => {
    const badges = collectBadges([{ station: "booth_program", scannedAt: "2026-09-20T01:00:00Z" }]);
    expect(badges[0].label).toBe("Booth chương trình");
  });
});
