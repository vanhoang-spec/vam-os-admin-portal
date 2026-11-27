// @vitest-environment jsdom
/**
 * VAM00039: chọn "Times New Roman" khi soạn thư nhưng thư nhận được ra font khác.
 * Trình duyệt ghi tên font có dấu cách trong nháy KÉP; bộ lọc máy chủ phải giữ được nó.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { mailEditorExtensions } from "@/app/operations/mail/mail-editor-extensions";
import { dungThanThuHtml, locHtmlThu } from "@/lib/mail-soan-thao-core";

const FONT_CO_DAU_CACH = [
  "'Times New Roman', Times, serif",
  "'Trebuchet MS', Helvetica, sans-serif",
  "'Courier New', Courier, monospace"
];

describe("font chữ tên có dấu cách còn nguyên từ lúc soạn tới thư gửi đi", () => {
  it.each(FONT_CO_DAU_CACH)("%s: qua trình soạn, lưu, mở lại và gửi", (font) => {
    const editor = new Editor({ extensions: mailEditorExtensions(), content: "<p>Kính gửi</p>" });
    editor.chain().selectAll().setFontFamily(font).run();

    const saved = locHtmlThu(editor.getHTML());
    expect(saved).toContain(`font-family:${font}`);

    // Mở lại mẫu đã lưu rồi lưu lần nữa: không được rơi mất.
    editor.commands.setContent(saved);
    expect(locHtmlThu(editor.getHTML())).toContain(`font-family:${font}`);

    expect(dungThanThuHtml(saved)).toContain(`font-family:${font}`);
  });

  it("HTML dán từ nơi khác ghi &quot; cũng giữ được", () => {
    const out = locHtmlThu('<p><span style="font-family: &quot;Times New Roman&quot;, serif">a</span></p>');
    expect(out).toContain("font-family:'Times New Roman', serif");
  });

  it("giá trị font lạ vẫn bị bỏ", () => {
    const out = locHtmlThu('<p><span style="font-family: url(&quot;https://x.test/a&quot;)">a</span></p>');
    expect(out).not.toContain("url(");
  });
});
