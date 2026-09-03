import "server-only";

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { ApplicationExportData, ApplicationExportField } from "@/lib/application-export";

const SECTION_ORDER = ["Thông tin ứng viên", "Thông tin ứng tuyển", "Hồ sơ Mentor", "Hồ sơ Mentee", "Nội dung form S12", "Câu trả lời ứng tuyển"];

/**
 * A long answer must be allowed to flow across pages, but a short one splitting
 * its label onto the previous page is just noise. Anything that comfortably
 * fits a page is therefore kept whole.
 */
const UNBREAKABLE_VALUE_LIMIT = 900;

function pdfField(field: ApplicationExportField): Content {
  return {
    stack: [
      { text: field.label, bold: true, color: "#334155", fontSize: 9 },
      { text: field.value, margin: [0, 3, 0, 0], fontSize: 10, lineHeight: 1.3 }
    ],
    margin: [0, 0, 0, 10],
    unbreakable: field.value.length <= UNBREAKABLE_VALUE_LIMIT
  };
}

function sectionHeading(section: string): Content {
  return {
    text: section.toUpperCase(),
    style: "section"
  };
}

/**
 * The heading travels with the first field of its section in one unbreakable
 * block, so a section title can never be left stranded at the bottom of a page
 * with its content overleaf.
 */
function pdfSection(section: string, fields: ApplicationExportField[]): Content[] {
  const [first, ...rest] = fields;
  const opener: Content =
    first.value.length <= UNBREAKABLE_VALUE_LIMIT
      ? { stack: [sectionHeading(section), pdfField(first)], unbreakable: true }
      : { stack: [sectionHeading(section), pdfField(first)] };
  return [opener, ...rest.map(pdfField)];
}

/**
 * Exported so the page-break structure can be asserted directly rather than
 * inferred from a rendered binary.
 */
export function buildApplicationPdfContent(data: ApplicationExportData): Content[] {
  const content: Content[] = [
    { text: "VAM / UEH MENTORING SEASON 12", style: "brand" },
    { text: "HỒ SƠ ỨNG TUYỂN", style: "title" },
    { text: data.applicantName, style: "applicant" },
    { text: `${data.role} · ${data.season}`, style: "role", margin: [0, 0, 0, 18] }
  ];

  for (const section of SECTION_ORDER) {
    const sectionFields = data.fields.filter((field) => field.section === section);
    // An empty section is skipped outright, so no heading is ever printed over
    // nothing and no page is spent on one.
    if (!sectionFields.length) continue;
    content.push(...pdfSection(section, sectionFields));
  }
  return content;
}

export async function applicationExportPdf(data: ApplicationExportData): Promise<Buffer> {
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = pdfFonts as unknown as Record<string, string>;
  const content = buildApplicationPdfContent(data);

  const document: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [48, 52, 48, 52],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#0f172a" },
    footer: (currentPage, pageCount) => ({
      text: `VAM OS · ${data.applicationId} · Trang ${currentPage}/${pageCount}`,
      alignment: "center",
      color: "#64748b",
      fontSize: 8,
      margin: [0, 16, 0, 0]
    }),
    styles: {
      brand: { fontSize: 10, bold: true, color: "#167c4b", characterSpacing: 0.8 },
      title: { fontSize: 20, bold: true, color: "#0f5132", margin: [0, 8, 0, 12] },
      applicant: { fontSize: 18, bold: true, color: "#0f172a" },
      role: { fontSize: 11, color: "#475569", margin: [0, 4, 0, 0] },
      section: {
        fontSize: 11,
        bold: true,
        color: "#167c4b",
        margin: [0, 16, 0, 10],
        decoration: "underline",
        decorationColor: "#bbf7d0"
      }
    },
    content,
    info: {
      title: `Hồ sơ ứng tuyển ${data.applicantName}`,
      subject: "VAM / UEH Mentoring Season 12",
      creator: "VAM OS"
    }
  };

  return new Promise<Buffer>((resolve, reject) => {
    try {
      pdfMake.createPdf(document).getBuffer((buffer) => resolve(Buffer.from(buffer)));
    } catch (error) {
      reject(error);
    }
  });
}
