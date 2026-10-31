/**
 * @vitest-environment jsdom
 */
/**
 * Điều hướng trang của Form tùy chỉnh (phản hồi BTC trên VAM00009): đích theo từng lựa chọn, đích mặc định
 * của trang, đổi nhánh sau khi quay lại, xoá trang, kiểm tra trước khi công khai. Form đang chạy không được
 * đổi hành vi, nên các ca "dữ liệu cũ" quan trọng ngang các ca tính năng mới.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  BRANCH_END,
  branchBlockers,
  branchWarnings,
  checkDefinitionRules,
  hasBranching,
  nextPageIndex,
  optionTargetsOf,
  parseFieldDefinitions,
  publishBlocker,
  removePageLinks,
  splitPages,
  storedFields,
  validateFormAnswers,
  visitedPages,
  type CustomFormField
} from "@/lib/custom-form-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/app/f/[code]/actions", () => ({ submitCustomFormAction: h.submit }));
vi.mock("@/app/forms/actions", () => ({ saveCustomFormAction: h.save, setCustomFormStatusAction: vi.fn(), sendCustomFormReceiptTestAction: vi.fn(), createEventForFormAction: vi.fn() }));
vi.mock("@/app/forms/[id]/form-image-field", () => ({ FormImageField: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));

import { PublicForm } from "@/app/f/[code]/public-form";
import { FormBuilder, type BuilderForm } from "@/app/forms/[id]/form-builder";

const field = (id: string, type: CustomFormField["type"], extra: Partial<CustomFormField> = {}): CustomFormField => ({
  id, type, label: `Câu ${id}`, help: "", required: type !== "page_break" && type !== "section", hidden: false, options: [], ...extra
});
const answer = (values: Record<string, string>) => (id: string) => values[id];
const read = (values: Record<string, string | string[]>) => (id: string) => {
  const value = values[id];
  return Array.isArray(value) ? value : value ? [value] : [];
};
const DEST = ["Hà Nội", "Đà Nẵng", "TP.HCM"];
/** Một câu chọn 3 lựa chọn: hai nhánh riêng, một lựa chọn chưa đặt đích. */
const CHOICE_FORM = (type: "single_choice" | "dropdown" = "single_choice"): CustomFormField[] => [
  field("f_askaaaaa", type, { options: DEST, optionTargets: { "Hà Nội": "f_brkbbbbb", "Đà Nẵng": BRANCH_END } }),
  field("f_brkaaaaa", "page_break", { label: "A" }),
  field("f_aaaaaaaa", "short_text"),
  field("f_brkbbbbb", "page_break", { label: "B" }),
  field("f_bbbbbbbb", "short_text")
];

describe("a. đích theo từng lựa chọn", () => {
  it.each(["single_choice", "dropdown"] as const)("%s: mỗi lựa chọn đi đúng đích; chưa đặt thì sang trang kế", (type) => {
    const pages = splitPages(CHOICE_FORM(type));
    expect(visitedPages(pages, answer({ f_askaaaaa: "Hà Nội" }))).toEqual([0, 2]);
    expect(visitedPages(pages, answer({ f_askaaaaa: "Đà Nẵng" }))).toEqual([0]);
    expect(visitedPages(pages, answer({ f_askaaaaa: "TP.HCM" }))).toEqual([0, 1, 2]);
  });
  it("yes_no đã lưu dạng {yes,no}: đọc ra bản đồ lựa chọn, đường đi y nguyên, định nghĩa không bị viết lại", () => {
    const old = { id: "f_askaaaaa", type: "yes_no", label: "Hỏi", help: "", required: true, hidden: false, options: ["Có", "Không"], branches: { yes: "f_brkbbbbb", no: BRANCH_END } };
    const [loaded] = storedFields([old]);
    expect(loaded).toEqual(old);
    expect(Array.from(optionTargetsOf(loaded).entries())).toEqual([["Có", "f_brkbbbbb"], ["Không", BRANCH_END]]);
    const pages = splitPages([loaded, field("f_brkaaaaa", "page_break"), field("f_aaaaaaaa", "short_text"), field("f_brkbbbbb", "page_break"), field("f_bbbbbbbb", "short_text")]);
    expect(visitedPages(pages, answer({ f_askaaaaa: "Có" }))).toEqual([0, 2]);
    expect(visitedPages(pages, answer({ f_askaaaaa: "Không" }))).toEqual([0]);
  });
  it("trình phân tích: chỉ giữ đích của lựa chọn còn trên câu; câu chọn nhiều không mang đích; đích sai dạng bị từ chối", () => {
    const parsed = parseFieldDefinitions([
      { id: "f_askaaaaa", type: "dropdown", label: "Hỏi", options: ["A", "B"], optionTargets: { A: BRANCH_END, "Đã xoá": "f_brkaaaaa", B: "" } },
      { id: "f_mulaaaaa", type: "multi_choice", label: "Nhiều", options: ["A"], optionTargets: { A: BRANCH_END } }
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fields[0].optionTargets).toEqual({ A: BRANCH_END });
    expect(parsed.fields[1]).not.toHaveProperty("optionTargets");
    expect(parseFieldDefinitions([{ id: "f_askaaaaa", type: "dropdown", label: "Hỏi", options: ["A"], optionTargets: { A: "javascript:x" } }]).ok).toBe(false);
    expect(parseFieldDefinitions([{ id: "f_askaaaaa", type: "dropdown", label: "Hỏi", options: ["A"], optionTargets: ["x"] }]).ok).toBe(false);
  });
  it("câu trả lời là chữ người gửi đặt: tên thuộc tính object không thành đích giả", () => {
    const pages = splitPages(CHOICE_FORM());
    expect(nextPageIndex(pages, 0, answer({ f_askaaaaa: "constructor" }))).toBe(1);
    // Lựa chọn tên "constructor" mà chưa đặt đích: đọc object thô sẽ ra hàm của Object.prototype.
    const odd = [field("f_askaaaaa", "dropdown", { options: ["constructor", "X"], optionTargets: { X: "" } }), field("f_brkaaaaa", "page_break"), field("f_aaaaaaaa", "short_text")];
    expect(hasBranching(odd)).toBe(false);
    expect(nextPageIndex(splitPages(odd), 0, answer({ f_askaaaaa: "constructor" }))).toBe(1);
  });
  it("máy chủ đọc đường đi như đọc câu trả lời: thêm khoảng trắng hay giá trị rỗng không né được nhánh", () => {
    const out = validateFormAnswers(CHOICE_FORM(), read({ f_askaaaaa: " Hà Nội ", f_bbbbbbbb: "x" }));
    expect(out.answers).toEqual({ f_askaaaaa: "Hà Nội", f_bbbbbbbb: "x" });
    expect(out.ok).toBe(true);
    const padded = validateFormAnswers(CHOICE_FORM(), read({ f_askaaaaa: ["", "Đà Nẵng"], f_aaaaaaaa: "lén", f_bbbbbbbb: "lén" }));
    expect(padded.answers).toEqual({ f_askaaaaa: "Đà Nẵng" });
  });
});

describe("b. đích mặc định của trang", () => {
  // Trang đầu có ngắt trang để đặt đích. A rẽ sang C, B kết thúc riêng, C là trang hội tụ.
  const FLOW: CustomFormField[] = [
    field("f_brk0aaaa", "page_break", { label: "Đầu" }),
    field("f_askaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: "", no: "f_brkbbbbb" } }),
    field("f_brkaaaaa", "page_break", { label: "A", nextPage: "f_brkccccc" }),
    field("f_aaaaaaaa", "short_text"),
    field("f_brkbbbbb", "page_break", { label: "B", nextPage: BRANCH_END }),
    field("f_bbbbbbbb", "short_text"),
    field("f_brkccccc", "page_break", { label: "C" }),
    field("f_cccccccc", "short_text")
  ];
  const pages = splitPages(FLOW);
  it("ngắt trang đọc được nextPage; loại khác không mang", () => {
    const parsed = parseFieldDefinitions([
      { id: "f_brkaaaaa", type: "page_break", label: "", nextPage: BRANCH_END },
      { id: "f_aaaaaaaa", type: "short_text", label: "Tên", nextPage: BRANCH_END }
    ]);
    expect(parsed.ok && parsed.fields[0].nextPage).toBe(BRANCH_END);
    expect(parsed.ok && parsed.fields[1]).not.toHaveProperty("nextPage");
    expect(parseFieldDefinitions([{ id: "f_brkaaaaa", type: "page_break", label: "", nextPage: "x y" }]).ok).toBe(false);
  });
  it("nhánh A đi tắt tới trang hội tụ, nhánh B kết thúc độc lập; trang ngoài nhánh bị bỏ qua", () => {
    expect(visitedPages(pages, answer({ f_askaaaaa: "Có" }))).toEqual([0, 1, 3]);
    expect(visitedPages(pages, answer({ f_askaaaaa: "Không" }))).toEqual([0, 2]);
  });
  it("đích theo câu trả lời thắng đích mặc định của trang; lựa chọn không có đích thì đi theo trang", () => {
    const form = [
      field("f_brk0aaaa", "page_break", { nextPage: "f_brkccccc" }),
      field("f_askaaaaa", "single_choice", { options: ["X", "Y"], optionTargets: { X: "f_brkaaaaa" } }),
      field("f_brkaaaaa", "page_break"),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkccccc", "page_break"),
      field("f_cccccccc", "short_text")
    ];
    const p = splitPages(form);
    expect(nextPageIndex(p, 0, answer({ f_askaaaaa: "X" }))).toBe(1);
    expect(nextPageIndex(p, 0, answer({ f_askaaaaa: "Y" }))).toBe(2);
    expect(nextPageIndex(p, 0, answer({}))).toBe(2);
  });
  it("form không đặt gì đi tuần tự như cũ, và vẫn hiện số trang N/M", () => {
    const plain = [field("f_aaaaaaaa", "short_text"), field("f_brkaaaaa", "page_break"), field("f_bbbbbbbb", "short_text")];
    expect(visitedPages(splitPages(plain), answer({}))).toEqual([0, 1]);
    expect(hasBranching(plain)).toBe(false);
  });
  it("đích mặc định lùi hay mất (lưu sót) bị bỏ qua: không vòng lặp, đi trang kế", () => {
    const loop = [
      field("f_brk0aaaa", "page_break"),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkaaaaa", "page_break", { nextPage: "f_brk0aaaa" }),
      field("f_bbbbbbbb", "short_text"),
      field("f_brkbbbbb", "page_break", { nextPage: "f_brkbbbbb" }),
      field("f_cccccccc", "short_text")
    ];
    expect(visitedPages(splitPages(loop), answer({}))).toEqual([0, 1, 2]);
  });
  it("trang có đích mặc định làm form thành rẽ nhánh: Email phải nằm trước hoặc cùng trang đó", () => {
    const late = [
      field("f_brk0aaaa", "page_break", { nextPage: "f_brkbbbbb" }),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkaaaaa", "page_break"),
      field("f_emailaaa", "email"),
      field("f_brkbbbbb", "page_break"),
      field("f_bbbbbbbb", "short_text")
    ];
    // Không có câu rẽ nhánh nào, chỉ đích của trang: số trang N/M vẫn sai nên phải hiện "Trang N".
    expect(hasBranching(late)).toBe(true);
    expect(checkDefinitionRules(late, { onePerEmail: true })).toContain("trường Email phải nằm trước");
    expect(checkDefinitionRules(late, { onePerEmail: false })).toBeNull();
    const nameLate = [field("f_emailaaa", "email"), ...late.filter((f) => f.id !== "f_emailaaa"), field("f_nameaaaa", "short_text", { label: "Họ và tên" })];
    expect(checkDefinitionRules(nameLate, { onePerEmail: true, requireKnownPerson: true })).toContain("Họ và tên");
    const sameEmailPage = [late[0], field("f_emailaaa", "email"), ...late.slice(1).filter((f) => f.id !== "f_emailaaa")];
    expect(checkDefinitionRules(sameEmailPage, { onePerEmail: true })).toBeNull();
  });
});

describe("e. kiểm tra đích trước khi lưu và công khai", () => {
  const rules = { onePerEmail: false };
  const withTarget = (type: "yes_no" | "option" | "page", target: string, tail: CustomFormField[]) => {
    const head = type === "page" ? [field("f_brk0aaaa", "page_break", { label: "Đầu", nextPage: target })] : [];
    const ask =
      type === "yes_no"
        ? field("f_askaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: target, no: "" } })
        : type === "option"
          ? field("f_askaaaaa", "dropdown", { options: ["X", "Y"], optionTargets: { X: target } })
          : field("f_askaaaaa", "short_text");
    return [...head, ask, ...tail];
  };
  it.each(["yes_no", "option", "page"] as const)("%s: đích mất / đang ẩn / trang trống đều chặn lưu, kèm đúng lý do", (type) => {
    expect(checkDefinitionRules(withTarget(type, "f_gonegone", []), rules)).toContain("không còn trên form");
    const hidden = [field("f_brkaaaaa", "page_break", { hidden: true }), field("f_bbbbbbbb", "short_text")];
    expect(checkDefinitionRules(withTarget(type, "f_brkaaaaa", hidden), rules)).toContain("đang ẩn");
    const empty = [field("f_brkaaaaa", "page_break"), field("f_brkbbbbb", "page_break"), field("f_bbbbbbbb", "short_text")];
    expect(checkDefinitionRules(withTarget(type, "f_brkaaaaa", empty), rules)).toContain("chưa có câu hỏi");
  });
  it("đích nằm trước hoặc chính trang đó: chặn lưu", () => {
    const form = [
      field("f_brk0aaaa", "page_break"),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkaaaaa", "page_break", { nextPage: "f_brk0aaaa" }),
      field("f_bbbbbbbb", "short_text")
    ];
    expect(checkDefinitionRules(form, rules)).toContain("nằm trước");
    const self = [form[0], form[1], { ...form[2], nextPage: "f_brkaaaaa" }, form[3]];
    expect(checkDefinitionRules(self, rules)).toContain("nằm trước");
    const option = [field("f_brk0aaaa", "page_break"), field("f_aaaaaaaa", "short_text"), field("f_brkaaaaa", "page_break"), field("f_askaaaaa", "single_choice", { options: ["X"], optionTargets: { X: "f_brk0aaaa" } })];
    expect(checkDefinitionRules(option, rules)).toContain("nằm trước");
  });
  it("trang không ai tới: chặn công khai nhưng không chặn lưu nháp", () => {
    const form = [
      field("f_askaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: "f_brkbbbbb", no: BRANCH_END } }),
      field("f_brkaaaaa", "page_break", { label: "Lạc" }),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkbbbbb", "page_break"),
      field("f_bbbbbbbb", "short_text")
    ];
    expect(publishBlocker(form)).toContain("Trang “Lạc” không có đường tới");
    expect(checkDefinitionRules(form, rules)).toBeNull();
  });
  it("trang tới được qua đường mặc định thì không báo: câu tùy chọn, hoặc còn lựa chọn chưa đặt đích", () => {
    const skeleton = (ask: CustomFormField) => [ask, field("f_brkaaaaa", "page_break"), field("f_aaaaaaaa", "short_text"), field("f_brkbbbbb", "page_break"), field("f_bbbbbbbb", "short_text")];
    const optional = field("f_askaaaaa", "single_choice", { required: false, options: ["X"], optionTargets: { X: "f_brkbbbbb" } });
    expect(publishBlocker(skeleton(optional))).toBeNull();
    const partial = field("f_askaaaaa", "single_choice", { options: ["X", "Y"], optionTargets: { X: "f_brkbbbbb" } });
    expect(publishBlocker(skeleton(partial))).toBeNull();
  });
  it("đích mặc định của trang làm trang kế không ai tới: báo; trang đứng sau trang lạc cũng không được coi là tới được", () => {
    const form = [
      field("f_brk0aaaa", "page_break", { nextPage: BRANCH_END }),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkaaaaa", "page_break", { label: "Giữa", nextPage: "f_brkbbbbb" }),
      field("f_bbbbbbbb", "short_text"),
      field("f_brkbbbbb", "page_break", { label: "Cuối" }),
      field("f_cccccccc", "short_text")
    ];
    expect(branchBlockers(form)).toHaveLength(2);
    expect(publishBlocker(form)).toContain("Giữa");
  });
  it("form đang công khai: trang lạc đã có từ trước không chặn lưu, trang lạc mới thì chặn", () => {
    const old = [
      field("f_askaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: BRANCH_END, no: BRANCH_END } }),
      field("f_brkaaaaa", "page_break", { label: "Cũ" }),
      field("f_aaaaaaaa", "short_text")
    ];
    expect(publishBlocker(old)).not.toBeNull();
    expect(publishBlocker(old, old)).toBeNull();
    const worse = [...old, field("f_brkbbbbb", "page_break", { label: "Mới" }), field("f_bbbbbbbb", "short_text")];
    expect(publishBlocker(worse, old)).toContain("Mới");
  });
  it("lựa chọn chưa đặt đích chỉ cảnh báo, không chặn gì; đặt đủ hoặc không rẽ nhánh thì im", () => {
    const form = CHOICE_FORM();
    expect(branchWarnings(form).join()).toContain("“TP.HCM”");
    expect(branchWarnings(form).join()).not.toContain("Hà Nội");
    expect(checkDefinitionRules(form, { onePerEmail: false })).toBeNull();
    expect(publishBlocker(form)).toBeNull();
    expect(branchWarnings([field("f_askaaaaa", "single_choice", { options: ["X", "Y"] })])).toEqual([]);
  });
});

describe("d. xoá trang: phần thuần", () => {
  it("bỏ mọi liên kết tới trang đó, giữ liên kết khác, liệt kê đúng chỗ bị mất", () => {
    const form = [
      field("f_askaaaaa", "single_choice", { label: "Chọn", options: ["X", "Y"], optionTargets: { X: "f_brkaaaaa", Y: "f_brkbbbbb" } }),
      field("f_yesaaaaa", "yes_no", { label: "Có không", options: ["Có", "Không"], branches: { yes: "f_brkaaaaa", no: BRANCH_END } }),
      field("f_brkbbbbb", "page_break", { label: "Bê", nextPage: "f_brkaaaaa" }),
      field("f_bbbbbbbb", "short_text"),
      field("f_brkaaaaa", "page_break", { label: "A" }),
      field("f_aaaaaaaa", "short_text")
    ];
    const { fields, lost } = removePageLinks(form, "f_brkaaaaa");
    expect(fields.map((f) => f.id)).not.toContain("f_brkaaaaa");
    expect(fields[0].optionTargets).toEqual({ Y: "f_brkbbbbb" });
    expect(fields[1].branches).toEqual({ yes: "", no: BRANCH_END });
    expect(fields[2].nextPage).toBe("");
    expect(lost).toEqual(["Câu “Chọn”, lựa chọn “X”", "Câu “Có không”, lựa chọn “Có”", "Trang “Bê”, mục Trang tiếp theo"]);
    expect(checkDefinitionRules(fields, { onePerEmail: false })).toBeNull();
  });
});

describe("c. đổi lựa chọn sau khi quay lại", () => {
  beforeEach(() => {
    h.submit.mockReset();
    window.localStorage.clear();
  });
  afterEach(cleanup);
  const FORM = [
    field("f_askaaaaa", "single_choice", { options: ["A", "B"], optionTargets: { A: "f_brkaaaaa", B: "f_brkbbbbb" } }),
    field("f_brkaaaaa", "page_break", { label: "A", nextPage: BRANCH_END }),
    field("f_aaaaaaaa", "short_text"),
    field("f_brkbbbbb", "page_break", { label: "B" }),
    field("f_bbbbbbbb", "short_text")
  ];
  const by = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const click = async (el: Element) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };
  const pick = (c: HTMLElement, option: string) =>
    click(Array.from(c.querySelectorAll('[data-field="f_askaaaaa"] label')).find((l) => l.textContent === option)!.querySelector("input")!);
  const fill = (c: HTMLElement, id: string, value: string) => fireEvent.change(c.querySelector(`#q-${id}`)!, { target: { value } });

  it("dữ liệu nhánh cũ còn nguyên khi quay lại nhánh đó, nhưng lúc gửi chỉ nhánh cuối được tính", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code="a1b2c3d4e5f6" fields={FORM} />);
    await pick(container, "A");
    await click(by(container, "page-next"));
    fill(container, "f_aaaaaaaa", "nhánh A");
    await click(by(container, "page-back"));
    await pick(container, "B");
    await click(by(container, "page-next"));
    expect(container.querySelector('[data-field="f_aaaaaaaa"]')).toBeNull();
    fill(container, "f_bbbbbbbb", "nhánh B");
    // Đổi ý thêm lần nữa: chữ đã gõ ở nhánh A vẫn còn trên trang.
    await click(by(container, "page-back"));
    await pick(container, "A");
    await click(by(container, "page-next"));
    expect((container.querySelector("#q-f_aaaaaaaa") as HTMLInputElement).value).toBe("nhánh A");
    await click(by(container, "page-back"));
    await pick(container, "B");
    await click(by(container, "page-next"));
    fireEvent.click(container.querySelector("#q-__consent")!);
    await act(async () => {
      fireEvent.submit(by(container, "custom-form"));
    });
    expect(h.submit).toHaveBeenCalledTimes(1);
    const { values } = h.submit.mock.calls[0][1];
    // Trình duyệt gửi cả bản giữ tạm; câu nào được ghi là do hàm máy chủ dùng chung quyết định.
    expect(validateFormAnswers(FORM, read(values)).answers).toEqual({ f_askaaaaa: "B", f_bbbbbbbb: "nhánh B" });
  });

  it("câu sai định dạng còn sót ở nhánh cũ không chặn gửi", () => {
    const form = [FORM[0], FORM[1], field("f_emailaaa", "email"), FORM[3], FORM[4]];
    expect(validateFormAnswers(form, read({ f_askaaaaa: "B", f_emailaaa: "sai", f_bbbbbbbb: "x" })).ok).toBe(true);
  });

  it("trang có đích mặc định Kết thúc hiện nút Gửi và số trang dạng Trang N", async () => {
    const { container } = render(<PublicForm code="a1b2c3d4e5f6" fields={FORM} />);
    await pick(container, "A");
    await click(by(container, "page-next"));
    expect(by(container, "form-submit")).not.toBeNull();
    expect(by(container, "page-progress").textContent).toBe("Trang 2");
  });
});

describe("trình tạo form", () => {
  const BASE: BuilderForm = {
    id: "11111111-2222-4333-8444-555555555555",
    eventId: null, registrationLimit: null, requireKnownPerson: false, themeColor: null, bannerPath: null, logoPath: null, logoPosition: "left",
    publicCode: "a1b2c3d4e5f6", title: "Thử", description: "", programId: null, status: "draft", opensAt: null, closesAt: null, thankYou: "",
    onePerEmail: false, autoReply: false, autoReplySubject: "", autoReplyBody: "", fields: []
  };
  const open = (fields: CustomFormField[], responseCount = 0) =>
    render(<FormBuilder form={{ ...BASE, fields }} programs={[]} responseCount={responseCount} publicUrl="https://os.test/f/x" />);
  const by = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const card = (c: HTMLElement, id: string) => c.querySelector(`[data-field="${id}"]`) as HTMLElement;
  const save = async (c: HTMLElement) => {
    h.save.mockResolvedValue({ ok: true, message: "Đã lưu form." });
    await act(async () => {
      fireEvent.click(by(c, "save-form"));
    });
    return h.save.mock.calls[h.save.mock.calls.length - 1][1].fields as CustomFormField[];
  };
  const selectOf = (c: HTMLElement, label: string) => c.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("a. sửa chữ một lựa chọn giữ đích; thêm lựa chọn; xoá lựa chọn bỏ luôn đích của nó", async () => {
    const { container } = open(CHOICE_FORM());
    const ask = card(container, "f_askaaaaa");
    fireEvent.change(ask.querySelector('input[aria-label="Lựa chọn 1"]')!, { target: { value: "Thủ đô" } });
    fireEvent.click(ask.querySelector('button[aria-label="Xoá lựa chọn 2"]')!);
    fireEvent.click(by(ask, "add-option"));
    fireEvent.change(ask.querySelector('input[aria-label="Lựa chọn 3"]')!, { target: { value: "Huế" } });
    fireEvent.change(selectOf(ask, "Đích của lựa chọn 3"), { target: { value: BRANCH_END } });
    const saved = (await save(container))[0];
    expect(saved.options).toEqual(["Thủ đô", "TP.HCM", "Huế"]);
    expect(saved.optionTargets).toEqual({ "Thủ đô": "f_brkbbbbb", "Huế": BRANCH_END });
  });
  it("a. dán nhiều dòng tách thành nhiều lựa chọn, dòng đang có đích giữ đích", async () => {
    const { container } = open(CHOICE_FORM("dropdown"));
    const ask = card(container, "f_askaaaaa");
    fireEvent.paste(ask.querySelector('input[aria-label="Lựa chọn 1"]')!, { clipboardData: { getData: () => "Một\r\nHai\n\nBa" } });
    const saved = (await save(container))[0];
    expect(saved.options).toEqual(["Một", "Hai", "Ba", "Đà Nẵng", "TP.HCM"]);
    expect(saved.optionTargets).toEqual({ "Một": "f_brkbbbbb", "Đà Nẵng": BRANCH_END });
  });
  it("a. form đã có câu trả lời: lựa chọn cũ khoá, thêm lựa chọn mới vẫn được", () => {
    const { container } = open(CHOICE_FORM(), 3);
    const ask = card(container, "f_askaaaaa");
    expect((ask.querySelector('input[aria-label="Lựa chọn 1"]') as HTMLInputElement).readOnly).toBe(true);
    expect((ask.querySelector('button[aria-label="Xoá lựa chọn 1"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(by(ask, "add-option"));
    expect((ask.querySelector('input[aria-label="Lựa chọn 4"]') as HTMLInputElement).readOnly).toBe(false);
  });
  it("a. câu chọn nhiều vẫn nhập mỗi dòng một lựa chọn, không có ô đích; câu Có/Không vẫn lưu dạng {yes,no}", async () => {
    const { container } = open([
      field("f_mulaaaaa", "multi_choice", { options: ["A"] }),
      field("f_yesaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: "", no: "" } }),
      field("f_brkaaaaa", "page_break"),
      field("f_aaaaaaaa", "short_text")
    ]);
    expect(by(card(container, "f_mulaaaaa"), "option-rows")).toBeNull();
    fireEvent.change(selectOf(container, "Đích khi trả lời Có"), { target: { value: "f_brkaaaaa" } });
    const saved = await save(container);
    expect(saved[1].branches).toEqual({ yes: "f_brkaaaaa", no: "" });
    expect(saved[1]).not.toHaveProperty("optionTargets");
  });
  it("b. ô Trang tiếp theo chỉ liệt kê trang phía sau và Kết thúc; đích hỏng vẫn hiện ra", async () => {
    const form = [
      field("f_brkaaaaa", "page_break", { label: "A" }),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkbbbbb", "page_break", { label: "B", nextPage: "f_brkaaaaa" }),
      field("f_bbbbbbbb", "short_text"),
      field("f_brkccccc", "page_break", { label: "C" }),
      field("f_cccccccc", "short_text")
    ];
    const { container } = open(form);
    const select = selectOf(card(container, "f_brkbbbbb"), "Trang tiếp theo");
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels.join("|")).toBe("Trang kế tiếp (mặc định)|Đích không còn hợp lệ — chọn lại|Trang: C|Kết thúc form (tới nút Gửi)");
    fireEvent.change(select, { target: { value: "f_brkccccc" } });
    expect((await save(container))[2].nextPage).toBe("f_brkccccc");
  });
  it("b. trang đầu không có ngắt trang: có gợi ý và nút thêm; có sẵn ngắt trang đầu thì không; form một trang thì không", async () => {
    const { container, unmount } = open(CHOICE_FORM());
    expect(by(container, "first-page-hint")).not.toBeNull();
    fireEvent.click(by(container, "add-first-break"));
    expect(by(container, "first-page-hint")).toBeNull();
    const saved = await save(container);
    expect(saved[0].type).toBe("page_break");
    // Ngắt trang đầu không sinh trang rỗng.
    expect(splitPages(saved)).toHaveLength(3);
    unmount();
    expect(by(open([field("f_aaaaaaaa", "short_text")]).container, "first-page-hint")).toBeNull();
  });
  it("d. xoá trang: liên kết biến mất, cảnh báo liệt kê đúng câu và trang, lưu xong thì hết cảnh báo", async () => {
    const { container } = open([
      field("f_askaaaaa", "single_choice", { label: "Chọn", options: ["X", "Y"], optionTargets: { X: "f_brkbbbbb" } }),
      field("f_yesaaaaa", "yes_no", { label: "Có không", options: ["Có", "Không"], branches: { yes: "f_brkbbbbb", no: "" } }),
      field("f_brkaaaaa", "page_break", { label: "A", nextPage: "f_brkbbbbb" }),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkbbbbb", "page_break", { label: "B" }),
      field("f_bbbbbbbb", "short_text")
    ]);
    const del = Array.from(card(container, "f_brkbbbbb").querySelectorAll("button")).find((b) => b.textContent?.trim() === "Xoá")!;
    fireEvent.click(del);
    const notice = by(container, "lost-links").textContent;
    expect(notice).toContain("Đã xoá trang “B”");
    expect(notice).toContain("Câu “Chọn”, lựa chọn “X”");
    expect(notice).toContain("Câu “Có không”, lựa chọn “Có”");
    expect(notice).toContain("Trang “A”, mục Trang tiếp theo");
    const saved = await save(container);
    expect(saved[0]).not.toHaveProperty("optionTargets");
    expect(saved[1].branches).toEqual({ yes: "", no: "" });
    expect(saved[2].nextPage ?? "").toBe("");
    expect(by(container, "lost-links")).toBeNull();
  });
  it("d. xoá trang không ai trỏ tới thì không cảnh báo; đổi ngắt trang sang loại khác cũng bỏ liên kết", () => {
    const form = [
      field("f_askaaaaa", "dropdown", { label: "Chọn", options: ["X"], optionTargets: { X: "f_brkbbbbb" } }),
      field("f_brkaaaaa", "page_break", { label: "A" }),
      field("f_aaaaaaaa", "short_text"),
      field("f_brkbbbbb", "page_break", { label: "B" }),
      field("f_bbbbbbbb", "short_text")
    ];
    const { container } = open(form);
    fireEvent.click(Array.from(card(container, "f_brkaaaaa").querySelectorAll("button")).find((b) => b.textContent?.trim() === "Xoá")!);
    expect(by(container, "lost-links")).toBeNull();
    fireEvent.change(selectOf(card(container, "f_brkbbbbb"), "Loại trường"), { target: { value: "section" } });
    expect(by(container, "lost-links").textContent).toContain("Câu “Chọn”, lựa chọn “X”");
    expect(selectOf(card(container, "f_askaaaaa"), "Đích của lựa chọn 1").value).toBe("");
  });
  it("e. bảng báo: lỗi chặn và cảnh báo tách riêng, hiện ngay khi sửa", () => {
    const { container } = open(CHOICE_FORM());
    expect(by(container, "branch-blockers")).toBeNull();
    expect(by(container, "branch-warnings").textContent).toContain("“TP.HCM”");
    fireEvent.click(Array.from(card(container, "f_brkbbbbb").querySelectorAll("button")).find((b) => b.textContent?.trim() === "Ẩn")!);
    expect(by(container, "branch-blockers").textContent).toContain("đang ẩn");
  });
});
