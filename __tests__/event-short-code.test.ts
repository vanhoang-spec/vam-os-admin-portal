/**
 * Mã ngắn 4 ký tự — đường lùi khi máy quét chịu thua.
 *
 * Ca quan trọng nhất trong file: `readCheckinCode` — đường CÔNG KHAI — không
 * bao giờ được nhận một mã 4 ký tự. Bốn ký tự trên 31 ký tự là khoảng 923
 * nghìn tổ hợp; với 200 người đăng ký, đoán mò trúng một mã bất kỳ là khoảng
 * 1/4.600. Nhận nó ở một URL công khai là mở đúng cái cửa nó không được mở.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKIN_CODE_LENGTH,
  SHORT_CODE_LENGTH,
  checkinCodeUrl,
  classifyScannedInput,
  generateCheckinCode,
  generateShortCode,
  isCheckinCode,
  isShortCode,
  readCheckinCode
} from "@/lib/event-checkin-code";

function realRandom(size: number) {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

describe("generateShortCode", () => {
  it("sinh đúng bốn ký tự", () => {
    for (let round = 0; round < 100; round += 1) {
      expect(generateShortCode(realRandom)).toHaveLength(SHORT_CODE_LENGTH);
    }
  });

  it("chỉ dùng các ký tự không nhầm được bằng mắt", () => {
    // Mã này sinh ra để GÕ TAY, ở cửa, giữa một hàng người. `0` với `O` phân
    // biệt bằng phông chữ là một mã sẽ bị gõ sai.
    for (let round = 0; round < 300; round += 1) {
      expect(generateShortCode(realRandom)).not.toMatch(/[01OIL]/);
    }
  });

  it("mã sinh ra tự nó phải qua được vòng kiểm", () => {
    for (let round = 0; round < 100; round += 1) {
      expect(isShortCode(generateShortCode(realRandom))).toBe(true);
    }
  });

  it("ngắn hơn hẳn mã đầy đủ — đó là cả lý do nó tồn tại", () => {
    expect(SHORT_CODE_LENGTH).toBeLessThan(CHECKIN_CODE_LENGTH);
  });
});

describe("hai loại mã không lẫn vào nhau", () => {
  it("mã ngắn KHÔNG phải mã đầy đủ", () => {
    expect(isCheckinCode(generateShortCode(realRandom))).toBe(false);
  });

  it("mã đầy đủ KHÔNG phải mã ngắn", () => {
    expect(isShortCode(generateCheckinCode(realRandom))).toBe(false);
  });
});

describe("đường CÔNG KHAI không bao giờ nhận mã ngắn", () => {
  it("readCheckinCode từ chối mã 4 ký tự gõ trần", () => {
    // Đây là ca quan trọng nhất của file.
    for (let round = 0; round < 50; round += 1) {
      expect(readCheckinCode(generateShortCode(realRandom))).toBeNull();
    }
  });

  it("readCheckinCode từ chối một URL vé mang mã 4 ký tự", () => {
    const short = generateShortCode(realRandom);
    expect(readCheckinCode(checkinCodeUrl("https://os.example.vn", short))).toBeNull();
  });
});

describe("classifyScannedInput — phân loại để tra đúng phạm vi", () => {
  it("mã đầy đủ được đánh dấu là 'full'", () => {
    const code = generateCheckinCode(realRandom);
    expect(classifyScannedInput(code)).toEqual({ kind: "full", code });
  });

  it("URL vé cũng là 'full'", () => {
    const code = generateCheckinCode(realRandom);
    expect(classifyScannedInput(checkinCodeUrl("https://os.example.vn", code))).toEqual({
      kind: "full",
      code
    });
  });

  it("mã 4 ký tự được đánh dấu là 'short'", () => {
    // Nhãn này là thứ quyết định phạm vi tra: 'short' chỉ tra trong đúng sự
    // kiện đang mở, 'full' tra trên toàn hệ thống.
    const short = generateShortCode(realRandom);
    expect(classifyScannedInput(short)).toEqual({ kind: "short", code: short });
  });

  it("chấp nhận mã ngắn gõ thường và có khoảng trắng", () => {
    expect(classifyScannedInput("  a7k2  ")).toEqual({ kind: "short", code: "A7K2" });
  });

  it("từ chối mọi thứ khác", () => {
    for (const junk of [
      "",
      "AB",
      "ABCDE",
      "A7K0",
      "https://example.com/gi-do",
      "00020101021138540010A00000072701",
      "tel:0900000000"
    ]) {
      expect(classifyScannedInput(junk), junk).toEqual({ kind: "unreadable" });
    }
  });

  it("cả năm ký tự dễ nhầm đều bị từ chối, không cái nào bị đoán thành cái kia", () => {
    // Bảng chữ cái bỏ `0` `O` `1` `I` `L`. Cả năm đều không hợp lệ — và quan
    // trọng là mã chứa `O` không được đoán thành `0`, hay ngược lại: đoán như
    // vậy là mở đường cho một mã gõ sai trở thành mã đúng của người khác.
    for (const near of ["A7K0", "A7KO", "A7K1", "A7KI", "A7KL"]) {
      expect(classifyScannedInput(near), near).toEqual({ kind: "unreadable" });
    }
  });
});
