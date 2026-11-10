/** @vitest-environment jsdom */
/**
 * Màn hình "Danh sách tùy chỉnh" khi có email ngoài VAM (VAM00027): thứ form gửi lên phải đúng là thứ
 * người bấm thấy, và hai lớp chặn gửi nhầm (ô xác nhận người ngoài, người trống tên với mẫu có ô tên)
 * phải khoá được nút gửi.
 *
 * `useFormState` được giả bằng một bản CÓ TRẠNG THÁI như __tests__/custom-list-builder-ui.test.tsx.
 * Phân loại: DIRECT PRODUCTION TESTS — dựng chính SendPanel/CustomListBuilder đang chạy thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/bulk-mail", () => ({
  sendTestEmailAction: vi.fn(),
  startBulkSendAction: vi.fn(),
  continueBulkSendAction: vi.fn(),
  previewCustomListAction: vi.fn(),
  searchCustomListPeopleAction: vi.fn(),
  startCustomBulkSendAction: vi.fn(),
  readExternalEmailFileAction: vi.fn()
}));

const dispatchers = new Map<unknown, (formData: FormData) => Promise<void>>();
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    useFormState: (action: (state: unknown, formData: FormData) => Promise<unknown>, initial: unknown) => {
      const [state, setState] = React.useState(initial);
      const dispatch = async (formData: FormData) => setState(await action(state, formData));
      dispatchers.set(action, dispatch);
      return [state, dispatch];
    },
    useFormStatus: () => ({ pending: false })
  };
});

import { SendPanel } from "@/app/operations/mail/send-panel";
import { previewCustomListAction, readExternalEmailFileAction } from "@/app/actions/bulk-mail";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let nameRequired = false;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  dispatchers.clear();
  nameRequired = false;
  vi.mocked(previewCustomListAction).mockImplementation(async (_state, formData) => ({
    ok: true,
    message: null,
    signature: String(formData.get("signature")),
    label: "Danh sách tùy chỉnh",
    rows: [
      { key: `people:${u(1)}`, fullName: "An Mentor", email: "an@x.org", roleWord: "mentor" },
      { key: "external:khach@y.vn", fullName: "Khách Mời", email: "khach@y.vn", roleWord: "khách mời", external: true },
      { key: "external:binh@z.vn", fullName: "", email: "binh@z.vn", roleWord: "khách mời", external: true }
    ],
    unreachable: [],
    unreachableCount: 0,
    external: { count: 2, problems: ["Dòng 3: “sai@congty” không phải email hợp lệ"], invalidCount: 1, duplicates: 0, overlap: 1, nameless: 1 },
    nameRequired,
    templateId: String(formData.get("template_id") ?? "") || null
  }));
});

function renderCustom(templates = [{ id: "tpl-1", name: "Mời họp", subject: "Thông báo" }]) {
  render(<SendPanel templates={templates} counts={{}} eventOptions={[]} batches={[]} canSend />);
  fireEvent.change(screen.getByLabelText("Gửi cho"), { target: { value: "custom" } });
}

const formOf = (element: Element) => element.closest("form") as HTMLFormElement;
const previewForm = () => formOf(screen.getByRole("button", { name: "Xem danh sách người nhận" }));
const sendForm = () => screen.queryByTestId("custom-send-form") as HTMLFormElement | null;
const sendButton = () => screen.getByRole("button", { name: "Bắt đầu gửi" }) as HTMLButtonElement;

async function submit(action: unknown, form: HTMLFormElement) {
  const dispatch = dispatchers.get(action);
  if (!dispatch) throw new Error("form không dùng useFormState cho action này");
  await act(async () => {
    await dispatch(new FormData(form));
  });
}

const TYPED = "khach@y.vn, Khách Mời\nan@x.org\nsai@congty\nbinh@z.vn";

describe("ô email ngoài VAM", () => {
  it("chỉ gõ email ngoài là đủ để xem trước; chữ đi vào CẢ form xem trước lẫn form gửi, cùng mẫu thư", async () => {
    renderCustom();
    expect((screen.getByRole("button", { name: "Xem danh sách người nhận" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: TYPED } });
    const preview = new FormData(previewForm());
    expect(preview.get("external_recipients")).toBe(TYPED);
    expect(preview.get("template_id")).toBe("tpl-1");

    await submit(previewCustomListAction, previewForm());
    const data = new FormData(sendForm() as HTMLFormElement);
    expect(data.get("external_recipients")).toBe(TYPED);
    expect(data.getAll("recipient_key")).toEqual([`people:${u(1)}`, "external:khach@y.vn", "external:binh@z.vn"]);
  });

  it("bản xem trước nói rõ: người ngoài gắn nhãn, email sai, trùng với VAM, chưa có tên", async () => {
    renderCustom();
    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: TYPED } });
    await submit(previewCustomListAction, previewForm());
    const summary = screen.getByTestId("custom-external-summary").textContent ?? "";
    expect(summary).toContain("2 email ngoài VAM");
    expect(summary).toContain("1 email ngoài đã có trong danh sách lấy từ VAM");
    expect(summary).toContain("1 người chưa có tên");
    expect(screen.getByTestId("custom-external-problems").textContent).toContain("“sai@congty” không phải email hợp lệ");
    expect(screen.getByTestId("custom-preview").textContent).toContain("ngoài VAM");
  });

  it("nút gửi khoá cho tới khi tick ô xác nhận người ngoài; ô đó mang đúng số người ngoài còn tick", async () => {
    renderCustom();
    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: TYPED } });
    await submit(previewCustomListAction, previewForm());
    expect(sendButton().disabled).toBe(true);
    const confirm = screen.getByLabelText(/Tôi đã kiểm/) as HTMLInputElement;
    fireEvent.click(confirm);
    expect(sendButton().disabled).toBe(false);
    expect(new FormData(sendForm() as HTMLFormElement).get("confirm_external")).toBe("2");

    // Bỏ tick một người ngoài: danh sách đổi, phải tick lại, và số đi theo.
    fireEvent.click(screen.getByLabelText("Gửi cho binh@z.vn"));
    expect(sendButton().disabled).toBe(true);
    expect(new FormData(sendForm() as HTMLFormElement).get("confirm_external")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Tôi đã kiểm/));
    expect(new FormData(sendForm() as HTMLFormElement).get("confirm_external")).toBe("1");
  });

  it("mẫu thư có ô tên: người ngoài trống tên khoá nút gửi; bỏ tick họ thì mở", async () => {
    nameRequired = true;
    renderCustom();
    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: TYPED } });
    await submit(previewCustomListAction, previewForm());
    fireEvent.click(screen.getByLabelText(/Tôi đã kiểm/));
    expect(screen.getByTestId("custom-nameless-block").textContent).toContain("1 email ngoài VAM chưa có tên");
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Gửi cho binh@z.vn"));
    fireEvent.click(screen.getByLabelText(/Tôi đã kiểm/));
    expect(screen.queryByTestId("custom-nameless-block")).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it("sửa chữ ô người ngoài, hoặc đổi mẫu thư, sau khi xem trước: ẩn nút gửi, nhắc xem lại", async () => {
    renderCustom([
      { id: "tpl-1", name: "Mời họp", subject: "Thông báo" },
      { id: "tpl-2", name: "Cảm ơn", subject: "Cảm ơn" }
    ]);
    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: TYPED } });
    await submit(previewCustomListAction, previewForm());
    expect(sendForm()).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: `${TYPED}\nthem@q.vn` } });
    expect(sendForm()).toBeNull();
    expect(screen.getByTestId("custom-stale")).toBeTruthy();

    await submit(previewCustomListAction, previewForm());
    expect(sendForm()).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Mẫu thư"), { target: { value: "tpl-2" } });
    expect(sendForm()).toBeNull();
  });
});

describe("file Excel", () => {
  it("danh sách đọc từ file được nối vào chữ gửi lên; “Bỏ danh sách từ file” gỡ nó ra", async () => {
    vi.mocked(readExternalEmailFileAction).mockResolvedValue({
      ok: true,
      message: "Đã đọc 2 email từ khach.xlsx.",
      token: "t1",
      fileName: "khach.xlsx",
      text: "mot@y.vn\tKhách Một\nhai@y.vn",
      count: 2,
      nameless: 1,
      problems: ["Dòng 4: “ba@sai” không phải email hợp lệ"],
      invalidCount: 1,
      duplicates: 0
    });
    renderCustom();
    const fileInput = screen.getByLabelText("Chọn file Excel danh sách email") as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toBe(".xlsx");
    await submit(readExternalEmailFileAction, formOf(fileInput));
    expect(screen.getByTestId("external-file-summary").textContent).toContain("2 email");
    expect(screen.getByTestId("external-file-problems").textContent).toContain("Dòng 4");

    fireEvent.change(screen.getByLabelText("Email ngoài VAM, mỗi dòng một người"), { target: { value: "go@tay.vn" } });
    expect(new FormData(previewForm()).get("external_recipients")).toBe("go@tay.vn\nmot@y.vn\tKhách Một\nhai@y.vn");

    fireEvent.click(screen.getByRole("button", { name: "Bỏ danh sách từ file" }));
    expect(new FormData(previewForm()).get("external_recipients")).toBe("go@tay.vn");
    expect(screen.queryByTestId("external-file-summary")).toBeNull();
  });

  it("không có người ngoài thì form không mang ô người ngoài nào (luồng VAM00026 không đổi)", async () => {
    renderCustom();
    fireEvent.click(screen.getByLabelText("Mentor đang tham gia mùa này"));
    expect(new FormData(previewForm()).has("external_recipients")).toBe(false);
  });
});
