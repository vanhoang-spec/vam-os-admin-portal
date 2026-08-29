import "server-only";

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { ApplicationExportData, ApplicationExportField } from "@/lib/application-export";

const SECTION_ORDER = ["Thông tin ứng viên", "Thông tin ứng tuyển", "Hồ sơ Mentor", "Hồ sơ Mentee", "Nội dung form S12", "Câu trả lời ứng tuyển"];

function pdfField(field: ApplicationExportField): Content {
  return {
    stack: [
      { text: field.label, bold: true, color: "#334155", fontSize: 9 },
      { text: field.value, margin: [0, 2, 0, 0], fontSize: 10, lineHeight: 1.25 }
    ],
    margin: [0, 0, 0, 8],
    unbreakable: false
  };
}

export async function applicationExportPdf(data: ApplicationExportData): Promise<Buffer> {
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = pdfFonts as unknown as Record<string, string>;
  const content: Content[] = [
    { text: "VAM / UEH MENTORING SEASON 12", style: "brand" },
    { text: "HỒ SƠ ỨNG TUYỂN", style: "title" },
    { text: data.applicantName, style: "applicant" },
    { text: `${data.role} · ${data.season}`, style: "role", margin: [0, 0, 0, 18] }
  ];

  for (const section of SECTION_ORDER) {
    const sectionFields = data.fields.filter((field) => field.section === section);
    if (!sectionFields.length) continue;
    content.push({ text: section.toUpperCase(), style: "section" });
    content.push(...sectionFields.map(pdfField));
  }

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
        margin: [0, 10, 0, 10],
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
