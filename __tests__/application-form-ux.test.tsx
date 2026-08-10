// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../app/apply/_components/submit-button", () => ({
  ApplySubmitButton: ({ idleLabel }: { idleLabel: string }) => <button type="submit">{idleLabel}</button>
}));
import {
  ApplicationForm,
  CheckboxGroupField,
  ConsentCheckbox,
  TextField
} from "../app/apply/_components/form-primitives";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("application required and error-navigation UX", () => {
  it("marks required fields visibly, leaves optional fields unmarked, and acknowledgements unchecked", () => {
    render(<>
      <TextField name="required_name" label="Họ tên" required />
      <TextField name="optional_note" label="Ghi chú" />
      <ConsentCheckbox name="commitment" label="Cam kết" required />
    </>);
    expect(within(screen.getByText("Họ tên").closest("div")!).getByText("Bắt buộc")).toBeTruthy();
    expect(within(screen.getByText("Ghi chú").closest("div")!).queryByText("Bắt buộc")).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("summarizes missing items, focuses the first invalid field in order, and preserves typed data", () => {
    render(
      <ApplicationForm action={vi.fn()} state={{ ok: false, message: null }} submitLabel="Gửi đơn">
        <TextField name="full_name" label="Họ tên" required />
        <ConsentCheckbox name="consent_data_storage" label="Đồng ý lưu trữ dữ liệu" required />
        <CheckboxGroupField name="email_notification_consent" label="Kênh nhận thông báo" required options={[{ value: "email", label: "Email" }]} />
        <CheckboxGroupField name="available_for_interview" label="Lịch phỏng vấn" required options={[{ value: "week_1", label: "Tuần 1" }]} />
      </ApplicationForm>
    );
    const name = screen.getByRole("textbox", { name: /Họ tên/ });
    fireEvent.change(name, { target: { value: "Nguyễn An" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi đơn" }));
    expect(screen.getByText(/Bạn còn 3 mục bắt buộc/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /Đồng ý lưu trữ/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: /Đồng ý lưu trữ/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi đơn" }));
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Email" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Email" }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi đơn" }));
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Tuần 1" }));
    expect((name as HTMLInputElement).value).toBe("Nguyễn An");
    expect(screen.getAllByText("Lịch phỏng vấn").length).toBeGreaterThanOrEqual(2);
  });

  it("blocks a fourth choice and conditionally requires the Other explanation", () => {
    render(<CheckboxGroupField
      name="target_soft_skills"
      label="Soft skills"
      maxSelections={3}
      options={[
        { value: "communication", label: "Communication" },
        { value: "leadership", label: "Leadership" },
        { value: "other", label: "Khác" },
        { value: "negotiation", label: "Negotiation" }
      ]}
      otherInput={{ name: "target_soft_skills_other", label: "Vui lòng ghi rõ kỹ năng/lĩnh vực khác" }}
    />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Communication" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Leadership" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Khác" }));
    expect((screen.getByRole("textbox", { name: /Vui lòng ghi rõ/ }) as HTMLInputElement).required).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Negotiation" }));
    expect((screen.getByRole("checkbox", { name: "Negotiation" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Bạn chỉ có thể chọn tối đa 3 lựa chọn.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Khác" }));
    expect(screen.queryByRole("textbox", { name: /Vui lòng ghi rõ/ })).toBeNull();
  });
});
