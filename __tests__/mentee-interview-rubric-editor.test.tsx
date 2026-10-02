// @vitest-environment jsdom
/**
 * Màn hình sửa phiếu chấm (app/interviews/phieu-cham-mentee/rubric-editor.tsx).
 * Phiếu sai chỉ lộ ra khi 30 mentor cùng mở form lúc 08:00 — nên ở đây khoá:
 * tổng trọng số hiện đúng, phiếu sai KHÔNG được gửi, phiếu đúng gửi đúng mùa + đúng
 * phiên bản đang sửa (chống ghi đè lần lưu của người khác).
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RubricEditor } from "@/app/interviews/phieu-cham-mentee/rubric-editor";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/actions/mentee-interview-rubric", () => ({ saveInterviewRubricAction: mocks.save }));

const SEASON = "22222222-2222-4222-8222-222222222222";
const renderEditor = (expectedVersion = 3) =>
  render(<RubricEditor seasonId={SEASON} seasonCode="UEHM-S13" expectedVersion={expectedVersion}
    initialCriteria={S12_INTERVIEW_CRITERIA} initialGuidance={S12_INTERVIEW_GUIDANCE} />);
const totalText = () => screen.getByText(/^Tổng trọng số:/).textContent;
const saveButton = () => screen.getByRole("button", { name: "Lưu phiếu chấm mùa UEHM-S13" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.save.mockResolvedValue({ ok: true, message: "Đã lưu phiếu chấm (phiên bản 4)." });
});
afterEach(cleanup);

it("phiếu S12 nạp đủ 4 tiêu chí, tổng 100%", () => {
  renderEditor();
  S12_INTERVIEW_CRITERIA.forEach((c, i) => {
    expect((screen.getByLabelText(`Tên tiêu chí ${i + 1}`) as HTMLInputElement).value).toBe(c.label);
    expect((screen.getByLabelText(`Trọng số % tiêu chí ${i + 1}`) as HTMLInputElement).value).toBe(String(c.weight));
  });
  expect(totalText()).toBe("Tổng trọng số: 100%");
});

it("đổi trọng số thì tổng đổi theo; tổng ≠ 100 thì báo lỗi và KHÔNG gửi gì", async () => {
  renderEditor();
  fireEvent.change(screen.getByLabelText("Trọng số % tiêu chí 1"), { target: { value: "40" } });
  expect(totalText()).toBe("Tổng trọng số: 110% — phải đúng 100%");
  fireEvent.click(saveButton());
  expect(screen.getByRole("alert").textContent).toBe("Tổng trọng số đang là 110% — phải đúng 100%.");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("tên tiêu chí để trống: chặn lưu", () => {
  renderEditor();
  fireEvent.change(screen.getByLabelText("Tên tiêu chí 2"), { target: { value: "   " } });
  fireEvent.click(saveButton());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("BTC bấm Huỷ ở hộp xác nhận: không gửi", () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  renderEditor();
  fireEvent.click(saveButton());
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("lưu hợp lệ: gửi đúng mùa, đúng phiên bản đang sửa, phiếu đã làm gọn; rồi tải lại trang", async () => {
  renderEditor(3);
  fireEvent.change(screen.getByLabelText("Kim chỉ nam"), { target: { value: "  Có cần không?  " } });
  fireEvent.change(screen.getAllByLabelText(/^Câu hỏi gợi ý/)[1], { target: { value: "Câu A\n\n  Câu B  \n" } });
  fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const sent = mocks.save.mock.calls[0][0];
  expect(sent.seasonId).toBe(SEASON);
  expect(sent.expectedVersion).toBe(3);
  expect(sent.guidance.motto).toBe("Có cần không?");
  expect(sent.criteria.map((c: { key: string }) => c.key)).toEqual(["need", "readiness", "ownership", "follow_through"]);
  expect(sent.criteria[1].interview_questions).toEqual(["Câu A", "Câu B"]);
  expect(sent.criteria[0]).toEqual(S12_INTERVIEW_CRITERIA[0]);
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  expect(screen.getByText("Đã lưu phiếu chấm (phiên bản 4).")).toBeTruthy();
});

it("database từ chối (người khác vừa lưu): báo lỗi, không tải lại trang", async () => {
  mocks.save.mockResolvedValue({ ok: false, message: "Phiếu vừa được người khác lưu. Tải lại trang." });
  renderEditor();
  fireEvent.click(saveButton());
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("người khác lưu"));
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("thêm tiêu chí: mã tự sinh không trùng, trọng số 0 → tổng vẫn 100; chưa đặt tên thì chặn lưu", () => {
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Thêm tiêu chí" }));
  expect((screen.getByLabelText("Trọng số % tiêu chí 5") as HTMLInputElement).value).toBe("0");
  expect(totalText()).toBe("Tổng trọng số: 100%");
  const legend = Array.from(document.querySelectorAll("legend")).map((l) => l.textContent).at(-1);
  expect(legend).toMatch(/^Tiêu chí 5 · mã tieu_chi_moi$/);
  fireEvent.click(saveButton());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("đổi thứ tự rồi lưu: gửi theo thứ tự mới; xoá tiêu chí cần xác nhận", async () => {
  renderEditor();
  fireEvent.click(screen.getAllByRole("button", { name: "Xuống" })[0]);
  expect((screen.getByLabelText("Tên tiêu chí 1") as HTMLInputElement).value).toBe(S12_INTERVIEW_CRITERIA[1].label);
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getAllByRole("button", { name: "Xoá tiêu chí" })[3]);
  expect(screen.getAllByRole("button", { name: "Xoá tiêu chí" })).toHaveLength(4);
  fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0].criteria.map((c: { key: string }) => c.key)).toEqual(["readiness", "need", "ownership", "follow_through"]);
});
