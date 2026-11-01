import { describe, expect, it } from "vitest";
import { compareMemberCodeCandidates, displayMemberCode, isMemberCode, legacyCodeSeason, nameSortParts, seasonStartYear } from "@/lib/member-code-core";

const person = (fullName: string, startYear = 2026, createdAt = "2026-01-01") => ({ fullName, startYear, createdAt });
const order = (rows: ReturnType<typeof person>[]) => [...rows].sort(compareMemberCodeCandidates).map((r) => r.fullName);

describe("dạng mã mới", () => {
  it("đúng 8 ký tự, nhóm R/E/S/C, số từ 0001", () => {
    expect(isMemberCode("UEHE0001")).toBe(true);
    expect(isMemberCode("UEHR9999")).toBe(true);
    for (const bad of ["UEHRF0800", "UEHX0001", "UEHR001", "UEHR0000", "ueHR0001", "", null, undefined]) expect(isMemberCode(bad)).toBe(false);
  });
});

describe("đọc mùa từ mã cũ", () => {
  it("hai chữ số đầu của phần số là mùa", () => {
    expect(legacyCodeSeason("UEHEF05123")).toBe(5);
    expect(legacyCodeSeason("UEHRF01005")).toBe(1);
    expect(legacyCodeSeason("UEHRM11154")).toBe(11);
    expect(legacyCodeSeason("UM02001")).toBe(2);
  });
  it("mã không đúng dạng thì không đoán", () => {
    for (const bad of ["test-01", "UEHR0001", "UEHRF00123", "", null]) expect(legacyCodeSeason(bad)).toBeNull();
  });
});

describe("năm bắt đầu", () => {
  it("mùa 1 và 2 cùng là 2016, từ mùa 3 cộng theo năm", () => {
    expect([1, 2, 3, 10, 12].map(seasonStartYear)).toEqual([2016, 2016, 2017, 2024, 2026]);
  });
});

describe("thứ tự cấp số", () => {
  it("tách Tên, Họ, Tên đệm và bỏ dấu, kể cả tên viết hoa hoặc chữ đ", () => {
    expect(nameSortParts("NGUYỄN  Thị Đào")).toEqual({ ten: "dao", ho: "nguyen", dem: "thi" });
    expect(nameSortParts("Hùng")).toEqual({ ten: "hung", ho: "", dem: "" });
  });
  it("đúng ví dụ của BTC: Hồ Mỹ An, Nguyễn Minh An, Bồ Tùng Anh", () => {
    expect(order([person("Bồ Tùng Anh"), person("Nguyễn Minh An"), person("Hồ Mỹ An")])).toEqual(["Hồ Mỹ An", "Nguyễn Minh An", "Bồ Tùng Anh"]);
  });
  it("năm bắt đầu đứng trước tên", () => {
    expect(order([person("An", 2026), person("Yến", 2016)])).toEqual(["Yến", "An"]);
  });
  it("cùng họ tên thì xét tên đệm, trùng hết thì hồ sơ tạo trước đứng trước", () => {
    expect(order([person("Lê Văn An"), person("Lê Anh An")])).toEqual(["Lê Anh An", "Lê Văn An"]);
    const later = person("Lê An", 2026, "2026-02-01");
    const earlier = person("Lê An", 2026, "2026-01-01");
    expect([later, earlier].sort(compareMemberCodeCandidates)).toEqual([earlier, later]);
  });
  it("cùng một tên ở dạng dựng sẵn và dạng tổ hợp thì so bằng nhau", () => {
    expect(nameSortParts("Hồ An".normalize("NFD"))).toEqual(nameSortParts("Hồ An".normalize("NFC")));
  });
});

describe("hiển thị", () => {
  it("mã mới kèm mã cũ, thiếu bên nào hiện bên còn lại", () => {
    expect(displayMemberCode("UEHR0001", "UEHRF01005")).toBe("UEHR0001 (UEHRF01005)");
    expect(displayMemberCode("UEHE0001", null)).toBe("UEHE0001");
    expect(displayMemberCode(null, "UEHRF01005")).toBe("UEHRF01005");
    expect(displayMemberCode(" ", "")).toBeNull();
  });
});
