import { describe, expect, it } from "vitest";

import {
  MENTEE_PROFILE_COLUMNS,
  MENTOR_PROFILE_COLUMNS,
  PARTICIPANT_GROUP_ORDER,
  PARTICIPANT_SHEET_NAME,
  PERSON_COLUMNS,
  buildParticipantTable,
  cellValue,
  isExcludedColumn,
  participantExportHref,
  participantGroupStyles,
  type ParticipantExportInput,
  type ParticipantRole
} from "@/lib/participant-export-core";
import { groupedTableXlsx } from "@/lib/xlsx-grouped-table";
import { BATCH_ID, SEASON_ID, menteeProfileRow, mentorProfileRow, personRow, uuid } from "./support/participant-export-fixture";
import { columnValues, readSheet } from "./support/xlsx-read";

function xlsxOf(input: ParticipantExportInput) {
  const role: ParticipantRole = input.role;
  return readSheet(
    groupedTableXlsx(buildParticipantTable(input), {
      sheetName: PARTICIPANT_SHEET_NAME[role],
      groupOrder: PARTICIPANT_GROUP_ORDER,
      groups: participantGroupStyles(role),
      frozenColumns: 2
    })
  );
}

function mentorInput(): ParticipantExportInput {
  return {
    role: "mentor",
    profiles: [
      mentorProfileRow(1, {
        mentor_code: "UEHMR11001",
        first_joined_year: 2019,
        company_current: "Công ty A",
        bio_url: "https://drive.example.test/cv-1.pdf",
        admin_notes: "Ghi chú nội bộ không được ra file",
        years_experience_min: 12,
        support_team_lead: false,
        intake_batch_id: BATCH_ID,
        // Cột mới thêm vào database về sau, code chưa biết tên.
        profile_picture_url: "=HYPERLINK(\"https://img.example.test/a.png\")",
        renewal_token_hash: "abc123"
      }),
      mentorProfileRow(2, { mentor_code: null }),
      mentorProfileRow(3, { mentor_code: "UEHMR12009" })
    ],
    people: [
      personRow(1, { member_code: "UEHR0002", gender: "male", date_of_birth: "1990-05-03", consent_pdpa_at: "2026-09-10T17:30:00Z" }),
      personRow(2, { member_code: "UEHC0001" }),
      personRow(3, { member_code: null, full_name: "An Chưa Có Mã" })
    ],
    intakeBatches: [{ id: BATCH_ID, code: "S12-MENTOR-01", season_id: SEASON_ID }],
    seasons: [{ id: SEASON_ID, code: "UEHM-S12" }],
    industryLinks: [
      { mentor_profile_id: uuid(1, 4), industry_id: "i2" },
      { mentor_profile_id: uuid(1, 4), industry_id: "i1" }
    ],
    industries: [
      { id: "i1", name: "Tài chính" },
      { id: "i2", name: "Bán lẻ" }
    ],
    functionLinks: [{ mentor_profile_id: uuid(1, 4), function_area_id: "f1" }],
    functionAreas: [{ id: "f1", name: "Marketing" }],
    programLinks: [],
    programs: []
  };
}

describe("VAM00025 — bảng hồ sơ Mentor", () => {
  it("đúng một sheet, tên theo vai trò", () => {
    const sheet = xlsxOf(mentorInput());
    expect(sheet.sheetNames).toEqual(["Mentor"]);
    expect(sheet.zip.file("xl/worksheets/sheet2.xml")).toBeNull();
    expect(Object.keys(sheet.zip.files).filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"))).toEqual(["xl/worksheets/sheet1.xml"]);
  });

  it("mỗi hồ sơ đúng một dòng, xếp như danh sách: UEHC trước UEHR, chưa có mã xuống cuối", () => {
    const sheet = xlsxOf(mentorInput());
    expect(sheet.rows).toHaveLength(3);
    expect(columnValues(sheet, "Mã thành viên")).toEqual(["UEHC0001", "UEHR0002", null]);
    expect(columnValues(sheet, "Họ và tên")).toEqual(["Người Thử 2", "Người Thử 1", "An Chưa Có Mã"]);
  });

  it("tiêu đề tiếng Việt; hai cột đầu là mã thành viên và họ tên; mã mới và mã cũ là hai cột riêng", () => {
    const sheet = xlsxOf(mentorInput());
    expect(sheet.headers.slice(0, 2)).toEqual(["Mã thành viên", "Họ và tên"]);
    for (const header of ["Email", "Số điện thoại", "Giới tính", "Ngày sinh", "Mã cũ", "Năm bắt đầu tham gia chương trình mentoring thuộc VAM", "Công ty hiện tại", "Liên kết hồ sơ (Bio / CV)", "Mùa & Năm mentoring đầu tiên", "Ngành nghề (danh mục)", "Chức năng chuyên môn (danh mục)", "Mùa intake", "Đợt tuyển"]) {
      expect(sheet.headers).toContain(header);
    }
    expect(columnValues(sheet, "Mã cũ")).toEqual([null, "UEHMR11001", "UEHMR12009"]);
    expect(sheet.groupTitles).toEqual(["1. THÔNG TIN CÁ NHÂN", "2. HỒ SƠ MENTOR", "3. THAM GIA CHƯƠNG TRÌNH"]);
    expect(sheet.sheetXml).toContain('<pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/>');
  });

  it("cột trống vẫn có mặt: mọi cột của bảng có trong dữ liệu đều thành cột, kể cả khi mọi ô đều trống", () => {
    const sheet = xlsxOf(mentorInput());
    for (const column of [...PERSON_COLUMNS, ...MENTOR_PROFILE_COLUMNS]) {
      if (column.key === "admin_notes") continue;
      expect(sheet.headers, column.key).toContain(column.header);
    }
    expect(columnValues(sheet, "Facebook")).toEqual([null, null, null]);
    expect(columnValues(sheet, "LinkedIn")).toEqual([null, null, null]);
  });

  it("cột lạ (thêm vào database sau) vẫn được xuất, tiêu đề là tên cột gốc", () => {
    const sheet = xlsxOf(mentorInput());
    expect(sheet.headers).toContain("profile_picture_url");
  });

  it("ghi chú admin và mã băm / token KHÔNG có trong file", () => {
    const sheet = xlsxOf(mentorInput());
    expect(sheet.headers).not.toContain("Ghi chú admin");
    expect(sheet.headers).not.toContain("admin_notes");
    expect(sheet.headers).not.toContain("renewal_token_hash");
    expect(sheet.sheetXml).not.toContain("Ghi chú nội bộ");
    expect(sheet.sheetXml).not.toContain("abc123");
  });

  it("đường dẫn là chữ trong ô: không công thức, không ảnh nhúng, không liên kết đính kèm", () => {
    const sheet = xlsxOf(mentorInput());
    expect(columnValues(sheet, "Liên kết hồ sơ (Bio / CV)")).toContain("https://drive.example.test/cv-1.pdf");
    expect(columnValues(sheet, "profile_picture_url")).toContain('=HYPERLINK("https://img.example.test/a.png")');
    expect(sheet.sheetXml).not.toContain("<f>");
    expect(sheet.sheetXml).not.toContain("<hyperlink");
    expect(sheet.sheetXml).not.toContain("<drawing");
    expect(Object.keys(sheet.zip.files).filter((name) => /media|drawings|worksheets\/_rels/.test(name))).toEqual([]);
  });

  it("định dạng giá trị: ngày DD/MM/YYYY giờ Việt Nam, giới tính tiếng Việt, số là số, có/không là chữ", () => {
    const sheet = xlsxOf(mentorInput());
    const row = sheet.rows[1];
    const at = (header: string) => row[sheet.headers.indexOf(header)];
    expect(at("Ngày sinh")).toBe("03/05/1990");
    // 17:30 UTC ngày 10/09 là 00:30 ngày 11/09 giờ Việt Nam.
    expect(at("Thời điểm đồng ý PDPA")).toBe("11/09/2026 00:30");
    expect(at("Giới tính")).toBe("Nam");
    expect(at("Số năm kinh nghiệm")).toBe(12);
    expect(at("Trưởng nhóm Support team")).toBe("Không");
    expect(at("Mùa & Năm mentoring đầu tiên")).toBe("Mùa 11 - Năm 2025");
    expect(at("Mùa intake")).toBe("UEHM-S12");
    expect(at("Đợt tuyển")).toBe("S12-MENTOR-01");
    expect(at("Ngành nghề (danh mục)")).toBe("Bán lẻ; Tài chính");
    expect(at("Chức năng chuyên môn (danh mục)")).toBe("Marketing");
  });

  it("chưa có ai để xuất: vẫn ra đủ các cột đã biết, không có dòng dữ liệu", () => {
    const sheet = xlsxOf({ ...mentorInput(), profiles: [], people: [] });
    expect(sheet.rows).toEqual([]);
    expect(sheet.headers).toContain("Năm bắt đầu tham gia chương trình mentoring thuộc VAM");
    expect(sheet.headers).toContain("Email");
    expect(sheet.headers).not.toContain("Ghi chú admin");
  });
});

describe("VAM00025 — bảng hồ sơ Mentee", () => {
  const input = (): ParticipantExportInput => ({
    role: "mentee",
    profiles: [
      menteeProfileRow(1, { mentee_code: "UEHME11010", mssv: "00000000001", year_of_study: "3", gpa_4: "3.5" }),
      menteeProfileRow(2, {})
    ],
    people: [personRow(1, { member_code: "UEHE0005" }), personRow(2, { member_code: "UEHS0001" })],
    intakeBatches: [],
    seasons: []
  });

  it("một sheet Mentee, Support team (UEHS) trước Mentee (UEHE), MSSV giữ nguyên dạng chữ", () => {
    const sheet = xlsxOf(input());
    expect(sheet.sheetNames).toEqual(["Mentee"]);
    expect(columnValues(sheet, "Mã thành viên")).toEqual(["UEHS0001", "UEHE0005"]);
    expect(columnValues(sheet, "MSSV")).toEqual([null, "00000000001"]);
    expect(columnValues(sheet, "Năm học")).toEqual([null, "Năm 3"]);
    expect(columnValues(sheet, "Mã cũ")).toEqual([null, "UEHME11010"]);
    expect(sheet.groupTitles[1]).toBe("2. HỒ SƠ MENTEE");
    for (const column of MENTEE_PROFILE_COLUMNS) expect(sheet.headers, column.key).toContain(column.header);
    // Cột chỉ của mentor không lọt vào file mentee.
    expect(sheet.headers).not.toContain("Ngành nghề (danh mục)");
  });
});

describe("cột bị loại và đường tải", () => {
  it("loại đúng cột nội bộ / bí mật, không loại nhầm cột thường", () => {
    for (const key of ["admin_notes", "internal_notes", "core_team_note", "token", "access_token", "token_hash", "password", "api_key", "secret"]) {
      expect(isExcludedColumn(key), key).toBe(true);
    }
    for (const key of ["bio_url", "mssv", "source_sheet", "member_code", "hashtag_text"]) expect(isExcludedColumn(key), key).toBe(false);
  });
  it("ô trống thật cho null / chuỗi rỗng; 0 vẫn là 0", () => {
    expect(cellValue("x", null)).toBeNull();
    expect(cellValue("x", "  ")).toBeNull();
    expect(cellValue("x", 0)).toBe(0);
    expect(cellValue("x", ["a", null, "b"])).toBe("a; b");
  });
  it("đường tải mang vai trò và mã mùa", () => {
    expect(participantExportHref("mentor", "UEHM-S12")).toBe("/api/exports/participant-profiles?role=mentor&season=UEHM-S12");
  });
});
