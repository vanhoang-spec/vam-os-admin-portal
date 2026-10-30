/**
 * @vitest-environment jsdom
 */
/**
 * Form tùy chỉnh phần 2 (VAM00009): câu Có/Không rẽ nhánh, chặn người chưa có trên hệ thống, màu chủ đạo.
 * Rẽ nhánh phải đúng ở CẢ HAI bên: trình duyệt quyết định trang hiện ra, máy chủ quyết định câu nào bắt
 * buộc và câu nào được ghi — dữ liệu gửi lên là thứ người gửi tự đặt được.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  BRANCH_END,
  checkDefinitionRules,
  nextPageIndex,
  parseFieldDefinitions,
  parseFormSettings,
  splitPages,
  themeTextColor,
  validateFormAnswers,
  visitedPages,
  type CustomFormField
} from "@/lib/custom-form-core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/f/[code]/actions", () => ({ submitCustomFormAction: h.submit }));

import { PublicForm } from "@/app/f/[code]/public-form";

const field = (id: string, type: CustomFormField["type"], extra: Partial<CustomFormField> = {}): CustomFormField => ({
  id, type, label: `Câu ${id}`, help: "", required: type !== "page_break", hidden: false, options: [], ...extra
});
const YES_NO = ["Có", "Không"];
// Trang 1: email + câu sàng lọc. Có → trang A rồi kết thúc. Không → trang B.
const FORM: CustomFormField[] = [
  field("f_emailaaa", "email"),
  field("f_askaaaaa", "yes_no", { options: YES_NO, branches: { yes: "f_brkaaaaa", no: "f_brkbbbbb" } }),
  field("f_brkaaaaa", "page_break", { label: "Trang A" }),
  field("f_aaaaaaaa", "yes_no", { options: YES_NO, branches: { yes: BRANCH_END, no: BRANCH_END } }),
  field("f_brkbbbbb", "page_break", { label: "Trang B" }),
  field("f_bbbbbbbb", "short_text")
];
const read = (values: Record<string, string>) => (id: string) => (values[id] ? [values[id]] : []);
const answer = (values: Record<string, string>) => (id: string) => values[id];

describe("đường đi theo câu trả lời", () => {
  const pages = splitPages(FORM);
  it("Có đi trang A rồi kết thúc, Không đi thẳng trang B", () => {
    expect(visitedPages(pages, answer({ f_askaaaaa: "Có", f_aaaaaaaa: "Có" }))).toEqual([0, 1]);
    expect(visitedPages(pages, answer({ f_askaaaaa: "Không" }))).toEqual([0, 2]);
  });
  it("chưa trả lời thì đi trang kế tiếp", () => {
    expect(nextPageIndex(pages, 0, answer({}))).toBe(1);
  });
  it("đích lùi hoặc đã bị xoá bị bỏ qua: không vòng lặp, đi trang kế tiếp", () => {
    const back = [
      field("f_brk0aaaa", "page_break", { label: "Đầu" }),
      field("f_askaaaaa", "yes_no", { options: YES_NO }),
      field("f_brkaaaaa", "page_break"),
      field("f_loopaaaa", "yes_no", { options: YES_NO, branches: { yes: "f_brk0aaaa", no: "f_gonegone" } })
    ];
    const p = splitPages(back);
    expect(visitedPages(p, answer({ f_loopaaaa: "Có" }))).toEqual([0, 1]);
    expect(visitedPages(p, answer({ f_loopaaaa: "Không" }))).toEqual([0, 1]);
  });
});

describe("kiểm câu trả lời theo đường đi (máy chủ dùng đúng hàm này)", () => {
  it("câu bắt buộc ở trang bị bỏ qua không còn bắt buộc", () => {
    const out = validateFormAnswers(FORM, read({ f_emailaaa: "an@gmail.com", f_askaaaaa: "Không", f_bbbbbbbb: "x" }));
    expect(out.ok).toBe(true);
  });
  it("câu trả lời còn sót ở trang bị bỏ qua KHÔNG được ghi", () => {
    const out = validateFormAnswers(FORM, read({ f_emailaaa: "an@gmail.com", f_askaaaaa: "Không", f_bbbbbbbb: "x", f_aaaaaaaa: "Có" }));
    expect(out.answers).toEqual({ f_emailaaa: "an@gmail.com", f_askaaaaa: "Không", f_bbbbbbbb: "x" });
  });
  it("câu bắt buộc trên đường đi vẫn bắt buộc", () => {
    expect(validateFormAnswers(FORM, read({ f_emailaaa: "an@gmail.com", f_askaaaaa: "Không" })).errors).toHaveProperty("f_bbbbbbbb");
  });
  it("câu Có/Không chỉ nhận hai lựa chọn của nó", () => {
    expect(validateFormAnswers(FORM, read({ f_emailaaa: "an@gmail.com", f_askaaaaa: "Có lẽ" })).errors).toHaveProperty("f_askaaaaa");
  });
});

describe("định nghĩa form", () => {
  it("lựa chọn của câu Có/Không do hệ thống đặt; loại khác không mang branches", () => {
    const parsed = parseFieldDefinitions([
      { id: "f_askaaaaa", type: "yes_no", label: "Hỏi", options: ["X"], branches: { yes: BRANCH_END, no: "", extra: 1 } },
      { id: "f_bbbbbbbb", type: "short_text", label: "Tên", branches: { yes: BRANCH_END } }
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fields[0].options).toEqual(YES_NO);
    expect(parsed.fields[0].branches).toEqual({ yes: BRANCH_END, no: "" });
    expect(parsed.fields[1]).not.toHaveProperty("branches");
  });
  it("đích rẽ nhánh sai dạng bị từ chối", () => {
    expect(parseFieldDefinitions([{ id: "f_askaaaaa", type: "yes_no", label: "Hỏi", branches: { yes: "javascript:x" } }]).ok).toBe(false);
  });
  it("đích không còn trên form, đang ẩn, hoặc nằm trước câu hỏi: không lưu được", () => {
    const rules = { onePerEmail: false };
    const gone = [field("f_askaaaaa", "yes_no", { options: YES_NO, branches: { yes: "f_gonegone", no: "" } })];
    expect(checkDefinitionRules(gone, rules)).toContain("trang đích");
    const hidden = [field("f_askaaaaa", "yes_no", { options: YES_NO, branches: { yes: "f_brkaaaaa", no: "" } }), field("f_brkaaaaa", "page_break", { hidden: true }), field("f_bbbbbbbb", "short_text")];
    expect(checkDefinitionRules(hidden, rules)).toContain("trang đích");
    const before = [field("f_brkaaaaa", "page_break"), field("f_cccccccc", "short_text"), field("f_brkbbbbb", "page_break"), field("f_askaaaaa", "yes_no", { options: YES_NO, branches: { yes: "f_brkbbbbb", no: "" } })];
    expect(checkDefinitionRules(before, rules)).toContain("trang đích");
    expect(checkDefinitionRules(FORM, rules)).toBeNull();
  });
  it("email dùng cho chặn trùng nằm sau câu rẽ nhánh: không lưu được", () => {
    const late = [
      field("f_askaaaaa", "yes_no", { options: YES_NO, branches: { yes: "f_brkbbbbb", no: "" } }),
      field("f_brkaaaaa", "page_break"),
      field("f_emailaaa", "email"),
      field("f_brkbbbbb", "page_break"),
      field("f_bbbbbbbb", "short_text")
    ];
    expect(checkDefinitionRules(late, { onePerEmail: true })).toContain("trường Email phải nằm trước");
    expect(checkDefinitionRules(late, { onePerEmail: false })).toBeNull();
  });
  it("bật chặn người lạ cần Email và Họ tên bắt buộc", () => {
    const rules = { onePerEmail: false, requireKnownPerson: true };
    expect(checkDefinitionRules([field("f_nameaaaa", "short_text", { label: "Họ và tên" })], rules)).toContain("trường Email");
    expect(checkDefinitionRules([field("f_emailaaa", "email")], rules)).toContain("Họ và tên");
    expect(checkDefinitionRules([field("f_emailaaa", "email"), field("f_nameaaaa", "short_text", { label: "Họ và tên", required: false })], rules)).toContain("Họ và tên");
    expect(checkDefinitionRules([field("f_emailaaa", "email"), field("f_nameaaaa", "short_text", { label: "Họ và tên" })], rules)).toBeNull();
  });
  it("màu: chỉ nhận #rrggbb, chuẩn về chữ thường; rỗng là mặc định", () => {
    const base = { title: "T", description: "", programId: "", thankYou: "", onePerEmail: false, opensAt: null, closesAt: null };
    const ok = parseFormSettings({ ...base, themeColor: "#AABBCC" });
    expect(ok.ok && ok.settings.themeColor).toBe("#aabbcc");
    const none = parseFormSettings({ ...base, themeColor: "" });
    expect(none.ok && none.settings.themeColor).toBeNull();
    expect(parseFormSettings({ ...base, themeColor: "red;background:url(x)" }).ok).toBe(false);
  });
  it("chữ trên nền màu đọc được ở cả hai đầu", () => {
    expect(themeTextColor("#ffff00")).toBe("#111827");
    expect(themeTextColor("#0f172a")).toBe("#ffffff");
  });
});

describe("form công khai rẽ nhánh", () => {
  beforeEach(() => {
    h.submit.mockReset();
    window.localStorage.clear();
  });
  afterEach(cleanup);
  const click = async (el: Element) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };
  const by = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const pick = (c: HTMLElement, id: string, option: string) =>
    click(Array.from(c.querySelectorAll(`[data-field="${id}"] label`)).find((l) => l.textContent === option)!.querySelector("input")!);
  const firstPage = async (c: HTMLElement, option: string) => {
    fireEvent.change(c.querySelector("#q-f_emailaaa")!, { target: { value: "an@gmail.com" } });
    await pick(c, "f_askaaaaa", option);
    await click(by(c, "page-next"));
  };

  it("Không → sang thẳng trang B; Quay lại về trang vừa đi; đổi sang Có → trang A", async () => {
    const { container } = render(<PublicForm code="a1b2c3d4e5f6" fields={FORM} />);
    await firstPage(container, "Không");
    expect(container.querySelector('[data-field="f_bbbbbbbb"]')).not.toBeNull();
    expect(container.querySelector('[data-field="f_aaaaaaaa"]')).toBeNull();
    expect(by(container, "page-progress").textContent).toBe("Trang 2");
    await click(by(container, "page-back"));
    await pick(container, "f_askaaaaa", "Có");
    await click(by(container, "page-next"));
    expect(container.querySelector('[data-field="f_aaaaaaaa"]')).not.toBeNull();
  });

  it("đích Kết thúc: trang đó có ô đồng ý và nút Gửi, gửi lên chỉ cần các trang đã đi", async () => {
    h.submit.mockResolvedValue({ ok: true, message: "Cảm ơn!", errors: {} });
    const { container } = render(<PublicForm code="a1b2c3d4e5f6" fields={FORM} />);
    await firstPage(container, "Có");
    expect(by(container, "form-submit")).toBeNull();
    await pick(container, "f_aaaaaaaa", "Có");
    expect(by(container, "form-submit")).not.toBeNull();
    fireEvent.click(container.querySelector("#q-__consent")!);
    await act(async () => {
      fireEvent.submit(by(container, "custom-form"));
    });
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it("màu chủ đạo áp vào nút; không đặt màu thì không có style", () => {
    const colored = render(<PublicForm code="a1b2c3d4e5f6" fields={FORM} themeColor="#ffff00" />);
    expect(by(colored.container, "page-next").style.backgroundColor).not.toBe("");
    expect(by(colored.container, "page-next").style.color).not.toBe("");
    cleanup();
    const plain = render(<PublicForm code="a1b2c3d4e5f6" fields={FORM} />);
    expect(by(plain.container, "page-next").getAttribute("style")).toBeNull();
  });
});
