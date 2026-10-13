/** @vitest-environment jsdom */
/**
 * __tests__/form-gia-han-gop-y-btc.test.tsx
 *
 * Bốn điều BTC góp ý về form mentor ngày 11/10/2026:
 *
 *   1. chọn được nhiều lĩnh vực có thể mentoring;
 *   2. số năm kinh nghiệm không dừng ở 20;
 *   3. bấm nút gửi khi còn thiếu thì liệt kê NGAY tại nút đó mọi mục còn thiếu;
 *   4. gửi chưa được thì những gì đã điền vẫn còn.
 *
 * 13/10/2026 — gia hạn chuyển sang "một nút" (gia-han-mot-nut.test.tsx): form gia hạn
 * không còn ô bắt buộc nào, và các ô hồ sơ chỉ có mặt khi mentor mở phần cập nhật. Vì thế:
 *   - điều 1, 2, 4 vẫn soi trên form gia hạn, sau khi mở phần cập nhật;
 *   - điều 3 không còn chỗ đứng trên form gia hạn (không có gì để thiếu), nhưng cơ chế đó
 *     — missing-fields.tsx — vẫn chạy trên form đăng ký mentor/mentee. Các ca của nó được
 *     giữ nguyên ý, dựng trên chính các ô dùng chung của form đăng ký.
 *
 * Form được dựng thật (không quét mã nguồn): điều người dùng gặp là hành vi của trình
 * duyệt trên chính các ô này, và một chuỗi có mặt trong file không chứng minh được điều đó.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ ok: false, message: "" }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("@/app/actions/renewals", () => ({ acceptRenewalAction: vi.fn(), declineRenewalAction: vi.fn() }));
vi.mock("@/app/apply/_components/submit-button", () => ({
  ApplySubmitButton: ({ idleLabel }: { idleLabel: string }) => <button type="submit">{idleLabel}</button>
}));

import { ApplicationForm, RadioGroupField, TextField } from "@/app/apply/_components/form-primitives";
import { RenewalForm } from "@/app/renew/[token]/renewal-form";
import { RENEWAL_ONE_CLICK_BUTTON } from "@/lib/renewal-one-click-core";
import { RENEWAL_MAX_EXPERIENCE_YEARS, type RenewalPublicDisplayDto } from "@/lib/renewal-types";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const EMPTY: RenewalPublicDisplayDto = {
  fullName: "Mentor Thử Nghiệm",
  emailPrimary: null,
  phonePrimary: null,
  mentorCode: null,
  firstVamSeason: null,
  companyCurrent: null,
  titleCurrent: null,
  yearsExperienceMin: null,
  yearsExperienceText: null,
  capacityTarget: null,
  industry: null,
  functionArea: null
};
const PREFILLED: RenewalPublicDisplayDto = {
  ...EMPTY,
  companyCurrent: "Công ty Thử Nghiệm",
  titleCurrent: "Giám đốc",
  yearsExperienceMin: 22,
  industry: "education",
  functionArea: "strategy_consulting"
};

/** Dựng form gia hạn và MỞ phần cập nhật hồ sơ — nơi các ô của điều 1, 2, 4 nằm. */
function renderUpdating(display: RenewalPublicDisplayDto = EMPTY) {
  const view = render(<RenewalForm token="token-thu-nghiem" display={display} />);
  const submitButton = screen.getByRole("button", { name: RENEWAL_ONE_CLICK_BUTTON });
  const form = submitButton.closest("form") as HTMLFormElement;
  fireEvent.click(screen.getByRole("button", { name: /Cập nhật hồ sơ hoặc nhắn Ban Tổ chức/ }));
  return { ...view, form, submitButton };
}

const control = <T extends HTMLElement = HTMLInputElement>(form: HTMLFormElement, name: string) =>
  form.querySelector(`[name="${name}"]`) as T;
const wrapper = (form: HTMLFormElement, name: string) =>
  Array.from(form.querySelectorAll<HTMLElement>("[data-field-name]")).find((node) => node.dataset.fieldName === name) as HTMLElement;
const summary = () => screen.queryByTestId("missing-fields-summary");
const summaryItems = () => within(summary() as HTMLElement).getAllByRole("listitem").map((item) => item.textContent);
const secondaryBox = (form: HTMLFormElement, value: string) =>
  form.querySelector(`input[name="secondary_industries_functions"][value="${value}"]`) as HTMLInputElement;

describe("1. chọn được nhiều lĩnh vực có thể mentoring", () => {
  it("ngành và chức năng CHÍNH vẫn chỉ chọn 1; lĩnh vực chọn thêm là một nhóm ô tick riêng", () => {
    const { form } = renderUpdating();
    expect(control(form, "industry_primary").tagName).toBe("SELECT");
    expect(control(form, "function_primary").tagName).toBe("SELECT");

    const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="secondary_industries_functions"]'));
    expect(boxes.every((box) => box.type === "checkbox")).toBe(true);
    // 13 ngành + 13 chức năng, "Khác" chỉ hiện một lần.
    expect(boxes).toHaveLength(25);
    expect(boxes.filter((box) => box.value === "other")).toHaveLength(1);
    expect(boxes.some((box) => box.required)).toBe(false);
  });

  it("tick được ba lĩnh vực cùng lúc, gồm cả ngành lẫn chức năng", () => {
    const { form } = renderUpdating();
    for (const value of ["fmcg", "marketing", "data_analytics"]) fireEvent.click(secondaryBox(form, value));

    expect(new FormData(form).getAll("secondary_industries_functions")).toEqual(["fmcg", "marketing", "data_analytics"]);
  });

  it("lĩnh vực thứ tư, thứ năm vẫn tick được: không còn trần 3 (BTC 13/10/2026)", () => {
    const { form } = renderUpdating();
    const five = ["fmcg", "marketing", "data_analytics", "tech", "product"];
    for (const value of five) fireEvent.click(secondaryBox(form, value));

    expect(five.every((value) => secondaryBox(form, value).checked)).toBe(true);
    // FormData theo thứ tự ô trên form, không theo thứ tự bấm — so theo tập hợp.
    expect(new FormData(form).getAll("secondary_industries_functions").map(String).sort()).toEqual([...five].sort());
    const group = wrapper(form, "secondary_industries_functions").textContent ?? "";
    expect(group).not.toContain("tối đa");
    expect(group).not.toMatch(/\d+\/\d+ đã chọn/);
  });

  it("chọn 'Khác' thì hiện ô ghi rõ; bỏ chọn thì ô đó biến mất", () => {
    const { form } = renderUpdating();
    expect(control(form, "secondary_industries_functions_other")).toBeNull();

    fireEvent.click(secondaryBox(form, "other"));
    expect(control(form, "secondary_industries_functions_other")).not.toBeNull();

    fireEvent.click(secondaryBox(form, "other"));
    expect(control(form, "secondary_industries_functions_other")).toBeNull();
  });
});

describe("2. số năm kinh nghiệm không dừng ở 20", () => {
  it("là một ô nhập số, không còn là danh sách chọn — và không bắt buộc", () => {
    const { form } = renderUpdating();
    const years = control(form, "mentor_total_work_years");

    expect(years.tagName).toBe("INPUT");
    expect(years.getAttribute("type")).toBe("number");
    expect(form.querySelector('select[name="mentor_total_work_years"]')).toBeNull();
    // Gia hạn một nút: để trống là giữ số năm trong hồ sơ.
    expect(years.required).toBe(false);
    expect(years.getAttribute("min")).toBe("0");
    expect(years.getAttribute("max")).toBe(String(RENEWAL_MAX_EXPERIENCE_YEARS));
    expect(years.getAttribute("step")).toBe("1");
  });

  it.each(["21", "35", "50", String(RENEWAL_MAX_EXPERIENCE_YEARS)])("nhận %s năm", (value) => {
    const { form } = renderUpdating();
    const years = control(form, "mentor_total_work_years");
    fireEvent.change(years, { target: { value } });
    expect(years.value).toBe(value);
    expect(years.validity.valid).toBe(true);
  });

  it.each([String(RENEWAL_MAX_EXPERIENCE_YEARS + 1), "-1", "2.5"])("vẫn chặn giá trị vô lý %s", (value) => {
    const { form } = renderUpdating();
    const years = control(form, "mentor_total_work_years");
    fireEvent.change(years, { target: { value } });
    expect(years.validity.valid).toBe(false);
  });

  it("điền sẵn số năm đã có trong hồ sơ, kể cả khi lớn hơn 20", () => {
    const { form } = renderUpdating(PREFILLED);
    expect(control(form, "mentor_total_work_years").value).toBe("22");
  });

  it("hồ sơ chưa có số năm thì ô để trống, không tự thành 0", () => {
    const { form } = renderUpdating();
    expect(control(form, "mentor_total_work_years").value).toBe("");
  });
});

// Cơ chế "mục chưa hoàn thành" (missing-fields.tsx), dựng trên các ô dùng chung của form
// đăng ký — nơi nó còn chạy. Trước 13/10 các ca này dựng trên form gia hạn.
describe("3. bấm nút gửi khi còn thiếu: liệt kê mọi mục còn thiếu ngay tại nút", () => {
  function renderApply(defaults: { fullName?: string } = {}) {
    render(
      <ApplicationForm action={vi.fn()} state={{ ok: false, message: null }} submitLabel="Gửi đơn thử">
        <TextField name="full_name" label="Họ tên" required defaultValue={defaults.fullName} />
        <TextField name="company_current" label="Công ty / Tổ chức hiện tại" required />
        <TextField name="nickname" label="Tên thường gọi" />
        <RadioGroupField
          name="can_attend_orientation"
          label="Sẵn sàng tham gia orientation"
          required
          options={[
            { value: "yes", label: "Có" },
            { value: "maybe", label: "Chưa chắc" },
            { value: "no", label: "Không" }
          ]}
        />
      </ApplicationForm>
    );
    const submitButton = screen.getByRole("button", { name: "Gửi đơn thử" });
    return { form: submitButton.closest("form") as HTMLFormElement, submitButton };
  }
  const ALL = ["Họ tên", "Công ty / Tổ chức hiện tại", "Sẵn sàng tham gia orientation"];

  it("chưa bấm gì thì không có danh sách nào", () => {
    renderApply();
    expect(summary()).toBeNull();
  });

  it("form trống: đủ mọi mục bắt buộc, theo đúng thứ tự trên form, gọi bằng tên người đọc hiểu", () => {
    const { form, submitButton } = renderApply();
    fireEvent.click(submitButton);

    expect(summaryItems()).toEqual(ALL);
    // Thứ tự trong danh sách là thứ tự các ô xuất hiện trên form, đọc thẳng từ DOM.
    const domOrder = Array.from(form.querySelectorAll<HTMLElement>("[data-field-name][data-invalid='true']")).map(
      (node) => node.dataset.fieldLabel
    );
    expect(summaryItems()).toEqual(domOrder);
    expect((summary() as HTMLElement).textContent).toContain(`Bạn còn ${ALL.length} mục bắt buộc chưa hoàn thành.`);
    // Ô không bắt buộc không bao giờ bị kể.
    expect(summaryItems()).not.toContain("Tên thường gọi");
    // Không một ô nào lọt ra bằng tên kỹ thuật.
    for (const item of summaryItems()) expect(item).not.toMatch(/^[a-z0-9_]+$/);
  });

  it("danh sách nằm trong chính form đó, sau ô bắt buộc cuối cùng và ngay trước nút gửi", () => {
    const { form, submitButton } = renderApply();
    fireEvent.click(submitButton);

    const box = summary() as HTMLElement;
    expect(form.contains(box)).toBe(true);
    const lastField = wrapper(form, "can_attend_orientation");
    expect(lastField.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(submitButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.getAttribute("role")).toBe("alert");
  });

  it("ô đã điền sẵn: chỉ kể những mục thật sự còn thiếu", () => {
    const { submitButton } = renderApply({ fullName: "Nguyễn Văn A" });
    fireEvent.click(submitButton);
    expect(summaryItems()).toEqual(ALL.filter((item) => item !== "Họ tên"));
  });

  it("tô đỏ từng ô còn thiếu và đưa con trỏ tới ô thiếu đầu tiên", () => {
    const { form, submitButton } = renderApply({ fullName: "Nguyễn Văn A" });
    fireEvent.click(submitButton);

    expect(wrapper(form, "company_current").getAttribute("data-invalid")).toBe("true");
    expect(control(form, "company_current").getAttribute("aria-invalid")).toBe("true");
    // Ô đã có giá trị không bị tô.
    expect(wrapper(form, "full_name").hasAttribute("data-invalid")).toBe(false);
    expect(document.activeElement).toBe(control(form, "company_current"));
  });

  it("sửa một ô thì dấu đỏ của ô đó gỡ ngay, ô khác giữ nguyên", () => {
    const { form, submitButton } = renderApply();
    fireEvent.click(submitButton);

    fireEvent.change(control(form, "company_current"), { target: { value: "Công ty A" } });

    expect(wrapper(form, "company_current").hasAttribute("data-invalid")).toBe(false);
    expect(control(form, "company_current").hasAttribute("aria-invalid")).toBe(false);
    expect(wrapper(form, "full_name").getAttribute("data-invalid")).toBe("true");
  });

  it("bấm lại sau khi điền bớt: danh sách ngắn đi đúng những mục vừa điền", () => {
    const { form, submitButton } = renderApply();
    fireEvent.click(submitButton);
    expect(summaryItems()).toEqual(ALL);

    fireEvent.change(control(form, "full_name"), { target: { value: "Nguyễn Văn A" } });
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(submitButton);

    expect(summaryItems()).toEqual(["Công ty / Tổ chức hiện tại"]);
  });

  it("điền đủ rồi bấm: danh sách biến mất", () => {
    const { form, submitButton } = renderApply();
    fireEvent.click(submitButton);
    expect(summary()).not.toBeNull();

    fireEvent.change(control(form, "full_name"), { target: { value: "Nguyễn Văn A" } });
    fireEvent.change(control(form, "company_current"), { target: { value: "Công ty A" } });
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(submitButton);

    expect(summary()).toBeNull();
  });

  it("ô được điền mà không phát sự kiện (trình duyệt tự điền): bấm lại thì dấu đỏ cũ được dọn", () => {
    const { form, submitButton } = renderApply();
    fireEvent.click(submitButton);
    expect(wrapper(form, "company_current").getAttribute("data-invalid")).toBe("true");

    // Gán thẳng giá trị, KHÔNG fireEvent: không có sự kiện change nào để gỡ dấu đỏ tại chỗ.
    control(form, "company_current").value = "Công ty tự điền";
    fireEvent.click(submitButton);

    expect(wrapper(form, "company_current").hasAttribute("data-invalid")).toBe(false);
    expect(control(form, "company_current").hasAttribute("aria-invalid")).toBe(false);
    expect(summaryItems()).not.toContain("Công ty / Tổ chức hiện tại");
    // Ô vẫn còn thiếu thì vẫn đỏ.
    expect(wrapper(form, "full_name").getAttribute("data-invalid")).toBe("true");
  });

  it("nhóm ô chọn một (radio) chưa chọn gì chỉ hiện MỘT dòng, dù trình duyệt báo sai ở từng ô", () => {
    const { submitButton } = renderApply({ fullName: "Nguyễn Văn A" });
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    // Điều kiện của ca này: cả ba ô đều bị trình duyệt coi là chưa hợp lệ.
    expect(radios.filter((radio) => !radio.validity.valid)).toHaveLength(3);

    fireEvent.click(submitButton);

    expect(summaryItems().filter((item) => item === "Sẵn sàng tham gia orientation")).toHaveLength(1);
  });

  it("form gia hạn một nút không có gì để thiếu: bấm nút không bao giờ sinh danh sách", () => {
    render(<RenewalForm token="token-thu-nghiem" display={EMPTY} />);
    fireEvent.click(screen.getByRole("button", { name: RENEWAL_ONE_CLICK_BUTTON }));
    expect(summary()).toBeNull();
    expect(document.querySelectorAll("[data-invalid='true']")).toHaveLength(0);
  });
});

describe("4. gửi chưa được thì những gì đã điền vẫn còn", () => {
  it("form bị reset sau khi máy chủ từ chối: mọi ô giữ nguyên, kể cả số mentee, số năm và lĩnh vực chọn thêm", () => {
    const { form } = renderUpdating();
    fireEvent.click(form.querySelector('input[name="mentoring_capacity_total"][value="3"]') as HTMLInputElement);
    fireEvent.change(control(form, "company_current"), { target: { value: "Công ty A" } });
    fireEvent.change(control(form, "title_current"), { target: { value: "Trưởng phòng" } });
    fireEvent.change(control(form, "mentor_total_work_years"), { target: { value: "35" } });
    fireEvent.change(control(form, "mentor_people_management_years"), { target: { value: "12" } });
    fireEvent.change(control(form, "industry_primary"), { target: { value: "education" } });
    for (const value of ["fmcg", "marketing"]) fireEvent.click(secondaryBox(form, value));
    fireEvent.change(control<HTMLTextAreaElement>(form, "mentoring_topics"), { target: { value: "Định hướng nghề nghiệp" } });

    // Đúng việc React làm sau MỌI server action, kể cả action trả lỗi.
    form.reset();

    expect(control(form, "company_current").value).toBe("Công ty A");
    expect(control(form, "title_current").value).toBe("Trưởng phòng");
    expect(control(form, "mentor_total_work_years").value).toBe("35");
    expect(control(form, "mentor_people_management_years").value).toBe("12");
    expect(control<HTMLSelectElement>(form, "industry_primary").value).toBe("education");
    expect(control<HTMLTextAreaElement>(form, "mentoring_topics").value).toBe("Định hướng nghề nghiệp");
    expect(new FormData(form).get("mentoring_capacity_total")).toBe("3");
    expect(new FormData(form).getAll("secondary_industries_functions")).toEqual(["fmcg", "marketing"]);
    // Phần cập nhật vẫn đang mở: người dùng không phải mở lại để tìm chỗ sai.
    expect(screen.getByTestId("renewal-profile-update")).toBeTruthy();
  });
});
