import { describe, expect, it } from "vitest";
import {
  recapStatusLabel,
  followUpStatusLabel,
  participantStatusLabel,
  matchStatusLabel,
  applicationStatusLabel,
  meetingTypeLabel,
  NAV_LABELS,
  FORBIDDEN_UI_TERMS,
  ACCEPTED_VAM_TERMS
} from "../lib/ui-labels";

describe("UI Labels - Domain Mappings", () => {
  it("maps recap status correctly", () => {
    expect(recapStatusLabel("submitted")).toBe("Đã ghi nhận");
    expect(recapStatusLabel("needs_review")).toBe("Cần kiểm tra");
    expect(recapStatusLabel("invalid")).toBe("Không hợp lệ");
    expect(recapStatusLabel("duplicate")).toBe("Trùng dữ liệu");
    expect(recapStatusLabel("deleted")).toBe("Đã ẩn");
    expect(recapStatusLabel("excluded")).toBe("Không tính vào báo cáo");
  });

  it("maps follow-up status correctly", () => {
    expect(followUpStatusLabel("open")).toBe("Chưa xử lý");
    expect(followUpStatusLabel("in_progress")).toBe("Đang xử lý");
    expect(followUpStatusLabel("resolved")).toBe("Đã hoàn tất");
    expect(followUpStatusLabel("no_response")).toBe("Chưa nhận phản hồi");
    expect(followUpStatusLabel("dropped")).toBe("Người tham gia đã dừng");
    expect(followUpStatusLabel("parked")).toBe("Tạm để sau");
  });

  it("maps participant status correctly", () => {
    expect(participantStatusLabel("active")).toBe("Đang tham gia");
    expect(participantStatusLabel("inactive")).toBe("Không hoạt động");
    expect(participantStatusLabel("pending")).toBe("Đang chờ xác nhận");
    expect(participantStatusLabel("dropped")).toBe("Đã dừng tham gia");
  });

  it("maps match status correctly", () => {
    expect(matchStatusLabel("active")).toBe("Đang đồng hành");
    expect(matchStatusLabel("completed")).toBe("Đã hoàn thành");
    expect(matchStatusLabel("dropped")).toBe("Đã dừng");
    expect(matchStatusLabel("unmatched_review")).toBe("Cần xem lại ghép cặp");
  });

  it("maps application status correctly", () => {
    expect(applicationStatusLabel("submitted")).toBe("Đã nộp / Chờ xử lý");
    expect(applicationStatusLabel("interview_completed")).toBe("Hoàn tất phỏng vấn");
    expect(applicationStatusLabel("approved_as_mentor")).toBe("Đã duyệt — Mentor");
  });

  it("maps meeting type correctly", () => {
    expect(meetingTypeLabel("1on1_primary")).toBe("Mentoring 1–1");
    expect(meetingTypeLabel("1on1_cross")).toBe("Cross-mentoring");
    expect(meetingTypeLabel("group")).toBe("Mentoring theo nhóm");
    expect(meetingTypeLabel("group_training")).toBe("Mentoring theo nhóm");
    expect(meetingTypeLabel("other")).toBe("Khác / chưa xác định");
    expect(meetingTypeLabel("unknown")).toBe("Chưa xác định");
  });

  it("falls back safely for unknown values", () => {
    // Should return the raw value if it's unknown
    expect(recapStatusLabel("unknown_status")).toBe("unknown_status");
    expect(followUpStatusLabel("invalid_key")).toBe("invalid_key");
    // Should trim and normalize when matching but fallback to original or similar
    expect(participantStatusLabel("   new_status  ")).toBe("new_status");
    // Empty cases
    expect(matchStatusLabel(null)).toBe("—");
    expect(applicationStatusLabel(undefined)).toBe("—");
    expect(meetingTypeLabel("")).toBe("—");
  });

  it("verifies unknown values never map to a valid enum state silently", () => {
    const validStatuses = ["Đã ghi nhận", "Cần kiểm tra", "Không hợp lệ", "Trùng dữ liệu", "Đã ẩn", "Không tính vào báo cáo"];
    expect(validStatuses).not.toContain(recapStatusLabel("some_weird_value"));
  });
});

describe("UI Labels - Terminology and Navigation", () => {
  it("contains all expected navigation labels", () => {
    expect(NAV_LABELS.dashboard).toBe("Tổng quan");
    expect(NAV_LABELS.operations).toBe("Vận hành");
    expect(NAV_LABELS.people).toBe("Cộng đồng VAM");
    expect(NAV_LABELS.matches).toBe("Ghép cặp");
    expect(NAV_LABELS.dataIssues).toBe("Rà soát dữ liệu");
    expect(NAV_LABELS.admin).toBe("Quản trị");
  });

  it("declares forbidden corporate terminology for UI", () => {
    expect(FORBIDDEN_UI_TERMS).toContain("CEO View");
    expect(FORBIDDEN_UI_TERMS).toContain("Founder View");
    expect(FORBIDDEN_UI_TERMS).toContain("Mentee im lặng");
    expect(FORBIDDEN_UI_TERMS).toContain("Data Issues");
  });

  it("allows accepted VAM terminology", () => {
    expect(ACCEPTED_VAM_TERMS).toContain("Mentor");
    expect(ACCEPTED_VAM_TERMS).toContain("Mentee");
    expect(ACCEPTED_VAM_TERMS).toContain("Season");
    expect(ACCEPTED_VAM_TERMS).toContain("Matching");
    expect(ACCEPTED_VAM_TERMS).toContain("Recap");
  });
});
