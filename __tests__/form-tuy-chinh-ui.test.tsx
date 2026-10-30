/**
 * @vitest-environment jsdom
 */
/**
 * Form tùy chỉnh — phần chạy trên trình duyệt (BTC 15/10/2026).
 *
 * Form công khai: thiếu mục bắt buộc / sai định dạng / chưa tích đồng ý thì KHÔNG gọi máy chủ, báo ngay
 * dưới đúng mục; hợp lệ thì gọi đúng một lần với đúng mã form; lỗi máy chủ trả về hiện đúng chỗ; trường
 * ẩn không hiện; bản xem thử không bao giờ gửi.
 * Trình tạo form: thêm câu chọn, lựa chọn mỗi dòng một cái (dòng trống bị bỏ); không công khai khi còn
 * thay đổi chưa lưu; form đã có câu trả lời thì câu cũ không xoá / không đổi loại được trên trang.
 * Đường /f/ là trang công khai mang nhãn khung trần; /forms vẫn đòi đăng nhập.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NextRequest } from "next/server";
import type { CustomFormField } from "@/lib/custom-form-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), status: vi.fn(), testReceipt: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/app/f/[code]/actions", () => ({ submitCustomFormAction: h.submit }));
vi.mock("@/app/forms/actions", () => ({
  saveCustomFormAction: h.save,
  setCustomFormStatusAction: h.status,
  sendCustomFormReceiptTestAction: h.testReceipt,
  createCustomFormAction: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));

import { PublicForm } from "@/app/f/[code]/public-form";
import { FormBuilder, type BuilderForm } from "@/app/forms/[id]/form-builder";
import { middleware } from "@/middleware";

const CODE = "a1b2c3d4e5f6";
const field = (id: string, type: CustomFormField["type"], extra: Partial<CustomFormField> = {}): CustomFormField => ({
  id,
  type,
  label: `Câu ${id}`,
  help: "",
  required: true,
  hidden: false,
  options: [],
  ...extra
});
const FIELDS: CustomFormField[] = [
  field("f_sectaaaa", "section", { label: "Thông tin cá nhân", help: "Điền đúng như trên thẻ sinh viên" }),
  field("f_nameaaaa", "short_text", { label: "Họ và tên" }),
  field("f_emailaaa", "email", { label: "Email" }),
  field("f_mssvaaaa", "student_id", { label: "MSSV" }),
  field("f_dobaaaaa", "date", { label: "Ngày sinh" }),
  field("f_slotaaaa", "multi_choice", { label: "Buổi rảnh", options: ["Sáng", "Chiều", "Tối"] }),
  field("f_noteaaaa", "long_text", { label: "Ghi chú", required: false }),
  field("f_secretaa", "short_text", { label: "Ghi chú nội bộ", hidden: true })
];

const errorOf = (container: HTMLElement, id: string) => container.querySelector(`[data-field="${id}"] [data-testid="field-error"]`)?.textContent ?? null;
const input = (container: HTMLElement, id: string) => container.querySelector(`#q-${id}`) as HTMLInputElement;
async function submitForm(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('[data-testid="custom-form"]')!);
  });
}
function fillValid(container: HTMLElement) {
  fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "Nguyễn Văn An" } });
  fireEvent.change(input(container, "f_emailaaa"), { target: { value: "an@gmail.com" } });
  fireEvent.change(input(container, "f_mssvaaaa"), { target: { value: "31241028261" } });
  fireEvent.change(input(container, "f_dobaaaaa"), { target: { value: "05092004" } });
  const toi = Array.from(container.querySelectorAll('[data-field="f_slotaaaa"] label')).find((l) => l.textContent === "Tối")!.querySelector("input")!;
  fireEvent.click(toi);
  fireEvent.click(container.querySelector("#q-__consent")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Nháp nằm trong bộ nhớ trình duyệt, chung cho mọi ca của file: không xoá thì nháp ca trước mở lại ở ca sau.
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("1. form công khai", () => {
  it("không hiện trường ẩn; khối tiêu đề hiện như phần chia; mục bắt buộc có dấu *", () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    expect(container.querySelector('[data-field="f_secretaa"]')).toBeNull();
    expect(container.textContent).not.toContain("Ghi chú nội bộ");
    expect(container.querySelector('[data-field="f_sectaaaa"] h2')?.textContent).toBe("Thông tin cá nhân");
    expect(container.querySelector('[data-field="f_nameaaaa"] label')?.textContent).toContain("*");
    expect(container.querySelector('[data-field="f_noteaaaa"] label')?.textContent).not.toContain("*");
  });

  it("ô đồng ý ở trang cuối ghi tên chương trình “UEH Mentoring” (24/10/2026)", () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    const consent = container.querySelector("#q-__consent")?.closest("label")?.textContent ?? "";
    expect(consent).toContain("Tôi đồng ý để UEH Mentoring thu thập và xử lý các thông tin trên");
    expect(consent).not.toContain("Vietnam Alumni Mentoring");
  });

  it("bấm Gửi khi còn trống: KHÔNG gọi máy chủ, báo dưới đúng từng mục bắt buộc và ô đồng ý", async () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    await submitForm(container);
    expect(h.submit).not.toHaveBeenCalled();
    for (const id of ["f_nameaaaa", "f_emailaaa", "f_mssvaaaa", "f_dobaaaaa", "f_slotaaaa"]) expect(errorOf(container, id), id).not.toBeNull();
    expect(errorOf(container, "f_noteaaaa")).toBeNull();
    expect(container.textContent).toContain("Vui lòng tích ô đồng ý");
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("chưa đúng");
  });

  it("sai định dạng (MSSV 7 số, ngày 31/02): KHÔNG gọi máy chủ; sửa lại thì lỗi của mục đó tắt", async () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fillValid(container);
    fireEvent.change(input(container, "f_mssvaaaa"), { target: { value: "1234567" } });
    fireEvent.change(input(container, "f_dobaaaaa"), { target: { value: "31022004" } });
    await submitForm(container);
    expect(h.submit).not.toHaveBeenCalled();
    expect(errorOf(container, "f_mssvaaaa")).toContain("8–12");
    expect(errorOf(container, "f_dobaaaaa")).toContain("ngày có thật");
    fireEvent.change(input(container, "f_mssvaaaa"), { target: { value: "31241028261" } });
    expect(errorOf(container, "f_mssvaaaa")).toBeNull();
  });

  it("ô ngày tự chèn dấu /", () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fireEvent.change(input(container, "f_dobaaaaa"), { target: { value: "05092004" } });
    expect(input(container, "f_dobaaaaa").value).toBe("05/09/2004");
  });

  it("hợp lệ: gọi máy chủ ĐÚNG MỘT lần với đúng mã form, câu trả lời, đồng ý, ô bẫy; xong thì hiện lời cảm ơn", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn bạn đã đăng ký Job Shadowing!", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fillValid(container);
    await submitForm(container);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit).toHaveBeenCalledWith(CODE, {
      values: {
        f_nameaaaa: "Nguyễn Văn An",
        f_emailaaa: "an@gmail.com",
        f_mssvaaaa: "31241028261",
        f_dobaaaaa: "05/09/2004",
        f_slotaaaa: ["Tối"]
      },
      consent: true,
      trap: ""
    });
    expect(container.querySelector('[data-testid="form-done"]')?.textContent).toBe("Cảm ơn bạn đã đăng ký Job Shadowing!");
    expect(container.querySelector('[data-testid="custom-form"]')).toBeNull();
  });

  it("máy chủ báo trùng email: hiện dưới ô Email, câu trả lời vẫn còn trên trang", async () => {
    h.submit.mockResolvedValue({ ok: false, message: "Email này đã gửi form rồi — mỗi email chỉ gửi một lần.", errors: { f_emailaaa: "Email này đã gửi form rồi." } });
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fillValid(container);
    await submitForm(container);
    expect(errorOf(container, "f_emailaaa")).toBe("Email này đã gửi form rồi.");
    expect(input(container, "f_nameaaaa").value).toBe("Nguyễn Văn An");
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("mỗi email chỉ gửi một lần");
  });

  it("mất mạng: báo gửi lại được, câu trả lời vẫn còn", async () => {
    h.submit.mockRejectedValue(new Error("mạng"));
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fillValid(container);
    await submitForm(container);
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("Gửi lại");
    expect(input(container, "f_mssvaaaa").value).toBe("31241028261");
  });

  it("bản xem thử: kiểm lỗi như thật nhưng KHÔNG BAO GIỜ gọi máy chủ", async () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} preview />);
    fillValid(container);
    await submitForm(container);
    expect(h.submit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("Bản xem thử");
  });
});

describe("2. trình tạo form", () => {
  const FORM: BuilderForm = {
    id: "11111111-2222-4333-8444-555555555555",
    eventId: null,
    registrationLimit: null, requireKnownPerson: false, themeColor: null,
    publicCode: CODE,
    title: "Tuyển mentee Job Shadowing",
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
    fields: [field("f_nameaaaa", "short_text", { label: "Họ và tên" }), field("f_emailaaa", "email", { label: "Email" })]
  };
  const renderBuilder = (responseCount = 0) =>
    render(<FormBuilder form={FORM} programs={[{ id: "p1", name: "Career Experience Program" }]} responseCount={responseCount} publicUrl={`https://os.test/f/${CODE}`} />);
  const byTestId = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

  it("thêm câu chọn một: lựa chọn mỗi dòng một cái (bỏ dòng trống, cắt khoảng trắng); Lưu gửi đúng định nghĩa", async () => {
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    const { container, getByLabelText } = renderBuilder();
    fireEvent.change(getByLabelText("Loại trường mới"), { target: { value: "single_choice" } });
    fireEvent.click(byTestId(container, "add-field"));
    const cards = container.querySelectorAll('[data-testid="field-list"] [data-field]');
    expect(cards).toHaveLength(3);
    const card = cards[2] as HTMLElement;
    fireEvent.change(card.querySelector('input[aria-label="Câu hỏi"]')!, { target: { value: "Bạn là sinh viên năm mấy?" } });
    fireEvent.change(card.querySelector("label textarea")!, { target: { value: " Năm 3\n\nNăm 4 \n" } });
    await act(async () => {
      fireEvent.click(byTestId(container, "save-form"));
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    const [id, payload] = h.save.mock.calls[0];
    expect(id).toBe(FORM.id);
    const added = payload.fields[2];
    expect(added).toMatchObject({ type: "single_choice", label: "Bạn là sinh viên năm mấy?", options: ["Năm 3", "Năm 4"], required: true });
    expect(added).not.toHaveProperty("optionsText");
    expect(added.id).toMatch(/^f_[a-z0-9]{8}$/);
    expect(payload).toMatchObject({ title: FORM.title, onePerEmail: true, opensAt: "", closesAt: "" });
    expect(byTestId(container, "builder-report").textContent).toBe("Đã lưu form.");
  });

  it("còn thay đổi chưa lưu thì không công khai được; lưu xong thì được", async () => {
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    h.status.mockResolvedValue({ ok: true, message: "Form đã công khai — gửi link cho người điền được rồi." });
    const { container, getByLabelText } = renderBuilder();
    expect(byTestId(container, "publish-form").disabled).toBe(false);
    fireEvent.change(getByLabelText("Ngày mở"), { target: { value: "16102026" } });
    expect(byTestId(container, "publish-form").disabled).toBe(true);
    fireEvent.change(getByLabelText("Giờ mở"), { target: { value: "0800" } });
    await act(async () => {
      fireEvent.click(byTestId(container, "save-form"));
    });
    expect(h.save.mock.calls[0][1]).toMatchObject({ opensAt: "2026-10-16T08:00" });
    expect(byTestId(container, "publish-form").disabled).toBe(false);
    await act(async () => {
      fireEvent.click(byTestId(container, "publish-form"));
    });
    expect(h.status).toHaveBeenCalledWith(FORM.id, "published");
    expect(byTestId(container, "form-status").textContent).toBe("Đang công khai");
  });

  it("giờ mở chỉ có ngày mà thiếu giờ: báo lỗi, KHÔNG gọi lưu", async () => {
    const { container, getByLabelText } = renderBuilder();
    fireEvent.change(getByLabelText("Ngày mở"), { target: { value: "16102026" } });
    await act(async () => {
      fireEvent.click(byTestId(container, "save-form"));
    });
    expect(h.save).not.toHaveBeenCalled();
    expect(byTestId(container, "builder-report").textContent).toContain("đủ ngày");
  });

  it("form đã có câu trả lời: câu cũ không xoá / không đổi loại được trên trang; câu mới thêm vẫn xoá được", () => {
    const { container, getByLabelText } = renderBuilder(3);
    expect(container.querySelector('[data-testid="locked-note"]')?.textContent).toContain("3 câu trả lời");
    const oldCard = container.querySelector('[data-field="f_nameaaaa"]') as HTMLElement;
    const del = Array.from(oldCard.querySelectorAll("button")).find((b) => b.textContent === "Xoá") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect((oldCard.querySelector('select[aria-label="Loại trường"]') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(byTestId(container, "add-field"));
    const cards = container.querySelectorAll('[data-testid="field-list"] [data-field]');
    const newDel = Array.from((cards[2] as HTMLElement).querySelectorAll("button")).find((b) => b.textContent === "Xoá") as HTMLButtonElement;
    expect(newDel.disabled).toBe(false);
    expect(getByLabelText("Loại trường mới")).toBeTruthy();
  });
});

describe("1b. form nhiều trang (BTC 15/10/2026)", () => {
  const PAGED: CustomFormField[] = [
    field("f_nameaaaa", "short_text", { label: "Họ và tên" }),
    field("f_emailaaa", "email", { label: "Email" }),
    field("f_brk1aaaa", "page_break", { label: "Hồ sơ", help: "Gửi link CV đã bật chia sẻ", required: false }),
    field("f_cvaaaaaa", "file_link", { label: "CV" }),
    field("f_brk2aaaa", "page_break", { label: "", required: false }),
    field("f_slotaaaa", "single_choice", { label: "Buổi", options: ["Sáng", "Chiều"] })
  ];
  const shownFields = (c: HTMLElement) => Array.from(c.querySelectorAll("[data-field]")).map((x) => x.getAttribute("data-field"));
  const click = async (c: HTMLElement, testId: string) => {
    await act(async () => {
      fireEvent.click(c.querySelector(`[data-testid="${testId}"]`)!);
    });
  };

  // VAM00010 (30/10/2026): React tái dùng nút "Tiếp" làm nút "Gửi" (chỉ đổi type). Trên trình duyệt thật React vẽ
  // lại TRƯỚC khi trình duyệt xử lý cú bấm, nên cú bấm "Tiếp" ở trang kế cuối gửi luôn form. jsdom xử lý cú bấm
  // trước khi React vẽ lại nên không dựng lại được đúng thời điểm đó — test khoá thẳng vào gốc: nút "Gửi" phải là
  // một phần tử KHÁC, và nút "Tiếp" vừa bấm không bao giờ trở thành nút submit.
  it("“Tiếp” ở trang kế cuối không bao giờ biến thành nút Gửi; qua lại giữa các trang không gửi, không báo lỗi", async () => {
    const { container } = render(<PublicForm code={CODE} fields={PAGED} />);
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.change(input(container, "f_emailaaa"), { target: { value: "an@gmail.com" } });
    await click(container, "page-next");
    fireEvent.change(input(container, "f_cvaaaaaa"), { target: { value: "https://drive.google.com/file/d/x" } });
    const nextOnPenultimate = container.querySelector('[data-testid="page-next"]') as HTMLButtonElement;
    await click(container, "page-next");
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 3/3");
    const submit = container.querySelector('button[type="submit"]');
    expect(submit).not.toBeNull();
    expect(submit).not.toBe(nextOnPenultimate);
    expect(nextOnPenultimate.isConnected).toBe(false);
    expect(nextOnPenultimate.type).toBe("button");
    expect(container.querySelector('[data-testid="form-notice"]')).toBeNull();
    // Tích đồng ý, quay lại rồi "Tiếp" lần nữa: vẫn là nút khác, vẫn không gửi.
    fireEvent.click(container.querySelector("#q-__consent")!);
    await click(container, "page-back");
    const nextAgain = container.querySelector('[data-testid="page-next"]') as HTMLButtonElement;
    await click(container, "page-next");
    expect(container.querySelector('button[type="submit"]')).not.toBe(nextAgain);
    expect(nextAgain.type).toBe("button");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("trang 1 chỉ có câu của trang 1, có “Tiếp”, chưa có ô đồng ý hay nút Gửi", () => {
    const { container } = render(<PublicForm code={CODE} fields={PAGED} />);
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 1/3");
    expect(shownFields(container)).toEqual(["f_nameaaaa", "f_emailaaa"]);
    expect(container.querySelector('[data-testid="page-next"]')).not.toBeNull();
    expect(container.querySelector("#q-__consent")).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("“Tiếp” khi trang còn thiếu: KHÔNG qua trang, báo dưới đúng mục; điền đủ thì qua trang 2 có tiêu đề và mô tả của ngắt trang", async () => {
    const { container } = render(<PublicForm code={CODE} fields={PAGED} />);
    await click(container, "page-next");
    expect(container.querySelector('[data-testid="custom-form"]')?.getAttribute("data-page")).toBe("1");
    expect(errorOf(container, "f_nameaaaa")).not.toBeNull();
    expect(errorOf(container, "f_emailaaa")).not.toBeNull();
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.change(input(container, "f_emailaaa"), { target: { value: "an@gmail.com" } });
    await click(container, "page-next");
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 2/3");
    expect(container.querySelector('[data-testid="page-header"]')?.textContent).toContain("Hồ sơ");
    expect(container.querySelector('[data-testid="page-header"]')?.textContent).toContain("Gửi link CV đã bật chia sẻ");
    expect(shownFields(container)).toEqual(["f_cvaaaaaa"]);
    expect(container.querySelector('[data-field="f_cvaaaaaa"]')?.textContent).toContain("Bất kỳ ai có đường liên kết");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("Enter ở trang chưa cuối = Tiếp (không gửi); “Quay lại” giữ nguyên câu đã điền; trang cuối mới có đồng ý + Gửi; gửi đủ mọi trang", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={PAGED} />);
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.change(input(container, "f_emailaaa"), { target: { value: "an@gmail.com" } });
    await submitForm(container);
    expect(h.submit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 2/3");
    await click(container, "page-back");
    expect(input(container, "f_nameaaaa").value).toBe("An");
    await click(container, "page-next");
    fireEvent.change(input(container, "f_cvaaaaaa"), { target: { value: "https://drive.google.com/file/d/x" } });
    await click(container, "page-next");
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 3/3");
    expect(container.querySelector('[data-testid="page-next"]')).toBeNull();
    fireEvent.click(Array.from(container.querySelectorAll('[data-field="f_slotaaaa"] label')).find((l) => l.textContent === "Chiều")!.querySelector("input")!);
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submitForm(container);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0][1].values).toEqual({
      f_nameaaaa: "An",
      f_emailaaa: "an@gmail.com",
      f_cvaaaaaa: "https://drive.google.com/file/d/x",
      f_slotaaaa: "Chiều"
    });
  });

  it("Enter ở trang 1 khi các trang sau đều tùy chọn: chỉ sang trang 2 — không gửi, không nhảy tới trang cuối đòi ô đồng ý", async () => {
    const optionalLater = PAGED.map((f) => (f.id === "f_cvaaaaaa" || f.id === "f_slotaaaa" ? { ...f, required: false } : f));
    const { container } = render(<PublicForm code={CODE} fields={optionalLater} />);
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.change(input(container, "f_emailaaa"), { target: { value: "an@gmail.com" } });
    await submitForm(container);
    expect(h.submit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 2/3");
    expect(container.querySelector('[data-testid="form-notice"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="field-error"]')).toHaveLength(0);
  });

  it("máy chủ báo lỗi ở một mục trang 1 (vd. trùng email): quay về trang 1 và hiện lỗi dưới ô đó", async () => {
    h.submit.mockResolvedValue({ ok: false, message: "Email này đã gửi form rồi — mỗi email chỉ gửi một lần.", errors: { f_emailaaa: "Email này đã gửi form rồi." } });
    const { container } = render(<PublicForm code={CODE} fields={PAGED} />);
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.change(input(container, "f_emailaaa"), { target: { value: "an@gmail.com" } });
    await click(container, "page-next");
    fireEvent.change(input(container, "f_cvaaaaaa"), { target: { value: "https://drive.google.com/file/d/x" } });
    await click(container, "page-next");
    fireEvent.click(Array.from(container.querySelectorAll('[data-field="f_slotaaaa"] label')).find((l) => l.textContent === "Sáng")!.querySelector("input")!);
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submitForm(container);
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 1/3");
    expect(errorOf(container, "f_emailaaa")).toBe("Email này đã gửi form rồi.");
  });
});

describe("2b. trình tạo form — thư tự động, ngắt trang", () => {
  const FORM2: BuilderForm = {
    id: "11111111-2222-4333-8444-555555555555",
    eventId: null,
    registrationLimit: null, requireKnownPerson: false, themeColor: null,
    publicCode: CODE,
    title: "Tuyển mentee Job Shadowing",
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
    fields: [field("f_nameaaaa", "short_text", { label: "Họ và tên" }), field("f_emailaaa", "email", { label: "Email" })]
  };
  const renderBuilder = () =>
    render(<FormBuilder form={FORM2} programs={[]} responseCount={0} publicUrl={`https://os.test/f/${CODE}`} />);

  it("tick “Gửi thư tự động” thì hiện ô tiêu đề + nội dung; “Gửi thử cho tôi” gửi đúng chữ đang trên trang; Lưu mang đủ ba trường thư", async () => {
    h.testReceipt.mockResolvedValue({ ok: true, message: "Đã gửi thư thử tới a@x.vn." });
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    const { container, getByLabelText, queryByLabelText } = renderBuilder();
    expect(queryByLabelText("Nội dung thư tự động")).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="auto-reply-toggle"]')!);
    fireEvent.change(getByLabelText("Tiêu đề thư tự động"), { target: { value: "Đã nhận đơn" } });
    fireEvent.change(getByLabelText("Nội dung thư tự động"), { target: { value: "Chào bạn,\nĐã nhận." } });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="test-receipt"]')!);
    });
    expect(h.testReceipt).toHaveBeenCalledWith(FORM2.id, { subject: "Đã nhận đơn", body: "Chào bạn,\nĐã nhận." });
    expect(container.querySelector('[data-testid="builder-report"]')?.textContent).toBe("Đã gửi thư thử tới a@x.vn.");
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="save-form"]')!);
    });
    expect(h.save.mock.calls[0][1]).toMatchObject({ autoReply: true, autoReplySubject: "Đã nhận đơn", autoReplyBody: "Chào bạn,\nĐã nhận." });
  });

  it("thêm “Ngắt trang”: thẻ ghi rõ là ngắt trang, không có ô bắt buộc, không chiếm số thứ tự câu hỏi", () => {
    const { container, getByLabelText } = renderBuilder();
    fireEvent.change(getByLabelText("Loại trường mới"), { target: { value: "page_break" } });
    fireEvent.click(container.querySelector('[data-testid="add-field"]')!);
    fireEvent.change(getByLabelText("Loại trường mới"), { target: { value: "file_link" } });
    fireEvent.click(container.querySelector('[data-testid="add-field"]')!);
    const cards = Array.from(container.querySelectorAll('[data-testid="field-list"] [data-field]')) as HTMLElement[];
    expect(cards[2].textContent).toContain("Ngắt trang");
    expect(cards[2].textContent).not.toContain("Bắt buộc trả lời");
    expect(cards[3].textContent).toContain("Câu 3");
  });
});

describe("1c. lưu nháp khi đang điền (BTC 15/10/2026)", () => {
  const KEY = `vam-form-nhap:${CODE}`;
  const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");
  const PAGED: CustomFormField[] = [
    field("f_nameaaaa", "short_text", { label: "Họ và tên" }),
    field("f_brk1aaaa", "page_break", { label: "Hồ sơ", required: false }),
    field("f_mssvaaaa", "student_id", { label: "MSSV" })
  ];
  const at = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it("đang gõ: tự lưu trên máy này sau khi ngừng gõ (không lưu từng phím); ô đồng ý và ô bẫy không bao giờ được lưu", async () => {
    at("2026-10-15T13:00:00Z");
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "Nguyễn Văn An" } });
    fireEvent.click(container.querySelector("#q-__consent")!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    fireEvent.change(input(container, "f_mssvaaaa"), { target: { value: "3124" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(stored()).toEqual({ v: 1, savedAt: Date.parse("2026-10-15T13:00:01.300Z"), page: 0, values: { f_nameaaaa: "Nguyễn Văn An", f_mssvaaaa: "3124" } });
    expect(JSON.stringify(stored())).not.toContain("consent");
    expect(container.querySelector('[data-testid="draft-status"]')?.textContent).toContain("Đã tự lưu nháp trên máy này lúc 15/10/2026 20:00");
  });

  it("mở lại đúng link trên máy này: câu cũ và trang đang điền dở hiện lại, báo giờ đã lưu; ô đồng ý vẫn phải tích lại", () => {
    // Ghim đồng hồ: nháp quá 14 ngày tự bỏ, nên để đồng hồ thật thì ca này hỏng từ 29/10/2026.
    at("2026-10-15T13:10:00Z");
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, savedAt: Date.parse("2026-10-15T13:05:00Z"), page: 1, values: { f_nameaaaa: "An", f_mssvaaaa: "31241028261" } })
    );
    const { container } = render(<PublicForm code={CODE} fields={PAGED} />);
    expect(container.querySelector('[data-testid="page-progress"]')?.textContent).toBe("Trang 2/2");
    expect(input(container, "f_mssvaaaa").value).toBe("31241028261");
    expect(container.querySelector('[data-testid="draft-restored"]')?.textContent).toContain("15/10/2026 20:05");
    expect((container.querySelector("#q-__consent") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(container.querySelector('[data-testid="page-back"]')!);
    expect(input(container, "f_nameaaaa").value).toBe("An");
  });

  it("chỉ mở trang thôi thì KHÔNG ghi gì, không đè nháp cũ; nháp của form khác không bị mở ra ở form này", async () => {
    at("2026-10-15T13:00:00Z");
    const other = JSON.stringify({ v: 1, savedAt: Date.now(), page: 0, values: { f_nameaaaa: "Người form khác" } });
    window.localStorage.setItem("vam-form-nhap:zzzzzzzzzzzz", other);
    const mine = JSON.stringify({ v: 1, savedAt: Date.now(), page: 0, values: { f_nameaaaa: "An" } });
    window.localStorage.setItem(KEY, mine);
    render(<PublicForm code={CODE} fields={FIELDS} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(window.localStorage.getItem(KEY)).toBe(mine);
    cleanup();
    window.localStorage.removeItem(KEY);
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    expect(input(container, "f_nameaaaa").value).toBe("");
    expect(container.querySelector('[data-testid="draft-restored"]')).toBeNull();
  });

  it("nút “Lưu nháp”: lưu ngay và báo; form còn trống thì báo không có gì để lưu", () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fireEvent.click(container.querySelector('[data-testid="draft-save"]')!);
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("Chưa có câu nào");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.click(container.querySelector('[data-testid="draft-save"]')!);
    expect(stored().values).toEqual({ f_nameaaaa: "An" });
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("Đã lưu nháp trên máy này");
  });

  it("“Xoá nháp”: xoá khỏi máy và làm trống form", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), page: 0, values: { f_nameaaaa: "An" } }));
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    expect(input(container, "f_nameaaaa").value).toBe("An");
    fireEvent.click(container.querySelector('[data-testid="draft-clear"]')!);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(input(container, "f_nameaaaa").value).toBe("");
    expect(container.querySelector('[data-testid="draft-restored"]')).toBeNull();
  });

  it("gửi thành công thì nháp mất; gửi hỏng thì nháp còn nguyên", async () => {
    h.submit.mockResolvedValueOnce({ ok: false, message: "Hệ thống đang bận, thử lại sau ít phút.", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fillValid(container);
    fireEvent.click(container.querySelector('[data-testid="draft-save"]')!);
    await submitForm(container);
    expect(stored().values.f_nameaaaa).toBe("Nguyễn Văn An");
    h.submit.mockResolvedValueOnce({ ok: true, message: "Cảm ơn!", errors: {} });
    await submitForm(container);
    expect(container.querySelector('[data-testid="form-done"]')).not.toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("trình duyệt chặn bộ nhớ (ẩn danh): không vỡ trang, báo rõ không lưu nháp được", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "An" } });
    fireEvent.click(container.querySelector('[data-testid="draft-save"]')!);
    expect(container.querySelector('[data-testid="form-notice"]')?.textContent).toContain("không cho lưu nháp");
    spy.mockRestore();
  });

  it("bản xem thử của ban tổ chức lưu nháp riêng, không lẫn với nháp của người điền thật", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), page: 0, values: { f_nameaaaa: "Người điền thật" } }));
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} preview />);
    expect(input(container, "f_nameaaaa").value).toBe("");
    fireEvent.change(input(container, "f_nameaaaa"), { target: { value: "BTC thử" } });
    fireEvent.click(container.querySelector('[data-testid="draft-save"]')!);
    expect(JSON.parse(window.localStorage.getItem(`${KEY}:xem-thu`)!).values).toEqual({ f_nameaaaa: "BTC thử" });
    expect(JSON.parse(window.localStorage.getItem(KEY)!).values).toEqual({ f_nameaaaa: "Người điền thật" });
  });
});

describe("3. đường công khai", () => {
  it("/f/<mã>: mở được khi chưa đăng nhập, mang nhãn khung trần custom_form", async () => {
    const response = await middleware(new NextRequest(`https://os.test/f/${CODE}`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-vam-public-route")).toBe("custom_form");
  });

  it("/forms (trang ban tổ chức) và đường trông giống KHÔNG công khai", async () => {
    for (const path of ["/forms", "/forms/abc", "/f", "/fx/abc"]) {
      const response = await middleware(new NextRequest(`https://os.test${path}`));
      expect(response.headers.get("x-middleware-request-x-vam-public-route"), path).toBeNull();
    }
  });
});
