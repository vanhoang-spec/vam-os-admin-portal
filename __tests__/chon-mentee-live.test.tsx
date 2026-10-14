/**
 * @vitest-environment jsdom
 */
/**
 * Trang chọn mentee Vòng 2 — phần chạy trên trình duyệt (BTC 14/10/2026).
 *
 * "Thời gian thực" là một lệnh đọc nhẹ mỗi 20 giây: hàng trăm mentor mở trang cùng lúc, tải lại cả
 * trang là kiểu đọc đã làm sập database ngày 11/10. Điều phải đúng:
 *   - bạn vừa được người khác chọn bị ẩn, kèm câu báo đúng số người;
 *   - không đọc được thì GIỮ danh sách (không ẩn nhầm); tab đang ẩn thì không hỏi máy chủ;
 *   - quá giờ đóng thì dừng hỏi và báo vòng đã đóng;
 *   - lọc theo nhóm trong cụm; "Xem đầy đủ hồ sơ" gọi đúng token + mã đơn;
 *   - câu báo kết quả chọn nằm ở đầu danh sách, còn lại khi thẻ biến mất sau khi trang làm mới;
 *   - "Bỏ chọn (còn N phút)" tự đếm lùi, hết hạn thì nút biến mất.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { MenteeCard } from "@/lib/matching-round2-link-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = vi.hoisted(() => ({
  available: vi.fn(),
  detail: vi.fn(),
  pick: vi.fn(),
  formState: { current: { status: "idle", message: "" } as { status: string; message: string } },
  // Hàm form của nút vẽ gần nhất — test gọi thẳng, như khi mentor bấm "Xác nhận chọn".
  lastFormAction: { current: null as null | ((prev: unknown, formData: FormData) => Promise<unknown>) }
}));
vi.mock("@/app/chon-mentee/[token]/actions", () => ({
  availableMenteesAction: h.available,
  menteeDetailAction: h.detail,
  pickMenteeAction: h.pick,
  unpickMenteeAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    useFormState: (fn: (prev: unknown, formData: FormData) => Promise<unknown>) => {
      h.lastFormAction.current = fn;
      return [h.formState.current, vi.fn()];
    },
    useFormStatus: () => ({ pending: false })
  };
});

import { MenteeList, POLL_MS } from "@/app/chon-mentee/[token]/mentee-list";
import { UnpickButton } from "@/app/chon-mentee/[token]/pick-forms";

const TOKEN = "aaaaaaaa-0000-4000-8000-00000000000a";
const A = "00000000-0000-4000-8000-000000000101";
const B = "00000000-0000-4000-8000-000000000102";
const card = (applicationId: string, name: string, groupCode: number, groupLabel: string): MenteeCard => ({
  applicationId,
  name,
  groupCode,
  groupLabel,
  facts: [["Ngành học", "Kế toán"]],
  texts: [["Mục tiêu khi tham gia mentoring", `Mục tiêu của ${name}`]],
  cv: null
});
const CARDS = [card(A, "Bạn Ngân Hàng", 1, "1. Ngân hàng - Bảo hiểm"), card(B, "Bạn Kế Toán", 2, "2. Kế toán - Kiểm toán")];
const GROUPS = [
  { code: 1, label: "1. Ngân hàng - Bảo hiểm" },
  { code: 2, label: "2. Kế toán - Kiểm toán" }
];
const shownIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="mentee-card"]')).map((c) => c.getAttribute("data-application"));
const setHidden = (hidden: boolean) => Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T05:00:00Z"));
  h.available.mockReset();
  h.detail.mockReset();
  h.pick.mockReset();
  h.lastFormAction.current = null;
  h.formState.current = { status: "idle", message: "" };
  setHidden(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function tick(ms = POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("tự cập nhật", () => {
  it("mỗi 20 giây hỏi máy chủ một lần; bạn vừa được người khác chọn bị ẩn, câu báo đúng số người", async () => {
    h.available.mockResolvedValue({ ok: true, ids: [A] });
    const { container } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt="2026-10-17T04:00:00Z" />);
    expect(shownIds(container)).toEqual([A, B]);
    await tick(POLL_MS - 1000);
    expect(h.available).not.toHaveBeenCalled();
    await tick(1000);
    expect(h.available).toHaveBeenCalledTimes(1);
    expect(h.available).toHaveBeenCalledWith(TOKEN);
    expect(shownIds(container)).toEqual([A]);
    expect(container.querySelector('[data-testid="gone-note"]')?.textContent).toBe("1 bạn vừa được mentor khác chọn và đã ẩn khỏi danh sách.");
  });

  it("không đọc được (lỗi máy chủ hay mạng): giữ nguyên danh sách, không ẩn nhầm ai", async () => {
    h.available.mockResolvedValueOnce({ ok: false, ids: [] }).mockRejectedValueOnce(new Error("mạng"));
    const { container } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt={null} />);
    await tick();
    await tick();
    expect(h.available).toHaveBeenCalledTimes(2);
    expect(shownIds(container)).toEqual([A, B]);
    expect(container.querySelector('[data-testid="gone-note"]')).toBeNull();
  });

  it("tab đang ẩn thì không hỏi; quay lại tab thì hỏi ngay", async () => {
    h.available.mockResolvedValue({ ok: true, ids: [B] });
    setHidden(true);
    const { container } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt={null} />);
    await tick();
    await tick();
    expect(h.available).not.toHaveBeenCalled();
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.available).toHaveBeenCalledTimes(1);
    expect(shownIds(container)).toEqual([B]);
  });

  it("quá giờ đóng: dừng hỏi máy chủ và báo vòng đã đóng", async () => {
    h.available.mockResolvedValue({ ok: true, ids: [A, B] });
    const { container } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt="2026-10-15T05:00:10Z" />);
    await tick();
    expect(h.available).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="round-closed"]')).not.toBeNull();
    expect(shownIds(container)).toEqual([]);
    await tick();
    expect(h.available).not.toHaveBeenCalled();
  });
});

describe("lọc và xem hồ sơ", () => {
  it("lọc theo nhóm trong cụm; số đếm trên nút trừ người đã được chọn", async () => {
    h.available.mockResolvedValue({ ok: true, ids: [A, B] });
    const { container, getByRole } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt={null} />);
    fireEvent.click(getByRole("button", { name: "2. Kế toán - Kiểm toán (1)" }));
    expect(shownIds(container)).toEqual([B]);
    expect(getByRole("button", { name: "2. Kế toán - Kiểm toán (1)" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getByRole("button", { name: "Tất cả (2)" }));
    expect(shownIds(container)).toEqual([A, B]);
    h.available.mockResolvedValue({ ok: true, ids: [A] });
    await tick();
    expect(getByRole("button", { name: "Tất cả (1)" })).toBeTruthy();
    expect(getByRole("button", { name: "2. Kế toán - Kiểm toán (0)" })).toBeTruthy();
  });

  it("một nhóm thì không có nút lọc", () => {
    const { container } = render(<MenteeList token={TOKEN} cards={[CARDS[0]]} groups={[GROUPS[0]]} closesAt={null} />);
    expect(container.querySelector('[data-testid="group-filter"]')).toBeNull();
  });

  it("“Xem đầy đủ hồ sơ” gọi đúng token + mã đơn của thẻ đó và hiện các câu tự luận; lỗi thì báo, không hiện gì sai", async () => {
    h.detail.mockResolvedValueOnce({ ok: true, texts: [["Khó khăn hiện tại", "Chưa biết bắt đầu từ đâu"]] });
    const { container, getAllByRole } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt={null} />);
    await act(async () => {
      fireEvent.click(getAllByRole("button", { name: "Xem đầy đủ hồ sơ" })[1]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.detail).toHaveBeenCalledWith(TOKEN, B);
    const second = container.querySelector(`[data-application="${B}"]`) as HTMLElement;
    expect(second.querySelector('[data-testid="mentee-detail"]')?.textContent).toContain("Chưa biết bắt đầu từ đâu");
    expect((container.querySelector(`[data-application="${A}"]`) as HTMLElement).querySelector('[data-testid="mentee-detail"]')).toBeNull();

    h.detail.mockResolvedValueOnce({ ok: false, message: "Bạn này không còn trong danh sách của anh/chị — có thể vừa được mentor khác chọn." });
    await act(async () => {
      fireEvent.click(getAllByRole("button", { name: "Xem đầy đủ hồ sơ" })[0]);
      await vi.advanceTimersByTimeAsync(0);
    });
    const first = container.querySelector(`[data-application="${A}"]`) as HTMLElement;
    expect(first.querySelector('[role="alert"]')?.textContent).toContain("không còn trong danh sách");
    expect(first.querySelector('[data-testid="mentee-detail"]')).toBeNull();
  });
});

describe("câu báo kết quả chọn", () => {
  // Next áp kết quả lượt chọn CÙNG MỘT LẦN với trang đã làm mới: thẻ của bạn vừa chọn (hay vừa bị
  // người khác chọn trước) biến mất trước khi nút kịp vẽ lại với kết quả. Bản giả dưới đây làm đúng
  // thứ tự đó — trang mới tới trước, kết quả về sau — vì thứ tự ngược lại (thẻ còn đó lúc có kết quả)
  // là thứ đã làm test cũ xanh trong khi trang thật không hiện câu báo nào (14/10/2026).
  async function submitWhileCardVanishes(result: { status: string; message: string }) {
    const view = render(<MenteeList token={TOKEN} cards={[CARDS[1]]} groups={GROUPS} closesAt={null} />);
    const formAction = h.lastFormAction.current;
    expect(formAction).not.toBeNull();
    h.pick.mockImplementation(async () => {
      view.rerender(<MenteeList token={TOKEN} cards={[]} groups={GROUPS} closesAt={null} />);
      return result;
    });
    const formData = new FormData();
    formData.set("menteeApplicationId", B);
    const prev = { status: "idle", message: "" };
    await act(async () => {
      await formAction!(prev, formData);
    });
    expect(h.pick).toHaveBeenCalledWith(TOKEN, prev, formData);
    expect(shownIds(view.container)).toEqual([]);
    return view.container.querySelector('[data-testid="pick-report"]') as HTMLElement | null;
  }

  it("chọn được: câu báo xanh ở đầu danh sách, kèm tên bạn được chọn, dù thẻ đã biến mất", async () => {
    const report = await submitWhileCardVanishes({
      status: "ok",
      message: "Đã chọn. Anh/chị còn có thể chọn thêm 1 mentee. Có thể bỏ chọn trong 30 phút."
    });
    expect(report?.textContent).toBe("Bạn Kế Toán: Đã chọn. Anh/chị còn có thể chọn thêm 1 mentee. Có thể bỏ chọn trong 30 phút.");
    expect(report?.className).toContain("bg-green-50");
  });

  it("mentor khác chọn trước: câu báo đỏ, kèm tên bạn đó, dù thẻ đã biến mất", async () => {
    const report = await submitWhileCardVanishes({ status: "error", message: "Bạn này vừa được mentor khác chọn — anh/chị chọn bạn khác nhé." });
    expect(report?.textContent).toBe("Bạn Kế Toán: Bạn này vừa được mentor khác chọn — anh/chị chọn bạn khác nhé.");
    expect(report?.className).toContain("bg-red-50");
  });

  it("chưa bấm gì thì không có câu báo", () => {
    const { container } = render(<MenteeList token={TOKEN} cards={CARDS} groups={GROUPS} closesAt={null} />);
    expect(container.querySelector('[data-testid="pick-report"]')).toBeNull();
  });
});

describe("đồng hồ bỏ chọn", () => {
  it("tự đếm lùi theo hạn thật; hết hạn thì nút bỏ chọn biến mất", async () => {
    const deadline = new Date(Date.now() + 90_000).toISOString();
    const { container, queryByRole } = render(<UnpickButton token={TOKEN} matchId="m-1" minutesLeft={9} deadline={deadline} />);
    // Số phút lấy theo hạn thật ngay khi hiện, không theo con số lúc tải trang.
    expect(queryByRole("button", { name: "Bỏ chọn (còn 2 phút)" })).toBeTruthy();
    await tick(31_000);
    expect(queryByRole("button", { name: "Bỏ chọn (còn 1 phút)" })).toBeTruthy();
    await tick(60_000);
    expect(queryByRole("button", { name: /Bỏ chọn/ })).toBeNull();
    expect(container.querySelector('[data-testid="undo-expired"]')?.textContent).toContain("Quá 30 phút");
  });
});
