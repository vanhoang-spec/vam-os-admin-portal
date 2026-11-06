/** @vitest-environment jsdom */
/**
 * Màn hình "Danh sách tùy chỉnh" (VAM00026): thứ form gửi lên phải đúng là thứ người bấm thấy.
 *
 * `useFormState` chỉ có thật trong bản react-dom của Next, nên ở đây được giả bằng một bản CÓ TRẠNG
 * THÁI: gọi action thật (đã giả) rồi đặt kết quả làm state mới — để bản xem trước hiện ra, bỏ tick được,
 * và ô ẩn của form gửi đổi theo. Component dùng `useActionState` của React 19 thì vỡ ngay khi dựng
 * (React 18.3.1 không có móc đó), và ca cuối khoá thêm bằng mã nguồn.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — dựng chính SendPanel/CustomListBuilder đang chạy thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/bulk-mail", () => ({
  sendTestEmailAction: vi.fn(),
  startBulkSendAction: vi.fn(),
  continueBulkSendAction: vi.fn(),
  previewCustomListAction: vi.fn(),
  searchCustomListPeopleAction: vi.fn(),
  startCustomBulkSendAction: vi.fn()
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
import {
  previewCustomListAction,
  searchCustomListPeopleAction,
  startCustomBulkSendAction
} from "@/app/actions/bulk-mail";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const E1 = u(101);
const P_ADD = u(4);

const EVENTS = [
  { id: E1, label: "Orientation · 01/11/2026 (buổi 1/2)", seriesId: u(104), sendable: 4, unreachable: 0, seriesSendable: 5, seriesUnreachable: 0 }
];

const ROWS = [
  { key: `people:${u(1)}`, fullName: "An Mentor", email: "an@x.org", roleWord: "mentor" },
  { key: `event_registrations:${u(31)}`, fullName: "Lan Đã Đến", email: "lan@x.org", roleWord: "người tham dự" },
  { key: `people:${P_ADD}`, fullName: "Dũng Ứng Viên", email: "dung@x.org", roleWord: "người tham dự" }
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  dispatchers.clear();
  vi.mocked(previewCustomListAction).mockImplementation(async (_state, formData) => ({
    ok: true,
    message: null,
    signature: String(formData.get("signature")),
    label: "Danh sách tùy chỉnh",
    rows: ROWS,
    unreachable: [],
    unreachableCount: 0
  }));
  vi.mocked(searchCustomListPeopleAction).mockResolvedValue({
    ok: true,
    message: null,
    results: [{ personId: P_ADD, fullName: "Dũng Ứng Viên", email: "dung@x.org", memberCode: "UEHE0004", roleWord: "người tham dự" }]
  });
});

function renderCustom() {
  render(
    <SendPanel
      templates={[{ id: "tpl-1", name: "Mời họp", subject: "Thông báo" }]}
      counts={{ mentee: { sendable: 10, unreachable: 0 } }}
      eventOptions={EVENTS}
      batches={[]}
      canSend
    />
  );
  fireEvent.change(screen.getByLabelText("Gửi cho"), { target: { value: "custom" } });
}

const formOf = (element: Element) => element.closest("form") as HTMLFormElement;
const previewForm = () => formOf(screen.getByRole("button", { name: "Xem danh sách người nhận" }));
const sendForm = () => screen.queryByTestId("custom-send-form") as HTMLFormElement | null;

async function submit(action: unknown, form: HTMLFormElement) {
  const dispatch = dispatchers.get(action);
  if (!dispatch) throw new Error("form không dùng useFormState cho action này");
  await act(async () => {
    await dispatch(new FormData(form));
  });
}

describe("chọn Danh sách tùy chỉnh", () => {
  it("hiện bộ dựng danh sách, ẩn form gửi của nhóm cố định", () => {
    renderCustom();
    expect(screen.getByTestId("custom-list-builder")).toBeTruthy();
    expect(document.getElementById("confirm-count")).toBeNull();
    expect(sendForm()).toBeNull();
  });

  it("nhóm cố định vẫn như cũ khi không chọn custom", () => {
    render(
      <SendPanel templates={[{ id: "tpl-1", name: "Mời họp", subject: "Thông báo" }]} counts={{ mentee: { sendable: 10, unreachable: 0 } }} eventOptions={EVENTS} batches={[]} canSend />
    );
    expect(screen.queryByTestId("custom-list-builder")).toBeNull();
    const form = formOf(document.getElementById("confirm-count") as HTMLElement);
    expect(new FormData(form).get("audience")).toBe("mentee");
  });
});

describe("nguồn đi đúng vào form xem trước", () => {
  it("mentor + sự kiện chỉ người đã check-in", async () => {
    renderCustom();
    fireEvent.click(screen.getByLabelText("Mentor đang tham gia mùa này"));
    fireEvent.click(screen.getByLabelText(/Người đăng ký một sự kiện/));
    fireEvent.change(screen.getByLabelText("Check-in"), { target: { value: "checked_in" } });
    const data = new FormData(previewForm());
    expect(data.get("src_mentor")).toBe("true");
    expect(data.get("src_mentee")).toBe("false");
    expect(data.get("src_staff")).toBe("false");
    expect(data.get("src_event_id")).toBe(E1);
    expect(data.get("src_event_checkin")).toBe("checked_in");
  });

  it("chưa tick gì thì không xem trước được", () => {
    renderCustom();
    expect((screen.getByRole("button", { name: "Xem danh sách người nhận" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("thêm tay, xem trước, bỏ tick, gửi", () => {
  it("thêm một người đã tìm thấy: id đi vào form, không có ô email nào", async () => {
    renderCustom();
    const search = formOf(screen.getByLabelText("Tìm người theo tên, email hoặc mã thành viên"));
    fireEvent.change(screen.getByLabelText("Tìm người theo tên, email hoặc mã thành viên"), { target: { value: "Dũng" } });
    await submit(searchCustomListPeopleAction, search);
    expect(vi.mocked(searchCustomListPeopleAction).mock.calls[0][1].get("q")).toBe("Dũng");
    fireEvent.click(screen.getByRole("button", { name: "Thêm Dũng Ứng Viên" }));
    expect(new FormData(previewForm()).getAll("added_person_id")).toEqual([P_ADD]);

    // Bỏ người vừa thêm thì id rời form.
    fireEvent.click(screen.getByRole("button", { name: "Bỏ Dũng Ứng Viên khỏi danh sách thêm tay" }));
    expect(new FormData(previewForm()).getAll("added_person_id")).toEqual([]);
  });

  it("xem trước → bỏ tick một người → form gửi chỉ mang khoá người còn tick, số xác nhận theo đó", async () => {
    renderCustom();
    fireEvent.click(screen.getByLabelText("Mentor đang tham gia mùa này"));
    await submit(previewCustomListAction, previewForm());

    const preview = screen.getByTestId("custom-preview");
    expect(preview.textContent).toContain("an@x.org");
    expect(preview.textContent).toContain("người tham dự");
    expect(screen.getByTestId("custom-count").textContent).toBe("3");

    fireEvent.click(screen.getByLabelText("Gửi cho Lan Đã Đến"));
    expect(screen.getByTestId("custom-count").textContent).toBe("2");
    const data = new FormData(sendForm() as HTMLFormElement);
    expect(data.getAll("recipient_key")).toEqual([`people:${u(1)}`, `people:${P_ADD}`]);
    expect(data.get("audience")).toBe("custom");
    expect(data.get("template_id")).toBe("tpl-1");
    expect(data.get("src_mentor")).toBe("true");
    expect(Array.from(data.keys()).some((key) => /email/i.test(key))).toBe(false);
    expect(screen.getByLabelText("Gõ lại số 2 để xác nhận")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Gõ lại số 2 để xác nhận"), { target: { value: "2" } });
    vi.mocked(startCustomBulkSendAction).mockResolvedValue({ ok: true, message: "Đã gửi 2 thư. Lô này đã gửi xong.", batchId: "b1", problems: [] });
    await submit(startCustomBulkSendAction, sendForm() as HTMLFormElement);
    expect(vi.mocked(startCustomBulkSendAction).mock.calls[0][1].get("confirm_count")).toBe("2");
    expect(screen.getByText("Đã gửi 2 thư. Lô này đã gửi xong.")).toBeTruthy();
  });

  it("đổi nguồn sau khi xem trước: ẩn nút gửi, nhắc xem lại", async () => {
    renderCustom();
    fireEvent.click(screen.getByLabelText("Mentor đang tham gia mùa này"));
    await submit(previewCustomListAction, previewForm());
    expect(sendForm()).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Ban tổ chức (admin, core team, support team)"));
    expect(sendForm()).toBeNull();
    expect(screen.getByTestId("custom-stale")).toBeTruthy();

    await submit(previewCustomListAction, previewForm());
    expect(sendForm()).not.toBeNull();
    expect(new FormData(sendForm() as HTMLFormElement).get("src_staff")).toBe("true");
  });
});

describe("React 18", () => {
  it("dùng useFormState của react-dom, không dùng useActionState", () => {
    const source = readFileSync("app/operations/mail/custom-list-builder.tsx", "utf8");
    expect(source).toMatch(/import \{[^}]*useFormState[^}]*\} from "react-dom"/);
    expect(source).not.toContain("useActionState");
  });
});
