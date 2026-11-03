import PizZip from "pizzip";
import { EXPORT_GROUP_TITLES, type ExportCell, type ExportGroup, type ExportTable } from "@/lib/mentee-offline-export-core";

/**
 * XLSX thật cho bảng xuất mentee phỏng vấn trực tiếp (VAM00023). Dựng tay bằng PizZip như file xuất kết quả phỏng vấn
 * mentor, nên cùng cách xử lý ô: chữ nằm trong inlineStr (một nhận xét bắt đầu bằng "=" không thành công thức), số là
 * số thật (sắp xếp được), ô rỗng để trống thật (lọc "(Blanks)" đúng).
 *
 * Bố cục: dòng 1 là TIÊU ĐỀ NHÓM (gộp ô, mỗi nhóm một màu), dòng 2 là tên cột cùng màu nhóm, từ dòng 3 là dữ liệu có
 * nền nhạt cùng màu nhóm. Bộ lọc (autoFilter) đặt ở DÒNG 2 trở xuống, không gồm dòng tiêu đề nhóm, để Filter và Sort
 * của Excel chạy trên đúng bảng dữ liệu. Hai dòng đầu và hai cột đầu (mã hồ sơ, họ tên) được cố định khi cuộn.
 */

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const XLSX_SHEET_NAME = "Mentee PV truc tiep";
/** Excel giới hạn một ô 32.767 ký tự; cắt kèm lời nhắc thay vì để file hỏng. */
const MAX_CELL_CHARS = 32000;

/** Màu từng nhóm: đậm cho tiêu đề, nhạt cho nền dữ liệu. */
export const EXPORT_GROUP_COLORS: Record<ExportGroup, { header: string; tint: string }> = {
  profile: { header: "FF167C4B", tint: "FFEAF6EF" },
  screening: { header: "FF1D4ED8", tint: "FFEAF1FF" },
  interview: { header: "FFC2410C", tint: "FFFFF1E6" }
};
const GROUP_ORDER: ExportGroup[] = ["profile", "screening", "interview"];

const xml = (value: string) =>
  value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A, B, …, Z, AA, AB, … */
export function columnLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : columnLetter(Math.floor(index / 26) - 1) + columnLetter(index % 26);
}

// cellXfs: 0 mặc định · 1-3 tiêu đề nhóm · 4-6 dữ liệu nền nhạt
const HEADER_STYLE: Record<ExportGroup, number> = { profile: 1, screening: 2, interview: 3 };
const BODY_STYLE: Record<ExportGroup, number> = { profile: 4, screening: 5, interview: 6 };

function stylesXml() {
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    ...GROUP_ORDER.map((g) => `<fill><patternFill patternType="solid"><fgColor rgb="${EXPORT_GROUP_COLORS[g].header}"/><bgColor indexed="64"/></patternFill></fill>`),
    ...GROUP_ORDER.map((g) => `<fill><patternFill patternType="solid"><fgColor rgb="${EXPORT_GROUP_COLORS[g].tint}"/><bgColor indexed="64"/></patternFill></fill>`)
  ];
  const header = (fill: number) =>
    `<xf numFmtId="0" fontId="1" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`;
  const body = (fill: number) =>
    `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`;
  return (
    `<styleSheet xmlns="${NS}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    '<borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `${header(2)}${header(3)}${header(4)}${body(5)}${body(6)}${body(7)}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
}

function cellXml(ref: string, style: number, value: ExportCell): string {
  if (value === null || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const textValue = value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}… (đã cắt, xem đầy đủ trong VAM OS)` : value;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(textValue)}</t></is></c>`;
}

/** Các khoảng cột liền nhau cùng nhóm, theo thứ tự cột. */
export function groupSpans(table: ExportTable): Array<{ group: ExportGroup; from: number; to: number }> {
  const spans: Array<{ group: ExportGroup; from: number; to: number }> = [];
  table.columns.forEach((column, index) => {
    const last = spans[spans.length - 1];
    if (last && last.group === column.group) last.to = index;
    else spans.push({ group: column.group, from: index, to: index });
  });
  return spans;
}

export function menteeOfflineXlsx(table: ExportTable): Buffer {
  const zip = new PizZip();
  const lastColumn = columnLetter(Math.max(0, table.columns.length - 1));
  const lastRow = table.rows.length + 2;
  const spans = groupSpans(table);

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
  );
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${XLSX_SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${XLSX_SHEET_NAME}'!$A$2:$${lastColumn}$${lastRow}</definedName></definedNames></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  );
  zip.file("xl/styles.xml", stylesXml());

  // Dòng 1: tiêu đề nhóm. Ô thứ hai trở đi của vùng gộp vẫn phải có mặt và mang cùng màu.
  const titleRow = table.columns
    .map((column, index) => {
      const span = spans.find((s) => index >= s.from && index <= s.to)!;
      return cellXml(`${columnLetter(index)}1`, HEADER_STYLE[column.group], index === span.from ? EXPORT_GROUP_TITLES[column.group] : null);
    })
    .join("");
  const headerRow = table.columns.map((column, index) => cellXml(`${columnLetter(index)}2`, HEADER_STYLE[column.group], column.header)).join("");
  const bodyRows = table.rows
    .map((cells, rowIndex) => {
      const r = rowIndex + 3;
      return `<row r="${r}">${table.columns.map((column, index) => cellXml(`${columnLetter(index)}${r}`, BODY_STYLE[column.group], cells[index] ?? null)).join("")}</row>`;
    })
    .join("");
  const merges = spans.filter((s) => s.to > s.from).map((s) => `<mergeCell ref="${columnLetter(s.from)}1:${columnLetter(s.to)}1"/>`);

  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="${NS}">` +
      '<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' +
      `<cols>${table.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData><row r="1" ht="24" customHeight="1">${titleRow}</row><row r="2">${headerRow}</row>${bodyRows}</sheetData>` +
      `<autoFilter ref="A2:${lastColumn}${lastRow}"/>` +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "") +
      "</worksheet>"
  );
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
