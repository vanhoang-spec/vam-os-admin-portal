"use client";

/**
 * Trình soạn thư có định dạng (VAM00038): chữ có font / cỡ / màu, danh sách, ảnh nhiều tấm (đổi cỡ,
 * căn, đổi thứ tự, thay, xoá), bảng, khung nội dung có màu nền.
 *
 * Dựng trên TipTap (ProseMirror) thay vì tự viết `contentEditable`: tự viết thì mỗi trình duyệt sinh
 * HTML một kiểu (Chrome <div>, Firefox <br>, Safari <span style>), dán từ Word mang theo cả mớ thẻ lạ,
 * và hoàn tác / chọn bảng phải tự làm. ProseMirror giữ một lược đồ đóng: chỉ những khối khai báo trong
 * mail-editor-extensions.ts tồn tại, nên thứ dán vào cũng bị ép về đúng các khối đó.
 *
 * Cái trình soạn sinh ra KHÔNG được tin: máy chủ lọc lại bằng danh sách cho phép trước khi lưu
 * (lib/mail-soan-thao-core.ts). Ảnh được tải thẳng từ trình duyệt lên kho công khai 'mail-anh'.
 */
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  MAIL_ANH_ACCEPT,
  MAIL_ANH_MAX_WIDTH,
  MAIL_ANH_MIN_WIDTH,
  kepBeRongAnh,
  kiemAnhThu
} from "@/lib/mail-anh-core";
import { requestMailImageUploadAction } from "@/app/actions/email-templates";
import {
  MAU_KHUNG_MAC_DINH,
  bangMoi,
  mailEditorExtensions,
  canHopLe,
  mauHopLe,
  type CanAnh
} from "./mail-editor-extensions";

export type MailRichEditorHandle = {
  /** Chèn chữ (ô điền) vào chỗ con trỏ đang đứng trong thân thư. */
  insertText: (text: string) => void;
};

const FONTS: Array<{ label: string; value: string }> = [
  { label: "Font mặc định", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" }
];

const SIZES = ["12px", "13px", "14px", "15px", "16px", "18px", "20px", "24px", "28px", "32px"];

const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Bề rộng thật của ảnh vừa tải, để ảnh nhỏ không bị kéo giãn mờ; ảnh to kẹp về 552px. */
function naturalWidth(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(kepBeRongAnh(img.naturalWidth || MAIL_ANH_MAX_WIDTH));
    img.onerror = () => resolve(MAIL_ANH_MAX_WIDTH);
    img.src = url;
  });
}

/** Đổi chỗ khối đang chọn (ảnh, khung, bảng) với khối liền trước / liền sau trong cùng khối cha. */
function moveSelectedBlock(editor: Editor, direction: -1 | 1): boolean {
  const { state } = editor;
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)) return false;
  const node = selection.node;
  const $pos = state.doc.resolve(selection.from);
  const parent = $pos.parent;
  const index = $pos.index();
  const tr = state.tr;
  if (direction < 0) {
    if (index === 0) return false;
    const before = parent.child(index - 1);
    const target = selection.from - before.nodeSize;
    tr.delete(selection.from, selection.to).insert(target, node);
    tr.setSelection(NodeSelection.create(tr.doc, target));
  } else {
    if (index >= parent.childCount - 1) return false;
    const after = parent.child(index + 1);
    const target = selection.from + after.nodeSize;
    tr.delete(selection.from, selection.to).insert(target, node);
    tr.setSelection(NodeSelection.create(tr.doc, target));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}

/** Vị trí (trước, sau) của khối tổ tiên gần nhất mang tên `name` quanh con trỏ. */
function ancestorRange(editor: Editor, name: string): { from: number; to: number; pos: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === name) {
      return { from: $from.before(depth), to: $from.after(depth), pos: $from.before(depth) };
    }
  }
  const selected = editor.state.selection;
  if (selected instanceof NodeSelection && selected.node.type.name === name) {
    return { from: selected.from, to: selected.to, pos: selected.from };
  }
  return null;
}

/** Bật / tắt viền cho MỌI ô của bảng đang đứng. */
function setTableBorder(editor: Editor, vien: boolean) {
  const range = ancestorRange(editor, "table");
  if (!range) return;
  const tr = editor.state.tr;
  const table = editor.state.doc.nodeAt(range.pos);
  table?.descendants((child, offset) => {
    if (child.type.name === "tableCell" || child.type.name === "tableHeader") {
      tr.setNodeMarkup(range.pos + 1 + offset, undefined, { ...child.attrs, vien });
    }
    return true;
  });
  editor.view.dispatch(tr);
}

function ToolButton({
  label,
  title,
  active,
  disabled,
  onClick
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`min-w-[2rem] rounded border px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
        active ? "border-vam-green bg-vam-mint text-vam-ink" : "border-vam-line bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function Group({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1 border-r border-vam-line pr-2 last:border-r-0">
      {children}
    </div>
  );
}

export const MailRichEditor = forwardRef<
  MailRichEditorHandle,
  {
    initialHtml: string;
    onChange: (html: string, text: string) => void;
    /** Bản chữ của nội dung vừa nạp (để đếm / kiểm), không coi là một lần sửa. */
    onTextReady?: (text: string) => void;
  }
>(function MailRichEditor({ initialHtml, onChange, onTextReady }, ref) {
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef(false);

  const editor = useEditor({
    // Next dựng trang ở máy chủ trước: dựng trình soạn ngay lúc đó làm lệch HTML giữa hai phía.
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: mailEditorExtensions(),
    content: initialHtml || "<p></p>",
    editorProps: {
      attributes: {
        id: "template-body-rich",
        "aria-label": "Nội dung thư (thiết kế)",
        class: "vam-mail-editor min-h-[320px] px-4 py-3 text-[15px] leading-6 text-vam-ink focus:outline-none"
      }
    },
    onCreate: ({ editor: current }) => onTextReady?.(current.getText({ blockSeparator: "\n\n" })),
    onUpdate: ({ editor: current }) => onChange(current.getHTML(), current.getText({ blockSeparator: "\n\n" }))
  });

  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) => {
        editor?.chain().focus().insertContent(text).run();
      }
    }),
    [editor]
  );

  async function uploadImage(file: File): Promise<string | null> {
    const checked = kiemAnhThu({ name: file.name, size: file.size, mime: file.type });
    if (!checked.ok) {
      setProblem(checked.message);
      return null;
    }
    const link = await requestMailImageUploadAction({ name: file.name, size: file.size, mime: file.type });
    if (!link.ok) {
      setProblem(link.message);
      return null;
    }
    try {
      const res = await fetch(link.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type, "x-upsert": "false", ...(apikey ? { apikey } : {}) },
        body: file
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setProblem("Chưa tải ảnh lên được. Kiểm tra mạng rồi chọn lại ảnh.");
      return null;
    }
    return link.publicUrl;
  }

  async function onPickFiles(list: FileList | null) {
    if (!editor || !list?.length) return;
    setProblem(null);
    setUploading(true);
    try {
      const files = Array.from(list).slice(0, 10);
      if (replaceRef.current) {
        const url = await uploadImage(files[0]);
        if (url) editor.chain().focus().updateAttributes("image", { src: url }).run();
        return;
      }
      for (const file of files) {
        const url = await uploadImage(file);
        if (!url) break;
        const width = await naturalWidth(url);
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: url, alt: "", width, align: "center" } })
          .run();
      }
    } finally {
      replaceRef.current = false;
      setUploading(false);
    }
  }

  function openPicker(replace: boolean) {
    replaceRef.current = replace;
    fileRef.current?.click();
  }

  function setLink() {
    if (!editor) return;
    const previous = String(editor.getAttributes("link").href ?? "");
    const url = window.prompt("Địa chỉ liên kết (https://… hoặc mailto:…). Để trống để bỏ liên kết.", previous);
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) {
      setProblem("Liên kết phải bắt đầu bằng https://, http:// hoặc mailto:.");
      return;
    }
    setProblem(null);
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  }

  if (!editor) {
    return <div className="min-h-[360px] rounded-md border border-vam-line bg-white" aria-busy="true" />;
  }

  const textStyle = editor.getAttributes("textStyle");
  const imageActive = editor.isActive("image");
  const image = imageActive ? editor.getAttributes("image") : null;
  const inTable = editor.isActive("table");
  const inKhung = Boolean(ancestorRange(editor, "khungNoiDung"));
  const khung = inKhung ? editor.getAttributes("khungNoiDung") : null;
  const cell = inTable ? editor.getAttributes("tableCell") : null;
  const block = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";
  const canMove = editor.state.selection instanceof NodeSelection;

  return (
    <div className="rounded-md border border-vam-line bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-vam-line bg-slate-50 px-2 py-2">
        <Group label="Kiểu chữ">
          <select
            aria-label="Kiểu đoạn"
            value={block}
            onChange={(event) => {
              const value = event.target.value;
              const chain = editor.chain().focus();
              if (value === "p") chain.setParagraph().run();
              else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
            }}
            className="rounded border border-vam-line bg-white px-1 py-1 text-xs"
          >
            <option value="p">Đoạn văn</option>
            <option value="h1">Tiêu đề lớn</option>
            <option value="h2">Tiêu đề vừa</option>
            <option value="h3">Tiêu đề nhỏ</option>
          </select>
          <select
            aria-label="Font chữ"
            // Mẫu mở lại có thể mang tên font trong nháy kép; ô chọn so với nháy đơn của FONTS.
            value={String(textStyle.fontFamily ?? "").replace(/"/g, "'")}
            onChange={(event) => {
              const value = event.target.value;
              if (value) editor.chain().focus().setFontFamily(value).run();
              else editor.chain().focus().unsetFontFamily().run();
            }}
            className="rounded border border-vam-line bg-white px-1 py-1 text-xs"
          >
            {FONTS.map((font) => (
              <option key={font.label} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Cỡ chữ"
            value={String(textStyle.fontSize ?? "")}
            onChange={(event) => {
              const value = event.target.value;
              if (value) editor.chain().focus().setFontSize(value).run();
              else editor.chain().focus().unsetFontSize().run();
            }}
            className="rounded border border-vam-line bg-white px-1 py-1 text-xs"
          >
            <option value="">Cỡ</option>
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size.replace("px", "")}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600" title="Màu chữ">
            <span>Màu</span>
            <input
              type="color"
              aria-label="Màu chữ"
              value={mauHopLe(textStyle.color) ?? "#14352a"}
              onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
              className="h-6 w-7 cursor-pointer rounded border border-vam-line"
            />
          </label>
        </Group>

        <Group label="Định dạng">
          <ToolButton label="B" title="In đậm" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolButton label="I" title="In nghiêng" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolButton label="U" title="Gạch chân" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <ToolButton label="S" title="Gạch ngang" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <ToolButton label="Link" title="Chèn / sửa liên kết" active={editor.isActive("link")} onClick={setLink} />
          <ToolButton label="Xoá ĐD" title="Xoá định dạng chữ" onClick={() => editor.chain().focus().unsetAllMarks().run()} />
        </Group>

        <Group label="Căn lề và danh sách">
          {(["left", "center", "right", "justify"] as const).map((align) => (
            <ToolButton
              key={align}
              label={{ left: "Trái", center: "Giữa", right: "Phải", justify: "Đều" }[align]}
              title={`Căn ${{ left: "trái", center: "giữa", right: "phải", justify: "đều hai bên" }[align]}`}
              active={editor.isActive({ textAlign: align })}
              onClick={() => editor.chain().focus().setTextAlign(align).run()}
            />
          ))}
          <ToolButton label="• DS" title="Danh sách dấu đầu dòng" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolButton label="1. DS" title="Danh sách đánh số" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        </Group>

        <Group label="Chèn">
          <ToolButton label={uploading ? "Đang tải…" : "Ảnh"} title="Chèn ảnh (chọn được nhiều ảnh)" disabled={uploading} onClick={() => openPicker(false)} />
          <ToolButton label="Bảng" title="Chèn bảng 3x2 có viền" onClick={() => editor.chain().focus().insertContent(bangMoi(3, 2, true)).run()} />
          <ToolButton label="2 cột" title="Chia khu vực 2 cột (ảnh và chữ cạnh nhau), không viền" onClick={() => editor.chain().focus().insertContent(bangMoi(1, 2, false)).run()} />
          <ToolButton
            label="Khung"
            title="Chèn khung nội dung có màu nền"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent({ type: "khungNoiDung", attrs: { mauNen: MAU_KHUNG_MAC_DINH }, content: [{ type: "paragraph" }] })
                .run()
            }
          />
          <ToolButton label="―" title="Đường kẻ ngang" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        </Group>

        <Group label="Hoàn tác">
          <ToolButton label="↶" title="Hoàn tác" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
          <ToolButton label="↷" title="Làm lại" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
        </Group>
      </div>

      {image ? (
        <div role="group" aria-label="Ảnh đang chọn" className="flex flex-wrap items-center gap-2 border-b border-vam-line bg-vam-mint/40 px-2 py-2 text-xs">
          <span className="font-medium text-vam-ink">Ảnh:</span>
          <label className="flex items-center gap-1">
            Rộng
            <input
              type="range"
              aria-label="Bề rộng ảnh"
              min={MAIL_ANH_MIN_WIDTH * 4}
              max={MAIL_ANH_MAX_WIDTH}
              step={8}
              value={kepBeRongAnh(image.width)}
              onChange={(event) => editor.chain().updateAttributes("image", { width: kepBeRongAnh(event.target.value) }).run()}
            />
            <span className="tabular-nums">{kepBeRongAnh(image.width)}px</span>
          </label>
          {(["left", "center", "right"] as CanAnh[]).map((align) => (
            <ToolButton
              key={align}
              label={{ left: "Trái", center: "Giữa", right: "Phải" }[align]}
              title={`Căn ảnh ${{ left: "trái", center: "giữa", right: "phải" }[align]}`}
              active={canHopLe(image.align) === align}
              onClick={() => editor.chain().focus().updateAttributes("image", { align }).run()}
            />
          ))}
          <ToolButton label="Lên" title="Đưa ảnh lên trên khối trước" disabled={!canMove} onClick={() => moveSelectedBlock(editor, -1)} />
          <ToolButton label="Xuống" title="Đưa ảnh xuống dưới khối sau" disabled={!canMove} onClick={() => moveSelectedBlock(editor, 1)} />
          <ToolButton label="Thay ảnh" title="Thay bằng ảnh khác" disabled={uploading} onClick={() => openPicker(true)} />
          <label className="flex items-center gap-1">
            Mô tả
            <input
              aria-label="Mô tả ảnh"
              value={String(image.alt ?? "")}
              maxLength={200}
              onChange={(event) => editor.chain().updateAttributes("image", { alt: event.target.value }).run()}
              placeholder="Hiện khi ảnh bị chặn"
              className="w-40 rounded border border-vam-line px-1 py-0.5"
            />
          </label>
          <ToolButton label="Xoá ảnh" title="Xoá ảnh khỏi thư" onClick={() => editor.chain().focus().deleteSelection().run()} />
        </div>
      ) : null}

      {inTable && !imageActive ? (
        <div role="group" aria-label="Bảng đang chọn" className="flex flex-wrap items-center gap-2 border-b border-vam-line bg-slate-50 px-2 py-2 text-xs">
          <span className="font-medium text-vam-ink">Bảng:</span>
          <ToolButton label="+ Dòng" title="Thêm dòng bên dưới" onClick={() => editor.chain().focus().addRowAfter().run()} />
          <ToolButton label="+ Cột" title="Thêm cột bên phải" onClick={() => editor.chain().focus().addColumnAfter().run()} />
          <ToolButton label="− Dòng" title="Xoá dòng này" onClick={() => editor.chain().focus().deleteRow().run()} />
          <ToolButton label="− Cột" title="Xoá cột này" onClick={() => editor.chain().focus().deleteColumn().run()} />
          <label className="flex items-center gap-1">
            Nền ô
            <input
              type="color"
              aria-label="Màu nền ô"
              value={mauHopLe(cell?.mauNen) ?? "#ffffff"}
              onChange={(event) => editor.chain().focus().setCellAttribute("mauNen", event.target.value).run()}
              className="h-6 w-7 cursor-pointer rounded border border-vam-line"
            />
          </label>
          <ToolButton label="Bỏ nền" title="Bỏ màu nền ô" onClick={() => editor.chain().focus().setCellAttribute("mauNen", null).run()} />
          <ToolButton label="Có viền" title="Kẻ viền mọi ô của bảng" onClick={() => setTableBorder(editor, true)} />
          <ToolButton label="Không viền" title="Bỏ viền mọi ô (dùng làm bố cục)" onClick={() => setTableBorder(editor, false)} />
          <ToolButton label="Xoá bảng" title="Xoá cả bảng" onClick={() => editor.chain().focus().deleteTable().run()} />
        </div>
      ) : null}

      {khung && !imageActive ? (
        <div role="group" aria-label="Khung đang chọn" className="flex flex-wrap items-center gap-2 border-b border-vam-line bg-slate-50 px-2 py-2 text-xs">
          <span className="font-medium text-vam-ink">Khung:</span>
          <label className="flex items-center gap-1">
            Nền
            <input
              type="color"
              aria-label="Màu nền khung"
              value={mauHopLe(khung.mauNen) ?? MAU_KHUNG_MAC_DINH}
              onChange={(event) => editor.chain().updateAttributes("khungNoiDung", { mauNen: event.target.value }).run()}
              className="h-6 w-7 cursor-pointer rounded border border-vam-line"
            />
          </label>
          <label className="flex items-center gap-1">
            Viền
            <input
              type="color"
              aria-label="Màu viền khung"
              value={mauHopLe(khung.mauVien) ?? "#cfd8d3"}
              onChange={(event) => editor.chain().updateAttributes("khungNoiDung", { mauVien: event.target.value }).run()}
              className="h-6 w-7 cursor-pointer rounded border border-vam-line"
            />
          </label>
          <ToolButton label="Bỏ viền" title="Bỏ viền khung" onClick={() => editor.chain().focus().updateAttributes("khungNoiDung", { mauVien: null }).run()} />
          <ToolButton
            label="Xoá khung"
            title="Xoá khung cùng nội dung bên trong"
            onClick={() => {
              const range = ancestorRange(editor, "khungNoiDung");
              if (range && window.confirm("Xoá khung này cùng toàn bộ chữ và ảnh bên trong?")) {
                editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
              }
            }}
          />
        </div>
      ) : null}

      <EditorContent editor={editor} />

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={MAIL_ANH_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const list = event.target.files;
          void onPickFiles(list).finally(() => {
            event.target.value = "";
          });
        }}
      />

      <p className="border-t border-vam-line px-3 py-2 text-xs text-slate-500">
        Bấm vào ảnh để đổi cỡ, căn lề, đổi thứ tự hoặc thay ảnh; kéo ảnh / khung để đổi chỗ. Ảnh PNG, JPG, GIF,
        WebP, tối đa 3 MB mỗi ảnh. Ảnh chèn vào thư được lưu ở kho công khai để người nhận mở thư lúc nào cũng thấy.
      </p>
      {problem ? (
        <p role="alert" className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {problem}
        </p>
      ) : null}
    </div>
  );
});
