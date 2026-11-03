/** @vitest-environment jsdom */
/**
 * Giới hạn số lần một email được đăng ký sự kiện (VAM00015): phần người dùng nhìn thấy.
 *
 *   - form đăng ký công khai nói trước giới hạn, và câu "đăng ký cả hai buổi" không còn hiện khi chuỗi đã giới hạn;
 *   - form tạo/sửa sự kiện có đúng các ô, tên ô trùng tên mà action đọc;
 *   - action sửa sự kiện chỉ gửi giới hạn khi form có gửi ô (đường ghi hẹp).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicRegistrationActionState } from "@/lib/event-action-types";

const formState = vi.hoisted(() => ({ value: null as PublicRegistrationActionState | null }));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: PublicRegistrationActionState) => [formState.value ?? initial, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/app/register/[token]/actions", () => ({ submitEventRegistrationAction: vi.fn() }));

import { RegistrationForm } from "@/app/register/[token]/registration-form";
import type { Event } from "@/lib/types";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");

const SESSIONS = [
  { id: "s1", seriesIndex: 1, startsAt: "2026-09-20T01:00:00Z", endsAt: "2026-09-20T04:00:00Z", full: false, waitlistEnabled: false },
  { id: "s2", seriesIndex: 2, startsAt: "2026-09-27T01:00:00Z", endsAt: "2026-09-27T04:00:00Z", full: false, waitlistEnabled: false }
] as never;

const event = (extra: Record<string, unknown> = {}) =>
  ({ id: "s1", event_name: "Mentor Orientation", series_id: "series-1", ...extra }) as unknown as Event;

const renderForm = (extra: Record<string, unknown> = {}, sessions: unknown = SESSIONS) =>
  render(<RegistrationForm token="t" eventName="Mentor Orientation" event={event(extra)} sessions={sessions as never} />);

afterEach(() => {
  cleanup();
  formState.value = null;
});

describe("1. form đăng ký công khai", () => {
  it("không đặt giới hạn: không có dòng thông tin, vẫn nói được đăng ký cả hai buổi như trước nay", () => {
    const { container } = renderForm();
    expect(container.querySelector("[data-registration-limit-notice]")).toBeNull();
    expect(container.textContent).toContain("Bạn có thể đăng ký cả hai buổi");
  });

  it("giới hạn 1 theo chuỗi: nói rõ tối đa 1 buổi, và câu 'cả hai buổi' biến mất", () => {
    const { container } = renderForm({ registration_limit_per_email: 1, registration_limit_scope: "series" });
    expect(container.querySelector("[data-registration-limit-notice]")?.textContent).toBe("Mỗi email được đăng ký tối đa 1 buổi trong chuỗi sự kiện này.");
    expect(container.textContent).not.toContain("đăng ký cả hai buổi");
    expect(container.textContent).toContain("Mỗi lần gửi là một buổi.");
  });

  it("giới hạn 2 theo chuỗi: tối đa 2 buổi", () => {
    const { container } = renderForm({ registration_limit_per_email: 2, registration_limit_scope: "series" });
    expect(container.querySelector("[data-registration-limit-notice]")?.textContent).toContain("tối đa 2 buổi");
  });

  it("phạm vi một sự kiện: một lần cho sự kiện này, và không đổi câu về các buổi", () => {
    const { container } = renderForm({ registration_limit_per_email: 1, registration_limit_scope: "event" });
    expect(container.querySelector("[data-registration-limit-notice]")?.textContent).toBe("Mỗi email chỉ đăng ký một lần cho sự kiện này.");
    expect(container.textContent).toContain("Bạn có thể đăng ký cả hai buổi");
  });

  it("sự kiện lẻ ghi nhầm phạm vi series (không có chuỗi): đọc như một sự kiện, không hứa số buổi", () => {
    const { container } = renderForm({ series_id: null, registration_limit_per_email: 1, registration_limit_scope: "series" }, null);
    expect(container.querySelector("[data-registration-limit-notice]")?.textContent).toBe("Mỗi email chỉ đăng ký một lần cho sự kiện này.");
  });

  it("đã bị từ chối vì đủ lượt: lời báo hiện ngay trên form, người đăng ký còn thấy chọn lại buổi", () => {
    formState.value = {
      ok: false,
      status: "limit_reached",
      message: "Email này đã đăng ký đủ số lần cho phép (1 lần) trong chuỗi sự kiện này. Muốn đăng ký buổi khác, hãy huỷ một đăng ký đã có hoặc liên hệ ban tổ chức.",
      values: {}
    };
    renderForm({ registration_limit_per_email: 1, registration_limit_scope: "series" });
    expect(screen.getByText(/đã đăng ký đủ số lần cho phép/)).toBeTruthy();
    expect(screen.getByText("Bạn đăng ký tham dự buổi nào?")).toBeTruthy();
  });
});

describe("2. form tạo và sửa sự kiện", () => {
  const form = source("app/events/event-form.tsx");

  it("có ô số (tối thiểu 1) và ô phạm vi, đúng tên mà action đọc", () => {
    expect(form).toMatch(/name="registration_limit_per_email"[\s\S]{0,80}min=\{1\}/);
    expect(form).toContain('name="registration_limit_scope"');
    expect(form).toContain('<option value="event">Một sự kiện</option>');
    expect(form).toContain('<option value="series">Toàn bộ chuỗi sự kiện</option>');
  });

  it("phạm vi chuỗi chỉ được mời khi tạo chuỗi hoặc khi sửa một buổi của chuỗi", () => {
    expect(form).toContain('mode === "create" || event?.series_id ? <option value="series">');
  });

  it("ô 'áp cho mọi buổi' chỉ có ở buổi thuộc chuỗi, mặc định KHÔNG tick (đường ghi hẹp: sửa một buổi chỉ áp cho buổi đó)", () => {
    expect(form).toMatch(/event\?\.series_id \? \(\s*<label className="mt-2 flex items-start gap-2">\s*<input type="checkbox" name="registration_limit_apply_to_series" value="true" className="mt-1" \/>/);
    expect(form).not.toMatch(/name="registration_limit_apply_to_series"[^>]*defaultChecked/);
  });

  it("nói rõ trên form: chỉ tính đăng ký công khai, huỷ hoàn lượt, 'một sự kiện' chỉ nhận số 1", () => {
    expect(form).toContain("Chỉ tính đăng ký qua form công khai");
    expect(form).toContain("Huỷ đăng ký thì được hoàn lượt");
    expect(form).toContain("chỉ nhận số 1");
  });
});

describe("3. action", () => {
  const actions = source("app/actions/events.ts");
  const createBlock = actions.slice(actions.indexOf("export async function createEventAction"), actions.indexOf("export async function updateEventAction"));
  const updateBlock = actions.slice(actions.indexOf("export async function updateEventAction"), actions.indexOf("const UPDATE_EVENT_OK"));

  it("tạo: luôn gửi hai ô giới hạn (ô trống là không giới hạn)", () => {
    expect(createBlock).toContain('registration_limit_per_email: formText(formData, "registration_limit_per_email")');
    expect(createBlock).toContain('registration_limit_scope: formText(formData, "registration_limit_scope")');
  });

  it("sửa: chỉ gửi giới hạn khi form có ô này, kèm cờ áp cho chuỗi", () => {
    expect(updateBlock).toContain('formData.has("registration_limit_per_email")');
    expect(updateBlock).toContain('registration_limit_apply_to_series: formData.has("registration_limit_apply_to_series") ? "true" : "false"');
    // Gửi vô điều kiện sẽ xoá giới hạn của mọi sự kiện mỗi khi một form khác lưu.
    expect(updateBlock).not.toMatch(/\n\s{4}registration_limit_per_email: formText/);
  });
});

describe("4. hướng dẫn trong app", () => {
  it("trang Sự kiện nói về giới hạn, cách tick áp cho chuỗi và hoàn lượt", () => {
    const guide = source("lib/help-guides.ts");
    expect(guide).toContain("Giới hạn số lần đăng ký theo email");
    expect(guide).toContain("Áp giới hạn này cho mọi buổi của chuỗi");
    expect(guide).toContain("Huỷ đăng ký thì được hoàn lượt");
  });
});
