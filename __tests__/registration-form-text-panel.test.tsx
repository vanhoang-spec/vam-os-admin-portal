/** @vitest-environment jsdom */
/**
 * Khung "Nội dung form đăng ký" trên trang chi tiết sự kiện.
 *
 * Khung gửi đúng buổi, đúng các đoạn đang hiện; chuỗi nhiều buổi thì tick sẵn "áp
 * dụng cho cả chuỗi"; lưu xong hay lưu hỏng thì chữ đang sửa vẫn còn; và trang chỉ
 * vẽ khung cho người được sửa.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventActionState } from "@/lib/event-action-types";

const formState = vi.hoisted(() => ({ value: null as EventActionState | null }));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: EventActionState) => [formState.value ?? initial, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/app/actions/events", () => ({ updateRegistrationFormTextAction: vi.fn() }));

import { RegistrationFormTextPanel } from "@/app/events/[id]/registration-form-text-panel";
import { formTextPanelFields } from "@/lib/event-form-text";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const FIELDS = formTextPanelFields({
  event_description: "🕒 AGENDA – 20.09.2026 & 27.09.2026",
  fee_required: true,
  payment_instruction: "STK 123"
});

beforeEach(() => {
  formState.value = null;
});

afterEach(cleanup);

function renderPanel(props: Partial<Parameters<typeof RegistrationFormTextPanel>[0]> = {}) {
  const view = render(
    <RegistrationFormTextPanel eventId={EVENT_ID} fields={FIELDS} seriesTotal={null} registrationUrl={null} {...props} />
  );
  return { ...view, form: view.container.querySelector("form") as HTMLFormElement };
}

describe("1. khung sửa", () => {
  it("gửi đúng buổi và đúng các đoạn đang hiện, với nội dung đang lưu", () => {
    const { form } = renderPanel();
    const data = new FormData(form);

    expect(data.get("event_id")).toBe(EVENT_ID);
    expect(data.get("event_description")).toBe("🕒 AGENDA – 20.09.2026 & 27.09.2026");
    expect(data.get("fee_description")).toBe("");
    expect(data.get("payment_instruction")).toBe("STK 123");
    expect(data.has("no_show_policy_text")).toBe(false);
    expect(screen.getByRole("button", { name: "Lưu nội dung form" })).toBeTruthy();
  });

  it("buổi đứng một mình: không có ô áp dụng cho cả chuỗi", () => {
    const { form } = renderPanel({ seriesTotal: 1 });
    expect(new FormData(form).has("apply_to_series")).toBe(false);
    expect(screen.queryByText(/Áp dụng cho cả/)).toBeNull();
  });

  it("chuỗi nhiều buổi: tick sẵn áp dụng cho cả chuỗi, nói rõ số buổi", () => {
    const { form } = renderPanel({ seriesTotal: 2 });
    expect(new FormData(form).get("apply_to_series")).toBe("1");
    expect(screen.getByText("Áp dụng cho cả 2 buổi trong chuỗi")).toBeTruthy();
  });

  it("có link đăng ký: có đường mở form để xem, mở ở tab mới", () => {
    renderPanel({ registrationUrl: "https://os.example.org/register/abc" });
    const link = screen.getByRole("link", { name: "Mở form đăng ký để xem →" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://os.example.org/register/abc");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("chưa có link: không có đường mở form", () => {
    renderPanel();
    expect(screen.queryByRole("link", { name: /Mở form đăng ký/ })).toBeNull();
  });

  it("lưu xong: nói ra", () => {
    formState.value = { ok: true, message: "Đã lưu nội dung form cho cả 2 buổi trong chuỗi." };
    renderPanel({ seriesTotal: 2 });
    expect(screen.getByRole("status").textContent).toBe("Đã lưu nội dung form cho cả 2 buổi trong chuỗi.");
  });
});

describe("2. chữ đang sửa không mất khi form bị đặt lại", () => {
  it("một form thường trong môi trường này CÓ bị đặt lại — nên ca dưới đo được thật", () => {
    const { container } = render(
      <form>
        <textarea name="x" defaultValue="cũ" />
      </form>
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "mới" } });
    (container.querySelector("form") as HTMLFormElement).reset();
    expect(textarea.value).toBe("cũ");
  });

  it("Next đặt lại form sau action: khung giữ nguyên chữ đang sửa", () => {
    const { form } = renderPanel();
    const textarea = form.querySelector('textarea[name="event_description"]') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "🕒 AGENDA – 27.09.2026 & 04.10.2026" } });
    form.reset();

    expect(textarea.value).toBe("🕒 AGENDA – 27.09.2026 & 04.10.2026");
  });
});

describe("3. trang sự kiện chỉ vẽ khung cho người được sửa", () => {
  const page = readFileSync("app/events/[id]/page.tsx", "utf8");

  it("quyền hỏi qua canEditRegistrationFormText", () => {
    expect(page).toContain("const canEditFormText = await canEditRegistrationFormText(adminUser, {");
  });

  it("khung và link nhảy xuống cùng một điều kiện, khung nhận đúng các đoạn đang hiện", () => {
    const panel = page.slice(page.indexOf("{canEditFormText ? (", page.indexOf("<RegistrationLinkPanel")));
    expect(panel).toContain("href={`#${REGISTRATION_FORM_TEXT_PANEL_ID}`}");
    const block = page.slice(page.lastIndexOf("{canEditFormText ? ("));
    expect(block).toContain("<div id={REGISTRATION_FORM_TEXT_PANEL_ID}");
    expect(block).toContain("fields={formTextPanelFields(detail.event)}");
    expect(page.split("{canEditFormText ? (").length - 1).toBe(2);
  });
});
