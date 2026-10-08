/**
 * Cấp bậc đọc từ chức danh tự khai (báo cáo tuyển mentor, BTC 08/10/2026).
 *
 * Điều phải đúng: cụm dài thắng cụm ngắn ("phó tổng giám đốc" ≠ "tổng giám đốc",
 * "trợ lý giám đốc" ≠ "giám đốc"); nhiều cụm → cấp cao nhất; viết tắt / sai chính tả
 * thật của mùa 12 đọc được; chức danh không đọc ra cấp thì nằm "Chưa xếp được", không
 * bị đoán vào đâu. Khoá trên toàn bộ chức danh thật, không chỉ ví dụ tự nghĩ.
 */
import { describe, expect, it } from "vitest";
import { seniorityOf } from "@/lib/mentor-seniority-core";
import { S12_MENTOR_TITLES } from "./fixtures/mentor-titles-s12";

const level = (title: string) => seniorityOf(title).level;

describe("cụm dài thắng cụm ngắn", () => {
  it.each([
    ["Phó Tổng Giám Đốc", "senior_director"],
    ["Tổng Giám đốc", "c_level"],
    ["Trợ lý Tổng Giám đốc", "specialist"],
    ["TRỢ LÝ GIÁM ĐỐC", "specialist"],
    ["Trợ lý Hội Đồng Quản Trị", "specialist"],
    ["Thành Viên Hội Đồng Quản Trị", "c_level"],
    ["Trợ lý Phụ trách bán lẻ", "specialist"],
    ["Phụ trách Phòng Tổ chức hành chính", "manager"],
    ["Chief Accountant", "manager"],
    ["Chief Financial Officer", "c_level"],
    ["Head Teacher", "academic"],
    ["Head of Sales", "director"],
    ["Country Sales Manager", "manager"],
    ["Country Manager", "c_level"],
    ["Client Partner Manager", "manager"],
    ["Finance Business Partner Manager", "manager"],
    ["Partner & Investment Director", "c_level"],
    ["Senior Director", "senior_director"],
    ["Director", "director"],
    ["Senior Manager", "manager"],
    ["Customer Marketing & High Net Worth Assistant Manager", "manager"],
    ["Tư vấn quản lý", "specialist"],
    ["Quản lý vận hành", "manager"],
    ["Phó trưởng phòng", "manager"],
    ["Trưởng phòng Cấp cao", "manager"],
    ["Giám đốc cấp cao", "senior_director"],
    ["Giám đốc Khối Hành chính Nhân sự", "senior_director"]
  ])("%s → %s", (title, expected) => {
    expect(level(title)).toBe(expected);
  });
});

describe("nhiều cụm: lấy cấp cao nhất", () => {
  it.each([
    ["Phó Chủ tịch kiêm Tổng Giám đốc", "c_level"],
    ["Founder & Coach", "c_level"],
    ["Giám đốc cấp cao và Giảng viên Thỉnh giảng UEH", "senior_director"],
    ["Trợ lý GĐ ĐH/ Trưởng phòng Kinh doanh Dịch vụ", "manager"],
    ["Phó Giám Đốc kiêm Trưởng Phòng Kinh Doanh", "director"],
    ["SSI: Product Owner dự án GenAI, Giảng viên nội bộ AI, Trưởng phòng Tư vấn chứng khoán; UEH: Giảng viên thỉnh giảng", "manager"]
  ])("%s → %s", (title, expected) => {
    expect(level(title)).toBe(expected);
  });
});

describe("viết tắt, không dấu, sai chính tả có thật", () => {
  it.each([
    ["GĐ", "director"],
    ["Gđ Phd", "director"],
    ["PGĐ PTTT Miền Nam", "director"],
    ["P. Giám Đốc", "director"],
    ["Gám đốc", "director"],
    ["GIÁM ĐỐC", "director"],
    ["giam doc", "director"],
    ["Phó CT HĐQT", "senior_director"],
    ["HRD", "director"],
    ["Regional HRM", "manager"],
    ["TBP. KHDN", "manager"],
    ["Tp KSNB", "manager"],
    ["Sales Manarger", "manager"],
    ["SAP FICO consultant teamleader", "manager"],
    ["Founder/C.E.O.", "c_level"],
    ["VP group reporting", "senior_director"]
  ])("%s → %s", (title, expected) => {
    expect(level(title)).toBe(expected);
  });

  it("ghi lại cụm đã khớp, để trang nói được vì sao", () => {
    expect(seniorityOf("Phó Tổng giám đốc")).toEqual({ level: "senior_director", matched: "pho tong giam doc" });
    expect(seniorityOf("")).toEqual({ level: "unclassified", matched: null });
    expect(seniorityOf(null)).toEqual({ level: "unclassified", matched: null });
  });
});

describe("toàn bộ chức danh thật mùa 12", () => {
  it("phân bố theo cấp — đổi luật thì con số này đổi, phải xem lại có chủ ý", () => {
    const counts: Record<string, number> = {};
    for (const t of S12_MENTOR_TITLES) counts[level(t)] = (counts[level(t)] ?? 0) + 1;
    expect(counts).toEqual({
      c_level: 50,
      senior_director: 17,
      director: 115,
      manager: 151,
      academic: 10,
      specialist: 69,
      independent: 5,
      unclassified: 12
    });
  });

  it("chỉ đúng các chức danh không nói cấp mới nằm “Chưa xếp được”", () => {
    expect(S12_MENTOR_TITLES.filter((t) => level(t) === "unclassified")).toEqual([
      "Đại diện ISC Global (Việt Nam) khu vực miền nam",
      "EQuest Education Group",
      "HR",
      "Logistics",
      "MAI",
      "Meta Management",
      "N/A",
      "QUẢN TRỊ TÀI CHÍNH",
      "Risk & Compliance",
      "Tái thẩm định KHDN (SME, DN lớn và FDI, Định chế tài chính,..); Thành viên tiểu ban tín dụng (rà soát chuyển giao DAB sang Vikki Bank)",
      "Talent Development",
      "TEST"
    ]);
  });
});
