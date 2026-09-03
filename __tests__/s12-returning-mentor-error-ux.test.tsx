// @vitest-environment jsdom
/**
 * Slice 2C — returning-Mentor error experience.
 *
 * The backend rule is unchanged and is covered by
 * s12-returning-mentor-intake-block.test.ts. What changed is only what the
 * applicant sees: the refusal used to render in a banner at the very top of a
 * long form, out of view of someone who had just pressed submit at the bottom,
 * with no announcement, no focus and no explanation of what to do next.
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/apply/_components/submit-button", () => ({
  ApplySubmitButton: ({ idleLabel }: { idleLabel: string }) => <button type="submit">{idleLabel}</button>
}));

import { ApplicationForm, TextField } from "../app/apply/_components/form-primitives";
import { RETURNING_MENTOR_GUIDANCE, type ApplyActionState } from "@/lib/apply-types";

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});
afterEach(cleanup);

const RETURNING_MENTOR_SERVER_MESSAGE =
  "Hồ sơ này cần được xử lý qua luồng xác nhận/gia hạn Mentor Season 12. Vui lòng sử dụng đường dẫn do BTC gửi hoặc liên hệ BTC nếu chưa nhận được.";

function renderForm(state: ApplyActionState) {
  return render(
    <ApplicationForm action={vi.fn()} state={state} submitLabel="Gửi đơn ứng tuyển">
      <TextField name="full_name" label="Họ tên" />
      <TextField name="email_primary" label="Email" />
    </ApplicationForm>
  );
}

const returningMentorState: ApplyActionState = {
  ok: false,
  message: RETURNING_MENTOR_SERVER_MESSAGE,
  errorKind: "returning_mentor"
};

const alert = () => screen.getByTestId("submit-area-alert");
const submitButton = () => screen.getByRole("button", { name: "Gửi đơn ứng tuyển" });

describe("Slice 2C — returning-Mentor error is visible where the applicant is looking", () => {
  it("renders the error between the last question and the submit button", () => {
    renderForm(returningMentorState);
    const node = alert();
    const button = submitButton();

    // DOCUMENT_POSITION_FOLLOWING === 4: the button comes after the alert.
    expect(node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing but the submit row separates them.
    expect(node.nextElementSibling?.contains(button)).toBe(true);
    // And it is below the questions, not above them.
    const lastField = document.querySelector('[data-field-name="email_primary"]')!;
    expect(lastField.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("announces itself and takes focus and scroll after the server responds", () => {
    renderForm(returningMentorState);
    expect(alert().getAttribute("role")).toBe("alert");
    expect(alert().tabIndex).toBe(-1);
    expect(document.activeElement).toBe(alert());
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("does not depend on colour alone to say something went wrong", () => {
    renderForm(returningMentorState);
    expect(alert().textContent).toContain(RETURNING_MENTOR_GUIDANCE.heading);
  });
});

describe("Slice 2C — returning-Mentor guidance is specific and safe", () => {
  it("explains that the applicant already has a Mentor profile", () => {
    renderForm(returningMentorState);
    const shown = alert().textContent ?? "";
    expect(shown).toContain(RETURNING_MENTOR_GUIDANCE.heading);
    expect(shown).toContain(RETURNING_MENTOR_GUIDANCE.body);
    expect(shown).toMatch(/hồ sơ Mentor/i);
    // Not a generic submission failure.
    expect(shown).not.toMatch(/Lỗi hệ thống/i);
    expect(shown).not.toBe("Không gửi được đơn");
  });

  it("points at the Season 12 renewal channel without inventing a public link", () => {
    renderForm(returningMentorState);
    const node = alert();
    expect(node.textContent).toContain(RETURNING_MENTOR_GUIDANCE.cta);
    expect(RETURNING_MENTOR_GUIDANCE.cta).toContain("Mùa 12");
    expect(RETURNING_MENTOR_GUIDANCE.cta).toContain("Core Team");
    // Renewal is reachable only through a per-Mentor token, so no URL is offered.
    expect(node.querySelectorAll("a")).toHaveLength(0);
    expect(node.textContent).not.toContain("/renew");
    expect(node.textContent).not.toMatch(/https?:\/\//);
  });

  it("does not reveal anything about the address beyond the applicant's own submission", () => {
    renderForm(returningMentorState);
    const shown = alert().textContent ?? "";
    // No echoed address, no count, no identity of the existing profile.
    expect(shown).not.toMatch(/@/);
    expect(shown).not.toMatch(/mentor_code|MT-\d/i);
  });
});

describe("Slice 2C — the shared alert does not change other outcomes", () => {
  it("shows a generic refusal generically, still near the submit button", () => {
    renderForm({ ok: false, message: "Đơn đăng ký cho vai trò này hiện chưa được mở." });
    const node = alert();
    expect(node.dataset.errorKind).toBe("generic");
    expect(node.textContent).toContain("Đơn đăng ký cho vai trò này hiện chưa được mở.");
    expect(node.textContent).not.toContain(RETURNING_MENTOR_GUIDANCE.cta);
  });

  it("renders nothing on success or before the first submission", () => {
    const { unmount } = renderForm({ ok: true, message: "Đã ghi nhận đơn đăng ký." });
    expect(screen.queryByTestId("submit-area-alert")).toBeNull();
    unmount();
    renderForm({ ok: false, message: null });
    expect(screen.queryByTestId("submit-area-alert")).toBeNull();
  });

  it("leaves focus on the offending control when the refusal names a field", () => {
    renderForm({
      ok: false,
      message: "Số điện thoại phải gồm đúng 10 chữ số.",
      fieldErrors: [{ name: "email_primary", label: "Email" }]
    });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /Email/ }));
    // The message is still restated near submit; it just does not steal focus.
    expect(alert().textContent).toContain("Số điện thoại phải gồm đúng 10 chữ số.");
  });
});

describe("Slice 2C — the refusal reason travels from the backend rule to the form", () => {
  const CREATE = readFileSync("lib/applications-create.ts", "utf8");
  const ACTION = readFileSync("app/actions/apply.ts", "utf8");
  const block = CREATE.slice(
    CREATE.indexOf('if (input.role === "mentor" && existingPerson)'),
    CREATE.indexOf("// Insert", CREATE.indexOf('if (input.role === "mentor" && existingPerson)'))
  );

  it("keeps the backend block refusing the submission, and only tags it", () => {
    expect(block).toContain('.from("mentor_profiles")');
    expect(block).toContain('if ((mentorHistory ?? []).length > 0)');
    expect(block).toContain('code: "validation"');
    expect(block).toContain('reason: "returning_mentor"');
    expect(block).toContain("xác nhận/gia hạn Mentor Season 12");
    // Still fails closed when the history lookup cannot be trusted.
    expect(block).toContain("if (mentorHistoryErr)");
    expect(block).toContain('code: "db"');
  });

  it("carries the tag into the form state without widening what is disclosed", () => {
    expect(ACTION).toContain("errorKind: result.reason");
    // The tag is set only from a refusal this submission itself produced.
    expect(ACTION).not.toMatch(/errorKind:\s*"returning_mentor"/);
  });

  it("performs no client-side identity lookup to decide what to show", () => {
    const form = readFileSync("app/apply/_components/form-primitives.tsx", "utf8");
    expect(form).not.toContain("fetch(");
    expect(form).not.toContain("mentor_profiles");
    expect(form.includes("RETURNING_MENTOR_GUIDANCE")).toBe(true);
  });
});
