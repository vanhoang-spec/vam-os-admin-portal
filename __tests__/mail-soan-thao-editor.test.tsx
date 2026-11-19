/** @vitest-environment jsdom */
/**
 * VAM00038 — trình soạn trên màn hình: mẫu thiết kế mở trong trình thiết kế, mẫu chữ thuần cũ mở
 * đúng như cũ, nút chèn ô chèn vào trình thiết kế, form gửi kèm chế độ và HTML.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/email-templates", () => ({
  saveEmailTemplateAction: vi.fn(),
  approveEmailTemplateAction: vi.fn(),
  archiveEmailTemplateAction: vi.fn(),
  copyEmailTemplateAction: vi.fn(),
  updateSourceTemplateAction: vi.fn(),
  requestMailImageUploadAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { TemplateEditor, type EditableTemplate } from "@/app/operations/mail/template-editor";

afterEach(cleanup);

const BASE: EditableTemplate = {
  id: "00000000-0000-4000-8000-0000000000c1",
  kind: "general_announcement",
  name: "Mẫu",
  subject: "Thông báo {{mua}}",
  body: "Chào {{ten_nguoi_nhan}}",
  status: "draft"
};

function hidden(name: string) {
  return document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement | null;
}

describe("mở mẫu", () => {
  it("mẫu chữ thuần cũ mở bằng ô văn bản như trước, form gửi che_do=chu", () => {
    render(<TemplateEditor kind="general_announcement" template={BASE} canApprove={false} />);
    expect((screen.getByLabelText("Nội dung thư") as HTMLTextAreaElement).value).toBe("Chào {{ten_nguoi_nhan}}");
    expect(hidden("che_do")?.value).toBe("chu");
    expect(hidden("body_html")).toBeNull();
  });

  it("mẫu thiết kế mở trong trình thiết kế với đủ nhóm công cụ", async () => {
    render(
      <TemplateEditor
        kind="general_announcement"
        template={{ ...BASE, bodyHtml: "<p>Chào <strong>{{ten_nguoi_nhan}}</strong></p>" }}
        canApprove={false}
      />
    );
    expect(hidden("che_do")?.value).toBe("thiet_ke");
    await waitFor(() => expect(screen.getByLabelText("Nội dung thư (thiết kế)")).toBeTruthy());
    for (const group of ["Kiểu chữ", "Định dạng", "Căn lề và danh sách", "Chèn"]) {
      expect(screen.getByRole("group", { name: group })).toBeTruthy();
    }
    expect(screen.getByLabelText("Font chữ")).toBeTruthy();
    expect(screen.getByLabelText("Cỡ chữ")).toBeTruthy();
    expect(screen.getByLabelText("Màu chữ")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chèn ảnh (chọn được nhiều ảnh)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chèn khung nội dung có màu nền" })).toBeTruthy();
    expect(screen.getByLabelText("Nội dung thư (thiết kế)").innerHTML).toContain("<strong>{{ten_nguoi_nhan}}</strong>");
  });

  it("chuyển thư chữ thuần sang thiết kế giữ nguyên chữ, thành đoạn văn", async () => {
    render(<TemplateEditor kind="general_announcement" template={null} canApprove={false} />);
    fireEvent.change(screen.getByLabelText("Nội dung thư"), { target: { value: "Dòng một\n\nDòng <hai>" } });
    fireEvent.click(screen.getByRole("button", { name: "Thiết kế (định dạng, ảnh, bảng)" }));
    expect(hidden("che_do")?.value).toBe("thiet_ke");
    expect(hidden("body_html")?.value).toBe("<p>Dòng một</p><p>Dòng &lt;hai&gt;</p>");
    await waitFor(() => expect(screen.getByLabelText("Nội dung thư (thiết kế)").textContent).toContain("Dòng <hai>"));
  });

  it("mẫu tạo từ mẫu khác có nút Cập nhật mẫu gốc nêu đúng tên gốc; mẫu thường thì không", () => {
    const { unmount } = render(
      <TemplateEditor kind="general_announcement" template={{ ...BASE, sourceTemplateId: "goc", sourceName: "Thư mời gốc" }} canApprove={false} />
    );
    expect(screen.getByRole("button", { name: "Cập nhật mẫu gốc" })).toBeTruthy();
    expect(screen.getByText(/Thư mời gốc/)).toBeTruthy();
    unmount();
    render(<TemplateEditor kind="general_announcement" template={BASE} canApprove={false} />);
    expect(screen.queryByRole("button", { name: "Cập nhật mẫu gốc" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dùng mẫu này cho thư mới" })).toBeTruthy();
  });
});

describe("chèn ô điền vào trình thiết kế", () => {
  it("bấm nút chèn ô thì ô vào thân thư thiết kế và vào HTML gửi đi", async () => {
    render(
      <TemplateEditor kind="general_announcement" template={{ ...BASE, bodyHtml: "<p>Xin chào</p>" }} canApprove={false} />
    );
    await waitFor(() => expect(screen.getByLabelText("Nội dung thư (thiết kế)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Tên mùa/ }));
    await waitFor(() => expect(hidden("body_html")?.value).toContain("{{mua}}"));
    // Tiêu đề không bị chèn nhầm.
    expect((screen.getByLabelText("Tiêu đề thư") as HTMLInputElement).value).toBe("Thông báo {{mua}}");
  });
});

describe("HTML trình soạn sinh ra đi qua bộ lọc máy chủ mà không mất bố cục", () => {
  it("ảnh (cỡ, căn), khung có nền, bảng có nền ô / viền, chữ có định dạng: lưu rồi mở lại vẫn y nguyên", async () => {
    const { Editor } = await import("@tiptap/core");
    const { mailEditorExtensions, bangMoi } = await import("@/app/operations/mail/mail-editor-extensions");
    const { locHtmlThu } = await import("@/lib/mail-soan-thao-core");

    const editor = new Editor({ extensions: mailEditorExtensions(), content: "<p>Chào {{ten_nguoi_nhan}}</p>" });
    editor
      .chain()
      .insertContent({ type: "image", attrs: { src: "https://kho.test/banner.png", alt: "Banner", width: 400, align: "right" } })
      .insertContent({ type: "khungNoiDung", attrs: { mauNen: "#ffeedd", mauVien: "#cc0000" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Trong khung" }] }] })
      .insertContent(bangMoi(1, 2, true))
      .run();
    editor.commands.setContent(editor.getHTML());
    editor.chain().selectAll().setColor("#c0392b").setFontSize("18px").setFontFamily("Georgia, serif").run();

    const saved = locHtmlThu(editor.getHTML());
    expect(saved).toMatch(
      /<div data-vam-anh style="text-align:right;margin:0(px)? 0(px)? 12px"><img src="https:\/\/kho.test\/banner.png" alt="Banner" width="400" data-align="right"/
    );
    expect(saved).toContain('data-mau-nen="#ffeedd" data-vien="#cc0000" bgcolor="#ffeedd"');
    expect(saved).toContain('data-vien="1"');
    // jsdom ghi màu dạng rgb(); trình duyệt thật giữ #hex. Bộ lọc nhận cả hai.
    expect(saved).toMatch(/color:(#c0392b|rgb\(192, 57, 43\))/);
    expect(saved).toContain("font-size:18px");
    expect(saved).toContain("font-family:Georgia, serif");

    // Thư gửi đi: ảnh giữ cỡ và căn, ô có bgcolor hex cho Outlook dù style ghi rgb().
    const { dungThanThuHtml } = await import("@/lib/mail-soan-thao-core");
    const sent = dungThanThuHtml(saved);
    expect(sent).toMatch(/<div style="text-align:right;[^"]*"><img src="https:\/\/kho.test\/banner.png" alt="Banner" width="400"/);
    expect(sent).toContain('bgcolor="#ffeedd"');

    const reopened = new Editor({ extensions: mailEditorExtensions(), content: saved });
    expect(locHtmlThu(reopened.getHTML())).toBe(saved);
    editor.destroy();
    reopened.destroy();
  });
});
