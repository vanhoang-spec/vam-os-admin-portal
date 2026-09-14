import type { AiDoc, DocBlock } from "@/lib/doc-blocks";

/**
 * Hiển thị tài liệu có cấu trúc do AI sinh ra.
 *
 * Render bằng JSX text node — React tự escape, KHÔNG dùng `dangerouslySetInnerHTML`. Nội
 * dung do model sinh ra, và model đọc cả file người dùng tải lên, nên phải coi như dữ
 * liệu người ngoài nhập vào.
 *
 * Không có state, không hook: dùng được ở cả server lẫn client component.
 */

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "mt-5 text-base font-semibold text-vam-ink first:mt-0",
  2: "mt-4 text-sm font-semibold text-vam-ink first:mt-0",
  3: "mt-3 text-sm font-medium text-vam-ink first:mt-0"
};

function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "heading": {
      const cls = HEADING_CLASS[block.level];
      if (block.level === 1) return <h3 className={cls}>{block.text}</h3>;
      if (block.level === 2) return <h4 className={cls}>{block.text}</h4>;
      return <h5 className={cls}>{block.text}</h5>;
    }
    case "paragraph":
      return <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{block.text}</p>;
    case "bullets":
      return (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      );
    case "terms":
      return (
        <dl className="mt-2 space-y-1.5 text-sm leading-relaxed">
          {block.items.map((item, index) => (
            <div key={index}>
              <dt className="inline font-semibold text-vam-ink">{item.term}: </dt>
              <dd className="inline text-slate-700">{item.definition}</dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        // Bảng rộng cuộn TRONG khung của nó — thân trang không bao giờ cuộn ngang.
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th key={index} className="border border-vam-line bg-slate-50 px-2 py-1.5 text-left font-semibold text-vam-ink">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, cellIndex) => (
                    <td key={cellIndex} className="border border-vam-line px-2 py-1.5 align-top text-slate-700">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function DocBlocksView({ doc, showTitle = true }: { doc: AiDoc; showTitle?: boolean }) {
  return (
    <article>
      {showTitle ? <h2 className="text-base font-semibold text-vam-ink">{doc.title}</h2> : null}
      {doc.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </article>
  );
}
