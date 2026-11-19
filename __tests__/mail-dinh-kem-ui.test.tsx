/** @vitest-environment jsdom */
/**
 * VAM00037 — giao diện chọn / xoá tệp đính kèm trong panel "Gửi hàng loạt".
 *
 * Điều phải đúng: tệp chọn từ máy hiện trong danh sách (tên, cỡ) trước khi gửi; bỏ được từng tệp;
 * MỌI form gửi (thư thử, nhóm cố định) mang đúng danh sách đang thấy; tệp bị chặn không bao giờ tới
 * máy chủ; trình duyệt PUT thẳng lên link ký sẵn với loại tệp máy chủ quyết định.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/bulk-mail", () => ({
  sendTestEmailAction: vi.fn(),
  startBulkSendAction: vi.fn(),
  continueBulkSendAction: vi.fn(),
  requestMailAttachmentUploadAction: vi.fn(),
  removeMailAttachmentAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { removeMailAttachmentAction, requestMailAttachmentUploadAction } from "@/app/actions/bulk-mail";
import { SendPanel } from "@/app/operations/mail/send-panel";

const P1 = "s/a/1/huong-dan.pdf";
const P2 = "s/a/2/lich.ics";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(requestMailAttachmentUploadAction).mockImplementation(async ({ files }) => ({
    ok: true,
    problems: [],
    links: files.map((file, i) => ({
      path: i === 0 ? P1 : P2,
      signedUrl: `https://kho.test/upload/${i}?token=t`,
      name: file.name,
      size: file.size,
      mime: file.name.endsWith(".pdf") ? "application/pdf" : "text/calendar"
    }))
  }));
  vi.mocked(removeMailAttachmentAction).mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel() {
  return (
    <SendPanel
      templates={[{ id: "tpl-1", name: "Mẫu", subject: "Tiêu đề" }]}
      counts={{ mentee: { sendable: 3, unreachable: 0 } }}
      batches={[]}
      canSend
    />
  );
}

function fileOf(name: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name);
}

function choose(files: File[]) {
  const input = document.getElementById("mail-dinh-kem-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

/** Giá trị ô đính kèm của từng form gửi — thứ thật sự lên máy chủ. */
function submitted(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('form input[type="hidden"][name="attachments"]')).map(
    (input) => input.value
  );
}

describe("chọn nhiều tệp", () => {
  it("hiện giới hạn ngay trên giao diện, chưa có tệp thì form mang ô rỗng", () => {
    render(panel());
    const box = screen.getByTestId("mail-attachments");
    expect(box.textContent).toContain("Tối đa 10 tệp, tổng không quá 10 MB");
    expect(box.textContent).toContain(".exe");
    expect(screen.getByTestId("mail-attachments-total").textContent).toBe("0/10 tệp · 0 KB/10 MB");
    const input = document.getElementById("mail-dinh-kem-input") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain(".pdf");
    expect(submitted()).toEqual(["", ""]);
  });

  it("tải hai tệp lên, hiện tên và cỡ, mọi form mang đủ hai tệp", async () => {
    render(panel());
    choose([fileOf("Hướng dẫn.pdf", 2048), fileOf("Lịch.ics", 1024)]);

    const list = await screen.findByTestId("mail-attachments-list");
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(list.textContent).toContain("Hướng dẫn.pdf");
    expect(list.textContent).toContain("2 KB");
    expect(list.textContent).toContain("Lịch.ics");

    // PUT thẳng lên link ký sẵn, với loại tệp máy chủ trả về.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://kho.test/upload/0?token=t");
    expect(init.method).toBe("PUT");
    expect(init.headers["content-type"]).toBe("application/pdf");

    const expected = JSON.stringify([
      { path: P1, name: "Hướng dẫn.pdf" },
      { path: P2, name: "Lịch.ics" }
    ]);
    expect(submitted()).toEqual([expected, expected]);
    expect(screen.getByText(/mỗi thư kèm/).textContent).toContain("2");
  });

  it("bỏ một tệp: danh sách và mọi form cập nhật, tệp được dọn khỏi kho", async () => {
    render(panel());
    choose([fileOf("Hướng dẫn.pdf", 2048), fileOf("Lịch.ics", 1024)]);
    await screen.findByRole("button", { name: "Bỏ tệp Lịch.ics" });

    fireEvent.click(screen.getByRole("button", { name: "Bỏ tệp Hướng dẫn.pdf" }));

    const list = screen.getByTestId("mail-attachments-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list.textContent).not.toContain("Hướng dẫn.pdf");
    expect(removeMailAttachmentAction).toHaveBeenCalledWith(P1);
    const expected = JSON.stringify([{ path: P2, name: "Lịch.ics" }]);
    expect(submitted()).toEqual([expected, expected]);
  });

  it("tệp chạy được bị chặn ngay trên máy, không xin link, không tải lên", async () => {
    render(panel());
    choose([fileOf("cai-dat.exe", 10), fileOf("chay.sh", 10)]);
    const problems = await screen.findByTestId("mail-attachments-problems");
    expect(problems.textContent).toContain("cai-dat.exe");
    expect(problems.textContent).toContain("chay.sh");
    expect(requestMailAttachmentUploadAction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submitted()).toEqual(["", ""]);
  });

  it("tệp quá lớn bị chặn trên máy, tệp hợp lệ đi cùng vẫn được nhận", async () => {
    render(panel());
    choose([fileOf("lon.pdf", 10 * 1024 * 1024 + 1), fileOf("Hướng dẫn.pdf", 100)]);
    const list = await screen.findByTestId("mail-attachments-list");
    expect(list.textContent).toContain("Hướng dẫn.pdf");
    expect(screen.getByTestId("mail-attachments-problems").textContent).toContain("lon.pdf");
    expect(vi.mocked(requestMailAttachmentUploadAction).mock.calls[0][0].files).toEqual([{ name: "Hướng dẫn.pdf", size: 100 }]);
  });

  it("tải lên hỏng thì tệp không vào danh sách, form không mang tệp", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    render(panel());
    choose([fileOf("Hướng dẫn.pdf", 100)]);
    const problems = await screen.findByTestId("mail-attachments-problems");
    expect(problems.textContent).toContain("chưa tải lên được");
    expect(screen.queryByTestId("mail-attachments-list")).toBeNull();
    expect(submitted()).toEqual(["", ""]);
  });
});
