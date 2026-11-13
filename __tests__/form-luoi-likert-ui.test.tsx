/**
 * @vitest-environment jsdom
 */
/**
 * Lưới thang đo Likert (VAM00032) — trên trình duyệt.
 *
 * Form công khai: mỗi phát biểu là một nhóm radio riêng (chọn một mức mỗi hàng), mỗi mức đúng một nút radio
 * (không vẽ hai bản cho hai cỡ màn hình); thiếu hàng bắt buộc thì không gọi máy chủ và báo dưới câu hỏi;
 * đủ thì gửi đúng khoá từng hàng. Trình tạo form: thêm lưới có sẵn hàng/cột mẫu, sửa / thêm / xoá hàng và
 * cột, thang mẫu; Lưu gửi đúng định nghĩa; form đã có câu trả lời thì hàng cũ không xoá được, thang mẫu khoá.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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

const CODE = "a1b2c3d4e5f6";
const COLS = ["1", "2", "3", "4", "5"];
const GRID: CustomFormField = {
  id: "f_gridaaaa",
  type: "likert_grid",
  label: "Đánh giá buổi học",
  help: "1 = rất kém, 5 = rất tốt",
  required: true,
  hidden: false,
  options: COLS,
  rows: [
    { id: "r_noidung1", label: "Nội dung" },
    { id: "r_diengia1", label: "Diễn giả" }
  ]
};
const K1 = "f_gridaaaa.r_noidung1";
const K2 = "f_gridaaaa.r_diengia1";

const rowEl = (container: HTMLElement, rowId: string) => container.querySelector(`[data-testid="likert-row"][data-row="${rowId}"]`) as HTMLElement;
const pick = (container: HTMLElement, rowId: string, column: string) => {
  const label = Array.from(rowEl(container, rowId).querySelectorAll("label")).find((l) => l.textContent === column)!;
  fireEvent.click(label.querySelector("input")!);
};
const errorOf = (container: HTMLElement) => container.querySelector('[data-field="f_gridaaaa"] [data-testid="field-error"]')?.textContent ?? null;
async function submit(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('[data-testid="custom-form"]')!);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("1. form công khai", () => {
  it("vẽ hàng tiêu đề các mức và mỗi phát biểu một nhóm radio; mỗi mức đúng một nút, chọn mức khác thì bỏ mức cũ", () => {
    const { container } = render(<PublicForm code={CODE} fields={[GRID]} />);
    const grid = container.querySelector('[data-field="f_gridaaaa"] [data-testid="likert-grid"]')!;
    expect(grid).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="likert-row"]')).toHaveLength(2);
    const row = rowEl(container, "r_noidung1");
    expect(row.getAttribute("role")).toBe("radiogroup");
    const radios = Array.from(row.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios).toHaveLength(COLS.length);
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set([`q-${K1}`]));
    // Cả lưới chỉ có hàng × cột nút radio: không có bản thứ hai cho điện thoại.
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(2 * COLS.length);
    pick(container, "r_noidung1", "4");
    pick(container, "r_noidung1", "2");
    expect(radios.filter((r) => r.checked).map((r) => r.nextSibling?.textContent)).toEqual(["2"]);
    // Hàng kia không bị chạm.
    expect(Array.from(rowEl(container, "r_diengia1").querySelectorAll("input")).some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it("bắt buộc mà còn hàng chưa chọn: không gọi máy chủ, báo dưới câu hỏi, hàng thiếu được đánh dấu; chọn tiếp thì lỗi tắt", async () => {
    const { container } = render(<PublicForm code={CODE} fields={[GRID]} />);
    pick(container, "r_noidung1", "5");
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submit(container);
    expect(h.submit).not.toHaveBeenCalled();
    expect(errorOf(container)).toBe("Vui lòng chọn một mức cho mỗi hàng.");
    expect(rowEl(container, "r_diengia1").getAttribute("aria-invalid")).toBe("true");
    expect(rowEl(container, "r_noidung1").getAttribute("aria-invalid")).toBeNull();
    pick(container, "r_diengia1", "3");
    expect(errorOf(container)).toBeNull();
  });

  it("đủ mọi hàng: gửi đúng một lần với khoá từng hàng", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={[GRID]} />);
    pick(container, "r_noidung1", "5");
    pick(container, "r_diengia1", "3");
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submit(container);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0][0]).toBe(CODE);
    expect(h.submit.mock.calls[0][1].values).toEqual({ [K1]: "5", [K2]: "3" });
  });

  it("không bắt buộc: bỏ trống vẫn gửi được", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={[{ ...GRID, required: false }]} />);
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submit(container);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });
});

describe("2. trình tạo form", () => {
  const FORM: BuilderForm = {
    id: "11111111-2222-4333-8444-555555555555",
    eventId: null,
    registrationLimit: null,
    requireKnownPerson: false,
    themeColor: null,
    bannerPath: null,
    logoPath: null,
    logoPosition: "left",
    publicCode: CODE,
    title: "Khảo sát",
    description: "",
    programId: null,
    status: "draft",
    opensAt: null,
    closesAt: null,
    thankYou: "",
    onePerEmail: false,
    autoReply: false,
    autoReplySubject: "",
    autoReplyBody: "",
    mentorForward: false,
    mentorForwardSubject: "",
    mentorForwardBody: "",
    fields: []
  };
  const renderBuilder = (form: BuilderForm, responseCount = 0) => render(<FormBuilder form={form} programs={[]} responseCount={responseCount} publicUrl={`https://os.test/f/${CODE}`} />);
  const save = async (container: HTMLElement) => {
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="save-form"]')!);
    });
  };

  it("thêm lưới: có sẵn hàng và thang 1–5; sửa, thêm, xoá hàng; đổi sang thang mẫu; Lưu gửi đúng định nghĩa", async () => {
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    const { container, getByLabelText } = renderBuilder(FORM);
    fireEvent.change(getByLabelText("Loại trường mới"), { target: { value: "likert_grid" } });
    fireEvent.click(container.querySelector('[data-testid="add-field"]')!);
    const card = container.querySelector('[data-testid="field-list"] [data-field]') as HTMLElement;
    const editor = card.querySelector('[data-testid="likert-editor"]') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.querySelectorAll('[data-testid="likert-row-edit"]')).toHaveLength(2);
    expect(Array.from(editor.querySelectorAll('[data-testid="likert-column-edit"] input')).map((i) => (i as HTMLInputElement).value)).toEqual(COLS);

    fireEvent.change(card.querySelector('input[aria-label="Câu hỏi"]')!, { target: { value: "Mức độ đồng ý với các phát biểu sau" } });
    fireEvent.change(editor.querySelector('input[aria-label="Phát biểu 1"]')!, { target: { value: " Tôi hiểu nội dung " } });
    fireEvent.click(editor.querySelector('[data-testid="likert-add-row"]')!);
    fireEvent.change(editor.querySelector('input[aria-label="Phát biểu 3"]')!, { target: { value: "Tôi muốn học tiếp" } });
    fireEvent.click(editor.querySelector('button[aria-label="Xoá phát biểu 2"]')!);
    fireEvent.click(Array.from(editor.querySelectorAll("button")).find((b) => b.textContent === "Mức độ đồng ý")!);
    fireEvent.click(editor.querySelector('button[aria-label="Xoá mức 3"]')!);
    await save(container);

    expect(h.save).toHaveBeenCalledTimes(1);
    const added = h.save.mock.calls[0][1].fields[0];
    expect(added).toMatchObject({
      type: "likert_grid",
      label: "Mức độ đồng ý với các phát biểu sau",
      required: true,
      options: ["Rất không đồng ý", "Không đồng ý", "Đồng ý", "Rất đồng ý"]
    });
    expect(added.rows.map((r: { label: string }) => r.label)).toEqual(["Tôi hiểu nội dung", "Tôi muốn học tiếp"]);
    for (const r of added.rows) expect(r.id).toMatch(/^r_[a-z0-9]{8}$/);
    expect(added).not.toHaveProperty("optionsText");
  });

  it("form đã có câu trả lời: hàng cũ và mức cũ không xoá được, thang mẫu khoá; hàng mới vẫn xoá được", () => {
    const { container } = renderBuilder({ ...FORM, status: "published", fields: [GRID] }, 3);
    const editor = container.querySelector('[data-testid="likert-editor"]') as HTMLElement;
    expect((editor.querySelector('button[aria-label="Xoá phát biểu 1"]') as HTMLButtonElement).disabled).toBe(true);
    expect((editor.querySelector('button[aria-label="Xoá mức 1"]') as HTMLButtonElement).disabled).toBe(true);
    expect((editor.querySelector('input[aria-label="Mức 1"]') as HTMLInputElement).readOnly).toBe(true);
    // Sửa chữ phát biểu cũ vẫn được (câu trả lời khoá theo mã hàng).
    expect((editor.querySelector('input[aria-label="Phát biểu 1"]') as HTMLInputElement).readOnly).toBe(false);
    const preset = Array.from(editor.querySelectorAll("button")).find((b) => b.textContent === "Mức độ hài lòng") as HTMLButtonElement;
    expect(preset.disabled).toBe(true);
    fireEvent.click(editor.querySelector('[data-testid="likert-add-row"]')!);
    expect((editor.querySelector('button[aria-label="Xoá phát biểu 3"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
