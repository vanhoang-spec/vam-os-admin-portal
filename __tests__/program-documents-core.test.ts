/**
 * lib/program-documents-core.ts — the code of conduct and the tips.
 *
 * The renderer is the reason this file matters. It takes text an organiser typed
 * into an admin form and puts it on a page with no login in front of it, so the
 * cases below pin that typed markup stays text, that only http(s) links become
 * links, and that the useful formatting still works.
 */
import { describe, it, expect } from "vitest";
import {
  buildDocumentSlug,
  defaultDocumentTitle,
  documentExcerpt,
  isDocumentReady,
  isValidSlug,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  renderDocumentHtml,
  SLUG_PATTERN,
  slugify,
  validateDocumentInput
} from "@/lib/program-documents-core";

describe("slugify", () => {
  it("drops Vietnamese diacritics rather than the words", () => {
    expect(slugify("Quy tắc ứng xử")).toBe("quy-tac-ung-xu");
    expect(slugify("Cẩm nang đồng hành")).toBe("cam-nang-dong-hanh");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(slugify("  UEHM — S12 (bản mới)  ")).toBe("uehm-s12-ban-moi");
  });

  it("is empty for text with nothing usable", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("buildDocumentSlug", () => {
  it("addresses a document by season, audience and kind", () => {
    expect(
      buildDocumentSlug({ seasonCode: "UEHM-S12", audience: "mentee", kind: "code_of_conduct" })
    ).toBe("uehm-s12-mentee-quy-tac-ung-xu");
    expect(buildDocumentSlug({ seasonCode: "UEHM-S12", audience: "mentor", kind: "tips" })).toBe(
      "uehm-s12-mentor-cam-nang"
    );
  });

  it("always produces something the column accepts", () => {
    for (const seasonCode of ["UEHM-S12", "", null, undefined, "!!!", "Mùa 12"]) {
      for (const audience of ["mentee", "mentor"] as const) {
        for (const kind of ["code_of_conduct", "tips"] as const) {
          const slug = buildDocumentSlug({ seasonCode, audience, kind });
          expect(SLUG_PATTERN.test(slug), `${seasonCode}/${audience}/${kind} → ${slug}`).toBe(true);
        }
      }
    }
  });

  it("gives two seasons two different addresses", () => {
    const s11 = buildDocumentSlug({ seasonCode: "UEHM-S11", audience: "mentee", kind: "tips" });
    const s12 = buildDocumentSlug({ seasonCode: "UEHM-S12", audience: "mentee", kind: "tips" });
    expect(s11).not.toBe(s12);
  });

  it("rejects an address that is not slug-shaped", () => {
    expect(isValidSlug("uehm-s12-mentee-cam-nang")).toBe(true);
    expect(isValidSlug("../../etc/passwd")).toBe(false);
    expect(isValidSlug("Có Dấu")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
  });
});

describe("defaultDocumentTitle", () => {
  it("names the document in Vietnamese", () => {
    expect(defaultDocumentTitle("mentee", "code_of_conduct")).toBe("Quy tắc ứng xử dành cho mentee");
    expect(defaultDocumentTitle("mentor", "tips")).toBe("Cẩm nang đồng hành dành cho mentor");
  });
});

describe("validateDocumentInput", () => {
  it("requires a title", () => {
    const result = validateDocumentInput({ title: "   ", body: "nội dung" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("tiêu đề");
  });

  it("accepts an empty body, because a draft starts empty", () => {
    const result = validateDocumentInput({ title: "Quy tắc", body: "" });
    expect(result.ok).toBe(true);
  });

  it("bounds the title and the body", () => {
    expect(validateDocumentInput({ title: "x".repeat(MAX_TITLE_LENGTH + 1), body: "" }).ok).toBe(false);
    expect(
      validateDocumentInput({ title: "Quy tắc", body: "x".repeat(MAX_BODY_LENGTH + 1) }).ok
    ).toBe(false);
  });
});

describe("renderDocumentHtml — typed markup never becomes live markup", () => {
  it("shows a script tag as text", () => {
    const html = renderDocumentHtml('<script>alert("x")</script>');
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("cannot break out of an attribute, because the quotes are escaped", () => {
    const html = renderDocumentHtml('[bấm](https://vam.vn" onmouseover="alert(1))');
    // The target held a quote, so it is not a link at all — and the quote that
    // would have ended the attribute is escaped, leaving inert text.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('"');
    expect(html).toContain("&quot;");
  });

  it("refuses a javascript: target and keeps only the label", () => {
    const html = renderDocumentHtml("[bấm vào đây](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("bấm vào đây");
    expect(html).not.toContain("<a ");
  });

  it("shows an img tag as text rather than loading it", () => {
    const html = renderDocumentHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("renderDocumentHtml — the formatting organisers actually use", () => {
  it("turns headings into h2, h3 and h4", () => {
    const html = renderDocumentHtml("# Mục lớn\n## Mục nhỏ\n### Mục nhỏ hơn");
    expect(html).toContain("<h2>Mục lớn</h2>");
    expect(html).toContain("<h3>Mục nhỏ</h3>");
    expect(html).toContain("<h4>Mục nhỏ hơn</h4>");
  });

  it("makes bullet and numbered lists", () => {
    const bullets = renderDocumentHtml("- một\n- hai");
    expect(bullets).toContain("<ul>");
    expect(bullets).toContain("<li>một</li>");
    expect(bullets.match(/<\/ul>/g) ?? []).toHaveLength(1);

    const numbered = renderDocumentHtml("1. một\n2. hai");
    expect(numbered).toContain("<ol>");
    expect(numbered).toContain("<li>hai</li>");
  });

  it("closes a list before the next paragraph", () => {
    const html = renderDocumentHtml("- một\n\nĐoạn sau.");
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("<p>Đoạn sau."));
  });

  it("keeps bold and italic", () => {
    const html = renderDocumentHtml("Cam kết **tối thiểu 6 tháng** và *đúng hẹn*.");
    expect(html).toContain("<strong>tối thiểu 6 tháng</strong>");
    expect(html).toContain("<em>đúng hẹn</em>");
  });

  it("links an https target and opens it safely", () => {
    const html = renderDocumentHtml("Xem [trang chương trình](https://vam.edu.vn/mentoring).");
    expect(html).toContain('href="https://vam.edu.vn/mentoring"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("separates paragraphs on a blank line and keeps single breaks inside one", () => {
    const html = renderDocumentHtml("Dòng một\nDòng hai\n\nĐoạn hai");
    expect(html.match(/<p>/g) ?? []).toHaveLength(2);
    expect(html).toContain("Dòng một<br />Dòng hai");
  });

  it("is empty for empty input", () => {
    expect(renderDocumentHtml("")).toBe("");
    expect(renderDocumentHtml("   \n\n  ")).toBe("");
  });
});

describe("documentExcerpt", () => {
  it("strips the markup characters and shortens", () => {
    const excerpt = documentExcerpt("# Quy tắc\n\n- **Đúng hẹn**\n- Tôn trọng", 40);
    expect(excerpt).not.toContain("#");
    expect(excerpt).not.toContain("*");
    expect(excerpt.length).toBeLessThanOrEqual(40);
  });
});

describe("isDocumentReady", () => {
  it("is ready only when published with text in it", () => {
    expect(isDocumentReady({ status: "published", body: "Nội dung" })).toBe(true);
    expect(isDocumentReady({ status: "published", body: "   " })).toBe(false);
    expect(isDocumentReady({ status: "draft", body: "Nội dung" })).toBe(false);
  });
});
