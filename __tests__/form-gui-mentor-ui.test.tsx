/** @vitest-environment jsdom */
/**
 * "Tự động gửi Submission cho Mentor" (VAM00011) — giao diện: ô chọn trong trình tạo form mặc định tắt, gửi
 * đúng ba giá trị khi lưu; trang câu trả lời đổi khi bật và NGUYÊN NHƯ CŨ khi tắt; nút bấm khoá trong lúc chạy.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  save: vi.fn(async () => ({ ok: true, message: "Đã lưu form." })),
  testMail: vi.fn(async () => ({ ok: true, message: "Đã gửi thư thử." })),
  pending: vi.fn(async () => ({ ok: true, message: "Đã gửi 1 bản, 0 bản còn chờ ghép cặp." })),
  listResponses: vi.fn(),
  listSends: vi.fn(),
  flags: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock("@/app/forms/actions", () => ({
  saveCustomFormAction: h.save,
  setCustomFormStatusAction: vi.fn(),
  sendCustomFormReceiptTestAction: vi.fn(),
  sendCustomFormMentorTestAction: h.testMail,
  sendPendingMentorForwardsAction: h.pending,
  createEventForFormAction: vi.fn()
}));
vi.mock("@/lib/custom-forms", () => ({
  listCustomFormResponses: h.listResponses,
  listCustomFormMentorSends: h.listSends,
  listCustomFormDuplicateFlags: h.flags
}));

import { FormBuilder, type BuilderForm } from "@/app/forms/[id]/form-builder";
import ResponsesPage from "@/app/forms/[id]/tra-loi/page";

const FORM_ID = "11111111-2222-4333-8444-555555555555";
const field = (id: string, type: string, label: string) => ({ id, type, label, help: "", required: true, hidden: false, options: [] }) as any;
const FIELDS = [field("f_nameaaaa", "short_text", "Họ và tên"), field("f_emailaaa", "email", "Email")];
const FORM: BuilderForm = {
  id: FORM_ID,
  publicCode: "a1b2c3d4e5f6",
  title: "Mục tiêu",
  description: "",
  programId: null,
  status: "draft",
  opensAt: null,
  closesAt: null,
  thankYou: "",
  onePerEmail: true,
  autoReply: false,
  autoReplySubject: "",
  autoReplyBody: "",
  mentorForward: false,
  mentorForwardSubject: "",
  mentorForwardBody: "",
  fields: FIELDS,
  eventId: null,
  registrationLimit: null,
  requireKnownPerson: false,
  themeColor: null,
  bannerPath: null,
  logoPath: null,
  logoPosition: "left"
};
const builder = (over: Partial<BuilderForm> = {}) => render(<FormBuilder form={{ ...FORM, ...over }} programs={[]} publicUrl="https://x/f/a" responseCount={0} events={[]} bannerUrl="" logoUrl="" />);
const toggle = () => screen.getByTestId("mentor-forward-toggle") as HTMLInputElement;
const within = (id: string) => screen.getByTestId(id);

const clickSave = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Lưu form/ }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.listResponses.mockResolvedValue({
    ok: true,
    data: {
      form: { id: FORM_ID, title: "Mục tiêu", eventId: null, mentorForward: true, fields: FIELDS },
      responses: [
        { id: "r-1", createdAt: "2026-11-01T02:00:00Z", answers: { f_nameaaaa: "An" } },
        { id: "r-2", createdAt: "2026-11-01T03:00:00Z", answers: { f_nameaaaa: "Bình" } },
        { id: "r-3", createdAt: "2026-11-01T04:00:00Z", answers: { f_nameaaaa: "Chi" } },
        { id: "r-4", createdAt: "2026-10-01T04:00:00Z", answers: { f_nameaaaa: "Dũng" } }
      ]
    }
  });
  h.listSends.mockResolvedValue({
    ok: true,
    data: [
      { responseId: "r-1", status: "da_gui", mentorName: "Trần Mentor", sentAt: "2026-11-01T02:01:00Z", lastError: null },
      { responseId: "r-2", status: "cho_ghep_cap", mentorName: "", sentAt: null, lastError: null },
      { responseId: "r-3", status: "khong_nhan_ra", mentorName: "", sentAt: null, lastError: "Email không khớp hồ sơ nào trên hệ thống." }
    ]
  });
});
afterEach(cleanup);

describe("1. trình tạo form", () => {
  it("mặc định tắt: có ô chọn, chưa hiện ô soạn thư", () => {
    builder();
    expect(within("mentor-forward").textContent).toContain("Tự động gửi Submission cho Mentor");
    expect(toggle().checked).toBe(false);
    expect(screen.queryByLabelText("Nội dung thư gửi mentor")).toBeNull();
    expect(screen.queryByTestId("test-mentor-mail")).toBeNull();
  });

  it("bật, soạn, lưu: gửi đúng ba giá trị lên máy chủ", async () => {
    builder();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText("Tiêu đề thư gửi mentor"), { target: { value: "Tiêu đề" } });
    fireEvent.change(screen.getByLabelText("Nội dung thư gửi mentor"), { target: { value: "Nội dung" } });
    await clickSave();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect((h.save.mock.calls as unknown as unknown[][])[0][1]).toMatchObject({ mentorForward: true, mentorForwardSubject: "Tiêu đề", mentorForwardBody: "Nội dung" });
  });

  it("không bật: lưu với mentorForward false", async () => {
    builder();
    await clickSave();
    expect((h.save.mock.calls as unknown as unknown[][])[0][1]).toMatchObject({ mentorForward: false });
  });

  it("Gửi thử dùng chữ đang trên trang", async () => {
    builder({ mentorForward: true, mentorForwardBody: "Đang soạn", mentorForwardSubject: "T" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("test-mentor-mail"));
    });
    expect(h.testMail).toHaveBeenCalledWith(FORM_ID, { subject: "T", body: "Đang soạn" });
  });

  it("form có CCCD: cảnh báo ngay trong khối này; không có thì không", () => {
    const { unmount } = builder({ mentorForward: true, fields: [...FIELDS, field("f_cccdaaaa", "citizen_id", "CCCD")] });
    expect(within("mentor-forward-cccd").textContent).toContain("CCCD");
    unmount();
    builder({ mentorForward: true });
    expect(screen.queryByTestId("mentor-forward-cccd")).toBeNull();
  });
});

describe("2. trang câu trả lời", () => {
  const page = async () => render(await ResponsesPage({ params: Promise.resolve({ id: FORM_ID }) }));
  const rowOf = (name: string) => screen.getByText(name).closest("tr")?.textContent ?? "";

  it("bật: trạng thái từng bản nằm đúng dòng của bản đó", async () => {
    await page();
    expect(rowOf("An")).toContain("Đã gửi tới Trần Mentor");
    expect(rowOf("Bình")).toContain("Chờ ghép cặp");
    expect(rowOf("Chi")).toContain("Không nhận ra mentee");
    expect(rowOf("Chi")).toContain("Email không khớp hồ sơ nào");
    expect(rowOf("Dũng")).toContain("Trước khi bật");
    expect(within("mentor-send-counts").textContent).toContain("Chờ ghép cặp: 1");
    expect(within("mentor-send-counts").textContent).toContain("Đã gửi: 1");
  });

  it("đọc trạng thái hỏng: báo lỗi, không vẽ như không có gì", async () => {
    h.listSends.mockResolvedValue({ ok: false, message: "Hệ thống đang bận" });
    await page();
    expect(within("mentor-send-panel").textContent).toContain("Hệ thống đang bận");
    expect(rowOf("Bình")).not.toContain("Trước khi bật");
  });

  it("tắt: không đọc sổ gửi, không khối, không cột, không nút", async () => {
    const off = await h.listResponses();
    off.data.form.mentorForward = false;
    h.listResponses.mockResolvedValue(off);
    await page();
    expect(h.listSends).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mentor-send-panel")).toBeNull();
    expect(screen.queryByTestId("mentor-send-pending")).toBeNull();
    expect(screen.queryByText("Gửi mentor")).toBeNull();
  });

  it("nút bấm gọi đúng form, hiện kết quả; đang chạy thì khoá nút", async () => {
    let finish: (value: { ok: boolean; message: string }) => void = () => {};
    h.pending.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await page();
    const button = screen.getByTestId("mentor-send-pending") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(h.pending).toHaveBeenCalledWith(FORM_ID);
    expect(button.disabled).toBe(true);
    await act(async () => {
      finish({ ok: true, message: "Đã gửi 1 bản, 0 bản còn chờ ghép cặp." });
    });
    expect(button.disabled).toBe(false);
    expect(screen.getByTestId("mentor-send-result").textContent).toContain("Đã gửi 1 bản");
  });
});
