/** @vitest-environment jsdom */
/**
 * Hộp thoại "Gửi remind": nhập lại ngày → xác nhận → gửi.
 *
 * Canh đúng thứ tự chủ chương trình yêu cầu: không có ngày khớp thì không tới
 * được câu hỏi xác nhận, không bấm Yes thì không có lệnh gửi nào — và khi đã
 * gửi, vòng gửi tự chạy tới hết nhưng dừng khi cả một lô đều lỗi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/event-reminders", () => ({
  startEventReminderAction: vi.fn(),
  continueEventReminderAction: vi.fn(),
  retryFailedEventReminderAction: vi.fn(),
  cancelEventReminderAction: vi.fn()
}));

import {
  continueEventReminderAction,
  startEventReminderAction
} from "@/app/actions/event-reminders";
import { EventReminderPanel } from "@/app/events/[id]/event-reminder-panel";
import {
  REMINDER_CONFIRM_QUESTION,
  REMINDER_DATE_INVALID,
  REMINDER_DATE_MISMATCH,
  type ReminderRunSummary
} from "@/lib/event-reminder-core";

const EVENT_ID = "00000000-0000-4000-b000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000001";

function renderPanel(overrides: Partial<Parameters<typeof EventReminderPanel>[0]> = {}) {
  return render(
    <EventReminderPanel
      eventId={EVENT_ID}
      sessionLabel="Mentor Orientation · Buổi 2/2 · 27/09/2026 08:00 – 11:30"
      expectedDate="2026-09-27"
      recipientCount={12}
      waitlistedCount={3}
      blockReason={null}
      canSend
      latestRun={null}
      latestRunError={null}
      {...overrides}
    />
  );
}

function counts(sent: number, queued: number, failed = 0) {
  return { queued, sending: 0, sent, failed, skipped: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function openAndTypeDate(value: string) {
  fireEvent.click(screen.getByRole("button", { name: /Gửi remind/ }));
  const input = screen.getByPlaceholderText("dd/mm/yyyy");
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
}

describe("1. bước nhập ngày", () => {
  it("chưa nhập ngày: báo định dạng, không tới câu xác nhận, không gọi máy chủ", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Gửi remind/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(screen.getByRole("alert").textContent).toBe(REMINDER_DATE_INVALID);
    expect(screen.queryByText(REMINDER_CONFIRM_QUESTION)).toBeNull();
    expect(startEventReminderAction).not.toHaveBeenCalled();
  });

  it("ngày của buổi KHÁC: báo không khớp, ở lại bước nhập ngày", () => {
    renderPanel();
    openAndTypeDate("20092026");

    expect(screen.getByRole("alert").textContent).toBe(REMINDER_DATE_MISMATCH);
    expect(screen.queryByText(REMINDER_CONFIRM_QUESTION)).toBeNull();
    expect(startEventReminderAction).not.toHaveBeenCalled();
  });

  it("ô nhập tự chèn dấu gạch chéo khi gõ chữ số", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Gửi remind/ }));
    const input = screen.getByPlaceholderText("dd/mm/yyyy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "27092026" } });
    expect(input.value).toBe("27/09/2026");
  });
});

describe("2. bước xác nhận", () => {
  it("ngày khớp: hiện đúng câu hỏi xác nhận; bấm Không thì đóng, không gửi gì", () => {
    renderPanel();
    openAndTypeDate("27092026");

    expect(screen.getByText(REMINDER_CONFIRM_QUESTION)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Không" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(startEventReminderAction).not.toHaveBeenCalled();
    expect(continueEventReminderAction).not.toHaveBeenCalled();
  });

  it("bấm Yes: lập lượt với đúng ngày đã nhập, rồi tự gửi tiếp tới khi xong", async () => {
    vi.mocked(startEventReminderAction).mockResolvedValue({
      ok: true,
      message: "Đã lập danh sách",
      runId: RUN_ID,
      counts: counts(0, 12),
      total: 12,
      done: false
    });
    vi.mocked(continueEventReminderAction)
      .mockResolvedValueOnce({
        ok: true,
        message: "Đã gửi 10/12 · còn 2",
        runId: RUN_ID,
        counts: counts(10, 2),
        total: 12,
        done: false,
        chunk: { sent: 10, failed: 0, skipped: 0, released: 0 }
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Đã gửi xong. Đã gửi 12/12",
        runId: RUN_ID,
        counts: counts(12, 0),
        total: 12,
        done: true,
        chunk: { sent: 2, failed: 0, skipped: 0, released: 0 }
      });

    renderPanel();
    openAndTypeDate("27092026");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(screen.getByText("Đã gửi xong. Đã gửi 12/12")).toBeTruthy());
    expect(startEventReminderAction).toHaveBeenCalledTimes(1);
    expect(startEventReminderAction).toHaveBeenCalledWith({ eventId: EVENT_ID, typedDate: "27/09/2026" });
    expect(continueEventReminderAction).toHaveBeenCalledTimes(2);
    expect(continueEventReminderAction).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(refresh).toHaveBeenCalled();
  });

  it("máy chủ từ chối lúc lập lượt: hiện lý do, không gọi gửi tiếp", async () => {
    vi.mocked(startEventReminderAction).mockResolvedValue({ ok: false, message: REMINDER_DATE_MISMATCH });

    renderPanel();
    openAndTypeDate("27092026");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(screen.getByText(REMINDER_DATE_MISMATCH)).toBeTruthy());
    expect(continueEventReminderAction).not.toHaveBeenCalled();
  });

  it("cả một lô đều lỗi: vòng tự động dừng ngay, không đốt nốt danh sách", async () => {
    vi.mocked(startEventReminderAction).mockResolvedValue({
      ok: true,
      message: "",
      runId: RUN_ID,
      counts: counts(0, 12),
      total: 12,
      done: false
    });
    vi.mocked(continueEventReminderAction).mockResolvedValue({
      ok: true,
      message: "Đã gửi 0/12 · lỗi 10 · còn 2",
      runId: RUN_ID,
      counts: counts(0, 2, 10),
      total: 12,
      done: false,
      chunk: { sent: 0, failed: 10, skipped: 0, released: 0 }
    });

    renderPanel();
    openAndTypeDate("27092026");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(screen.getByText(/đều gửi lỗi nên hệ thống dừng lại/)).toBeTruthy());
    expect(continueEventReminderAction).toHaveBeenCalledTimes(1);
  });
});

describe("3. khi không được gửi, và lượt dở", () => {
  it("buổi bị chặn: nút tắt và nói lý do", () => {
    renderPanel({ blockReason: "Buổi này đã huỷ — không gửi remind cho một buổi không diễn ra." });

    const button = screen.getByRole("button", { name: /Gửi remind/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/đã huỷ — không gửi remind/)).toBeTruthy();
  });

  it("không có quyền vận hành mùa: nút tắt", () => {
    renderPanel({ canSend: false });
    expect((screen.getByRole("button", { name: /Gửi remind/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lượt dở: không mở lượt mới, bấm Gửi tiếp thì gửi tiếp đúng lượt đó", async () => {
    const latestRun: ReminderRunSummary = {
      id: RUN_ID,
      status: "running",
      createdAt: "2026-09-14T03:00:00.000Z",
      createdByName: "Người vận hành",
      confirmedDate: "2026-09-27",
      total: 12,
      counts: counts(7, 5)
    };
    vi.mocked(continueEventReminderAction).mockResolvedValue({
      ok: true,
      message: "Đã gửi xong. Đã gửi 12/12",
      runId: RUN_ID,
      counts: counts(12, 0),
      total: 12,
      done: true,
      chunk: { sent: 5, failed: 0, skipped: 0, released: 0 }
    });

    renderPanel({ latestRun });
    expect((screen.getByRole("button", { name: /Gửi remind/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Gửi tiếp 5 thư" }));

    await waitFor(() => expect(continueEventReminderAction).toHaveBeenCalledWith({ runId: RUN_ID }));
    expect(startEventReminderAction).not.toHaveBeenCalled();
  });
});
