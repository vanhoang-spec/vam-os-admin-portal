// @vitest-environment jsdom
/**
 * Màn hình phỏng vấn mentee: hồ sơ chi tiết tải riêng cho bạn đang mở (11/10/2026).
 *
 * Danh sách không còn chở đơn đăng ký và phiếu chấm của mọi người. Bộ test này giữ ba
 * điều: (1) mở hồ sơ thì đơn + phiếu vẫn hiện đủ như trước; (2) việc tải thêm KHÔNG
 * chặn check-in, phân bàn hay chấm bạn chưa có kết quả; (3) không ai sửa được một
 * kết quả đã lưu trên một phiếu trống.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OfflineDashboardClient } from "@/app/interviews/mentee-offline/workflow";
import type { OfflineCandidate, OfflineCandidateDetail, OfflineDashboard, OfflineDetailResult, OfflineOperation, OfflineReview } from "@/lib/mentee-offline-core";
import { TAKE_CHOICES, type InterviewRubric } from "@/lib/mentee-interview-rubric-core";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";

const mocks = vi.hoisted(() => ({ save: vi.fn(), detail: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/actions/mentee-offline", () => ({
  saveOfflineInterviewAction: mocks.save,
  lookupOfflineTicketAction: vi.fn(),
  cancelMenteeBookingAction: vi.fn(),
  moveMenteeBookingAction: vi.fn(),
  loadOfflineCandidateDetailAction: mocks.detail
}));
vi.mock("@/app/interviews/mentee-offline/qr-camera", () => ({ InterviewQrCamera: () => null }));

const RUBRIC: InterviewRubric = {
  id: "rubric-1", seasonId: "season", seasonCode: "UEHM-S12", own: true, version: 3, handbookVersion: 0,
  criteria: S12_INTERVIEW_CRITERIA, guidance: S12_INTERVIEW_GUIDANCE, copiedFromSeasonCode: null, updatedAt: "2026-10-02T00:00:00Z", updatedByName: "BTC",
  hasHandbook: false, handbookHtml: null, handbookFileName: null, handbookUpdatedAt: null, handbookUpdatedByName: null
};
const op = (over: Partial<OfflineOperation> = {}): OfflineOperation => ({
  checked_in_at: "2026-10-11T01:00:00Z", room: 1, desk: 1, interviewer_id: "me", review_id: "rv-interview", outcome: null, match_id: null,
  revision: 2, is_online: false, online_note: null, ...over
});
/** Một dòng của danh sách GỌN: không `answers`, phiếu rỗng. */
const lean = (id: string, name: string, over: Partial<OfflineCandidate> = {}): OfflineCandidate => ({
  id, name, phone: "0900000000", email: `${id}@example.test`, status: "interview_in_progress", sessionId: "s1", bookedAt: "2026-10-06T00:00:00Z",
  reviews: [], operation: op(), takeSubmitted: false, ...over
});
const SCREENING: OfflineReview = {
  id: "rv-screen", review_round: "profile_screening", reviewerName: "Chấm Hồ Sơ", status: "submitted", score_motivation: 4, score_goal_clarity: 4,
  score_commitment: 5, score_fit: 4, score_communication: 3, total_score: 20, recommendation: "approve_recommended", reviewer_note: "Hồ sơ rõ mục tiêu"
};
const SAVED_INTERVIEW: OfflineReview = {
  id: "rv-interview", review_round: "interview", reviewerName: "Tôi", status: "submitted", score_motivation: null, score_goal_clarity: null,
  score_commitment: null, score_fit: null, score_communication: null, total_score: null, recommendation: "approve_recommended",
  reviewer_note: "Lý do đã lưu từ trước",
  interview_scores: S12_INTERVIEW_CRITERIA.map((c) => ({ key: c.key, label: c.label, weight: c.weight, score: 4, note: `Ghi chú ${c.key}` })) as OfflineReview["interview_scores"],
  rubric_version: 3, weighted_score: 4, key_development_need: "Nhu cầu đã lưu", expectation_alignment: "aligned", alignment_note: "Kỳ vọng đã lưu",
  take_choice: "undecided", desired_mentor_profile: "Chân dung đã lưu", additional_note: null
};
const detailOf = (answer: string, reviews: OfflineReview[] = [SCREENING]): OfflineCandidateDetail => ({ answers: [["Mục tiêu", answer]], reviews });
const okDetail = (answer: string, reviews?: OfflineReview[]): OfflineDetailResult => ({ ok: true, detail: detailOf(answer, reviews) });

function dashboard(candidates: OfflineCandidate[], over: Partial<OfflineDashboard> = {}): OfflineDashboard {
  return {
    actorId: "me", seasonId: "season", canOperate: false, logs: [], rubric: RUBRIC,
    sessions: [{ id: "s1", starts_at: "2026-10-11T01:00:00Z", ends_at: "2026-10-11T01:30:00Z", venue: "Phòng B1-502, B1-503 — Cơ sở B", seat_limit: 28 }],
    participants: [{ id: "me", full_name: "Tôi", email: "me@example.test", capacity: 2, activeMatches: 0 }],
    candidates, ...over
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const panel = (name: string) => screen.getByRole("region", { name: `Hồ sơ ${name}` });
const openRow = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  // Form chấm tự lưu nháp vào localStorage theo (người phỏng vấn, hồ sơ) — không dọn thì
  // nháp của ca trước điền sẵn vào form của ca sau.
  window.localStorage.clear();
  // Check-in và nộp kết quả đều hỏi lại bằng confirm() — jsdom không có sẵn.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.save.mockResolvedValue({ ok: true, message: "Đã lưu" });
});
afterEach(cleanup);

describe("mở hồ sơ: tải riêng đơn đăng ký và phiếu chấm của bạn đó", () => {
  it("gọi đúng một lần cho đúng hồ sơ; đang tải thì nói rõ; về rồi thì hiện đơn + điểm vòng hồ sơ", async () => {
    const pending = deferred<OfflineDetailResult>();
    mocks.detail.mockReturnValue(pending.promise);
    render(<OfflineDashboardClient data={dashboard([lean("a", "An"), lean("b", "Bình")])} initialApplication="a" />);
    expect(mocks.detail.mock.calls).toEqual([["a"]]);
    const p = within(panel("An"));
    expect(p.getByTestId("detail-loading").textContent).toBe("Đang tải hồ sơ…");
    expect(p.queryByText("Học kỹ năng")).toBeNull();
    await act(async () => { pending.resolve(okDetail("Học kỹ năng")); });
    expect(p.queryByTestId("detail-loading")).toBeNull();
    expect(p.getByText("Mục tiêu")).toBeTruthy();
    expect(p.getByText("Học kỹ năng")).toBeTruthy();
    expect(p.getByText(/Chấm Hồ Sơ · 20\/25/)).toBeTruthy();
    expect(p.getByText("Hồ sơ rõ mục tiêu")).toBeTruthy();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });

  it("bấm một bạn trong danh sách mới tải bạn đó — không tải trước cho ai chưa mở", async () => {
    mocks.detail.mockImplementation(async (id: string) => okDetail(`Đơn của ${id}`));
    render(<OfflineDashboardClient data={dashboard([lean("a", "An"), lean("b", "Bình")])} />);
    expect(mocks.detail).not.toHaveBeenCalled();
    openRow("Bình");
    await waitFor(() => expect(within(panel("Bình")).getByText("Đơn của b")).toBeTruthy());
    expect(mocks.detail.mock.calls).toEqual([["b"]]);
  });

  it("dữ liệu còn kèm sẵn đơn đăng ký (dạng cũ): dùng luôn, không gọi máy chủ", () => {
    const full = lean("a", "An", { answers: [["Mục tiêu", "Có sẵn"]], reviews: [SCREENING] });
    render(<OfflineDashboardClient data={dashboard([full])} initialApplication="a" />);
    expect(within(panel("An")).getByText("Có sẵn")).toBeTruthy();
    expect(within(panel("An")).getByText("Hồ sơ rõ mục tiêu")).toBeTruthy();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});

describe("tải hỏng không làm kẹt buổi phỏng vấn", () => {
  it("máy chủ báo lỗi: hiện lỗi + nút “Tải lại hồ sơ”; bấm thì tải lại và hiện đơn", async () => {
    const second = deferred<OfflineDetailResult>();
    mocks.detail.mockResolvedValueOnce({ ok: false, message: "Chưa tải được hồ sơ của bạn này." }).mockReturnValueOnce(second.promise);
    render(<OfflineDashboardClient data={dashboard([lean("a", "An")])} initialApplication="a" />);
    const p = within(panel("An"));
    await waitFor(() => expect(p.getByTestId("detail-error").textContent).toContain("Chưa tải được hồ sơ của bạn này."));
    expect(p.queryByTestId("detail-loading")).toBeNull();
    fireEvent.click(p.getByRole("button", { name: "Tải lại hồ sơ" }));
    // Đang thử lại: lỗi cũ biến mất, người dùng thấy máy đang tải chứ không phải một dòng lỗi đứng yên.
    await waitFor(() => expect(p.getByTestId("detail-loading")).toBeTruthy());
    expect(p.queryByTestId("detail-error")).toBeNull();
    await act(async () => { second.resolve(okDetail("Lần hai được")); });
    expect(p.getByText("Lần hai được")).toBeTruthy();
    expect(p.queryByTestId("detail-error")).toBeNull();
    expect(mocks.detail.mock.calls).toEqual([["a"], ["a"]]);
  });

  it("mất kết nối (lời gọi ném lỗi): vẫn là một dòng lỗi có nút thử lại, không vỡ màn hình", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(okDetail("Có mạng lại"));
    render(<OfflineDashboardClient data={dashboard([lean("a", "An")])} initialApplication="a" />);
    const p = within(panel("An"));
    await waitFor(() => expect(p.getByTestId("detail-error").textContent).toContain("Mất kết nối"));
    fireEvent.click(p.getByRole("button", { name: "Tải lại hồ sơ" }));
    await waitFor(() => expect(p.getByText("Có mạng lại")).toBeTruthy());
  });

  it("bạn CHƯA có kết quả: form chấm có ngay, không chờ hồ sơ chi tiết — và gửi được dù hồ sơ chưa về", async () => {
    mocks.detail.mockReturnValue(new Promise<OfflineDetailResult>(() => {})); // không bao giờ về
    render(<OfflineDashboardClient data={dashboard([lean("a", "An")])} initialApplication="a" />);
    const p = within(panel("An"));
    expect(p.getByTestId("detail-loading")).toBeTruthy();
    const scores = [5, 3, 4, 2];
    S12_INTERVIEW_CRITERIA.forEach((c, i) => {
      fireEvent.change(p.getByLabelText(c.label), { target: { value: String(scores[i]) } });
      fireEvent.change(p.getByLabelText(`Evidence / Note — ${c.label}`), { target: { value: `Ghi chú ${i}` } });
    });
    fireEvent.change(p.getByLabelText("Lý do chọn / không chọn"), { target: { value: "Có động lực" } });
    fireEvent.change(p.getByLabelText("Nhu cầu phát triển chính"), { target: { value: "Hướng nghề" } });
    fireEvent.change(p.getByLabelText("Mức độ phù hợp về kỳ vọng của Mentee"), { target: { value: "aligned" } });
    fireEvent.change(p.getByLabelText("Concern / Note"), { target: { value: "Ổn" } });
    fireEvent.change(p.getByLabelText("Chân dung Mentor phù hợp"), { target: { value: "Coaching" } });
    fireEvent.click(p.getByLabelText(TAKE_CHOICES.take));
    fireEvent.click(p.getByRole("button", { name: "Xác nhận kết quả" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ applicationId: "a", action: "result", revision: 2, values: { outcome: "passed", takeChoice: "take", rationale: "Có động lực" } });
  });

  it("Support: nút check-in dùng được ngay khi hồ sơ chi tiết chưa về", async () => {
    mocks.detail.mockReturnValue(new Promise<OfflineDetailResult>(() => {}));
    const waiting = lean("a", "An", { operation: null, status: "interview_scheduled" });
    render(<OfflineDashboardClient data={dashboard([waiting], { actorId: "support", canOperate: true })} initialApplication="a" />);
    fireEvent.click(within(panel("An")).getByRole("button", { name: "Xác nhận check-in" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ applicationId: "a", action: "checkin", revision: 0, values: {} }));
  });
});

describe("bạn ĐÃ có kết quả: phiếu đã lưu nằm trong hồ sơ chi tiết", () => {
  const scored = () => lean("a", "An", { status: "approved_as_mentee", operation: op({ outcome: "passed", revision: 3 }) });

  it("chưa về: nói kết quả nhưng CHƯA cho sửa và chưa dựng form — sửa trên phiếu trống là ghi đè phiếu thật", async () => {
    const pending = deferred<OfflineDetailResult>();
    mocks.detail.mockReturnValue(pending.promise);
    render(<OfflineDashboardClient data={dashboard([scored()])} initialApplication="a" />);
    const p = within(panel("An"));
    expect(p.getByTestId("result-pending").textContent).toContain("Đạt làm mentee");
    expect(p.queryByRole("button", { name: "Sửa kết quả / lựa chọn mentee" })).toBeNull();
    expect(p.queryByRole("button", { name: "Xác nhận kết quả" })).toBeNull();
    await act(async () => { pending.resolve(okDetail("Đơn", [SCREENING, SAVED_INTERVIEW])); });
    expect(p.queryByTestId("result-pending")).toBeNull();
    expect(p.getByText(/Lý do đã lưu từ trước/)).toBeTruthy();
    expect(p.getByText(/Nhu cầu đã lưu/)).toBeTruthy();
    expect(p.getByRole("button", { name: "Sửa kết quả / lựa chọn mentee" })).toBeTruthy();
  });

  it("về rồi: bấm sửa thì form mang đúng nội dung phiếu đã lưu", async () => {
    mocks.detail.mockResolvedValue(okDetail("Đơn", [SCREENING, SAVED_INTERVIEW]));
    render(<OfflineDashboardClient data={dashboard([scored()])} initialApplication="a" />);
    const p = within(panel("An"));
    fireEvent.click(await p.findByRole("button", { name: "Sửa kết quả / lựa chọn mentee" }));
    expect((p.getByLabelText("Lý do chọn / không chọn") as HTMLTextAreaElement).value).toBe("Lý do đã lưu từ trước");
    expect((p.getByLabelText("Nhu cầu phát triển chính") as HTMLTextAreaElement).value).toBe("Nhu cầu đã lưu");
    expect((p.getByLabelText("Chân dung Mentor phù hợp") as HTMLTextAreaElement).value).toBe("Chân dung đã lưu");
    expect((p.getByLabelText(S12_INTERVIEW_CRITERIA[0].label) as HTMLSelectElement).value).toBe("4");
    expect((p.getByLabelText(TAKE_CHOICES.undecided) as HTMLInputElement).checked).toBe(true);
  });

  it("tải hỏng: vẫn không cho sửa; tải lại được thì mới hiện nút", async () => {
    mocks.detail.mockResolvedValueOnce({ ok: false, message: "Chưa tải được hồ sơ của bạn này." }).mockResolvedValueOnce(okDetail("Đơn", [SAVED_INTERVIEW]));
    render(<OfflineDashboardClient data={dashboard([scored()])} initialApplication="a" />);
    const p = within(panel("An"));
    await waitFor(() => expect(p.getByTestId("detail-error")).toBeTruthy());
    expect(p.queryByRole("button", { name: "Sửa kết quả / lựa chọn mentee" })).toBeNull();
    expect(p.getByTestId("result-pending")).toBeTruthy();
    fireEvent.click(p.getByRole("button", { name: "Tải lại hồ sơ" }));
    expect(await p.findByRole("button", { name: "Sửa kết quả / lựa chọn mentee" })).toBeTruthy();
  });
});

describe("nhớ hồ sơ đã tải", () => {
  it("đóng rồi mở lại cùng một bạn: không tải lần nữa; mở bạn khác thì tải bạn khác", async () => {
    mocks.detail.mockImplementation(async (id: string) => okDetail(`Đơn của ${id}`));
    render(<OfflineDashboardClient data={dashboard([lean("a", "An"), lean("b", "Bình")])} />);
    openRow("An");
    await waitFor(() => expect(within(panel("An")).getByText("Đơn của a")).toBeTruthy());
    fireEvent.click(within(panel("An")).getByRole("button", { name: "Đóng hồ sơ" }));
    openRow("Bình");
    await waitFor(() => expect(within(panel("Bình")).getByText("Đơn của b")).toBeTruthy());
    openRow("An");
    // Có ngay, không qua trạng thái đang tải.
    expect(within(panel("An")).getByText("Đơn của a")).toBeTruthy();
    expect(within(panel("An")).queryByTestId("detail-loading")).toBeNull();
    expect(mocks.detail.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("câu trả lời về muộn của bạn cũ không hiện dưới tên bạn đang mở — nhưng vẫn được nhớ", async () => {
    const slowA = deferred<OfflineDetailResult>();
    mocks.detail.mockImplementation((id: string) => (id === "a" ? slowA.promise : Promise.resolve(okDetail("Đơn của b"))));
    render(<OfflineDashboardClient data={dashboard([lean("a", "An"), lean("b", "Bình")])} />);
    openRow("An");
    openRow("Bình");
    await waitFor(() => expect(within(panel("Bình")).getByText("Đơn của b")).toBeTruthy());
    await act(async () => { slowA.resolve(okDetail("Đơn của a")); });
    expect(within(panel("Bình")).getByText("Đơn của b")).toBeTruthy();
    expect(screen.queryByText("Đơn của a")).toBeNull();
    openRow("An");
    expect(within(panel("An")).getByText("Đơn của a")).toBeTruthy();
    expect(mocks.detail.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("chưa có kết quả: check-in / phân bàn (phiên bản tăng) không tải lại; có kết quả rồi thì mỗi lần lưu tải lại phiếu", async () => {
    mocks.detail.mockImplementation(async () => okDetail("Đơn"));
    const at = (revision: number, outcome: OfflineOperation["outcome"] = null) => dashboard([lean("a", "An", { operation: op({ revision, outcome }) })]);
    const view = render(<OfflineDashboardClient data={at(1)} initialApplication="a" />);
    await waitFor(() => expect(within(panel("An")).getByText("Đơn")).toBeTruthy());
    view.rerender(<OfflineDashboardClient data={at(2)} initialApplication="a" />);
    expect(within(panel("An")).getByText("Đơn")).toBeTruthy();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    view.rerender(<OfflineDashboardClient data={at(3, "passed")} initialApplication="a" />);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    view.rerender(<OfflineDashboardClient data={at(4, "passed")} initialApplication="a" />);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(3));
    view.rerender(<OfflineDashboardClient data={at(4, "passed")} initialApplication="a" />);
    expect(mocks.detail).toHaveBeenCalledTimes(3);
  });
});

describe("trần 2 lựa chọn “Có – Tôi muốn nhận” đọc từ danh sách gọn", () => {
  const takeRadio = () => within(panel("An")).getByLabelText(TAKE_CHOICES.take) as HTMLInputElement;
  beforeEach(() => { mocks.detail.mockReturnValue(new Promise<OfflineDetailResult>(() => {})); });

  it("đã nộp 2 phiếu chọn nhận ở hồ sơ KHÁC: khoá lựa chọn này", () => {
    render(<OfflineDashboardClient data={dashboard([lean("a", "An"), lean("b", "Bình", { takeSubmitted: true }), lean("c", "Chi", { takeSubmitted: true })])} initialApplication="a" />);
    expect(takeRadio().disabled).toBe(true);
  });

  it("mới 1 phiếu, hoặc phiếu chọn nhận là của người phỏng vấn khác: còn chọn được", () => {
    render(<OfflineDashboardClient data={dashboard([
      lean("a", "An"), lean("b", "Bình", { takeSubmitted: true }),
      lean("c", "Chi", { takeSubmitted: true, operation: op({ interviewer_id: "nguoi-khac" }) })
    ])} initialApplication="a" />);
    expect(takeRadio().disabled).toBe(false);
  });
});
