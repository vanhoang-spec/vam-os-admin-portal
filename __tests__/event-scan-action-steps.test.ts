/**
 * Lời báo và màu của máy quét sau mỗi lượt quét.
 *
 * Người đứng quét chỉ liếc màn hình một cái. Màu phải nói đúng: xanh là suôn sẻ,
 * vàng là "đã ghi nhưng để ý" (quét lại, hoặc chưa qua Check in), đỏ là không ghi.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/event-supporters", () => ({ canScanEvent: vi.fn() }));
vi.mock("@/lib/event-checkin", () => ({ recordScan: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canScanEvent } from "@/lib/event-supporters";
import { recordScan } from "@/lib/event-checkin";
import { recordEventScanAction } from "@/app/actions/event-scan";
import { MISSING_CHECK_IN_NOTE, initialScanActionState } from "@/lib/event-scan-action-types";

const EVENT = "00000000-0000-4000-8000-0000000000e1";

const RECORDED = {
  ok: true as const,
  repeat: false,
  fullName: "Nguyễn Văn A",
  station: "gift_counter",
  stationLabel: "Quét lần 2 · Check quầy đổi quà",
  badges: [{ station: "gift_counter", label: "Quét lần 2 · Check quầy đổi quà", scannedAt: "2026-09-20T02:00:00Z" }],
  missingCheckIn: false
};

function scanForm(station = "gift_counter") {
  const formData = new FormData();
  formData.set("event_id", EVENT);
  formData.set("scanned", "A7K2");
  formData.set("station", station);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "support_team", status: "active" } as never);
  vi.mocked(canScanEvent).mockResolvedValue(true);
});

describe("lời báo theo lần quét", () => {
  it("suôn sẻ: xanh, nói tên người và đúng lần quét", async () => {
    vi.mocked(recordScan).mockResolvedValue(RECORDED);

    const state = await recordEventScanAction(initialScanActionState, scanForm());

    expect(recordScan).toHaveBeenCalledWith(expect.objectContaining({ eventId: EVENT, station: "gift_counter" }));
    expect(state).toEqual({
      ok: true,
      tone: "success",
      message: "Nguyễn Văn A — Quét lần 2 · Check quầy đổi quà.",
      fullName: "Nguyễn Văn A",
      badges: ["Quét lần 2 · Check quầy đổi quà"]
    });
  });

  it("chưa qua Check in: đã ghi, màu vàng, kèm câu nhắc", async () => {
    vi.mocked(recordScan).mockResolvedValue({ ...RECORDED, missingCheckIn: true });

    const state = await recordEventScanAction(initialScanActionState, scanForm());

    expect(state.ok).toBe(true);
    expect(state.tone).toBe("warning");
    expect(state.message).toBe(`Nguyễn Văn A — Quét lần 2 · Check quầy đổi quà. ${MISSING_CHECK_IN_NOTE}`);
  });

  it("quét lại người chưa qua Check in: vẫn là quét lại, vẫn kèm câu nhắc", async () => {
    vi.mocked(recordScan).mockResolvedValue({ ...RECORDED, repeat: true, missingCheckIn: true });

    const state = await recordEventScanAction(initialScanActionState, scanForm());

    expect(state.tone).toBe("repeat");
    expect(state.message).toBe(
      `Nguyễn Văn A đã được quét ở Quét lần 2 · Check quầy đổi quà rồi. ${MISSING_CHECK_IN_NOTE}`
    );
  });

  it("lần quét không còn trong thiết lập: đỏ, nói nguyên lời bảo tải lại trang", async () => {
    vi.mocked(recordScan).mockResolvedValue({
      ok: false,
      reason: "stale_step",
      message: "Lần quét đang chọn không còn trong thiết lập của sự kiện. Tải lại trang máy quét rồi chọn lại lần quét."
    });

    const state = await recordEventScanAction(initialScanActionState, scanForm("talkshow"));

    expect(state.tone).toBe("error");
    expect(state.message).toContain("Tải lại trang máy quét");
  });

  it("không có quyền quét buổi này: không ghi gì", async () => {
    vi.mocked(canScanEvent).mockResolvedValue(false);

    const state = await recordEventScanAction(initialScanActionState, scanForm());

    expect(state.tone).toBe("error");
    expect(recordScan).not.toHaveBeenCalled();
  });
});
