// @vitest-environment jsdom
/**
 * Màn hình phỏng vấn mentee: ô "BTC chốt kết quả" cho hồ sơ "Cần BTC xem xét thêm" (12/10/2026).
 *
 * Giữ bốn điều: (1) ô chỉ mời đúng người (Core team trở lên) trên đúng hồ sơ; (2) không gì
 * được gửi đi trước khi có đủ lựa chọn, lý do VÀ một lần xác nhận; (3) lỗi hiện ngay cạnh
 * nút; (4) BTC đã chốt thì người phỏng vấn không còn nút sửa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OfflineDashboardClient } from "@/app/interviews/mentee-offline/workflow";
import { BTC_DECISIONS, OFFLINE_OUTCOMES, type OfflineCandidate, type OfflineDashboard, type OfflineOperation, type OfflineReview } from "@/lib/mentee-offline-core";
import type { InterviewRubric } from "@/lib/mentee-interview-rubric-core";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";

const mocks = vi.hoisted(() => ({ decide: vi.fn(), detail: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/actions/mentee-offline", () => ({
  saveOfflineInterviewAction: mocks.save,
  lookupOfflineTicketAction: vi.fn(),
  cancelMenteeBookingAction: vi.fn(),
  moveMenteeBookingAction: vi.fn(),
  loadOfflineCandidateDetailAction: mocks.detail,
  decideNeedsReviewAction: mocks.decide
}));
vi.mock("@/app/interviews/mentee-offline/qr-camera", () => ({ InterviewQrCamera: () => null }));

const RUBRIC: InterviewRubric = {
  id: "rubric-1", seasonId: "season", seasonCode: "UEHM-S12", own: true, version: 3, handbookVersion: 0,
  criteria: S12_INTERVIEW_CRITERIA, guidance: S12_INTERVIEW_GUIDANCE, copiedFromSeasonCode: null, updatedAt: "2026-10-02T00:00:00Z", updatedByName: "BTC",
  hasHandbook: false, handbookHtml: null, handbookFileName: null, handbookUpdatedAt: null, handbookUpdatedByName: null
};
const op = (over: Partial<OfflineOperation> = {}): OfflineOperation => ({
  checked_in_at: "2026-10-11T01:00:00Z", room: 1, desk: 1, interviewer_id: "mentor", review_id: "rv", outcome: "needs_review", match_id: null,
  revision: 3, is_online: false, online_note: null, outcome_reason: "Cần BTC cân nhắc thêm", ...over
});
const cand = (id: string, name: string, over: Partial<OfflineCandidate> = {}): OfflineCandidate => ({
  id, name, phone: "0900000000", email: `${id}@example.test`, status: "needs_more_review", sessionId: "s1", bookedAt: "2026-10-06T00:00:00Z",
  reviews: [], operation: op(), takeSubmitted: false, ...over
});
const REVIEW: OfflineReview = {
  id: "rv", review_round: "interview", reviewerName: "Mentor A", status: "submitted", score_motivation: null, score_goal_clarity: null,
  score_commitment: null, score_fit: null, score_communication: null, total_score: null, recommendation: "needs_admin_review",
  reviewer_note: "Cần BTC cân nhắc thêm", interview_scores: null, take_choice: "undecided"
};
type Who = "core" | "support" | "mentor";
function dashboard(candidates: OfflineCandidate[], who: Who): OfflineDashboard {
  return {
    actorId: who === "mentor" ? "mentor" : who, seasonId: "season", logs: [], rubric: RUBRIC,
    canOperate: who !== "mentor", canDecide: who === "core",
    sessions: [{ id: "s1", starts_at: "2026-10-11T01:00:00Z", ends_at: "2026-10-11T01:30:00Z", venue: "Phòng B1-502 — Cơ sở B", seat_limit: 28 }],
    participants: [{ id: "mentor", full_name: "Mentor A", email: "mentor@example.test", capacity: 2, activeMatches: 0 }],
    candidates
  };
}
const panel = (name: string) => screen.getByRole("region", { name: `Hồ sơ ${name}` });
const box = (name: string) => within(within(panel(name)).getByTestId("btc-decision"));
const typeReason = (name: string, text: string) => fireEvent.change(box(name).getByLabelText(/Lý do của quyết định/), { target: { value: text } });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.detail.mockResolvedValue({ ok: true, detail: { answers: [["Mục tiêu", "Tìm hướng nghề"]], reviews: [REVIEW] } });
  mocks.decide.mockResolvedValue({ ok: true, message: "Đã chốt: Đạt — bạn này là mentee của mùa." });
});
afterEach(cleanup);

describe("ô chỉ mời đúng người, trên đúng hồ sơ", () => {
  it("Core team mở hồ sơ “cần xem thêm”: có ô chốt với hai lựa chọn và lời dặn đọc trước khi chốt", () => {
    render(<OfflineDashboardClient data={dashboard([cand("a", "An")], "core")} initialApplication="a" />);
    const b = box("An");
    expect(b.getByText(/Người phỏng vấn để lại “Cần BTC xem xét thêm”/)).toBeTruthy();
    expect(b.getByLabelText(BTC_DECISIONS.passed)).toBeTruthy();
    expect(b.getByLabelText(BTC_DECISIONS.rejected)).toBeTruthy();
    expect(b.getByRole("button", { name: "Chốt kết quả" })).toBeTruthy();
  });

  it("Support team (vận hành được nhưng không được chốt) và người phỏng vấn: không có ô", () => {
    for (const who of ["support", "mentor"] as Who[]) {
      render(<OfflineDashboardClient data={dashboard([cand("a", "An")], who)} initialApplication="a" />);
      expect(within(panel("An")).queryByTestId("btc-decision")).toBeNull();
      cleanup();
    }
  });

  it("kết quả do người phỏng vấn chốt (Đạt / Không chọn) hoặc chưa chấm: Core team cũng không có ô", () => {
    for (const outcome of ["passed", "rejected", null] as Array<OfflineOperation["outcome"]>) {
      render(<OfflineDashboardClient data={dashboard([cand("a", "An", { operation: op({ outcome }) })], "core")} initialApplication="a" />);
      expect(within(panel("An")).queryByTestId("btc-decision")).toBeNull();
      cleanup();
    }
  });

  it("thiếu khoá canDecide (database chưa có hàm mới): coi như không được chốt", () => {
    const data = dashboard([cand("a", "An")], "core");
    delete data.canDecide;
    render(<OfflineDashboardClient data={data} initialApplication="a" />);
    expect(within(panel("An")).queryByTestId("btc-decision")).toBeNull();
  });
});

describe("không gì được gửi trước khi đủ lựa chọn, lý do và một lần xác nhận", () => {
  it("chưa chọn kết quả, hoặc chưa ghi lý do: báo thiếu ngay tại ô, không gửi", () => {
    render(<OfflineDashboardClient data={dashboard([cand("a", "An")], "core")} initialApplication="a" />);
    fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    expect(box("An").getByRole("alert").textContent).toBe("Chọn kết quả: Đạt hoặc Không chọn.");
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.passed));
    expect(box("An").queryByRole("alert")).toBeNull();
    typeReason("An", "   ");
    fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    expect(box("An").getByRole("alert").textContent).toBe("Nhập lý do của quyết định — bắt buộc.");
    expect(box("An").queryByRole("group", { name: "Xác nhận chốt kết quả" })).toBeNull();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("đủ rồi: bước một chỉ HỎI LẠI (nêu tên và kết quả); bấm “Xác nhận chốt” mới gửi đúng hồ sơ, phiên bản, kết quả, lý do", async () => {
    render(<OfflineDashboardClient data={dashboard([cand("a", "An"), cand("b", "Bình")], "core")} initialApplication="a" />);
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.passed));
    typeReason("An", "  Mục tiêu rõ, đủ cam kết  ");
    fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    const ask = box("An").getByRole("group", { name: "Xác nhận chốt kết quả" });
    expect(ask.textContent).toContain(BTC_DECISIONS.passed);
    expect(ask.textContent).toContain("An");
    expect(ask.textContent).toContain("mentee của mùa");
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Xác nhận chốt" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect(mocks.decide).toHaveBeenCalledWith({ applicationId: "a", revision: 3, outcome: "passed", reason: "Mục tiêu rõ, đủ cam kết" });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("“Không chọn”: lời hỏi lại nói rõ hệ quả khác, và gửi đúng kết quả đó", async () => {
    render(<OfflineDashboardClient data={dashboard([cand("a", "An")], "core")} initialApplication="a" />);
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.rejected));
    typeReason("An", "Chưa có nhu cầu rõ");
    fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    const ask = box("An").getByRole("group", { name: "Xác nhận chốt kết quả" });
    expect(ask.textContent).toContain(BTC_DECISIONS.rejected);
    expect(ask.textContent).toContain("không được chọn làm mentee");
    expect(ask.textContent).not.toContain("mentee của mùa");
    fireEvent.click(within(ask).getByRole("button", { name: "Xác nhận chốt" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ applicationId: "a", revision: 3, outcome: "rejected", reason: "Chưa có nhu cầu rõ" }));
  });

  it("“Quay lại”, đổi lựa chọn hoặc sửa lý do giữa chừng: quay về bước một, chưa gửi gì", () => {
    render(<OfflineDashboardClient data={dashboard([cand("a", "An")], "core")} initialApplication="a" />);
    const toConfirm = () => fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    const asking = () => box("An").queryByRole("group", { name: "Xác nhận chốt kết quả" });
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.passed));
    typeReason("An", "Lý do");
    toConfirm();
    fireEvent.click(within(asking()!).getByRole("button", { name: "Quay lại" }));
    expect(asking()).toBeNull();
    toConfirm();
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.rejected));
    expect(asking()).toBeNull();
    toConfirm();
    typeReason("An", "Lý do khác");
    expect(asking()).toBeNull();
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});

describe("lỗi hiện ngay cạnh nút", () => {
  it("máy chủ từ chối: lời báo nằm TRONG ô chốt, quay về bước một, không làm mới trang", async () => {
    mocks.decide.mockResolvedValue({ ok: false, message: "Thông tin vừa được cập nhật trên thiết bị khác. Tải lại trước khi lưu." });
    render(<OfflineDashboardClient data={dashboard([cand("a", "An")], "core")} initialApplication="a" />);
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.passed));
    typeReason("An", "Lý do");
    fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    fireEvent.click(box("An").getByRole("button", { name: "Xác nhận chốt" }));
    await waitFor(() => expect(box("An").getByRole("alert").textContent).toContain("Tải lại trước khi lưu"));
    expect(box("An").queryByRole("group", { name: "Xác nhận chốt kết quả" })).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
    // Lý do đã gõ còn nguyên để thử lại.
    expect((box("An").getByLabelText(/Lý do của quyết định/) as HTMLTextAreaElement).value).toBe("Lý do");
  });

  it("mất kết nối (lời gọi ném lỗi): vẫn là một dòng lỗi trong ô, không vỡ màn hình", async () => {
    mocks.decide.mockRejectedValue(new Error("Failed to fetch"));
    render(<OfflineDashboardClient data={dashboard([cand("a", "An")], "core")} initialApplication="a" />);
    fireEvent.click(box("An").getByLabelText(BTC_DECISIONS.rejected));
    typeReason("An", "Lý do");
    fireEvent.click(box("An").getByRole("button", { name: "Chốt kết quả" }));
    fireEvent.click(box("An").getByRole("button", { name: "Xác nhận chốt" }));
    await waitFor(() => expect(box("An").getByRole("alert").textContent).toContain("Mất kết nối"));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("sau khi BTC chốt", () => {
  const decided = (over: Partial<OfflineOperation> = {}) => cand("a", "An", {
    status: "approved_as_mentee",
    operation: op({ outcome: "passed", revision: 4, outcome_reason: "Mục tiêu rõ", btc_decided_by: "core", btc_decided_at: "2026-10-12T03:00:00Z", btc_decided_by_name: "Chị Core", ...over })
  });

  it("hồ sơ ghi rõ: BTC chốt gì, ai, lúc nào, lý do — và người phỏng vấn đã để lại “cần xem thêm”", async () => {
    render(<OfflineDashboardClient data={dashboard([decided()], "support")} initialApplication="a" />);
    const line = await within(panel("An")).findByTestId("btc-decided");
    expect(line.textContent).toContain(`BTC đã chốt: ${OFFLINE_OUTCOMES.passed}`);
    expect(line.textContent).toContain("Chị Core");
    expect(line.textContent).toContain("12/10/2026 10:00");
    expect(line.textContent).toContain(OFFLINE_OUTCOMES.needs_review);
    expect(line.textContent).toContain("Lý do của BTC: Mục tiêu rõ");
    // Lý do của BTC không bị gọi nhầm là "lý do sửa" của người phỏng vấn.
    expect(within(panel("An")).queryByText(/Lý do sửa/)).toBeNull();
  });

  it("không có tên người chốt (không đọc được danh bạ): vẫn hiện, ghi “BTC”", async () => {
    render(<OfflineDashboardClient data={dashboard([decided({ btc_decided_by_name: null })], "support")} initialApplication="a" />);
    expect((await within(panel("An")).findByTestId("btc-decided")).textContent).toContain("· BTC ·");
  });

  it("người phỏng vấn của chính hồ sơ đó KHÔNG còn nút “Sửa kết quả”", async () => {
    render(<OfflineDashboardClient data={dashboard([decided()], "mentor")} initialApplication="a" />);
    await within(panel("An")).findByTestId("btc-decided");
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());
    expect(within(panel("An")).queryByRole("button", { name: "Sửa kết quả / lựa chọn mentee" })).toBeNull();
  });

  it("đối chứng: hồ sơ người phỏng vấn tự chốt (BTC chưa đụng) thì nút sửa vẫn còn, không có dòng BTC", async () => {
    const own = cand("a", "An", { status: "approved_as_mentee", operation: op({ outcome: "passed", revision: 3, outcome_reason: "Cần BTC cân nhắc thêm" }) });
    render(<OfflineDashboardClient data={dashboard([own], "mentor")} initialApplication="a" />);
    expect(await within(panel("An")).findByRole("button", { name: "Sửa kết quả / lựa chọn mentee" })).toBeTruthy();
    expect(within(panel("An")).queryByTestId("btc-decided")).toBeNull();
  });

  it("Core team vẫn đổi lại được: ô nói rõ là đổi quyết định, lựa chọn đang có bị khoá, gửi kèm phiên bản mới", async () => {
    mocks.decide.mockResolvedValue({ ok: true, message: "Đã chốt: Không chọn làm mentee." });
    render(<OfflineDashboardClient data={dashboard([decided()], "core")} initialApplication="a" />);
    const b = box("An");
    expect(b.getByText(/BTC đã chốt hồ sơ này/)).toBeTruthy();
    expect((b.getByLabelText(/Đạt — nhận làm mentee/) as HTMLInputElement).disabled).toBe(true);
    expect((b.getByLabelText(BTC_DECISIONS.rejected) as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(b.getByLabelText(BTC_DECISIONS.rejected));
    typeReason("An", "Bấm nhầm");
    fireEvent.click(b.getByRole("button", { name: "Chốt kết quả" }));
    fireEvent.click(box("An").getByRole("button", { name: "Xác nhận chốt" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ applicationId: "a", revision: 4, outcome: "rejected", reason: "Bấm nhầm" }));
  });
});

describe("hàng chờ của Core team trên danh sách", () => {
  const list = () => [
    cand("a", "An"),
    cand("b", "Bình", { status: "approved_as_mentee", operation: op({ outcome: "passed" }) }),
    cand("c", "Chi", { status: "interview_scheduled", operation: null }),
    cand("d", "Dung")
  ];
  const names = () => Array.from(document.querySelectorAll("tbody tr")).map((r) => r.querySelector("button")?.textContent);

  it("ô lọc “Chỉ hồ sơ cần BTC xem xét thêm” đếm đúng và chỉ để lại đúng các hồ sơ đó", () => {
    render(<OfflineDashboardClient data={dashboard(list(), "core")} />);
    expect(names()).toHaveLength(4);
    const filter = screen.getByLabelText("Chỉ hồ sơ cần BTC xem xét thêm (2)");
    fireEvent.click(filter);
    expect(names()).toEqual(["An", "Dung"]);
    fireEvent.click(filter);
    expect(names()).toHaveLength(4);
  });

  it("Support team cũng lọc được (để chuẩn bị cho Core team); người phỏng vấn thì không có ô lọc này", () => {
    render(<OfflineDashboardClient data={dashboard(list(), "support")} />);
    expect(screen.getByLabelText("Chỉ hồ sơ cần BTC xem xét thêm (2)")).toBeTruthy();
    cleanup();
    render(<OfflineDashboardClient data={dashboard(list(), "mentor")} />);
    expect(screen.queryByLabelText(/Chỉ hồ sơ cần BTC xem xét thêm/)).toBeNull();
  });

  it("nhật ký gọi đúng tên thao tác “BTC chốt kết quả”", () => {
    const data = dashboard(list(), "core");
    data.logs = [{ id: "log-1", application_id: "a", actor_name: "Chị Core", candidate_name: "An", action: "btc_decision", reason: "Mục tiêu rõ",
      created_at: "2026-10-12T03:00:00Z", before_data: { operation: { outcome: "needs_review" } }, after_data: { operation: { outcome: "passed" }, values: { outcome: "passed", reason: "Mục tiêu rõ" } } }];
    render(<OfflineDashboardClient data={data} />);
    expect(screen.getByText(/Chị Core · An · BTC chốt kết quả/)).toBeTruthy();
  });
});
