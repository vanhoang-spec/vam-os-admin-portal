/** @vitest-environment jsdom */
/**
 * Trang "Chữ trên form đăng ký".
 *
 * Canh: mỗi khối gửi kèm chữ màn hình đã hiện (để nhận ra người khác vừa sửa); nút
 * "Dùng lại chữ mặc định" đưa đúng chữ mặc định vào ô; lưu hỏng không xoá chữ đang
 * gõ; và trang chỉ mở cho người qua cả hai cổng quyền.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormTextActionState } from "@/lib/application-form-text-core";

const formState = vi.hoisted(() => ({ value: null as FormTextActionState | null }));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: FormTextActionState) => [formState.value ?? initial, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/app/actions/application-form-texts", () => ({ saveApplicationFormTextsAction: vi.fn() }));

import { FormTextGroupEditor, type FormTextEditorSlot } from "@/app/admin/seasons-forms/form-texts/form-text-group-editor";

const NOTE_DEFAULT = "Lưu ý: Chương trình nhận đăng ký Mentor mới Mùa 12 đến hết ngày **19/09/2026**.";

const SLOTS: FormTextEditorSlot[] = [
  {
    key: "mentor.process.step1_title",
    label: "Bước 1 · Tiêu đề",
    kind: "line",
    optional: false,
    defaultText: "Bước 1 – Đăng ký tham gia",
    value: "Bước 1 – Đăng ký tham gia",
    edited: false,
    updatedLabel: null
  },
  {
    key: "mentor.process.step1_note",
    label: "Bước 1 · Khung lưu ý vàng",
    kind: "rich",
    optional: true,
    defaultText: NOTE_DEFAULT,
    value: "Hạn nộp dời sang **26/09/2026**.",
    edited: true,
    updatedLabel: "15/09/2026 10:00 · Thảo"
  }
];

beforeEach(() => {
  formState.value = null;
});

afterEach(cleanup);

function renderEditor() {
  const view = render(<FormTextGroupEditor title="Form mentor · Quy trình 3 bước" shownOn="Form nộp đơn mentor" slots={SLOTS} />);
  return { ...view, form: view.container.querySelector("form") as HTMLFormElement };
}

describe("1. khung sửa một nhóm", () => {
  it("gửi mỗi khối kèm chữ màn hình đã hiện", () => {
    const { form } = renderEditor();
    const data = new FormData(form);

    expect(data.get("mentor.process.step1_title")).toBe("Bước 1 – Đăng ký tham gia");
    expect(data.get("expected:mentor.process.step1_title")).toBe("Bước 1 – Đăng ký tham gia");
    expect(data.get("mentor.process.step1_note")).toBe("Hạn nộp dời sang **26/09/2026**.");
    expect(data.get("expected:mentor.process.step1_note")).toBe("Hạn nộp dời sang **26/09/2026**.");
    expect(screen.getByRole("button", { name: "Lưu phần này" })).toBeTruthy();
  });

  it("nói khối nào đã sửa, ai sửa, lúc nào; khối nào đang là mặc định", () => {
    renderEditor();
    expect(screen.getByText("Đã sửa · 15/09/2026 10:00 · Thảo")).toBeTruthy();
    expect(screen.getByText("Chữ mặc định")).toBeTruthy();
  });

  it("Dùng lại chữ mặc định: đưa đúng chữ mặc định vào ô, và đó là thứ được gửi đi", () => {
    const { form } = renderEditor();
    const buttons = screen.getAllByRole("button", { name: "Dùng lại chữ mặc định" });
    // Chỉ khối đang khác mặc định mới có nút này.
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);

    expect(new FormData(form).get("mentor.process.step1_note")).toBe(NOTE_DEFAULT);
    // Chữ màn hình đã hiện vẫn là bản trên server — không phải chữ vừa đưa vào ô,
    // kẻo hàm ghi không còn nhận ra bản người khác sửa trong lúc này.
    expect(new FormData(form).get("expected:mentor.process.step1_note")).toBe("Hạn nộp dời sang **26/09/2026**.");
    expect(screen.queryByRole("button", { name: "Dùng lại chữ mặc định" })).toBeNull();
  });

  it("xem trước chữ đậm của khối nhiều dòng, theo đúng chữ đang gõ", () => {
    const { form } = renderEditor();
    const textarea = form.querySelector('textarea[name="mentor.process.step1_note"]') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Orientation **27/09** và **04/10**" } });

    expect(Array.from(form.querySelectorAll("strong")).map((node) => node.textContent)).toEqual(["27/09", "04/10"]);
  });

  it("lưu hỏng hay xong, Next đặt lại form: chữ đang gõ vẫn còn", () => {
    const { form } = renderEditor();
    const textarea = form.querySelector('textarea[name="mentor.process.step1_note"]') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Bản đang gõ dở" } });
    form.reset();

    expect(textarea.value).toBe("Bản đang gõ dở");
  });

  it("báo kết quả lưu", () => {
    formState.value = { ok: false, message: "“Bước 1 · Khung lưu ý vàng” vừa được người khác sửa. Tải lại trang để xem bản mới, rồi sửa lại." };
    renderEditor();
    expect(screen.getByRole("alert").textContent).toContain("vừa được người khác sửa");
  });
});

describe("2. trang chỉ mở cho người qua cả hai cổng", () => {
  const page = readFileSync("app/admin/seasons-forms/form-texts/page.tsx", "utf8");

  it("cổng vai trò, cổng phạm vi đọc hỏng, rồi cổng vận hành mùa — cùng hàm với đường ghi", () => {
    const role = page.indexOf("!canEditApplicationFormTexts(admin.role)");
    const scope = page.indexOf("if (ctx.scopeError)");
    const season = page.indexOf("await canEditFormTextsForSeason(lookup.seasonId)");
    const editors = page.indexOf("<FormTextGroupEditor");
    expect(role).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(role);
    expect(season).toBeGreaterThan(scope);
    expect(editors).toBeGreaterThan(season);
  });

  it("bảng chưa đọc được thì nói thẳng là migration, không vẽ các ô với chữ mặc định như thể đã đọc", () => {
    const unreadable = page.indexOf("if (!lookup.ok)");
    expect(unreadable).toBeGreaterThan(-1);
    expect(page.slice(unreadable, unreadable + 400)).toContain("migration");
    expect(unreadable).toBeLessThan(page.indexOf("<FormTextGroupEditor"));
  });

  it("màn hình Mùa & Form đăng ký có lối vào, cùng cổng vai trò", () => {
    const controls = readFileSync("app/admin/seasons-forms/page.tsx", "utf8");
    expect(controls).toContain("{canEditApplicationFormTexts(admin.role) ? (");
    expect(controls).toContain("href={APPLICATION_FORM_TEXTS_PATH}");
  });
});
