/**
 * @vitest-environment jsdom
 */
/**
 * Khung "Gửi thư kết quả" — chế độ gửi liên tục (BTC 23/10/2026): bấm một lần, trang tự gọi lượt này nối
 * lượt kia tới khi máy chủ báo dừng.
 *
 * Điều phải đúng: chưa xác nhận thì không lượt nào chạy; vòng lặp dừng đúng khi máy chủ báo (hết người,
 * hết hạn mức, lỗi), khi người bấm dừng, khi mất kết nối, và không bao giờ quá trần số lượt; người lỗi
 * ở lượt trước được gửi kèm để máy chủ bỏ qua; xong thì tải lại số liệu trang.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({ batch: vi.fn(), refresh: vi.fn() }));

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormState: (_fn: unknown, initial: unknown) => [initial, vi.fn()], useFormStatus: () => ({ pending: false }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/actions/match-result", () => ({
  addMatchResultHoldsAction: vi.fn(),
  confirmMatchResultHoldsAction: vi.fn(),
  removeMatchResultHoldAction: vi.fn(),
  resendMatchResultAction: vi.fn(),
  saveMatchResultSettingsAction: vi.fn(),
  sendMatchResultAction: vi.fn(),
  sendMatchResultBatchAction: mocks.batch,
  sendMatchResultGroupTestAction: vi.fn(),
  sendMatchResultTestAction: vi.fn()
}));
vi.mock("@/app/actions/matching-round2", () => ({
  sendRound2ReminderTestAction: vi.fn(),
  sendRound2RemindersAction: vi.fn(),
  sendRound2InvitesAction: vi.fn(),
  sendRound2TestAction: vi.fn(),
  setRound2WindowAction: vi.fn()
}));

import { CONTINUOUS_MAX_ROUNDS, MatchResultSendPanel, type MatchResultSendPanelProps } from "@/app/matches/ket-qua/forms";

const base: MatchResultSendPanelProps = {
  blocked: [],
  sentInWindow: 0,
  allowance: 40,
  readyGroups: 470,
  readyPeople: 1155,
  nextBatchGroups: 18,
  nextBatchPeople: 40,
  roomToday: 920
};
const FAILED = "mentee:e0000000-0000-4000-8000-000000000002";
const round = (over: Record<string, unknown> = {}) => ({ ok: true, message: "Đã gửi 40 thư kết quả.", sent: 40, failed: 0, left: 100, failedKeys: [], more: true, ...over });
const text = (c: HTMLElement) => c.textContent ?? "";
const status = (c: HTMLElement) => c.querySelector('[data-testid="match-result-continuous-progress"] [role="status"]')?.textContent ?? "";

function start(props: Partial<MatchResultSendPanelProps> = {}) {
  const view = render(<MatchResultSendPanel {...base} {...props} />);
  fireEvent.click(view.container.querySelector('[data-testid="match-result-continuous"]')!);
  return view;
}
const confirm = (c: HTMLElement) => fireEvent.click(Array.from(c.querySelectorAll("button")).find((b) => b.textContent === "Xác nhận gửi liên tục")!);

beforeEach(() => {
  mocks.batch.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => cleanup());

describe("nút và bước xác nhận", () => {
  it("hai nút: gửi liên tục (ước tính hôm nay = min(người chờ, hạn mức còn)) và gửi một lô", () => {
    const { container } = render(<MatchResultSendPanel {...base} />);
    expect(container.querySelector('[data-testid="match-result-continuous"]')?.textContent).toBe("Gửi liên tục (khoảng 920 thư hôm nay)");
    expect(text(container)).toContain("Gửi một lô (tối đa 40 thư)");
  });

  it("bấm gửi liên tục chưa chạy lượt nào: hiện câu xác nhận; Huỷ thì quay lại", () => {
    const { container, getByText } = start({ readyPeople: 235 });
    expect(text(container)).toContain("Gửi liên tục thư kết quả tới người thật? Hôm nay gửi được khoảng 235 thư");
    expect(mocks.batch).not.toHaveBeenCalled();
    fireEvent.click(getByText("Huỷ"));
    expect(container.querySelector('[data-testid="match-result-continuous"]')).not.toBeNull();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("còn lý do khoá: không có nút gửi nào", () => {
    const { container } = render(<MatchResultSendPanel {...base} blocked={["Chưa có file Handbook mentee trên VAM OS."]} />);
    expect(container.querySelector('[data-testid="match-result-continuous"]')).toBeNull();
    expect(text(container)).not.toContain("Gửi một lô");
  });
});

describe("vòng lặp gửi liên tục", () => {
  it("gọi lượt này nối lượt kia tới khi máy chủ báo dừng; người lỗi được gửi kèm ở lượt sau; xong thì tải lại trang", async () => {
    mocks.batch
      .mockResolvedValueOnce(round({ failed: 1, sent: 39, failedKeys: [FAILED] }))
      .mockResolvedValueOnce(round({ sent: 38 }))
      .mockResolvedValueOnce(round({ sent: 0, more: false, message: "Đã chạm phần hạn mức: cả hệ thống đã gửi 920/1000 thư trong 24 giờ qua." }));
    const { container } = start();
    confirm(container);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    expect(mocks.batch.mock.calls[0][0]).toEqual({ confirmed: true, skip: [], variant: "standard" });
    expect(mocks.batch.mock.calls[1][0]).toEqual({ confirmed: true, skip: [FAILED], variant: "standard" });
    expect(mocks.batch.mock.calls[2][0]).toEqual({ confirmed: true, skip: [FAILED], variant: "standard" });
    expect(status(container)).toContain("Xong 3 lượt: đã gửi 77 thư, 1 thư lỗi");
    expect(status(container)).toContain("Đã chạm phần hạn mức");
  });

  it("máy chủ từ chối (ví dụ chưa xác nhận danh sách giữ lại): dừng ngay sau lượt đó, báo đúng lý do", async () => {
    mocks.batch.mockResolvedValueOnce(round({ ok: false, sent: 0, more: false, message: "Danh sách mentor giữ lại chưa được xác nhận." }));
    const { container } = start();
    confirm(container);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(status(container)).toContain("Danh sách mentor giữ lại chưa được xác nhận.");
  });

  it("bấm Dừng: chạy nốt lượt đang chạy rồi dừng, không gọi lượt mới", async () => {
    let release!: (v: unknown) => void;
    mocks.batch.mockImplementationOnce(() => new Promise((resolve) => (release = resolve))).mockResolvedValue(round());
    const { container, getByText } = start();
    confirm(container);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    fireEvent.click(getByText("Dừng sau lượt này"));
    expect(text(container)).toContain("Sẽ dừng sau lượt đang chạy");
    await act(async () => release(round()));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(status(container)).toContain("Đã dừng theo yêu cầu.");
  });

  it("mất kết nối giữa chừng: dừng, nói rõ cách làm tiếp", async () => {
    mocks.batch.mockResolvedValueOnce(round()).mockRejectedValueOnce(new Error("network"));
    const { container } = start();
    confirm(container);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.batch).toHaveBeenCalledTimes(2);
    expect(status(container)).toContain("Mất kết nối giữa chừng");
    expect(status(container)).toContain("đã gửi 40 thư");
  });

  it(`máy chủ cứ báo gửi tiếp: dừng ở trần ${CONTINUOUS_MAX_ROUNDS} lượt`, async () => {
    mocks.batch.mockResolvedValue(round({ sent: 1 }));
    const { container } = start();
    confirm(container);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled(), { timeout: 5000 });
    expect(mocks.batch).toHaveBeenCalledTimes(CONTINUOUS_MAX_ROUNDS);
  });

  it("đang gửi thì hỏi trước khi rời trang; xong thì thôi hỏi", async () => {
    let release!: (v: unknown) => void;
    mocks.batch.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { container } = start();
    confirm(container);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    const during = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    await act(async () => release(round({ more: false })));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
