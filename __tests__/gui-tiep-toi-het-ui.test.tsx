/** @vitest-environment jsdom */
/**
 * Nút "Gửi tiếp tới hết": tự bấm "Gửi tiếp" NỐI TIẾP cho tới khi lô xong, và dừng đúng lúc.
 *
 * Mỗi ca canh một cách vòng tự bấm gây hại mà không ai thấy:
 *   - chạy chồng hai lần trên cùng một lô (bấm đúp, hoặc bấm "Gửi tiếp" thường trong lúc tự chạy);
 *   - đi tiếp sau lỗi / sau 429 / khi không tiến được (gọi máy chủ mãi mãi);
 *   - không dừng khi người bấm bảo dừng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/bulk-mail", () => ({ continueBulkSendAction: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});

import { continueBulkSendAction } from "@/app/actions/bulk-mail";
import { GuiTiepControls } from "@/app/operations/mail/gui-tiep-toi-het";

const BATCH = "00000000-0000-4000-8000-0000000000bb";
const ok = (remaining: number, processed: number, extra: Record<string, unknown> = {}) => ({
  ok: true, message: `Đã gửi ${processed} thư.`, batchId: BATCH, problems: [], remaining, processed, ...extra
});

afterEach(cleanup);
beforeEach(() => vi.mocked(continueBulkSendAction).mockReset());

function mount() {
  render(<GuiTiepControls batchId={BATCH} continueAction={vi.fn()} />);
}
const status = () => screen.getByTestId(`gui-tiep-trang-thai-${BATCH}`).textContent ?? "";
const calls = () => vi.mocked(continueBulkSendAction).mock.calls;

describe("Gửi tiếp tới hết", () => {
  it("bấm lại cho tới khi lô xong, mỗi lần đúng lô này; cộng dồn số thư đã xử lý", async () => {
    vi.mocked(continueBulkSendAction)
      .mockResolvedValueOnce(ok(309, 100) as never)
      .mockResolvedValueOnce(ok(209, 100) as never)
      .mockResolvedValueOnce(ok(0, 209) as never);
    mount();
    fireEvent.click(screen.getByText("Gửi tiếp tới hết"));
    await waitFor(() => expect(status()).toContain("Lô đã gửi xong."));
    expect(calls()).toHaveLength(3);
    for (const call of calls()) expect((call[1] as FormData).get("batch_id")).toBe(BATCH);
    expect(status()).toContain("409 thư");
    // Xong thì nút tự gửi hiện lại, nút Gửi tiếp thường mở lại.
    expect(screen.getByText("Gửi tiếp tới hết")).toBeTruthy();
    expect((screen.getByText("Gửi tiếp") as HTMLButtonElement).disabled).toBe(false);
  });

  it("lỗi: dừng ngay, không bấm thêm, hiện câu lỗi của máy chủ", async () => {
    vi.mocked(continueBulkSendAction).mockResolvedValueOnce({
      ok: false, message: "Lô này đã kết thúc.", batchId: BATCH, problems: []
    } as never);
    mount();
    fireEvent.click(screen.getByText("Gửi tiếp tới hết"));
    await waitFor(() => expect(status()).toContain("báo lỗi"));
    expect(status()).toContain("Lô này đã kết thúc.");
    expect(calls()).toHaveLength(1);
  });

  it("429: dừng, không bấm thêm", async () => {
    vi.mocked(continueBulkSendAction).mockResolvedValueOnce(ok(300, 5, { rateLimited: true }) as never);
    mount();
    fireEvent.click(screen.getByText("Gửi tiếp tới hết"));
    await waitFor(() => expect(status()).toContain("chạm giới hạn"));
    expect(calls()).toHaveLength(1);
  });

  it("lần chạy không tiến được (0 thư): dừng thay vì gọi máy chủ mãi", async () => {
    vi.mocked(continueBulkSendAction).mockResolvedValue(ok(50, 0) as never);
    mount();
    fireEvent.click(screen.getByText("Gửi tiếp tới hết"));
    await waitFor(() => expect(status()).toContain("không gửi thêm được"));
    expect(calls()).toHaveLength(1);
  });

  it("mất kết nối giữa chừng: dừng và nói phần còn lại vẫn trong lô", async () => {
    vi.mocked(continueBulkSendAction).mockRejectedValueOnce(new Error("network"));
    mount();
    fireEvent.click(screen.getByText("Gửi tiếp tới hết"));
    await waitFor(() => expect(status()).toContain("vẫn nằm trong lô"));
    expect(calls()).toHaveLength(1);
  });

  it("đang tự chạy: nút Gửi tiếp thường bị khoá, bấm đúp không mở vòng thứ hai; Dừng thì dừng sau lần đang dở", async () => {
    let release: (value: unknown) => void = () => undefined;
    vi.mocked(continueBulkSendAction)
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)) as never)
      .mockResolvedValue(ok(100, 100) as never);
    mount();
    const auto = screen.getByText("Gửi tiếp tới hết");
    // Hai cú bấm trong CÙNG một lượt vẽ (React chưa kịp đổi nút thành "Dừng") — đúng kiểu bấm đúp nhanh.
    act(() => {
      auto.click();
      auto.click();
    });
    await waitFor(() => expect(screen.getByText("Dừng")).toBeTruthy());
    expect((screen.getByText("Gửi tiếp") as HTMLButtonElement).disabled).toBe(true);
    expect(status()).toContain("Giữ tab này mở");

    fireEvent.click(screen.getByText("Dừng"));
    await act(async () => release(ok(200, 100)));
    await waitFor(() => expect(status()).toContain("Đã dừng theo yêu cầu"));
    expect(calls()).toHaveLength(1);
  });
});
