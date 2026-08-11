// @vitest-environment jsdom
/**
 * S12 final UAT blockers — browser-side contract.
 *
 * 1. CRITICAL regression guard: the form's `invalid` capture handler must not
 *    dispatch further `invalid` events. Before the fix, revealInvalid() called
 *    checkValidity(), which fires `invalid`, which re-entered revealInvalid()
 *    without bound and froze both public forms (and hung this suite).
 * 2. Phone must not silently truncate an over-length paste into a different,
 *    valid-looking number.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../app/apply/_components/submit-button", () => ({
  ApplySubmitButton: ({ idleLabel }: { idleLabel: string }) => <button type="submit">{idleLabel}</button>
}));
import {
  ApplicationForm,
  CheckboxGroupField,
  ConsentCheckbox,
  PhoneField,
  TextField
} from "../app/apply/_components/form-primitives";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

/**
 * Counts every `invalid` event in the document during one submit.
 *
 * The document-level capture listener runs before the form's capture listener,
 * so if the recursion is ever reintroduced this breaks the storm with
 * stopImmediatePropagation() and fails the assertion instead of hanging forever
 * on a synchronous spin that no test timeout can interrupt.
 */
const STORM_LIMIT = 200;
function withInvalidCounter<T>(body: (read: () => { count: number; stormed: boolean }) => T): T {
  let count = 0;
  let stormed = false;
  const guard = (event: Event) => {
    count += 1;
    if (count > STORM_LIMIT) {
      stormed = true;
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener("invalid", guard, true);
  try {
    return body(() => ({ count, stormed }));
  } finally {
    document.removeEventListener("invalid", guard, true);
  }
}

function renderForm() {
  return render(
    <ApplicationForm action={vi.fn()} state={{ ok: false, message: null }} submitLabel="Gửi đơn">
      <TextField name="full_name" label="Họ tên" required />
      <PhoneField name="phone_primary" label="Số điện thoại" required />
      <ConsentCheckbox name="consent_data_storage" label="Đồng ý lưu trữ dữ liệu" required />
    </ApplicationForm>
  );
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Gửi đơn" }));
const nameBox = () => screen.getByRole("textbox", { name: /Họ tên/ }) as HTMLInputElement;
const phoneBox = () => screen.getByRole("textbox", { name: /Số điện thoại/ }) as HTMLInputElement;
const consentBox = () => screen.getByRole("checkbox", { name: /Đồng ý lưu trữ/ }) as HTMLInputElement;

describe("S12 UAT — invalid-event recursion is fixed", () => {
  it("fires exactly one invalid event per invalid control and terminates", () => {
    withInvalidCounter((read) => {
      renderForm();
      submit();
      const { count, stormed } = read();
      expect(stormed).toBe(false);
      // Three invalid required controls => three events. Any recursion inflates this.
      expect(count).toBe(3);
    });
  });

  it("summarises every missing field and focuses the first invalid control", () => {
    renderForm();
    submit();
    expect(screen.getByText(/Bạn còn 3 mục bắt buộc/)).toBeTruthy();
    expect(document.activeElement).toBe(nameBox());
  });

  it("advances focus to the next invalid control on each subsequent submit", () => {
    withInvalidCounter((read) => {
      renderForm();

      submit();
      expect(document.activeElement).toBe(nameBox());

      fireEvent.change(nameBox(), { target: { value: "Nguyễn An" } });
      submit();
      expect(document.activeElement).toBe(phoneBox());

      fireEvent.change(phoneBox(), { target: { value: "0901234567" } });
      submit();
      expect(document.activeElement).toBe(consentBox());

      // Values entered earlier survive every failed submit.
      expect(nameBox().value).toBe("Nguyễn An");
      expect(phoneBox().value).toBe("0901234567");
      expect(screen.getByText(/Bạn còn 1 mục bắt buộc/)).toBeTruthy();
      expect(read().stormed).toBe(false);
    });
  });

  it("clears the summary once every control is valid", () => {
    renderForm();
    submit();
    expect(screen.getByText(/Bạn còn 3 mục bắt buộc/)).toBeTruthy();
    fireEvent.change(nameBox(), { target: { value: "Nguyễn An" } });
    fireEvent.change(phoneBox(), { target: { value: "0901234567" } });
    fireEvent.click(consentBox());
    submit();
    expect(screen.queryByText(/mục bắt buộc chưa hoàn thành/)).toBeNull();
  });
});

describe("S12 UAT — phone is never silently truncated", () => {
  it("carries no maxLength that could rewrite an over-length value", () => {
    render(<PhoneField name="phone_primary" label="Số điện thoại" required />);
    expect(phoneBox().hasAttribute("maxlength")).toBe(false);
    expect(phoneBox().getAttribute("pattern")).toBe("[0-9]{10}");
  });

  it("keeps a pasted 11-digit number intact and rejects it", () => {
    render(<PhoneField name="phone_primary" label="Số điện thoại" required />);
    fireEvent.change(phoneBox(), { target: { value: "09012345678" } });
    // The whole value survives — it must not become the valid-but-wrong "0901234567".
    expect(phoneBox().value).toBe("09012345678");
    expect(phoneBox().validity.valid).toBe(false);
    expect(phoneBox().validity.patternMismatch).toBe(true);
  });

  it.each([
    ["0901234567", true, "exactly 10 digits"],
    ["090123456", false, "9 digits"],
    ["09012345678", false, "11 digits"],
    ["09012abc67", false, "letters"],
    ["0901 23456", false, "spaces"]
  ])("browser validity for %s is %s (%s)", (value, expected) => {
    render(<PhoneField name="phone_primary" label="Số điện thoại" required />);
    fireEvent.change(phoneBox(), { target: { value } });
    expect(phoneBox().validity.valid).toBe(expected);
  });

  it("surfaces an over-length phone through the shared error summary", () => {
    withInvalidCounter((read) => {
      renderForm();
      fireEvent.change(nameBox(), { target: { value: "Nguyễn An" } });
      fireEvent.click(consentBox());
      fireEvent.change(phoneBox(), { target: { value: "09012345678" } });
      submit();
      expect(screen.getByText(/Bạn còn 1 mục bắt buộc/)).toBeTruthy();
      expect(document.activeElement).toBe(phoneBox());
      expect(read().stormed).toBe(false);
    });
  });
});

describe("S12 UAT — program default selection", () => {
  it("renders UEHM already checked without checking anything else", () => {
    render(
      <CheckboxGroupField
        name="programs_willing_to_join"
        label="Chương trình"
        required
        defaultSelected={["UEHM"]}
        options={[
          { value: "UEHM", label: "UEH Mentoring (ĐH Kinh tế TP.HCM)" },
          { value: "HAM", label: "Hanoi Alumni Mentoring" },
          { value: "BK", label: "BK Mentoring (Đại học Bách Khoa TP.HCM)" }
        ]}
      />
    );
    expect((screen.getByRole("checkbox", { name: /UEH Mentoring/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Hanoi Alumni/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /BK Mentoring/ }) as HTMLInputElement).checked).toBe(false);
  });
});
