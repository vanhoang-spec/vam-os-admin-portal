/** @vitest-environment jsdom */
/**
 * Nút "Gửi tiếp tới hết": tự bấm "Gửi tiếp" NỐI TIẾP cho tới khi lô xong, và dừng đúng lúc.
 *
 * Mỗi ca canh một cách vòng tự bấm gây hại mà không ai thấy:
 *   - chạy chồng hai lần trên cùng một lô (bấm đúp, hoặc bấm "Gửi tiếp" thường trong lúc tự chạy);
 *   - đi tiếp sau lỗi / sau 429 / khi nhà cung cấp hỏng / khi không tiến được (gọi máy chủ mãi mãi);
 *   - không dừng khi người bấm bảo dừng, hoặc khi rời trang (vòng chạy ngầm, mất nút Dừng);
 *   - mất câu báo cuối khi lô xong và nút rời màn hình.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/bulk-mail", () => ({ continueBulkSendAction: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});

import { continueBulkSendAction } from "@/app/actions/bulk-mail";
import { GuiTiepControls } from "@/app/operations/mail/gui-tiep-toi-het";
import type { BulkMailActionState } from "@/lib/bulk-mail-action-types";

const BATCH = "00000000-0000-4000-8000-0000000000bb";
const ok = (remaining: number, processed: number, extra: Record<string, unknown> = {}) => ({
  ok: true, message: `Đã gửi ${processed} thư.`, batchId: BATCH, problems: [], remaining, processed, ...extra
});

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(continueBulkSendAction).mockReset();
  refresh.mockReset();
});

let onEnd: ReturnType<typeof vi.fn<(state: BulkMailActionState) => void>>;
function mount() {
  onEnd = vi.fn<(state: BulkMailActionState) => void>();
  return render(<GuiTiepControls batchId={BATCH} continueAction={vi.fn()} onEnd={onEnd} />);
}
const calls = () => vi.mocked(continueBulkSendAction).mock.calls;
const endMessage = () => String(onEnd.mock.calls.at(-1)?.[0].message ?? "");
/** onEnd được gọi lúc bắt đầu (xoá câu cũ, message null) và lúc dừng (có câu báo). */
const endedCalls = () => onEnd.mock.calls.filter((call) => call[0].message);
const waitEnded = () => waitFor(() => expect(endedCalls().length).toBeGreaterThan(0));
const clickAuto = () => act(() => screen.getByText("Gửi tiếp tới hết").click());

describe("Gửi tiếp tới hết", () => {
  it("bấm lại tới khi lô xong, mỗi lần đúng lô này, tu_dong=1; báo cuối qua onEnd; làm mới trang một lần", async () => {
    vi.mocked(continueBulkSendAction)
      .mockResolvedValueOnce(ok(339, 85) as never)
      .mockResolvedValueOnce(ok(254, 85) as never)
      .mockResolvedValueOnce(ok(0, 254) as never);
    mount();
    clickAuto();
    await waitEnded();
    expect(endedCalls()).toHaveLength(1);
    // Lúc bắt đầu, câu báo của lượt trước bị xoá.
    expect(onEnd.mock.calls[0][0].message).toBeNull();
    expect(calls()).toHaveLength(3);
    for (const call of calls()) {
      expect((call[1] as FormData).get("batch_id")).toBe(BATCH);
      expect((call[1] as FormData).get("tu_dong")).toBe("1");
    }
    expect(endedCalls()[0][0].ok).toBe(true);
    expect(endMessage()).toContain("Lô đã gửi xong.");
    expect(endMessage()).toContain("424 thư");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((screen.getByText("Gửi tiếp") as HTMLButtonElement).disabled).toBe(false);
  });

  it("lỗi: dừng ngay, không bấm thêm, câu lỗi của máy chủ đi kèm", async () => {
    vi.mocked(continueBulkSendAction).mockResolvedValueOnce({
      ok: false, message: "Lô này đã kết thúc.", batchId: BATCH, problems: []
    } as never);
    mount();
    clickAuto();
    await waitEnded();
    expect(endMessage()).toContain("báo lỗi");
    expect(endMessage()).toContain("Lô này đã kết thúc.");
    expect(endedCalls()[0][0].ok).toBe(false);
    expect(calls()).toHaveLength(1);
  });

  it.each([
    ["429", { rateLimited: true }, "chạm giới hạn"],
    ["nhà cung cấp lỗi liên tiếp", { providerTrouble: true }, "lỗi liên tiếp"],
    ["cấu hình chặn gửi thư", { configBlocked: true }, "cấu hình đang chặn"]
  ])("%s: dừng, không bấm thêm", async (_label, extra, words) => {
    vi.mocked(continueBulkSendAction).mockResolvedValueOnce(ok(300, 5, extra) as never);
    mount();
    clickAuto();
    await waitEnded();
    expect(endMessage()).toContain(words);
    expect(calls()).toHaveLength(1);
  });

  it("lần chạy không tiến được (0 thư ghi sổ): dừng thay vì gọi máy chủ mãi", async () => {
    vi.mocked(continueBulkSendAction).mockResolvedValue(ok(50, 0) as never);
    mount();
    clickAuto();
    await waitEnded();
    expect(endMessage()).toContain("không gửi thêm được");
    expect(calls()).toHaveLength(1);
  });

  it("mất kết nối giữa chừng: dừng và nói phần còn lại vẫn trong lô", async () => {
    vi.mocked(continueBulkSendAction).mockRejectedValueOnce(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mount();
    clickAuto();
    await waitEnded();
    expect(endMessage()).toContain("vẫn nằm trong lô");
    expect(calls()).toHaveLength(1);
  });

  it("đang tự chạy: Gửi tiếp thường bị khoá, bấm đúp không mở vòng thứ hai, có cảnh báo đóng tab; Dừng thì dừng sau lần đang dở", async () => {
    let release: (value: unknown) => void = () => undefined;
    vi.mocked(continueBulkSendAction)
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)) as never)
      .mockResolvedValue(ok(100, 85) as never);
    const addListener = vi.spyOn(window, "addEventListener");
    mount();
    const auto = screen.getByText("Gửi tiếp tới hết");
    // Hai cú bấm trong CÙNG một lượt vẽ (React chưa kịp đổi nút thành "Dừng") — đúng kiểu bấm đúp nhanh.
    act(() => {
      auto.click();
      auto.click();
    });
    await waitFor(() => expect(screen.getByText("Dừng")).toBeTruthy());
    expect((screen.getByText("Gửi tiếp") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(`gui-tiep-trang-thai-${BATCH}`).textContent).toContain("Giữ tab này mở");
    expect(addListener.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);

    act(() => screen.getByText("Dừng").click());
    await act(async () => release(ok(200, 85)));
    await waitEnded();
    expect(endMessage()).toContain("Đã dừng theo yêu cầu");
    expect(calls()).toHaveLength(1);
    addListener.mockRestore();
  });

  it("câu báo cuối gom lỗi của MỌI vòng, không chỉ vòng cuối", async () => {
    vi.mocked(continueBulkSendAction)
      .mockResolvedValueOnce(ok(100, 85, { problems: ["An: hộp thư sai"] }) as never)
      .mockResolvedValueOnce(ok(15, 85, { problems: ["Bình: hộp thư sai", "An: hộp thư sai"] }) as never)
      .mockResolvedValueOnce(ok(0, 15) as never);
    mount();
    clickAuto();
    await waitEnded();
    expect(endedCalls()[0][0].problems).toEqual(["An: hộp thư sai", "Bình: hộp thư sai"]);
  });

  it("rời màn hình giữa chừng (đổi trang trong app): vòng dừng sau lần đang dở, không chạy ngầm", async () => {
    let release: (value: unknown) => void = () => undefined;
    vi.mocked(continueBulkSendAction)
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)) as never)
      .mockResolvedValue(ok(100, 85) as never);
    const view = mount();
    clickAuto();
    await waitFor(() => expect(calls()).toHaveLength(1));
    view.unmount();
    await act(async () => release(ok(200, 85)));
    await waitEnded();
    expect(calls()).toHaveLength(1);
  });
});
