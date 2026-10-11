/** @vitest-environment jsdom */
/**
 * __tests__/form-gia-han-gop-y-btc.test.tsx
 *
 * Bốn điều BTC góp ý về form mentor ngày 11/10/2026, soi trên form GIA HẠN — nơi cả bốn
 * thật sự còn thiếu (form đăng ký mentor mới đã có sẵn, xem application-form-ux.test.tsx):
 *
 *   1. chọn được nhiều lĩnh vực có thể mentoring;
 *   2. số năm kinh nghiệm không dừng ở 20;
 *   3. bấm "Xác nhận tiếp tục" khi còn thiếu thì liệt kê NGAY tại nút đó mọi mục còn thiếu;
 *   4. gửi chưa được thì những gì đã điền vẫn còn.
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
import { ACTIVE_READING_KEYS, CONFIRMATION_PHRASES, requiredCheckboxAcknowledgements } from "@/lib/application-commitments";
import { RENEWAL_MAX_EXPERIENCE_YEARS, RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD, type RenewalPublicDisplayDto } from "@/lib/renewal-types";

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

const ACKS = requiredCheckboxAcknowledgements("mentor");

function renderForm(display: RenewalPublicDisplayDto = EMPTY) {
  const view = render(<RenewalForm token="token-thu-nghiem" display={display} />);
  const submitButton = screen.getByRole("button", { name: "Xác nhận tiếp tục" });
  const form = submitButton.closest("form") as HTMLFormElement;
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

/** Điền mọi ô bắt buộc cho tới khi trình duyệt coi form là hợp lệ. */
function fillEverything(form: HTMLFormElement) {
  fireEvent.click(control(form, "participation_confirmed"));
  fireEvent.change(control(form, "company_current"), { target: { value: "Công ty A" } });
  fireEvent.change(control(form, "title_current"), { target: { value: "Trưởng phòng" } });
  fireEvent.change(control(form, "mentor_total_work_years"), { target: { value: "35" } });
  fireEvent.change(control(form, "industry_primary"), { target: { value: "education" } });
  fireEvent.change(control(form, "function_primary"), { target: { value: "product" } });
  fireEvent.change(control(form, "mentor_people_management_years"), { target: { value: "12" } });
  fireEvent.change(control(form, "university"), { target: { value: "UEH" } });
  for (const entry of ACKS) fireEvent.click(control(form, entry.key));
  fireEvent.change(control(form, ACTIVE_READING_KEYS.mentor), { target: { value: CONFIRMATION_PHRASES.mentor } });
  fireEvent.click(control(form, "consent_data_storage"));
  fireEvent.click(control(form, RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD));
}

describe("3. bấm Xác nhận khi còn thiếu: liệt kê mọi mục còn thiếu ngay tại nút", () => {
  const EXPECTED_WHEN_EMPTY = [
    "Xác nhận tiếp tục tham gia Season 12",
    "Công ty / Tổ chức hiện tại",
    "Chức danh / Vị trí hiện tại",
    "Ngành nghề chính",
    "Chức năng / chuyên môn chính",
    "Số năm kinh nghiệm",
    "Số năm kinh nghiệm quản lý con người / đội ngũ",
    "Trường đại học đã tốt nghiệp",
    // Form xếp các cam kết chung trước, nhóm "ranh giới nghề nghiệp, an toàn" sau.
    ...ACKS.filter((entry) => entry.category !== "professional_safety").map((entry) => entry.wording),
    ...ACKS.filter((entry) => entry.category === "professional_safety").map((entry) => entry.wording),
    "Nhập lại câu xác nhận đã đọc và hiểu các nguyên tắc chính",
    "Quyền riêng tư: đồng ý lưu trữ và sử dụng dữ liệu cho Season 12",
    "Xác nhận rà soát hồ sơ"
  ];

  it("chưa bấm gì thì không có danh sách nào", () => {
    renderForm();
    expect(summary()).toBeNull();
  });

  it("form trống: đủ mọi mục bắt buộc, theo đúng thứ tự trên form, gọi bằng tên người đọc hiểu", () => {
    const { form, submitButton } = renderForm();
    fireEvent.click(submitButton);

    expect(summaryItems()).toEqual(EXPECTED_WHEN_EMPTY);
    // Thứ tự trong danh sách là thứ tự các ô xuất hiện trên form, đọc thẳng từ DOM.
    const domOrder = Array.from(form.querySelectorAll<HTMLElement>("[data-field-name][data-invalid='true']")).map(
      (node) => node.dataset.fieldLabel
    );
    expect(summaryItems()).toEqual(domOrder);
    expect((summary() as HTMLElement).textContent).toContain(`Bạn còn ${EXPECTED_WHEN_EMPTY.length} mục bắt buộc chưa hoàn thành.`);
    // Không một ô nào lọt ra bằng tên kỹ thuật: mỗi ô bắt buộc đều đã có nhãn.
    for (const item of summaryItems()) expect(item).not.toMatch(/^[a-z0-9_]+$|_V\d+$/);
  });

  it("danh sách nằm trong chính form đó, ngay trước nút Xác nhận tiếp tục", () => {
    const { form, submitButton } = renderForm();
    fireEvent.click(submitButton);

    const box = summary() as HTMLElement;
    expect(form.contains(box)).toBe(true);
    // Sau ô bắt buộc cuối cùng, trước nút.
    const lastField = control(form, RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD);
    expect(lastField.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(submitButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.getAttribute("role")).toBe("alert");
  });

  it("hồ sơ đã điền sẵn: chỉ kể những mục thật sự còn thiếu", () => {
    const { submitButton } = renderForm(PREFILLED);
    fireEvent.click(submitButton);

    const items = summaryItems();
    for (const filled of ["Công ty / Tổ chức hiện tại", "Chức danh / Vị trí hiện tại", "Số năm kinh nghiệm", "Ngành nghề chính", "Chức năng / chuyên môn chính"]) {
      expect(items).not.toContain(filled);
    }
    expect(items).toContain("Số năm kinh nghiệm quản lý con người / đội ngũ");
    expect(items).toHaveLength(EXPECTED_WHEN_EMPTY.length - 5);
  });

  it("tô đỏ từng ô còn thiếu và đưa con trỏ tới ô thiếu đầu tiên", () => {
    const { form, submitButton } = renderForm(PREFILLED);
    fireEvent.click(submitButton);

    expect(wrapper(form, "mentor_people_management_years").getAttribute("data-invalid")).toBe("true");
    expect(control(form, "mentor_people_management_years").getAttribute("aria-invalid")).toBe("true");
    // Ô đã có giá trị không bị tô.
    expect(wrapper(form, "company_current").hasAttribute("data-invalid")).toBe(false);
    expect(document.activeElement).toBe(control(form, "participation_confirmed"));
  });

  it("sửa một ô thì dấu đỏ của ô đó gỡ ngay, ô khác giữ nguyên", () => {
    const { form, submitButton } = renderForm(PREFILLED);
    fireEvent.click(submitButton);

    fireEvent.change(control(form, "mentor_people_management_years"), { target: { value: "5" } });

    expect(wrapper(form, "mentor_people_management_years").hasAttribute("data-invalid")).toBe(false);
    expect(control(form, "mentor_people_management_years").hasAttribute("aria-invalid")).toBe(false);
    expect(wrapper(form, "university").getAttribute("data-invalid")).toBe("true");
  });

  it("bấm lại sau khi điền bớt: danh sách ngắn đi đúng những mục vừa điền", () => {
    const { form, submitButton } = renderForm(PREFILLED);
    fireEvent.click(submitButton);
    const before = summaryItems();

    fireEvent.click(control(form, "participation_confirmed"));
    fireEvent.change(control(form, "university"), { target: { value: "UEH" } });
    fireEvent.click(submitButton);

    expect(summaryItems()).toEqual(
      before.filter((item) => item !== "Xác nhận tiếp tục tham gia Season 12" && item !== "Trường đại học đã tốt nghiệp")
    );
  });

  it("gõ câu xác nhận chưa khớp cũng được kể là còn thiếu", () => {
    const { form, submitButton } = renderForm();
    fillEverything(form);
    fireEvent.change(control(form, ACTIVE_READING_KEYS.mentor), { target: { value: "tôi đồng ý" } });
    fireEvent.click(submitButton);

    expect(summaryItems()).toEqual(["Nhập lại câu xác nhận đã đọc và hiểu các nguyên tắc chính"]);
  });

  it("điền đủ rồi bấm: danh sách biến mất", () => {
    const { form, submitButton } = renderForm();
    fireEvent.click(submitButton);
    expect(summary()).not.toBeNull();

    fillEverything(form);
    fireEvent.click(submitButton);

    expect(summary()).toBeNull();
  });

  it("chọn 'Khác' mà chưa ghi rõ thì ô ghi rõ cũng nằm trong danh sách", () => {
    const { form, submitButton } = renderForm();
    fillEverything(form);
    fireEvent.change(control(form, "industry_primary"), { target: { value: "other" } });
    fireEvent.click(secondaryBox(form, "other"));
    fireEvent.click(submitButton);

    expect(summaryItems()).toEqual(["Ghi rõ ngành nghề chính", "Vui lòng ghi rõ kỹ năng/lĩnh vực khác"]);
  });

  it("ô được điền mà không phát sự kiện (trình duyệt tự điền): bấm lại thì dấu đỏ cũ được dọn", () => {
    const { form, submitButton } = renderForm();
    fireEvent.click(submitButton);
    expect(wrapper(form, "company_current").getAttribute("data-invalid")).toBe("true");

    // Gán thẳng giá trị, KHÔNG fireEvent: không có sự kiện change nào để gỡ dấu đỏ tại chỗ.
    control(form, "company_current").value = "Công ty tự điền";
    fireEvent.click(submitButton);

    expect(wrapper(form, "company_current").hasAttribute("data-invalid")).toBe(false);
    expect(control(form, "company_current").hasAttribute("aria-invalid")).toBe(false);
    expect(summaryItems()).not.toContain("Công ty / Tổ chức hiện tại");
    // Ô vẫn còn thiếu thì vẫn đỏ.
    expect(wrapper(form, "title_current").getAttribute("data-invalid")).toBe("true");
  });

  it("form 'không tiếp tục' không dính vào danh sách của form xác nhận", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận tiếp tục" }));
    const declineForm = screen.getByRole("button", { name: "Xác nhận không tiếp tục" }).closest("form") as HTMLFormElement;
    expect(declineForm.contains(summary())).toBe(false);
    expect(declineForm.querySelector("[data-testid='missing-fields-summary']")).toBeNull();
  });
});

describe("phần dùng chung với form đăng ký: một nhóm ô là một dòng", () => {
  it("nhóm ô chọn một (radio) chưa chọn gì chỉ hiện MỘT dòng, dù trình duyệt báo sai ở từng ô", () => {
    render(
      <ApplicationForm action={vi.fn()} state={{ ok: false, message: null }} submitLabel="Gửi đơn thử">
        <TextField name="full_name" label="Họ tên" required />
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
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    // Điều kiện của ca này: cả ba ô đều bị trình duyệt coi là chưa hợp lệ.
    expect(radios.filter((radio) => !radio.validity.valid)).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Gửi đơn thử" }));

    expect(summaryItems()).toEqual(["Họ tên", "Sẵn sàng tham gia orientation"]);
    expect((summary() as HTMLElement).textContent).toContain("Bạn còn 2 mục bắt buộc chưa hoàn thành.");
  });
});

describe("2. số năm kinh nghiệm không dừng ở 20", () => {
  it("là một ô nhập số, không còn là danh sách chọn", () => {
    const { form } = renderForm();
    const years = control(form, "mentor_total_work_years");

    expect(years.tagName).toBe("INPUT");
    expect(years.getAttribute("type")).toBe("number");
    expect(form.querySelector('select[name="mentor_total_work_years"]')).toBeNull();
    expect(years.required).toBe(true);
    expect(years.getAttribute("min")).toBe("0");
    expect(years.getAttribute("max")).toBe(String(RENEWAL_MAX_EXPERIENCE_YEARS));
    expect(years.getAttribute("step")).toBe("1");
  });

  it.each(["21", "35", "50", String(RENEWAL_MAX_EXPERIENCE_YEARS)])("nhận %s năm", (value) => {
    const { form } = renderForm();
    const years = control(form, "mentor_total_work_years");
    fireEvent.change(years, { target: { value } });
    expect(years.value).toBe(value);
    expect(years.validity.valid).toBe(true);
  });

  it.each([String(RENEWAL_MAX_EXPERIENCE_YEARS + 1), "-1", "2.5"])("vẫn chặn giá trị vô lý %s", (value) => {
    const { form } = renderForm();
    const years = control(form, "mentor_total_work_years");
    fireEvent.change(years, { target: { value } });
    expect(years.validity.valid).toBe(false);
  });

  it("điền sẵn số năm đã có trong hồ sơ, kể cả khi lớn hơn 20", () => {
    const { form } = renderForm(PREFILLED);
    expect(control(form, "mentor_total_work_years").value).toBe("22");
  });

  it("hồ sơ chưa có số năm thì ô để trống, không tự thành 0", () => {
    const { form } = renderForm();
    expect(control(form, "mentor_total_work_years").value).toBe("");
  });
});

describe("1. chọn được nhiều lĩnh vực có thể mentoring", () => {
  it("ngành và chức năng CHÍNH vẫn chỉ chọn 1; lĩnh vực chọn thêm là một nhóm ô tick riêng", () => {
    const { form } = renderForm();
    expect(control(form, "industry_primary").tagName).toBe("SELECT");
    expect(control(form, "function_primary").tagName).toBe("SELECT");

    const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="secondary_industries_functions"]'));
    expect(boxes.every((box) => box.type === "checkbox")).toBe(true);
    // 13 ngành + 13 chức năng, "Khác" chỉ hiện một lần.
    expect(boxes).toHaveLength(25);
    expect(boxes.filter((box) => box.value === "other")).toHaveLength(1);
    // Không bắt buộc: form trống không kể mục này là còn thiếu.
    expect(boxes.some((box) => box.required)).toBe(false);
  });

  it("tick được ba lĩnh vực cùng lúc, gồm cả ngành lẫn chức năng", () => {
    const { form } = renderForm();
    for (const value of ["fmcg", "marketing", "data_analytics"]) fireEvent.click(secondaryBox(form, value));

    const sent = new FormData(form).getAll("secondary_industries_functions");
    expect(sent).toEqual(["fmcg", "marketing", "data_analytics"]);
    expect(wrapper(form, "secondary_industries_functions").textContent).toContain("3/3 đã chọn");
  });

  it("lĩnh vực thứ tư bị chặn và nói rõ lý do", () => {
    const { form } = renderForm();
    for (const value of ["fmcg", "marketing", "data_analytics", "tech"]) fireEvent.click(secondaryBox(form, value));

    expect(secondaryBox(form, "tech").checked).toBe(false);
    expect(new FormData(form).getAll("secondary_industries_functions")).toEqual(["fmcg", "marketing", "data_analytics"]);
    expect(wrapper(form, "secondary_industries_functions").textContent).toContain("Bạn chỉ có thể chọn tối đa 3 lựa chọn.");
  });

  it("chọn 'Khác' thì hiện ô ghi rõ, bắt buộc; bỏ chọn thì ô đó biến mất", () => {
    const { form } = renderForm();
    expect(control(form, "secondary_industries_functions_other")).toBeNull();

    fireEvent.click(secondaryBox(form, "other"));
    expect(control(form, "secondary_industries_functions_other").required).toBe(true);

    fireEvent.click(secondaryBox(form, "other"));
    expect(control(form, "secondary_industries_functions_other")).toBeNull();
  });
});

describe("4. gửi chưa được thì những gì đã điền vẫn còn", () => {
  it("form bị reset sau khi máy chủ từ chối: mọi ô giữ nguyên, kể cả ô số năm và lĩnh vực chọn thêm", () => {
    const { form } = renderForm();
    fillEverything(form);
    for (const value of ["fmcg", "marketing"]) fireEvent.click(secondaryBox(form, value));
    fireEvent.change(control<HTMLTextAreaElement>(form, "mentoring_topics"), { target: { value: "Định hướng nghề nghiệp" } });

    // Đúng việc React làm sau MỌI server action, kể cả action trả lỗi.
    form.reset();

    expect(control(form, "company_current").value).toBe("Công ty A");
    expect(control(form, "title_current").value).toBe("Trưởng phòng");
    expect(control(form, "mentor_total_work_years").value).toBe("35");
    expect(control(form, "mentor_people_management_years").value).toBe("12");
    expect(control<HTMLTextAreaElement>(form, "mentoring_topics").value).toBe("Định hướng nghề nghiệp");
    expect(control(form, "participation_confirmed").checked).toBe(true);
    expect(control(form, ACKS[0].key).checked).toBe(true);
    expect(control(form, ACTIVE_READING_KEYS.mentor).value).toBe(CONFIRMATION_PHRASES.mentor);
    expect(new FormData(form).getAll("secondary_industries_functions")).toEqual(["fmcg", "marketing"]);
  });
});
