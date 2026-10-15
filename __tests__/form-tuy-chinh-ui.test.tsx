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

const h = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), status: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/app/f/[code]/actions", () => ({ submitCustomFormAction: h.submit }));
vi.mock("@/app/forms/actions", () => ({ saveCustomFormAction: h.save, setCustomFormStatusAction: h.status, createCustomFormAction: vi.fn() }));
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
});
afterEach(() => cleanup());

describe("1. form công khai", () => {
  it("không hiện trường ẩn; khối tiêu đề hiện như phần chia; mục bắt buộc có dấu *", () => {
    const { container } = render(<PublicForm code={CODE} fields={FIELDS} />);
    expect(container.querySelector('[data-field="f_secretaa"]')).toBeNull();
    expect(container.textContent).not.toContain("Ghi chú nội bộ");
    expect(container.querySelector('[data-field="f_sectaaaa"] h2')?.textContent).toBe("Thông tin cá nhân");
    expect(container.querySelector('[data-field="f_nameaaaa"] label')?.textContent).toContain("*");
    expect(container.querySelector('[data-field="f_noteaaaa"] label')?.textContent).not.toContain("*");
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
    publicCode: CODE,
    title: "Tuyển mentee Job Shadowing",
    description: "",
    programId: null,
    status: "draft",
    opensAt: null,
    closesAt: null,
    thankYou: "",
    onePerEmail: true,
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
