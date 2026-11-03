import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

import { humanizeKey } from "@/lib/application-export";
import {
  NONE,
  MAX_EXPORT_IDS,
  applyExportFilters,
  parseExportFilters,
  resultOptions,
  reviewerOptions
} from "@/lib/mentee-offline-export-filter";
import { buildExportTable, currentReview, filteredIds, summaryRows } from "@/lib/mentee-offline-export-core";
import { EXPORT_GROUP_COLORS, XLSX_SHEET_NAME, columnLetter, groupSpans, menteeOfflineXlsx } from "@/lib/mentee-offline-export-xlsx";
import { canExportMenteeOffline } from "@/lib/permissions";
import { STAFF_BINH, STAFF_HOA, STAFF_OLD, dataset, review, uuid } from "./support/mentee-offline-export-fixture";

const headerOf = (table: ReturnType<typeof buildExportTable>, header: string) => table.columns.findIndex((c) => c.header === header);

describe("phiếu hiện tại của một vòng", () => {
  it("bỏ phiếu đã huỷ: người đánh giá cũ không xuất hiện", () => {
    const mine = dataset().reviews.filter((r) => r.application_id === uuid(1));
    const profile = currentReview(mine, "profile_screening");
    expect(profile?.reviewer_admin_user_id).toBe(STAFF_HOA);
    expect(profile?.reviewer_note).toBe("Hồ sơ tốt");
  });
  it("vòng chưa có phiếu thì null; chỉ có phiếu huỷ cũng là null", () => {
    expect(currentReview([], "interview")).toBeNull();
    expect(currentReview([review({ id: uuid(1, 5), application_id: uuid(1), review_round: "interview", status: "cancelled" })], "interview")).toBeNull();
  });
  it("phiếu huỷ cập nhật MUỘN hơn phiếu đang làm vẫn không thắng: người đánh giá cũ không quay lại", () => {
    const live = review({ id: uuid(1, 5), application_id: uuid(1), review_round: "interview", status: "in_progress", reviewer_admin_user_id: STAFF_BINH, updated_at: "2026-10-01T00:00:00Z" });
    const cancelled = review({ id: uuid(2, 5), application_id: uuid(1), review_round: "interview", status: "cancelled", reviewer_admin_user_id: STAFF_OLD, updated_at: "2026-10-09T00:00:00Z" });
    expect(currentReview([cancelled, live], "interview")?.id).toBe(live.id);
    expect(currentReview([live, cancelled], "interview")?.reviewer_admin_user_id).toBe(STAFF_BINH);
  });
  it("lệch dữ liệu có hai phiếu chưa huỷ: lấy phiếu đã nộp, rồi phiếu mới cập nhật, luôn cùng một kết quả", () => {
    const draft = review({ id: uuid(1, 5), application_id: uuid(1), review_round: "interview", status: "in_progress", updated_at: "2026-10-09T00:00:00Z" });
    const oldSubmitted = review({ id: uuid(2, 5), application_id: uuid(1), review_round: "interview", updated_at: "2026-10-02T00:00:00Z" });
    const newSubmitted = review({ id: uuid(3, 5), application_id: uuid(1), review_round: "interview", updated_at: "2026-10-05T00:00:00Z" });
    expect(currentReview([draft, oldSubmitted, newSubmitted], "interview")?.id).toBe(newSubmitted.id);
    expect(currentReview([newSubmitted, oldSubmitted, draft], "interview")?.id).toBe(newSubmitted.id);
  });
});

describe("danh sách tóm tắt", () => {
  it("ca sớm trước, trong ca theo tên; mỗi mentee một dòng", () => {
    const rows = summaryRows(dataset());
    expect(rows.map((r) => r.name)).toEqual(["Đặng Chi", "Nguyễn Văn An", "Trần Thị Bình"]);
  });
  it("người đánh giá hiện tại và kết quả từng vòng", () => {
    const [chi, an, binh] = summaryRows(dataset());
    expect(an.profile).toEqual({ reviewerId: STAFF_HOA, reviewerName: "Lê Hoà", result: "pass_to_interview" });
    expect(an.interview).toEqual({ reviewerId: STAFF_BINH, reviewerName: "Phạm Bình", result: "passed" });
    expect(binh.profile.result).toBe("waitlist");
    // Bình chưa có phiếu phỏng vấn nhưng hồ sơ đã ghi kết quả "cần xem thêm": kết quả vòng phỏng vấn là kết quả đang ghi trên hồ sơ.
    expect(binh.interview).toEqual({ reviewerId: "", reviewerName: "", result: "needs_review" });
    expect(chi.profile).toEqual({ reviewerId: "", reviewerName: "", result: "" });
  });
  it("một mentee có hai lượt giữ ca vẫn chỉ một dòng", () => {
    const data = dataset();
    data.bookings.push({ application_id: uuid(1), session_id: data.sessions[1].id });
    expect(summaryRows(data).filter((r) => r.id === uuid(1))).toHaveLength(1);
  });
});

describe("bộ lọc kết hợp (VÀ)", () => {
  const rows = summaryRows(dataset());
  const names = (filters: Parameters<typeof applyExportFilters>[1]) => applyExportFilters(rows, filters).map((r) => r.name);

  it("không điều kiện thì giữ tất cả", () => {
    expect(names({})).toHaveLength(3);
  });
  it("từng điều kiện đứng riêng", () => {
    expect(names({ profileReviewer: STAFF_HOA })).toEqual(["Nguyễn Văn An"]);
    expect(names({ profileResult: "waitlist" })).toEqual(["Trần Thị Bình"]);
    expect(names({ interviewReviewer: STAFF_BINH })).toEqual(["Nguyễn Văn An"]);
    expect(names({ interviewResult: "needs_review" })).toEqual(["Trần Thị Bình"]);
    expect(names({ q: "tran thi" })).toEqual(["Trần Thị Bình"]);
  });
  it("hai điều kiện cùng lúc: chỉ ai thoả cả hai", () => {
    // Bình do Bình chấm vòng hồ sơ và có kết quả needs_review; An do Hoà chấm vòng hồ sơ.
    expect(names({ profileReviewer: STAFF_BINH, interviewResult: "needs_review" })).toEqual(["Trần Thị Bình"]);
    expect(names({ profileReviewer: STAFF_HOA, interviewResult: "needs_review" })).toEqual([]);
    expect(names({ profileResult: "pass_to_interview", interviewResult: "passed", interviewReviewer: STAFF_BINH })).toEqual(["Nguyễn Văn An"]);
    expect(names({ profileResult: "pass_to_interview", interviewResult: "passed", interviewReviewer: STAFF_HOA })).toEqual([]);
  });
  it("điều kiện cuối (kết quả phỏng vấn) thật sự loại người không khớp", () => {
    expect(names({ profileResult: "pass_to_interview", interviewResult: "rejected" })).toEqual([]);
  });
  it("NONE là chưa có người đánh giá / chưa có kết quả", () => {
    expect(names({ profileReviewer: NONE })).toEqual(["Đặng Chi"]);
    expect(names({ interviewReviewer: NONE })).toEqual(["Đặng Chi", "Trần Thị Bình"]);
    expect(names({ profileResult: NONE })).toEqual(["Đặng Chi"]);
    expect(names({ interviewResult: NONE })).toEqual(["Đặng Chi"]);
  });
  it("danh sách mã đã chọn giới hạn thêm, giao với các điều kiện khác", () => {
    expect(names({ ids: [uuid(1), uuid(2)] })).toEqual(["Nguyễn Văn An", "Trần Thị Bình"]);
    expect(names({ ids: [uuid(1), uuid(2)], profileResult: "waitlist" })).toEqual(["Trần Thị Bình"]);
  });
  it("ô tìm không phân biệt dấu và hoa thường, mọi từ phải khớp", () => {
    expect(names({ q: "NGUYEN an" })).toEqual(["Nguyễn Văn An"]);
    expect(names({ q: "binh@example" })).toEqual(["Trần Thị Bình"]);
    expect(names({ q: "nguyen binh" })).toEqual([]);
  });
  it("tuỳ chọn người đánh giá và kết quả chỉ lấy những gì có trong dữ liệu", () => {
    expect(reviewerOptions(rows, "profile").map((p) => p.name)).toEqual(["Lê Hoà", "Phạm Bình"]);
    expect(reviewerOptions(rows, "profile").map((p) => p.id)).not.toContain(STAFF_OLD);
    expect(resultOptions(rows, "interview").sort()).toEqual(["needs_review", "passed"]);
  });
  it("filteredIds đi qua cùng một bộ lọc", () => {
    expect(filteredIds(dataset(), { profileResult: "waitlist" })).toEqual([uuid(2)]);
  });
});

describe("đọc điều kiện từ biểu mẫu", () => {
  const read = (values: Record<string, string>) => (key: string) => values[key];
  it("hợp lệ: chuẩn hoá chữ thường, bỏ trùng", () => {
    const mixed = "ABCDEF01-0000-4000-8000-00000000000A";
    const parsed = parseExportFilters(read({ ids: `${mixed}, ${mixed.toLowerCase()};${uuid(2)}`, q: "  an  ", profile_reviewer: STAFF_HOA, profile_result: "waitlist", interview_reviewer: NONE, interview_result: "passed" }));
    expect(parsed).toEqual({ ok: true, filters: { ids: [mixed.toLowerCase(), uuid(2)], q: "an", profileReviewer: STAFF_HOA, profileResult: "waitlist", interviewReviewer: NONE, interviewResult: "passed" } });
  });
  it("để trống là không đặt điều kiện", () => {
    expect(parseExportFilters(read({}))).toEqual({ ok: true, filters: {} });
  });
  it("giá trị sai dạng là lỗi, không bị bỏ qua lặng lẽ", () => {
    expect(parseExportFilters(read({ ids: "không-phải-uuid" })).ok).toBe(false);
    expect(parseExportFilters(read({ profile_reviewer: "abc" })).ok).toBe(false);
    expect(parseExportFilters(read({ interview_reviewer: "1; drop table" })).ok).toBe(false);
    expect(parseExportFilters(read({ interview_result: "approved" })).ok).toBe(false);
    expect(parseExportFilters(read({ profile_result: "Nên Mời!" })).ok).toBe(false);
    expect(parseExportFilters(read({ q: "x".repeat(101) })).ok).toBe(false);
  });
  it("quá nhiều mã một lần bị từ chối", () => {
    const ids = Array.from({ length: MAX_EXPORT_IDS + 1 }, (_, i) => uuid(i + 1)).join(",");
    expect(parseExportFilters(read({ ids })).ok).toBe(false);
  });
});

describe("bảng xuất", () => {
  const all = [uuid(1), uuid(2), uuid(3)];
  const table = buildExportTable(dataset(), all);
  const cell = (row: number, header: string) => table.rows[row][headerOf(table, header)];

  it("ba nhóm cột theo thứ tự hồ sơ, vòng hồ sơ, vòng phỏng vấn, mỗi nhóm liền nhau", () => {
    expect(groupSpans(table).map((s) => s.group)).toEqual(["profile", "screening", "interview"]);
    expect(table.rows.every((r) => r.length === table.columns.length)).toBe(true);
  });
  it("mỗi mentee một dòng, theo đúng thứ tự mã được đưa vào", () => {
    expect(table.rows.map((r) => r[1])).toEqual(["Nguyễn Văn An", "Trần Thị Bình", "Đặng Chi"]);
  });
  it("chỉ xuất đúng những mã được đưa vào", () => {
    expect(buildExportTable(dataset(), [uuid(2)]).rows).toHaveLength(1);
    expect(buildExportTable(dataset(), [uuid(404)]).rows).toHaveLength(0);
  });
  it("vòng hồ sơ: người đánh giá HIỆN TẠI, điểm từng tiêu chí là số, tổng điểm, kết quả, nhận xét", () => {
    expect(cell(0, "Người đánh giá vòng hồ sơ")).toBe("Lê Hoà");
    expect(cell(0, "Động lực tham gia")).toBe(5);
    expect(cell(0, "Giao tiếp")).toBe(4);
    expect(cell(0, "Tổng điểm (tối đa 25)")).toBe(21);
    expect(cell(0, "Kết quả vòng hồ sơ")).toBe("Nên mời phỏng vấn");
    expect(cell(0, "Nhận xét vòng hồ sơ")).toBe("Hồ sơ tốt");
    expect(JSON.stringify(table.rows)).not.toContain("Người Cũ");
    expect(JSON.stringify(table.rows)).not.toContain("ghi chú của người cũ");
  });
  it("vòng phỏng vấn: tiêu chí là cột riêng lấy từ chính phiếu, điểm quy đổi, kết quả, nhận xét", () => {
    expect(headerOf(table, "Nhu cầu Mentoring (30%)")).toBeGreaterThan(-1);
    expect(headerOf(table, "Sẵn sàng học hỏi (70%)")).toBeGreaterThan(-1);
    expect(cell(0, "Người phỏng vấn")).toBe("Phạm Bình");
    expect(cell(0, "Nhu cầu Mentoring (30%)")).toBe(4);
    expect(cell(0, "Sẵn sàng học hỏi (70%)")).toBe(5);
    expect(cell(0, "Điểm quy đổi (thang 5)")).toBe(4.7);
    expect(cell(0, "Kết quả vòng phỏng vấn")).toBe("Đạt làm mentee");
    expect(cell(0, "Lý do chốt kết quả")).toBe("Phù hợp");
    expect(cell(0, "Nhận xét vòng phỏng vấn")).toBe("Rất phù hợp");
    expect(cell(0, "Evidence / Note từng tiêu chí")).toBe("Nhu cầu Mentoring: Nêu rõ nhu cầu\nSẵn sàng học hỏi: Rất cởi mở");
    expect(cell(0, "Mức độ phù hợp về kỳ vọng")).toBe("Kỳ vọng phù hợp");
    expect(cell(0, "Mentor có muốn nhận bạn này")).toBe("Có – Tôi muốn nhận bạn này");
  });
  it("vòng chưa có kết quả thì để trống, không bịa giá trị", () => {
    // Bình: không có phiếu phỏng vấn; Chi: không có phiếu nào.
    for (const header of ["Người phỏng vấn", "Nhu cầu Mentoring (30%)", "Điểm quy đổi (thang 5)", "Nhận xét vòng phỏng vấn", "Mức độ phù hợp về kỳ vọng"]) {
      expect([null, ""]).toContain(cell(1, header));
    }
    for (const header of ["Người đánh giá vòng hồ sơ", "Động lực tham gia", "Tổng điểm (tối đa 25)", "Kết quả vòng hồ sơ", "Nhận xét vòng hồ sơ", "Người phỏng vấn", "Kết quả vòng phỏng vấn"]) {
      expect([null, ""]).toContain(cell(2, header));
    }
    expect(cell(1, "Kết quả vòng phỏng vấn")).toBe("Cần BTC xem xét thêm");
  });
  it("hồ sơ: thông tin liên hệ, ca, phòng và bàn, câu trả lời đơn; đường dẫn giữ nguyên dạng chữ", () => {
    expect(cell(0, "Email")).toBe("an@example.test");
    expect(cell(0, "Số điện thoại")).toBe("0900000001");
    expect(cell(0, "Phòng / Bàn")).toBe("Phòng B1.504 · Bàn 3");
    expect(cell(0, "Địa điểm ca")).toBe("Phòng B1.503, B1.504 — Cơ sở B");
    expect(cell(1, "Phỏng vấn online")).toBe("Online");
    expect(table.rows[0]).toContain("https://drive.example.test/cv-an");
    expect(table.rows[0]).toContain("Tài chính");
  });
  it("ngày giờ theo giờ Việt Nam, DD/MM/YYYY", () => {
    expect(cell(0, "Ca phỏng vấn")).toBe("03/10/2026 09:00");
    expect(cell(0, "Check-in lúc")).toBe("03/10/2026 08:50");
  });
  it("cột câu trả lời đơn chỉ sinh từ dữ liệu của những bạn được xuất", () => {
    const cvHeader = humanizeKey("cv_url");
    const only = buildExportTable(dataset(), [uuid(2)]);
    expect(only.columns.map((c) => c.header)).not.toContain(cvHeader);
    expect(buildExportTable(dataset(), [uuid(1)]).columns.map((c) => c.header)).toContain(cvHeader);
  });
});

describe("file XLSX", () => {
  const table = buildExportTable(dataset(), [uuid(1), uuid(2), uuid(3)]);
  const zip = new PizZip(menteeOfflineXlsx(table));
  const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
  const styles = zip.file("xl/styles.xml")!.asText();
  const last = columnLetter(table.columns.length - 1);

  it("một sheet duy nhất", () => {
    expect(zip.file("xl/workbook.xml")!.asText()).toContain(`name="${XLSX_SHEET_NAME}"`);
    expect(zip.file("xl/worksheets/sheet2.xml")).toBeNull();
  });
  it("bộ lọc đặt ở dòng tên cột (dòng 2) tới hết dữ liệu, không gồm dòng tiêu đề nhóm", () => {
    expect(sheet).toContain(`<autoFilter ref="A2:${last}${table.rows.length + 2}"/>`);
    expect(sheet).not.toContain('<autoFilter ref="A1:');
    expect(zip.file("xl/workbook.xml")!.asText()).toContain(`$A$2:$${last}$${table.rows.length + 2}`);
  });
  it("tiêu đề ba nhóm gộp ô, mỗi nhóm một màu khác nhau", () => {
    const spans = groupSpans(table);
    expect(sheet).toContain('<mergeCells count="3">');
    for (const span of spans) expect(sheet).toContain(`<mergeCell ref="${columnLetter(span.from)}1:${columnLetter(span.to)}1"/>`);
    for (const title of ["1. THÔNG TIN HỒ SƠ MENTEE", "2. ĐÁNH GIÁ VÒNG HỒ SƠ", "3. ĐÁNH GIÁ VÒNG PHỎNG VẤN"]) expect(sheet).toContain(title);
    const colors = Object.values(EXPORT_GROUP_COLORS).flatMap((c) => [c.header, c.tint]);
    expect(new Set(colors).size).toBe(6);
    for (const color of colors) expect(styles).toContain(`rgb="${color}"`);
  });
  it("cố định hai dòng đầu và hai cột đầu", () => {
    expect(sheet).toContain('<pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/>');
  });
  it("chữ là inlineStr (không thành công thức), số là số thật, ô rỗng để trống thật", () => {
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("=HYPERLINK(&quot;https://x.test&quot;)");
    expect(sheet).toMatch(/<c r="[A-Z]+3" s="\d" t="inlineStr"><is><t xml:space="preserve">Nguyễn Văn An<\/t>/);
    const total = headerOf(table, "Tổng điểm (tối đa 25)");
    expect(sheet).toContain(`<c r="${columnLetter(total)}3" s="5"><v>21</v></c>`);
    const blank = headerOf(table, "Nhận xét vòng phỏng vấn");
    expect(sheet).toContain(`<c r="${columnLetter(blank)}4" s="6"/>`);
  });
  it("ô quá dài bị cắt kèm lời nhắc, không làm hỏng file", () => {
    const big = buildExportTable(dataset(), [uuid(1)]);
    big.rows[0][headerOf(big, "Ghi chú thêm")] = "x".repeat(40000);
    const text = new PizZip(menteeOfflineXlsx(big)).file("xl/worksheets/sheet1.xml")!.asText();
    expect(text).not.toContain("x".repeat(32001));
    expect(text).toContain("đã cắt");
  });
  it("không có mentee nào vẫn là file hợp lệ chỉ có hai dòng tiêu đề", () => {
    const empty = new PizZip(menteeOfflineXlsx(buildExportTable(dataset(), []))).file("xl/worksheets/sheet1.xml")!.asText();
    expect(empty).toContain(`<autoFilter ref="A2:`);
    expect(empty).not.toContain('<row r="3">');
  });
});

describe("quyền xuất", () => {
  it("chỉ Super admin, Admin, Core team; Support, mentor, người xem, reviewer thì không", () => {
    for (const role of ["super_admin", "admin", "core_team"]) expect(canExportMenteeOffline(role)).toBe(true);
    for (const role of ["support_team", "reviewer", "viewer", "mentor", "mentee", "", null, undefined, "SUPER_ADMIN"]) expect(canExportMenteeOffline(role)).toBe(false);
  });
});
