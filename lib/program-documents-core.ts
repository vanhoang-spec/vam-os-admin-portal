/**
 * lib/program-documents-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The code of conduct and the tips: naming them, addressing them, and turning
 * the text an organiser typed into HTML a mentee can read.
 *
 * Pure and dependency-light, so the rendering rules are unit-testable — which
 * matters, because this is the one place in the application where text written
 * in an admin form is displayed on a page with no login in front of it. The
 * renderer therefore escapes EVERYTHING first and only then puts its own tags
 * back: there is no path by which typed markup becomes live markup.
 */

export const DOCUMENT_AUDIENCES = ["mentee", "mentor"] as const;
export type DocumentAudience = (typeof DOCUMENT_AUDIENCES)[number];

export const DOCUMENT_KINDS = ["code_of_conduct", "tips"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const AUDIENCE_LABELS: Record<DocumentAudience, string> = {
  mentee: "Mentee",
  mentor: "Mentor"
};

export const KIND_LABELS: Record<DocumentKind, string> = {
  code_of_conduct: "Quy tắc ứng xử",
  tips: "Cẩm nang đồng hành"
};

export const MAX_TITLE_LENGTH = 160;
export const MAX_BODY_LENGTH = 40_000;

/** Default title before anybody edits it. */
export function defaultDocumentTitle(audience: DocumentAudience, kind: DocumentKind): string {
  return `${KIND_LABELS[kind]} dành cho ${AUDIENCE_LABELS[audience].toLowerCase()}`;
}

// ── Slug ─────────────────────────────────────────────────────────────────────

function stripDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** A URL-safe address. Vietnamese loses its diacritics rather than its meaning. */
export function slugify(value: string): string {
  return stripDiacritics(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * The address a document keeps for the life of the season.
 *
 * Built from the season code so two seasons can each have their own code of
 * conduct, and never regenerated: emails already carry the old one.
 */
export function buildDocumentSlug(input: {
  seasonCode: string | null | undefined;
  audience: DocumentAudience;
  kind: DocumentKind;
}): string {
  const season = slugify(input.seasonCode ?? "") || "mua";
  const kind = input.kind === "code_of_conduct" ? "quy-tac-ung-xu" : "cam-nang";
  const slug = `${season}-${input.audience}-${kind}`;
  // The column allows 3..81 characters starting with a letter or digit.
  return slug.length >= 3 ? slug : `tai-lieu-${slug}`;
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

// ── Validation ───────────────────────────────────────────────────────────────

export type DocumentInput = { title?: unknown; body?: unknown };

export type DocumentValidation =
  | { ok: true; title: string; body: string }
  | { ok: false; message: string };

export function validateDocumentInput(input: DocumentInput): DocumentValidation {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, message: "Vui lòng nhập tiêu đề tài liệu." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: `Tiêu đề không được dài quá ${MAX_TITLE_LENGTH} ký tự.` };
  }

  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      message: `Nội dung không được dài quá ${MAX_BODY_LENGTH.toLocaleString("vi-VN")} ký tự.`
    };
  }

  return { ok: true, title, body };
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only a link this program would actually publish. */
function safeHref(url: string): string | null {
  const text = url.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  if (/[\s<>"']/.test(text)) return null;
  return text;
}

/** Inline marks, applied to text that is ALREADY escaped. */
function renderInline(escaped: string): string {
  return escaped
    // [nhãn](https://…) — the label may hold anything, the target may not.
    .replace(/\[([^\]]{1,120})\]\(([^)\s]{1,300})\)/g, (match, label: string, href: string) => {
      const safe = safeHref(href.replace(/&amp;/g, "&"));
      if (!safe) return label;
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*]{1,300})\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]{1,300})\*/g, "$1<em>$2</em>");
}

/**
 * Turn the organiser's text into HTML.
 *
 * Supported on purpose and no more: headings (#, ##, ###), bullet and numbered
 * lists, bold, italic, links, and blank-line paragraphs. Everything else is
 * shown as the characters that were typed.
 */
export function renderDocumentHtml(body: string): string {
  const lines = String(body ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join("<br />"))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const escaped = escapeHtml(line.trim());

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = line.trim().match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length + 1; // # → h2, so the page keeps one h1
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }

    const bullet = line.trim().match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      closeParagraph();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${renderInline(escapeHtml(bullet[1].trim()))}</li>`);
      continue;
    }

    const numbered = line.trim().match(/^\d{1,3}[.)]\s+(.*)$/);
    if (numbered) {
      closeParagraph();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${renderInline(escapeHtml(numbered[1].trim()))}</li>`);
      continue;
    }

    closeList();
    paragraph.push(escaped);
  }

  closeParagraph();
  closeList();

  return out.join("\n");
}

/** First words of a document, for a listing or a link preview. */
export function documentExcerpt(body: string, maxLength = 180): string {
  const text = String(body ?? "")
    .replace(/[#*>`_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/** A document with no text yet is not something to link an applicant to. */
export function isDocumentReady(document: { status?: string | null; body?: string | null }): boolean {
  return document.status === "published" && String(document.body ?? "").trim().length > 0;
}
