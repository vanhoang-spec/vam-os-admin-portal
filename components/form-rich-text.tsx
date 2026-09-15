import { Fragment } from "react";
import { parseRichText, type RichInline } from "@/lib/application-form-text-core";

/**
 * Hiện một khối chữ admin sửa được trên form nộp đơn.
 *
 * Không dùng dangerouslySetInnerHTML: chữ đi qua bộ đọc trong
 * lib/application-form-text-core.ts rồi thành phần tử React, nên một khối chữ gõ
 * "<script>" chỉ hiện đúng mấy ký tự đó. Dùng được cả ở server lẫn client
 * component — không có state, không có hook.
 */
export function FormRichText({
  text,
  className,
  paragraphClassName,
  listClassName = "list-disc space-y-1.5 pl-5",
  itemClassName,
  strongClassName = "font-semibold text-vam-ink",
  linkClassName = "text-vam-green underline"
}: {
  text: string;
  className?: string;
  paragraphClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  strongClassName?: string;
  linkClassName?: string;
}) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;

  const inline = (tokens: RichInline[]) =>
    tokens.map((token, index) => {
      const content =
        token.kind === "link" ? (
          <a href={token.href} className={linkClassName}>
            {token.text}
          </a>
        ) : (
          token.text
        );
      return token.strong ? (
        <strong key={index} className={strongClassName}>
          {content}
        </strong>
      ) : (
        <Fragment key={index}>{content}</Fragment>
      );
    });

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) =>
        block.kind === "list" ? (
          <ul key={blockIndex} className={listClassName}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className={itemClassName}>
                {inline(item)}
              </li>
            ))}
          </ul>
        ) : (
          <p key={blockIndex} className={paragraphClassName}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        )
      )}
    </div>
  );
}
