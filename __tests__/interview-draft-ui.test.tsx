// @vitest-environment jsdom
/**
 * Bản nháp phiếu chấm phỏng vấn (BTC 03/10/2026): mentor chuyển tab / chuyển app
 * giữa chừng thì không phải nhập lại từ đầu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OfflineDashboardClient } from "@/app/interviews/mentee-offline/workflow";
import { type OfflineDashboard } from "@/lib/mentee-offline-core";
import { TAKE_CHOICES, type InterviewRubric } from "@/lib/mentee-interview-rubric-core";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";
import { DRAFT_MAX_AGE_MS, draftExpired, draftHasContent, draftKey, parseDraft } from "@/lib/interview-draft-core";

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/actions/mentee-offline", () => ({
  saveOfflineInterviewAction: mocks.save, lookupOfflineTicketAction: vi.fn(), cancelMenteeBookingAction: vi.fn(), moveMenteeBookingAction: vi.fn()
}));
vi.mock("@/app/interviews/mentee-offline/qr-camera", () => ({ InterviewQrCamera: () => null }));

const RUBRIC: InterviewRubric = {
  id: "rubric-1", seasonId: "season", seasonCode: "UEHM-S12", own: true, version: 3, handbookVersion: 0,
  criteria: S12_INTERVIEW_CRITERIA, guidance: S12_INTERVIEW_GUIDANCE, copiedFromSeasonCode: null, updatedAt: "2026-10-02T00:00:00Z", updatedByName: "BTC",
  hasHandbook: false, handbookHtml: null, handbookFileName: null, handbookUpdatedAt: null, handbookUpdatedByName: null
};
function data(actorId = "mentor", version = 3): OfflineDashboard {
  return {
    actorId, seasonId: "season", canOperate: false, logs: [], rubric: { ...RUBRIC, version },
    sessions: [{ id: "session", starts_at: "2026-10-03T01:00:00Z", ends_at: "2026-10-03T01:30:00Z", venue: "UEH", seat_limit: 25 }],
    participants: [{ id: actorId, full_name: "Mentor A", email: "mentor@example.test", capacity: 1, activeMatches: 0 }],
    candidates: [{
      id: "app", name: "Mentee A", phone: "0901234567", email: "a@example.test", status: "interview_in_progress", sessionId: "session",
      bookedAt: "2026-09-27T01:00Z", rawPayload: null, answers: [["Mục tiêu", "Học kỹ năng"]], reviews: [],
      operation: { checked_in_at: "2026-10-03T00:50Z", room: 5, desk: 5, interviewer_id: actorId, review_id: "review", outcome: null, match_id: null, revision: 2, is_online: false, online_note: null }
    }]
  };
}
const KEY = draftKey("mentor", "app");
const firstNote = () => screen.getByLabelText(`Evidence / Note — ${S12_INTERVIEW_CRITERIA[0].label}`) as HTMLTextAreaElement;
const firstScore = () => screen.getByLabelText(S12_INTERVIEW_CRITERIA[0].label) as HTMLSelectElement;
const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");

function fillAll() {
  const scores = [5, 3, 4, 2];
  S12_INTERVIEW_CRITERIA.forEach((c, i) => {
    fireEvent.change(screen.getByLabelText(c.label), { target: { value: String(scores[i]) } });
    fireEvent.change(screen.getByLabelText(`Evidence / Note — ${c.label}`), { target: { value: `Ghi chú ${i}` } });
  });
  fireEvent.change(screen.getByLabelText("Lý do chọn / không chọn"), { target: { value: "Có động lực" } });
  fireEvent.change(screen.getByLabelText("Nhu cầu phát triển chính"), { target: { value: "Định hướng nghề" } });
  fireEvent.change(screen.getByLabelText("Mức độ phù hợp về kỳ vọng của Mentee"), { target: { value: "aligned" } });
  fireEvent.change(screen.getByLabelText("Concern / Note"), { target: { value: "Ổn" } });
  fireEvent.change(screen.getByLabelText("Chân dung Mentor phù hợp"), { target: { value: "Coaching" } });
  fireEvent.click(screen.getByLabelText(TAKE_CHOICES.recommend_other));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/interviews/mentee-offline");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.save.mockResolvedValue({ ok: true, message: "Đã lưu" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("phần thuần", () => {
  const draft = { savedAt: 1_000_000, rubricVersion: 3, outcome: "passed", takeChoice: "", fields: { "note:need": "x" } };
  it("đọc nháp hợp lệ; bỏ nháp hỏng, quá hạn, khác phiên bản phiếu, hoặc cũ hơn kết quả đã lưu", () => {
    const raw = JSON.stringify(draft);
    expect(parseDraft(raw, { rubricVersion: 3, nowMs: 1_000_500 })).toMatchObject({ fields: { "note:need": "x" } });
    expect(parseDraft("{hỏng", { rubricVersion: 3, nowMs: 1_000_500 })).toBeNull();
    expect(parseDraft(raw, { rubricVersion: 3, nowMs: 1_000_000 + DRAFT_MAX_AGE_MS + 1 })).toBeNull();
    expect(parseDraft(raw, { rubricVersion: 4, nowMs: 1_000_500 })).toBeNull();
    expect(parseDraft(raw, { rubricVersion: 3, nowMs: 1_000_500, savedResultAtMs: 1_000_200 })).toBeNull();
    expect(parseDraft(raw, { rubricVersion: 3, nowMs: 1_000_500, savedResultAtMs: 999_000 })).not.toBeNull();
  });
  it("form trống không phải nháp; khoá tách theo mentor", () => {
    expect(draftHasContent({ fields: { a: " ", b: "" }, takeChoice: "" })).toBe(false);
    expect(draftHasContent({ fields: { a: "1" }, takeChoice: "" })).toBe(true);
    expect(draftKey("m1", "app")).not.toBe(draftKey("m2", "app"));
    expect(draftExpired(JSON.stringify(draft), 1_000_000 + DRAFT_MAX_AGE_MS + 1)).toBe(true);
  });
});

describe("form chấm tự lưu và khôi phục nháp", () => {
  it("gõ là lưu (sau một nhịp ngắn); mở lại hồ sơ thì điền lại đúng chỗ đang dở", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<OfflineDashboardClient data={data()} initialApplication="app" />);
    expect(window.localStorage.getItem(KEY)).toBeNull(); // mở form trống không ghi gì
    fireEvent.change(firstScore(), { target: { value: "4" } });
    fireEvent.change(firstNote(), { target: { value: "Đang ghi dở" } });
    fireEvent.click(screen.getByLabelText(TAKE_CHOICES.recommend_other));
    act(() => { vi.advanceTimersByTime(500); });
    expect(stored()).toMatchObject({ rubricVersion: 3, takeChoice: "recommend_other" });
    expect(stored().fields[`note:${S12_INTERVIEW_CRITERIA[0].key}`]).toBe("Đang ghi dở");

    cleanup();
    render(<OfflineDashboardClient data={data()} initialApplication="app" />);
    expect(firstNote().value).toBe("Đang ghi dở");
    expect(firstScore().value).toBe("4");
    expect((screen.getByLabelText(TAKE_CHOICES.recommend_other) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Đã khôi phục bản nháp");
  });

  it("chuyển tab/app (trang bị ẩn) thì lưu NGAY, không đợi nhịp", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<OfflineDashboardClient data={data()} initialApplication="app" />);
    fireEvent.change(firstNote(), { target: { value: "Gõ xong chuyển app" } });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(stored().fields[`note:${S12_INTERVIEW_CRITERIA[0].key}`]).toBe("Gõ xong chuyển app");
  });

  it("lưu kết quả THÀNH CÔNG thì xoá nháp", async () => {
    render(<OfflineDashboardClient data={data()} initialApplication="app" />);
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận kết quả" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
  });

  it("lưu kết quả HỎNG (máy chủ từ chối / mất mạng) thì GIỮ nháp", async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, message: "Lỗi" });
    render(<OfflineDashboardClient data={data()} initialApplication="app" />);
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận kết quả" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Lỗi")).toBeTruthy());
    expect(stored().fields["rationale"]).toBe("Có động lực");
    // Lỗi phải hiện NGAY cạnh nút gửi — đầu hồ sơ cách nút gửi cả màn hình (sự cố 03/10).
    const form = screen.getByRole("button", { name: "Xác nhận kết quả" }).closest("form")!;
    expect(within(form).getByRole("alert").textContent).toContain("Chưa lưu được: Lỗi");
    expect(within(form).getByRole("alert").textContent).toContain("không cần nhập lại");

    mocks.save.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận kết quả" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toContain("Mất kết nối"));
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("'Bỏ bản nháp' xoá nháp và trả form về trống", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), rubricVersion: 3, outcome: "rejected", takeChoice: "", fields: { [`note:${S12_INTERVIEW_CRITERIA[0].key}`]: "cũ" } }));
    render(<OfflineDashboardClient data={data()} initialApplication="app" />);
    expect(firstNote().value).toBe("cũ");
    expect((screen.getByLabelText("Kết quả") as HTMLSelectElement).value).toBe("rejected");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ bản nháp" }));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(firstNote().value).toBe("");
    expect((screen.getByLabelText("Kết quả") as HTMLSelectElement).value).toBe("passed");
  });

  it("mentor khác trên cùng máy không thấy nháp; phiếu đã lên phiên bản mới thì nháp bị bỏ", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), rubricVersion: 3, outcome: "passed", takeChoice: "", fields: { [`note:${S12_INTERVIEW_CRITERIA[0].key}`]: "của mentor A" } }));
    render(<OfflineDashboardClient data={data("mentor-khac")} initialApplication="app" />);
    expect(firstNote().value).toBe("");
    cleanup();
    render(<OfflineDashboardClient data={data("mentor", 4)} initialApplication="app" />);
    expect(firstNote().value).toBe("");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

it("hồ sơ đang mở được ghi lên đường dẫn, để tải lại trang mở lại đúng hồ sơ", () => {
  render(<OfflineDashboardClient data={data()} />);
  fireEvent.click(screen.getByRole("button", { name: "Mentee A" }));
  expect(new URL(window.location.href).searchParams.get("application")).toBe("app");
  fireEvent.click(screen.getByRole("button", { name: "Đóng hồ sơ" }));
  expect(new URL(window.location.href).searchParams.get("application")).toBeNull();
});
