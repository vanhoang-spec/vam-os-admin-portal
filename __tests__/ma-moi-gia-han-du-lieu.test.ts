/**
 * Mentor gia hạn đã có mã mới, nên trang gia hạn và Dữ liệu cần xử lý phải hiện mã đó. Mã cũ chỉ còn là khoá nhận
 * diện ở phía máy chủ: luồng import mentor cũ vẫn phải tra mentor_code.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { displayMemberCode } from "@/lib/member-code-core";
import { matchesMentorQuery } from "@/lib/renewal-search";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const mentorCode = displayMemberCode("UEHR0012", "UEHRF01005");

describe("tìm mentor gia hạn", () => {
  it("tìm được theo cả mã mới và mã cũ", () => {
    expect(matchesMentorQuery({ fullName: "An", mentorCode, email: null }, "UEHR0012")).toBe(true);
    expect(matchesMentorQuery({ fullName: "An", mentorCode, email: null }, "UEHRF01005")).toBe(true);
    expect(matchesMentorQuery({ fullName: "An", mentorCode, email: null }, "UEHR9999")).toBe(false);
  });
});

describe("nguồn dữ liệu", () => {
  it("trang gia hạn đọc mã mới từ bảng người", () => {
    const consoleCode = source("lib/renewal-console.ts");
    expect(consoleCode).toContain('"id,full_name,email_primary,data_quality_flags,member_code"');
    expect(consoleCode).toContain("displayMemberCode(person.member_code");
    expect(consoleCode).toContain("displayMemberCode(person?.member_code");
    expect(source("lib/renewal-batch.ts")).toContain("displayMemberCode(person?.member_code");
  });
  it("trang gia hạn công khai hiện mã mới cho mentor", () => {
    const code = source("lib/renewal-runtime.ts");
    expect(code).toContain("mentorCode: person.member_code ?? profile.mentor_code");
    expect(code).toContain('.select("id,full_name,email_primary,phone_primary,member_code")');
  });
  it("Dữ liệu cần xử lý hiện mã mới ở cả ba mục", () => {
    const code = source("app/data-issues/page.tsx");
    expect(code.split("displayMemberCode(person?.member_code").length - 1).toBe(3);
    expect(code).not.toContain('"Mã Mentor"');
    expect(code).not.toContain('"Mã Mentee"');
  });
  it("import mentor cũ vẫn tra theo mã cũ", () => {
    expect(source("lib/legacy-mentor-service.ts")).toContain('.ilike("mentor_code", exactCodePattern)');
  });
});
