/**
 * Các khối riêng của trình soạn thư (VAM00038), viết trên TipTap / ProseMirror.
 *
 * Nguyên tắc: HTML trình soạn sinh ra đã là HTML dùng được trong thư — style inline, bố cục bằng bảng,
 * ảnh mang thuộc tính `width` — để bản người soạn nhìn thấy và bản người nhận mở ra là một. Thuộc tính
 * `data-*` chỉ để trình soạn đọc lại mẫu đã lưu; máy chủ bỏ chúng ở lượt lọc cuối lúc gửi.
 *
 * Mọi giá trị đọc từ HTML (màu, căn lề, bề rộng) đều được kiểm lại ở đây trước khi đưa vào style: HTML
 * của một mẫu đã lưu là dữ liệu, không phải thứ tin được.
 */
import { Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { MAIL_ANH_MAX_WIDTH, kepBeRongAnh } from "@/lib/mail-anh-core";

export type CanAnh = "left" | "center" | "right";

const HEX = /^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/i;

export function mauHopLe(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return HEX.test(text) ? text.toLowerCase() : null;
}

export function canHopLe(value: unknown): CanAnh {
  return value === "left" || value === "right" ? value : "center";
}

/** Ảnh khối: một ảnh một dòng, căn trái / giữa / phải bằng text-align của khối bọc (Outlook hiểu). */
export const AnhThu = Image.extend({
  draggable: true,

  addAttributes() {
    // TipTap chạy parseHTML của từng thuộc tính trên CHÍNH phần tử khớp luật (có thể là <div> bọc), và
    // kết quả đè lên getAttrs — nên mỗi thuộc tính tự tìm <img> bên trong.
    const imgOf = (element: HTMLElement): HTMLElement | null =>
      element.tagName === "IMG" ? element : element.querySelector("img");
    return {
      src: { default: null, parseHTML: (element: HTMLElement) => imgOf(element)?.getAttribute("src") ?? null },
      alt: { default: "", parseHTML: (element: HTMLElement) => imgOf(element)?.getAttribute("alt") ?? "" },
      width: {
        default: MAIL_ANH_MAX_WIDTH,
        parseHTML: (element: HTMLElement) => {
          const img = imgOf(element);
          return kepBeRongAnh(img?.getAttribute("width") ?? img?.style.width.replace("px", ""));
        }
      },
      align: {
        default: "center",
        parseHTML: (element: HTMLElement) => canHopLe(imgOf(element)?.getAttribute("data-align"))
      }
    };
  },

  parseHTML() {
    // Chỉ nhận ảnh https: ảnh dán vào dạng data: / http bị bỏ ngay trong trình soạn (máy chủ cũng bỏ).
    const fromImg = (img: HTMLImageElement | null) =>
      /^https:\/\//i.test(img?.getAttribute("src") ?? "") ? {} : false;
    return [
      {
        tag: "div[data-vam-anh]",
        priority: 100,
        getAttrs: (element) => fromImg((element as HTMLElement).querySelector("img"))
      },
      { tag: "img[src]", getAttrs: (element) => fromImg(element as HTMLImageElement) }
    ];
  },

  renderHTML({ node }) {
    const width = kepBeRongAnh(node.attrs.width);
    const align = canHopLe(node.attrs.align);
    return [
      "div",
      { "data-vam-anh": "", style: `text-align:${align};margin:0 0 12px` },
      [
        "img",
        {
          src: String(node.attrs.src ?? ""),
          alt: String(node.attrs.alt ?? ""),
          width: String(width),
          "data-align": align,
          style: `width:${width}px;max-width:100%;height:auto;display:inline-block;border:0`
        }
      ]
    ];
  }
}).configure({ inline: false, allowBase64: false });

export const MAU_KHUNG_MAC_DINH = "#f1f7f4";

/**
 * Khung nội dung: một vùng có màu nền (và viền tuỳ chọn) chứa chữ, ảnh, bảng. Dựng bằng bảng một ô
 * chứ không bằng <div> có nền: Outlook bản cài đặt bỏ nền của <div>, nhưng giữ `bgcolor` của ô bảng.
 */
export const KhungNoiDung = Node.create({
  name: "khungNoiDung",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  draggable: true,

  addAttributes() {
    return {
      mauNen: {
        default: MAU_KHUNG_MAC_DINH,
        parseHTML: (element: HTMLElement) =>
          mauHopLe(element.querySelector("td")?.getAttribute("data-mau-nen")) ?? MAU_KHUNG_MAC_DINH
      },
      mauVien: {
        default: null,
        parseHTML: (element: HTMLElement) => mauHopLe(element.querySelector("td")?.getAttribute("data-vien"))
      }
    };
  },

  parseHTML() {
    return [{ tag: "table[data-vam-khung]", contentElement: "td", priority: 100 }];
  },

  renderHTML({ node }) {
    const bg = mauHopLe(node.attrs.mauNen) ?? MAU_KHUNG_MAC_DINH;
    const border = mauHopLe(node.attrs.mauVien);
    return [
      "table",
      {
        "data-vam-khung": "",
        role: "presentation",
        width: "100%",
        cellpadding: "0",
        cellspacing: "0",
        border: "0",
        style: "width:100%;border-collapse:separate;margin:0 0 16px"
      },
      [
        "tbody",
        [
          "tr",
          [
            "td",
            {
              "data-mau-nen": bg,
              ...(border ? { "data-vien": border } : {}),
              bgcolor: bg,
              style: `background-color:${bg};padding:16px;border-radius:6px${border ? `;border:1px solid ${border}` : ""}`
            },
            0
          ]
        ]
      ]
    ];
  }
});

const MAU_VIEN_O = "#cfd8d3";

function cellAttributes() {
  return {
    mauNen: {
      default: null,
      parseHTML: (element: HTMLElement) => mauHopLe(element.getAttribute("data-mau-nen")),
      renderHTML: (attrs: Record<string, unknown>) => {
        const bg = mauHopLe(attrs.mauNen);
        return bg ? { "data-mau-nen": bg, bgcolor: bg, style: `background-color:${bg}` } : {};
      }
    },
    vien: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-vien") === "1",
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.vien ? { "data-vien": "1", style: `border:1px solid ${MAU_VIEN_O}` } : {}
    }
  };
}

/** Ô bảng có màu nền và viền riêng từng ô: bảng có viền để trình bày số liệu, không viền để chia cột. */
export const OBang = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  }
}).configure({ HTMLAttributes: { style: "padding:8px;vertical-align:top" } });

export const OTieuDeBang = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  }
}).configure({ HTMLAttributes: { style: "padding:8px;vertical-align:top;font-weight:bold" } });

export const BangThu = Table.configure({
  resizable: false,
  HTMLAttributes: {
    role: "presentation",
    width: "100%",
    cellpadding: "0",
    cellspacing: "0",
    border: "0",
    style: "width:100%;border-collapse:collapse;margin:0 0 12px"
  }
});

/**
 * Toàn bộ lược đồ của trình soạn. Không có khối mã, không có thứ gì ngoài những khối dưới đây: thứ dán
 * vào trình soạn bị ép về đúng các khối này.
 */
export function mailEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        isAllowedUri: (url: string) => /^(https?:\/\/|mailto:)/i.test(url)
      }
    }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    AnhThu,
    KhungNoiDung,
    BangThu,
    TableRow,
    OBang,
    OTieuDeBang
  ];
}

/** Nội dung JSON của một bảng mới: `rows` x `cols` ô, có viền hoặc không. */
export function bangMoi(rows: number, cols: number, vien: boolean) {
  return {
    type: "table",
    content: Array.from({ length: rows }, () => ({
      type: "tableRow",
      content: Array.from({ length: cols }, () => ({
        type: "tableCell",
        attrs: { vien },
        content: [{ type: "paragraph" }]
      }))
    }))
  };
}
