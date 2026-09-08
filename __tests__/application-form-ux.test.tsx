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
  TextAreaField,
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

describe("do dai toi thieu duoc noi ro, theo thoi gian thuc", () => {
  /**
   * Truoc thay doi nay, muc toi thieu chi ton tai o hai noi: thuoc tinh
   * minLength ma trinh duyet chi noi ra khi da bam nop o cuoi mot form dai,
   * va mot cau trong dong chu thich xam. Ca hai deu khong noi CON THIEU BAO
   * NHIEU. Team van hanh xin mot bo dem hien ngay canh o.
   */
  const counter = (name: string) => document.querySelector('[data-testid="' + name + '-counter"]') as HTMLElement;

  it("dem tu 0 va noi con thieu bao nhieu ky tu", () => {
    render(<TextAreaField name="why_uem_text" label="Vi sao" required minLength={100} />);
    expect(counter("why_uem_text").dataset.met).toBe("false");
    expect(counter("why_uem_text").textContent).toBe("0/100 ký tự — còn thiếu 100");
  });

  it("cap nhat ngay khi go, khong cho toi luc bam nop", () => {
    render(<TextAreaField name="why_uem_text" label="Vi sao" required minLength={100} />);
    const box = document.querySelector('[name="why_uem_text"]') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "x".repeat(40) } });
    expect(counter("why_uem_text").textContent).toContain("40/100");
    expect(counter("why_uem_text").textContent).toContain("60");
    expect(counter("why_uem_text").dataset.met).toBe("false");

    fireEvent.change(box, { target: { value: "x".repeat(120) } });
    expect(counter("why_uem_text").dataset.met).toBe("true");
    expect(counter("why_uem_text").textContent).toContain("120");
  });

  it("dem cung don vi voi minLength cua chinh o do", () => {
    // Neu bo dem dem khac trinh duyet thi no se bao "da du" tren mot o ma
    // trinh duyet van tu choi - te hon la khong co bo dem nao.
    render(<TextAreaField name="why_uem_text" label="Vi sao" required minLength={5} />);
    const box = document.querySelector('[name="why_uem_text"]') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Cà phê" } });
    expect(counter("why_uem_text").dataset.met).toBe(String("Cà phê".length >= 5));
    expect(box.value.length).toBe("Cà phê".length);
  });

  it("khong hien bo dem o o khong co muc toi thieu", () => {
    render(<TextAreaField name="additional_notes" label="Ghi chu them" />);
    expect(counter("additional_notes")).toBeNull();
  });
});

describe("cau phai chep lai nguyen van", () => {
  const PHRASE = "Tôi cam kết đồng hành cùng Mentee trong suốt mùa mentoring.";

  it("hien noi bat va tach khoi dong chu thich xam", () => {
    render(
      <TextField
        name="MENTEE_ACTIVE_READING_V1"
        label="Vui long nhap lai cau duoi day"
        required
        repeatPhrase={PHRASE}
      />
    );
    const phrase = document.querySelector('[data-testid="MENTEE_ACTIVE_READING_V1-repeat-phrase"]') as HTMLElement;
    expect(phrase.textContent).toBe(PHRASE);
    // Mau do la yeu cau cua team van hanh; y nghia khong nam o mau nen cau
    // van duoc noi vao input qua aria-describedby ben duoi.
    expect(phrase.className).toContain("border-red-400");
    expect(phrase.className).toContain("text-red-800");
  });

  it("duoc tro den tu chinh o nhap, khong chi nam canh no", () => {
    render(
      <TextField
        name="MENTEE_ACTIVE_READING_V1"
        label="Vui long nhap lai cau duoi day"
        required
        repeatPhrase={PHRASE}
      />
    );
    const box = document.querySelector('[name="MENTEE_ACTIVE_READING_V1"]') as HTMLInputElement;
    expect(box.getAttribute("aria-describedby")).toBe("MENTEE_ACTIVE_READING_V1-phrase");
  });

  it("o khong co cau chep lai thi khong sinh khoi do rong", () => {
    render(<TextField name="full_name" label="Ho va ten" required />);
    expect(document.querySelector('[data-testid="full_name-repeat-phrase"]')).toBeNull();
    expect(document.querySelector('[name="full_name"]')!.getAttribute("aria-describedby")).toBeNull();
  });
});
