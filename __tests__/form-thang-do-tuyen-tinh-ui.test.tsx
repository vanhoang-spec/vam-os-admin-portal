/**
 * @vitest-environment jsdom
 */
/**
 * Thang đo tuyến tính (VAM00033) — trên trình duyệt.
 *
 * Form công khai: các mức nằm trên MỘT hàng (lưới đúng n cột bằng nhau, co được), một bộ radio duy nhất (chọn một
 * mức), nhãn hai đầu hiện khi có; bắt buộc thì không gọi máy chủ khi chưa chọn; gửi đúng chữ số của mức; màu chủ đạo.
 * Trình tạo form: thêm câu có sẵn thang 1–5; đổi khoảng, ghi nhãn; Lưu gửi đúng định nghĩa; đã có câu trả lời thì
 * giá trị thu hẹp khoảng bị tắt. Lưới Likert bên cạnh vẫn vẽ như cũ.
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
const SCALE: CustomFormField = {
  id: "f_scaleaaa",
  type: "linear_scale",
  label: "Bạn hài lòng với buổi học?",
  help: "",
  required: true,
  hidden: false,
  options: [],
  scale: { min: 1, max: 5, minLabel: "Rất không hài lòng", maxLabel: "Rất hài lòng" }
};
const GRID: CustomFormField = {
  id: "f_gridaaaa",
  type: "likert_grid",
  label: "Đánh giá",
  help: "",
  required: false,
  hidden: false,
  options: ["1", "2", "3"],
  rows: [{ id: "r_noidung1", label: "Nội dung" }]
};

const scaleEl = (container: HTMLElement) => container.querySelector('[data-field="f_scaleaaa"] [data-testid="linear-scale"]') as HTMLElement;
const radios = (container: HTMLElement) => Array.from(scaleEl(container).querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
const pick = (container: HTMLElement, value: string) =>
  fireEvent.click(scaleEl(container).querySelector(`[data-testid="linear-scale-option"][data-value="${value}"] input`)!);
const errorOf = (container: HTMLElement) => container.querySelector('[data-field="f_scaleaaa"] [data-testid="field-error"]')?.textContent ?? null;
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
  it("các mức 1–5 tăng dần trên một hàng: một lưới đúng 5 cột co được, không xuống dòng", () => {
    const { container } = render(<PublicForm code={CODE} fields={[SCALE]} />);
    const group = scaleEl(container);
    expect(group.getAttribute("role")).toBe("radiogroup");
    const row = group.querySelector('[data-testid="linear-scale-options"]') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    expect(row.className).not.toMatch(/flex-wrap/);
    const options = Array.from(row.querySelectorAll('[data-testid="linear-scale-option"]')) as HTMLElement[];
    expect(options.map((o) => o.dataset.value)).toEqual(["1", "2", "3", "4", "5"]);
    for (const o of options) expect(o.className).toContain("min-w-0");
  });

  it("0–10: 11 mức trên một hàng", () => {
    const { container } = render(<PublicForm code={CODE} fields={[{ ...SCALE, scale: { min: 0, max: 10, minLabel: "", maxLabel: "" } }]} />);
    const row = scaleEl(container).querySelector('[data-testid="linear-scale-options"]') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe("repeat(11, minmax(0, 1fr))");
    expect(radios(container).map((r) => r.value)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    // Không có nhãn thì không vẽ dòng nhãn.
    expect(scaleEl(container).querySelector('[data-testid="linear-scale-labels"]')).toBeNull();
  });

  it("một bộ radio duy nhất: chọn mức khác thì bỏ mức cũ", () => {
    const { container } = render(<PublicForm code={CODE} fields={[SCALE]} />);
    expect(new Set(radios(container).map((r) => r.name))).toEqual(new Set(["q-f_scaleaaa"]));
    pick(container, "4");
    pick(container, "2");
    expect(radios(container).filter((r) => r.checked).map((r) => r.value)).toEqual(["2"]);
  });

  it("nhãn hai đầu hiện dưới hai đầu thang và đi kèm tên nút đầu / cuối cho trình đọc màn hình", () => {
    const { container } = render(<PublicForm code={CODE} fields={[SCALE]} />);
    const group = scaleEl(container);
    expect(group.querySelector('[data-testid="linear-scale-min-label"]')?.textContent).toBe("Rất không hài lòng");
    expect(group.querySelector('[data-testid="linear-scale-max-label"]')?.textContent).toBe("Rất hài lòng");
    const r = radios(container);
    expect(r[0].getAttribute("aria-label")).toBe("1 – Rất không hài lòng");
    expect(r[4].getAttribute("aria-label")).toBe("5 – Rất hài lòng");
    expect(r[2].getAttribute("aria-label")).toBe("3");
  });

  it("bắt buộc mà chưa chọn: không gọi máy chủ, báo dưới câu hỏi; chọn thì lỗi tắt", async () => {
    const { container } = render(<PublicForm code={CODE} fields={[SCALE]} />);
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submit(container);
    expect(h.submit).not.toHaveBeenCalled();
    expect(errorOf(container)).toBe("Vui lòng chọn một mức.");
    pick(container, "3");
    expect(errorOf(container)).toBeNull();
  });

  it("đã chọn: gửi đúng một lần với chữ số của mức; câu Likert bên cạnh vẫn vẽ như cũ", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={[SCALE, GRID]} />);
    expect(container.querySelectorAll('[data-field="f_gridaaaa"] [data-testid="likert-row"]')).toHaveLength(1);
    expect(container.querySelector('[data-field="f_gridaaaa"] [data-testid="linear-scale"]')).toBeNull();
    pick(container, "5");
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submit(container);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0][1].values).toEqual({ f_scaleaaa: "5" });
  });

  it("không bắt buộc: bỏ trống vẫn gửi được", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code={CODE} fields={[{ ...SCALE, required: false }]} />);
    fireEvent.click(container.querySelector("#q-__consent")!);
    await submit(container);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0][1].values).toEqual({});
  });

  it("mức đã chọn tô theo màu chủ đạo của form", () => {
    const { container } = render(<PublicForm code={CODE} fields={[SCALE]} themeColor="#123456" />);
    pick(container, "4");
    const option = scaleEl(container).querySelector('[data-value="4"]') as HTMLElement;
    expect(option.style.backgroundColor).toBe("rgb(18, 52, 86)");
    expect((scaleEl(container).querySelector('[data-value="3"]') as HTMLElement).style.backgroundColor).toBe("");
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

  it("thêm câu: có sẵn thang 1–5; đổi khoảng 0–10, ghi nhãn, bỏ bắt buộc; Lưu gửi đúng định nghĩa", async () => {
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    const { container, getByLabelText } = renderBuilder(FORM);
    fireEvent.change(getByLabelText("Loại trường mới"), { target: { value: "linear_scale" } });
    fireEvent.click(container.querySelector('[data-testid="add-field"]')!);
    const card = container.querySelector('[data-testid="field-list"] [data-field]') as HTMLElement;
    const editor = card.querySelector('[data-testid="linear-scale-editor"]') as HTMLElement;
    expect(editor).not.toBeNull();
    const min = editor.querySelector('select[aria-label="Điểm bắt đầu"]') as HTMLSelectElement;
    const max = editor.querySelector('select[aria-label="Điểm kết thúc"]') as HTMLSelectElement;
    expect([min.value, max.value]).toEqual(["1", "5"]);
    expect(Array.from(min.options).map((o) => o.value)).toEqual(["0", "1"]);
    expect(Array.from(max.options).map((o) => o.value)).toEqual(["2", "3", "4", "5", "6", "7", "8", "9", "10"]);

    fireEvent.change(card.querySelector('input[aria-label="Câu hỏi"]')!, { target: { value: "Bạn giới thiệu chương trình cho bạn bè?" } });
    fireEvent.change(min, { target: { value: "0" } });
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.change(editor.querySelector('input[aria-label="Nhãn điểm bắt đầu"]')!, { target: { value: " Không bao giờ " } });
    fireEvent.change(editor.querySelector('input[aria-label="Nhãn điểm kết thúc"]')!, { target: { value: "Chắc chắn" } });
    expect(editor.querySelector('[data-testid="linear-scale-preview"]')?.textContent).toContain("0 · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10");
    fireEvent.click(Array.from(card.querySelectorAll("label")).find((l) => l.textContent?.includes("Bắt buộc trả lời"))!.querySelector("input")!);
    await save(container);

    expect(h.save).toHaveBeenCalledTimes(1);
    const added = h.save.mock.calls[0][1].fields[0];
    expect(added).toMatchObject({ type: "linear_scale", label: "Bạn giới thiệu chương trình cho bạn bè?", required: false, options: [] });
    expect(added.scale).toEqual({ min: 0, max: 10, minLabel: "Không bao giờ", maxLabel: "Chắc chắn" });
    expect(added).not.toHaveProperty("optionsText");
    expect(added).not.toHaveProperty("rows");
  });

  it("đổi loại sang thang đo thì có thang mặc định; đổi sang loại khác thì không gửi thang", async () => {
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    const text: CustomFormField = { id: "f_textaaaa", type: "short_text", label: "Câu A", help: "", required: true, hidden: false, options: [] };
    const { container } = renderBuilder({ ...FORM, fields: [text, { ...SCALE }] });
    const cards = Array.from(container.querySelectorAll('[data-testid="field-list"] [data-field]')) as HTMLElement[];
    fireEvent.change(cards[0].querySelector('select[aria-label="Loại trường"]')!, { target: { value: "linear_scale" } });
    fireEvent.change(cards[1].querySelector('select[aria-label="Loại trường"]')!, { target: { value: "number" } });
    await save(container);
    const [a, b] = h.save.mock.calls[0][1].fields;
    expect(a.scale).toEqual({ min: 1, max: 5, minLabel: "", maxLabel: "" });
    expect(b.type).toBe("number");
    expect(b).not.toHaveProperty("scale");
  });

  it("form đã có câu trả lời: giá trị thu hẹp khoảng bị tắt, mở rộng và sửa nhãn được", () => {
    const { container } = renderBuilder({ ...FORM, status: "published", fields: [SCALE] }, 3);
    const editor = container.querySelector('[data-testid="linear-scale-editor"]') as HTMLElement;
    const min = editor.querySelector('select[aria-label="Điểm bắt đầu"]') as HTMLSelectElement;
    const max = editor.querySelector('select[aria-label="Điểm kết thúc"]') as HTMLSelectElement;
    expect(Array.from(min.options).filter((o) => o.disabled).map((o) => o.value)).toEqual([]);
    expect(Array.from(max.options).filter((o) => o.disabled).map((o) => o.value)).toEqual(["2", "3", "4"]);
    expect((editor.querySelector('input[aria-label="Nhãn điểm bắt đầu"]') as HTMLInputElement).readOnly).toBe(false);
    expect(editor.querySelector('[data-testid="linear-scale-preview"]')?.textContent).toContain("chỉ mở rộng được thang");
  });
});
