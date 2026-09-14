/** @vitest-environment jsdom */
/**
 * Máy quét chỉ hiện các lần quét của ĐÚNG sự kiện đang mở, và gửi đúng lần
 * đang chọn.
 *
 * Lỗi đáng sợ nhất ở đây không đỏ lên màn hình: người đứng quầy Check out tải
 * lại trang, lần quét quay về Check in, và cả hàng người được ghi sai mà máy vẫn
 * kêu bíp bình thường.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("jsqr", () => ({ default: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));
vi.mock("@/app/actions/event-scan", () => ({ recordEventScanAction: vi.fn() }));

import { recordEventScanAction } from "@/app/actions/event-scan";
import { EventScanner } from "@/app/events/[id]/scan/scanner";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const STEPS = [
  { station: "entrance", label: "Quét lần 1 · Check in" },
  { station: "gift_counter", label: "Quét lần 2 · Check quầy đổi quà" },
  { station: "checkout", label: "Quét lần 3 · Check out" }
];

function sentStation(call = 0) {
  const formData = vi.mocked(recordEventScanAction).mock.calls[call][1] as FormData;
  return { station: formData.get("station"), scanned: formData.get("scanned"), eventId: formData.get("event_id") };
}

function typeCode(code: string) {
  fireEvent.change(screen.getByPlaceholderText("VD: A7K2 hoặc A7K2M9PQRS"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Điểm danh" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(recordEventScanAction).mockResolvedValue({
    ok: true,
    tone: "success",
    message: "Nguyễn Văn A — Quét lần 1 · Check in.",
    fullName: "Nguyễn Văn A",
    badges: []
  });
});

afterEach(cleanup);

describe("1. lần quét", () => {
  it("chỉ hiện đúng các lần quét của sự kiện, không còn trạm cố định", () => {
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    const options = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options).map((option) => option.text);
    expect(options).toEqual(STEPS.map((step) => step.label));
    expect(screen.queryByText(/Booth/)).toBeNull();
  });

  it("gửi đúng lần quét đang chọn", async () => {
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "checkout" } });
    typeCode("A7K2");

    await waitFor(() => expect(recordEventScanAction).toHaveBeenCalledTimes(1));
    expect(sentStation()).toEqual({ station: "checkout", scanned: "A7K2", eventId: EVENT_ID });
  });

  it("tải lại trang vẫn giữ lần quét đã chọn", async () => {
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "checkout" } });
    cleanup();

    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("checkout"));

    typeCode("A7K2");
    await waitFor(() => expect(recordEventScanAction).toHaveBeenCalledTimes(1));
    expect(sentStation().station).toBe("checkout");
  });

  it("lần quét đã nhớ không còn trong thiết lập: về lần quét đầu tiên", async () => {
    window.localStorage.setItem(`vam-os:scan-step:${EVENT_ID}`, "talkshow");
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    typeCode("A7K2");

    await waitFor(() => expect(recordEventScanAction).toHaveBeenCalledTimes(1));
    expect(sentStation().station).toBe("entrance");
  });

  it("nhớ riêng từng sự kiện", async () => {
    window.localStorage.setItem("vam-os:scan-step:00000000-0000-4000-8000-0000000000e2", "checkout");
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    typeCode("A7K2");

    await waitFor(() => expect(recordEventScanAction).toHaveBeenCalledTimes(1));
    expect(sentStation().station).toBe("entrance");
  });

  it("sự kiện chỉ có một lần quét: không có ô chọn, vẫn gửi đúng lần đó", async () => {
    render(<EventScanner eventId={EVENT_ID} steps={[{ station: "checkout", label: "Quét lần 1 · Check out" }]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Quét lần 1 · Check out")).toBeTruthy();

    typeCode("A7K2");
    await waitFor(() => expect(recordEventScanAction).toHaveBeenCalledTimes(1));
    expect(sentStation().station).toBe("checkout");
  });
});

describe("2. kết quả", () => {
  it("nhắc chưa Check in hiện màu vàng, không phải màu xanh của lượt quét suôn sẻ", async () => {
    vi.mocked(recordEventScanAction).mockResolvedValue({
      ok: true,
      tone: "warning",
      message: "Nguyễn Văn A — Quét lần 2 · Check quầy đổi quà. Người này chưa được quét Check in.",
      fullName: "Nguyễn Văn A",
      badges: ["Quét lần 2 · Check quầy đổi quà"]
    });
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    typeCode("A7K2");

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("chưa được quét Check in");
    expect(status.className).toContain("amber");
    expect(status.className).not.toContain("vam-mint");
  });
});

describe("3. thiết lập", () => {
  it("không truyền đường thiết lập (người hỗ trợ): không có link", () => {
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} />);
    expect(screen.queryByRole("link", { name: "Thiết lập các lần quét" })).toBeNull();
  });

  it("người được thiết lập: link tới khung thiết lập trên cùng trang", () => {
    render(<EventScanner eventId={EVENT_ID} steps={STEPS} settingsHref="#thiet-lap-lan-quet" />);
    expect(screen.getByRole("link", { name: "Thiết lập các lần quét" }).getAttribute("href")).toBe("#thiet-lap-lan-quet");
  });
});
