import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  displayCurrentMemberCode,
  displayYearOfStudy,
  firstSeasonLabel,
  firstSeasonOf,
  firstSeasonOrder,
  memberCodeOrder
} from "@/lib/member-code-core";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("VAM00016/17: danh sách chỉ hiện mã mới", () => {
  it("có mã mới thì không kèm mã cũ trong ngoặc", () => {
    expect(displayCurrentMemberCode("UEHR0001", "UEHRM03023")).toBe("UEHR0001");
    expect(displayCurrentMemberCode(" UEHE0007 ", "UEHEM11164")).toBe("UEHE0007");
  });
  it("chưa có mã mới thì còn mã cũ để dòng không trống, không có gì thì null", () => {
    expect(displayCurrentMemberCode(null, "UEHEM11164")).toBe("UEHEM11164");
    expect(displayCurrentMemberCode("", "  ")).toBeNull();
  });
});

describe("VAM00016/17: Mùa & Năm mentoring đầu tiên", () => {
  it("đọc mùa từ hai chữ số đầu của mã cũ, năm theo mùa", () => {
    expect(firstSeasonLabel({ legacyCode: "UEHRM11032", hasMemberCode: true })).toBe("Mùa 11 - Năm 2025");
    expect(firstSeasonLabel({ legacyCode: "UEHEM11164", hasMemberCode: true })).toBe("Mùa 11 - Năm 2025");
    expect(firstSeasonLabel({ legacyCode: "UEHRF03024", hasMemberCode: true })).toBe("Mùa 03 - Năm 2017");
    expect(firstSeasonLabel({ legacyCode: "UEHSF11001", hasMemberCode: true })).toBe("Mùa 11 - Năm 2025");
  });
  it("mùa 1 và 2 cùng là năm 2016, không phải 2015 như báo lỗi ghi", () => {
    expect(firstSeasonLabel({ legacyCode: "UEHRF01005" })).toBe("Mùa 01 - Năm 2016");
    expect(firstSeasonLabel({ legacyCode: "UM02001" })).toBe("Mùa 02 - Năm 2016");
    expect(firstSeasonLabel({ legacyCode: "UEHRF01005" })).not.toContain("2015");
  });
  it("mã cũ thắng năm ghi trên hồ sơ khi hai bên lệch", () => {
    expect(firstSeasonLabel({ legacyCode: "UEHRF05123", startYear: 2024, hasMemberCode: true })).toBe("Mùa 05 - Năm 2019");
  });
  it("không có mã cũ thì dùng năm bắt đầu trên hồ sơ", () => {
    expect(firstSeasonLabel({ startYear: 2024, hasMemberCode: true })).toBe("Mùa 10 - Năm 2024");
    expect(firstSeasonLabel({ startYear: 2026, hasMemberCode: true })).toBe("Mùa 12 - Năm 2026");
  });
  it("năm 2016 không có mã cũ thì chỉ biết năm, vì chưa rõ mùa 1 hay 2", () => {
    expect(firstSeasonOf({ startYear: 2016, hasMemberCode: true })).toEqual({ season: null, year: 2016 });
    expect(firstSeasonLabel({ startYear: 2016, hasMemberCode: true })).toBe("Năm 2016");
  });
  it("chỉ có mã mới thì là Mùa 12 - Năm 2026; không có gì thì dấu gạch", () => {
    expect(firstSeasonLabel({ hasMemberCode: true })).toBe("Mùa 12 - Năm 2026");
    expect(firstSeasonLabel({})).toBe("-");
    expect(firstSeasonLabel({ startYear: 1999, hasMemberCode: false })).toBe("-");
  });
  it("xếp sớm nhất trước, chưa rõ xuống cuối", () => {
    const early = firstSeasonOrder({ legacyCode: "UEHRF01005" });
    const mid = firstSeasonOrder({ legacyCode: "UEHRF11032" });
    const late = firstSeasonOrder({ hasMemberCode: true });
    const unknown = firstSeasonOrder({});
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThan(late);
    expect(late).toBeLessThan(unknown);
  });
});

describe("VAM00020/21: xếp theo mã mới", () => {
  const mentorOrder = (code: string | null) => memberCodeOrder(code, "CR");
  const menteeOrder = (code: string | null) => memberCodeOrder(code, "SE");

  it("mentor: toàn bộ UEHC đứng trước UEHR, trong nhóm theo số", () => {
    const codes = ["UEHR0001", "UEHC0010", "UEHR0630", "UEHC0002", "UEHC0017"];
    const sorted = [...codes].sort((a, b) => mentorOrder(a) - mentorOrder(b));
    expect(sorted).toEqual(["UEHC0002", "UEHC0010", "UEHC0017", "UEHR0001", "UEHR0630"]);
  });
  it("mentee: UEHS đứng trước UEHE dù chữ E đứng trước chữ S trong bảng chữ cái", () => {
    const codes = ["UEHE0001", "UEHS0017", "UEHE0720", "UEHS0001"];
    const sorted = [...codes].sort((a, b) => menteeOrder(a) - menteeOrder(b));
    expect(sorted).toEqual(["UEHS0001", "UEHS0017", "UEHE0001", "UEHE0720"]);
  });
  it("chưa có mã mới, mã cũ, hoặc mã nhóm khác thì xuống cuối", () => {
    for (const khongHopLe of [null, "", "UEHEM11164", "UEHR0001x"]) {
      expect(menteeOrder(khongHopLe)).toBeGreaterThan(menteeOrder("UEHE9999"));
    }
    expect(mentorOrder("UEHE0001")).toBeGreaterThan(mentorOrder("UEHR9999"));
    expect(menteeOrder("UEHC0001")).toBeGreaterThan(menteeOrder("UEHE9999"));
  });
  it("nhận chữ thường và khoảng trắng", () => {
    expect(mentorOrder(" uehc0003 ")).toBe(3);
  });
});

describe("VAM00018: Năm học", () => {
  it("năm 1 đến 4 hiện rõ là năm thứ mấy, graduated hiện tiếng Việt, trống là dấu gạch", () => {
    expect(displayYearOfStudy("1")).toBe("Năm 1");
    expect(displayYearOfStudy("4")).toBe("Năm 4");
    expect(displayYearOfStudy("graduated")).toBe("Đã tốt nghiệp");
    expect(displayYearOfStudy(null)).toBe("-");
    expect(displayYearOfStudy("  ")).toBe("-");
  });
});

describe("trang /mentors", () => {
  const code = source("app/mentors/page.tsx");
  it("đổi nhãn cột mã, thay cột Số năm mentor VAM bằng Mùa & Năm đầu tiên, bỏ cột Kinh nghiệm mô tả", () => {
    expect(code).toContain('label: "Mã thành viên Mentor"');
    expect(code).toContain('label: "Mùa & Năm mentoring đầu tiên"');
    expect(code).not.toContain("Số năm mentor VAM");
    expect(code).not.toContain("Kinh nghiệm mô tả");
    expect(code).toContain('label: "Số năm kinh nghiệm"');
  });
  it("mặc định xếp theo mã mới Core rồi Mentor", () => {
    const sort = /sortOptions=\{\[\s*(?:\/\/[^\n]*\n\s*)?\{ label: "([^"]*)", key: "([^"]*)"/.exec(code);
    expect(sort?.[2]).toBe("member_code_order");
    expect(code).toContain('memberCodeOrder(person?.member_code, "CR")');
  });
  it("không hiện mã cũ trong ngoặc nhưng vẫn tìm được theo mã cũ", () => {
    expect(code).not.toContain("displayMemberCode(");
    expect(code).toContain("displayCurrentMemberCode(person?.member_code, mentor.mentor_code)");
    expect(/searchKeys=\{\[(.*?)\]\}/.exec(code)?.[1]).toContain('"mentor_code"');
  });
});

describe("trang /mentees", () => {
  const code = source("app/mentees/page.tsx");
  const columns = code.slice(code.indexOf("columns={["));
  const at = (label: string) => columns.indexOf(`label: "${label}"`);

  it("đổi nhãn cột mã, bỏ ba cột Trường, Khóa / Lớp, Độ tin cậy", () => {
    expect(code).toContain('label: "Mã thành viên Mentee"');
    for (const bo of ["Trường", "Khóa / Lớp", "Độ tin cậy match"]) {
      expect(at(bo)).toBe(-1);
    }
    expect(code).not.toContain("Độ tin cậy giảm dần");
  });
  it("Năm học nằm ngay sau Mã trường; Mùa & Năm đầu tiên nằm ngay sau Ngành học", () => {
    const order = ["Mã trường", "Năm học", "Ngành học", "Mùa & Năm mentoring đầu tiên", "MSSV"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("mặc định xếp theo mã mới Support team rồi Mentee, và không hiện mã cũ trong ngoặc", () => {
    const sort = /sortOptions=\{\[\s*(?:\/\/[^\n]*\n\s*)?\{ label: "([^"]*)", key: "([^"]*)"/.exec(code);
    expect(sort?.[2]).toBe("member_code_order");
    expect(code).toContain('memberCodeOrder(person?.member_code, "SE")');
    expect(code).not.toContain("displayMemberCode(");
    expect(code).toContain("displayCurrentMemberCode(mentor?.member_code, mentorProfile?.mentor_code)");
    expect(/searchKeys=\{\[(.*?)\]\}/.exec(code)?.[1]).toContain('"mentee_code"');
  });
});
