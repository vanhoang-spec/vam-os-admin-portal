/**
 * @vitest-environment jsdom
 */
/**
 * Trình tạo form — khối "Đăng ký sự kiện" (VAM00008, 30/10/2026): chọn sự kiện, tạo nhanh sự kiện,
 * giới hạn số đăng ký; form đã có câu trả lời thì khoá ô chọn sự kiện. Và trang câu trả lời của form
 * gắn sự kiện: link sang sự kiện, bảng cảnh báo trùng; đọc cảnh báo hỏng thì báo lỗi, không giấu.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomFormField } from "@/lib/custom-form-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = vi.hoisted(() => ({ save: vi.fn(), quick: vi.fn(), refresh: vi.fn(), responses: null as any, flags: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/app/forms/actions", () => ({
  saveCustomFormAction: h.save,
  setCustomFormStatusAction: vi.fn(),
  sendCustomFormReceiptTestAction: vi.fn(),
  createCustomFormAction: vi.fn(),
  createEventForFormAction: h.quick
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/custom-forms", () => ({
  listCustomFormResponses: vi.fn(async () => h.responses),
  listCustomFormDuplicateFlags: vi.fn(async () => h.flags)
}));

import { FormBuilder, type BuilderEvent, type BuilderForm } from "@/app/forms/[id]/form-builder";
import ResponsesPage from "@/app/forms/[id]/tra-loi/page";

const field = (id: string, type: CustomFormField["type"], label: string): CustomFormField => ({ id, type, label, help: "", required: true, hidden: false, options: [] });
const FORM: BuilderForm = {
  id: "11111111-2222-4333-8444-555555555555",
  publicCode: "a1b2c3d4e5f6",
  title: "Đăng ký Training",
  description: "",
  programId: null,
  status: "draft",
  opensAt: null,
  closesAt: null,
  thankYou: "",
  onePerEmail: false,
  autoReply: false,
  autoReplySubject: "",
  autoReplyBody: "",
  fields: [field("f_nameaaaa", "short_text", "Họ và tên"), field("f_mailaaaa", "email", "Email")],
  eventId: null,
  registrationLimit: null, requireKnownPerson: false, themeColor: null
};
const EVENTS: BuilderEvent[] = [
  { id: "ev-1", name: "Training 15/11", startsAt: "2026-11-15T01:00:00Z", capacity: 100, status: "active", blocker: null },
  { id: "ev-fee", name: "Gala có phí", startsAt: "2026-11-20T11:00:00Z", capacity: null, status: "active", blocker: "Sự kiện có thu phí" }
];
const byTestId = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
const build = (responseCount = 0, form: BuilderForm = FORM) =>
  render(<FormBuilder form={form} programs={[]} events={EVENTS} responseCount={responseCount} publicUrl="https://os.test/f/x" />);

beforeEach(() => {
  vi.clearAllMocks();
  h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
});

describe("trình tạo form — khối sự kiện", () => {
  it("chọn sự kiện bật luôn 'mỗi email một lần'; Lưu gửi đúng mã sự kiện và giới hạn", async () => {
    const { container } = build();
    fireEvent.change(byTestId(container, "event-select"), { target: { value: "ev-1" } });
    fireEvent.change(byTestId(container, "registration-limit"), { target: { value: "40" } });
    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Lưu form")!);
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1]).toMatchObject({ eventId: "ev-1", registrationLimit: "40", onePerEmail: true });
  });

  it("sự kiện không gắn được thì không chọn được, kèm chữ 'không gắn được'", () => {
    const { container } = build();
    const option = container.querySelector('option[value="ev-fee"]') as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain("không gắn được");
  });

  it("form đã có câu trả lời → ô chọn sự kiện bị khoá, không có nút tạo sự kiện mới", () => {
    const { container } = build(3, { ...FORM, eventId: "ev-1", onePerEmail: true });
    expect(byTestId(container, "event-select").disabled).toBe(true);
    expect(byTestId(container, "quick-event-toggle")).toBeNull();
  });

  it("tạo nhanh sự kiện: gửi đúng tên, giờ Việt Nam, sức chứa; sự kiện mới được chọn sẵn", async () => {
    h.quick.mockResolvedValue({
      ok: true,
      message: "Đã tạo sự kiện",
      event: { id: "ev-new", name: "Kick-off", startsAt: "2026-11-20T11:00:00Z", capacity: 80, status: "active", blocker: null }
    });
    const { container, getByLabelText } = build();
    fireEvent.click(byTestId(container, "quick-event-toggle"));
    fireEvent.change(getByLabelText("Tên sự kiện mới"), { target: { value: "Kick-off" } });
    fireEvent.change(getByLabelText("Ngày sự kiện"), { target: { value: "20112026" } });
    fireEvent.change(getByLabelText("Giờ sự kiện"), { target: { value: "1800" } });
    fireEvent.change(getByLabelText("Sức chứa"), { target: { value: "80" } });
    await act(async () => {
      fireEvent.click(byTestId(container, "quick-event-create"));
    });
    expect(h.quick).toHaveBeenCalledWith({ name: "Kick-off", startsAt: "2026-11-20T18:00", location: "", capacity: "80" });
    expect(byTestId(container, "event-select").value).toBe("ev-new");
  });

  it("tạo nhanh thiếu giờ → báo ngay, không gọi máy chủ", async () => {
    const { container, getByLabelText } = build();
    fireEvent.click(byTestId(container, "quick-event-toggle"));
    fireEvent.change(getByLabelText("Tên sự kiện mới"), { target: { value: "Kick-off" } });
    await act(async () => {
      fireEvent.click(byTestId(container, "quick-event-create"));
    });
    expect(h.quick).not.toHaveBeenCalled();
    expect(container.textContent).toContain("cần ngày (DD/MM/YYYY) và giờ (HH:mm)");
  });
});

describe("trang câu trả lời — form gắn sự kiện", () => {
  const page = async () => renderToStaticMarkup(await ResponsesPage({ params: Promise.resolve({ id: FORM.id }) }));
  beforeEach(() => {
    h.responses = { ok: true, data: { form: { ...FORM, eventId: "ev-1", fields: FORM.fields }, responses: [] } };
    h.flags = { ok: true, data: [{ id: "f1", createdAt: "2026-10-30T05:00:00Z", submittedName: "Trần Thị Bình", submittedEmail: "an@gmail.com", existingName: "Nguyễn Văn An", resolvedAt: null }] };
  });

  it("có link sang sự kiện và bảng cảnh báo trùng", async () => {
    const html = await page();
    expect(html).toContain('href="/events/ev-1"');
    expect(html).toContain("Cảnh báo: email trùng, họ tên khác (1)");
    expect(html).toContain("Trần Thị Bình");
    expect(html).toContain("Nguyễn Văn An");
  });

  it("đọc cảnh báo hỏng → hộp lỗi, không giả vờ là 0 cảnh báo", async () => {
    h.flags = { ok: false, message: "Hệ thống đang bận, thử lại sau ít phút." };
    const html = await page();
    expect(html).toContain("Hệ thống đang bận");
    expect(html).toContain("(?)");
  });

  it("form độc lập → không có khối sự kiện", async () => {
    h.responses = { ok: true, data: { form: { ...FORM, eventId: null }, responses: [] } };
    const html = await page();
    expect(html).not.toContain("event-link-info");
  });
});
