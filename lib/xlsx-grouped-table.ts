import PizZip from "pizzip";

/**
 * Một cửa dựng file .xlsx MỘT sheet cho các bảng xuất "mỗi người một dòng, cột chia nhóm" (VAM00023, VAM00025).
 *
 * Dựng tay bằng PizZip (đã có sẵn trong dự án) thay vì thêm thư viện Excel mới. Cách xử lý ô giữ đúng như bản đầu tiên
 * của file xuất mentee phỏng vấn trực tiếp:
 * - chữ nằm trong inlineStr, nên một ô bắt đầu bằng "=" (một đường dẫn, một nhận xét) KHÔNG thành công thức;
 * - số là số thật (sắp xếp, lọc theo số được);
 * - ô rỗng để trống thật, để bộ lọc "(Blanks)" của Excel đúng.
 *
 * Bố cục: dòng 1 là TIÊU ĐỀ NHÓM (gộp ô, mỗi nhóm một màu), dòng 2 là tên cột, từ dòng 3 là dữ liệu nền nhạt cùng màu
 * nhóm. Bộ lọc (autoFilter) đặt ở DÒNG 2 trở xuống, không gồm dòng tiêu đề nhóm. Hai dòng đầu và `frozenColumns` cột đầu
 * được cố định khi cuộn.
 */

export type XlsxCell = string | number | null;
export type XlsxColumn<G extends string> = { group: G; header: string; width: number };
export type XlsxTable<G extends string> = { columns: XlsxColumn<G>[]; rows: XlsxCell[][] };
/** Màu dạng ARGB, ví dụ "FF167C4B". */
export type XlsxGroupStyle = { title: string; header: string; tint: string };
export type XlsxSheetOptions<G extends string> = {
  sheetName: string;
  /** Thứ tự nhóm quyết định chỉ số kiểu ô; mọi nhóm có mặt trong `columns` phải nằm ở đây. */
  groupOrder: readonly G[];
  groups: Record<G, XlsxGroupStyle>;
  frozenColumns: number;
};

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/** Excel giới hạn một ô 32.767 ký tự; cắt kèm lời nhắc thay vì để file hỏng. */
const MAX_CELL_CHARS = 32000;

const xml = (value: string) =>
  value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A, B, …, Z, AA, AB, … */
export function columnLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : columnLetter(Math.floor(index / 26) - 1) + columnLetter(index % 26);
}

/** Các khoảng cột liền nhau cùng nhóm, theo thứ tự cột. */
export function groupSpans<G extends string>(table: XlsxTable<G>): Array<{ group: G; from: number; to: number }> {
  const spans: Array<{ group: G; from: number; to: number }> = [];
  table.columns.forEach((column, index) => {
    const last = spans[spans.length - 1];
    if (last && last.group === column.group) last.to = index;
    else spans.push({ group: column.group, from: index, to: index });
  });
  return spans;
}

// cellXfs: 0 mặc định · 1..n tiêu đề từng nhóm · n+1..2n dữ liệu nền nhạt từng nhóm (n = số nhóm, theo groupOrder).
function stylesXml<G extends string>(options: XlsxSheetOptions<G>) {
  const order = options.groupOrder;
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    ...order.map((g) => `<fill><patternFill patternType="solid"><fgColor rgb="${options.groups[g].header}"/><bgColor indexed="64"/></patternFill></fill>`),
    ...order.map((g) => `<fill><patternFill patternType="solid"><fgColor rgb="${options.groups[g].tint}"/><bgColor indexed="64"/></patternFill></fill>`)
  ];
  const header = (fill: number) =>
    `<xf numFmtId="0" fontId="1" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`;
  const body = (fill: number) =>
    `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`;
  const headers = order.map((_, i) => header(2 + i)).join("");
  const bodies = order.map((_, i) => body(2 + order.length + i)).join("");
  return (
    `<styleSheet xmlns="${NS}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    '<borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${1 + 2 * order.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `${headers}${bodies}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
}

function cellXml(ref: string, style: number, value: XlsxCell): string {
  if (value === null || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}"/>`;
  const textValue = value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}… (đã cắt, xem đầy đủ trong VAM OS)` : value;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(textValue)}</t></is></c>`;
}

export function groupedTableXlsx<G extends string>(table: XlsxTable<G>, options: XlsxSheetOptions<G>): Buffer {
  const zip = new PizZip();
  const lastColumn = columnLetter(Math.max(0, table.columns.length - 1));
  const lastRow = table.rows.length + 2;
  const spans = groupSpans(table);
  const rank = (group: G) => {
    const index = options.groupOrder.indexOf(group);
    // Nhóm lạ là lỗi lập trình: dựng ra file sai màu còn tệ hơn báo lỗi ngay.
    if (index < 0) throw new Error(`Nhóm cột chưa khai báo màu: ${group}`);
    return index;
  };
  const headerStyle = (group: G) => 1 + rank(group);
  const bodyStyle = (group: G) => 1 + options.groupOrder.length + rank(group);
  const sheetName = xml(options.sheetName);
  const frozen = Math.max(0, options.frozenColumns);

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
  );
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName}'!$A$2:$${lastColumn}$${lastRow}</definedName></definedNames></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  );
  zip.file("xl/styles.xml", stylesXml(options));

  // Dòng 1: tiêu đề nhóm. Ô thứ hai trở đi của vùng gộp vẫn phải có mặt và mang cùng màu.
  const titleRow = table.columns
    .map((column, index) => {
      const span = spans.find((s) => index >= s.from && index <= s.to)!;
      return cellXml(`${columnLetter(index)}1`, headerStyle(column.group), index === span.from ? options.groups[column.group].title : null);
    })
    .join("");
  const headerRow = table.columns.map((column, index) => cellXml(`${columnLetter(index)}2`, headerStyle(column.group), column.header)).join("");
  const bodyRows = table.rows
    .map((cells, rowIndex) => {
      const r = rowIndex + 3;
      return `<row r="${r}">${table.columns.map((column, index) => cellXml(`${columnLetter(index)}${r}`, bodyStyle(column.group), cells[index] ?? null)).join("")}</row>`;
    })
    .join("");
  const merges = spans.filter((s) => s.to > s.from).map((s) => `<mergeCell ref="${columnLetter(s.from)}1:${columnLetter(s.to)}1"/>`);
  const pane = frozen > 0
    ? `<pane xSplit="${frozen}" ySplit="2" topLeftCell="${columnLetter(frozen)}3" activePane="bottomRight" state="frozen"/>`
    : '<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>';

  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="${NS}">` +
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
      `<cols>${table.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData><row r="1" ht="24" customHeight="1">${titleRow}</row><row r="2">${headerRow}</row>${bodyRows}</sheetData>` +
      `<autoFilter ref="A2:${lastColumn}${lastRow}"/>` +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "") +
      "</worksheet>"
  );
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Bảng MỘT dòng tiêu đề, không nhóm cột (câu trả lời Form tùy chỉnh, VAM00032): dòng 1 là tên cột, từ dòng 2 là dữ liệu.
 * Dùng chung cách ghi ô với bảng nhóm ở trên (chữ trong inlineStr nên "=…", "+…", "-…", "@…" không thành công thức),
 * cố định dòng 1 và đặt bộ lọc từ dòng 1. Tách hàm riêng thay vì thêm cờ "bỏ dòng nhóm" vào groupedTableXlsx: mọi chỉ số
 * dòng ở đó đều cộng 2, một cờ nữa là thêm một chỗ để lệch một dòng.
 */
export function plainTableXlsx(headers: string[], rows: XlsxCell[][], options: { sheetName: string; widths?: number[] }): Buffer {
  const zip = new PizZip();
  const lastColumn = columnLetter(Math.max(0, headers.length - 1));
  const lastRow = rows.length + 1;
  const sheetName = xml(options.sheetName);
  const width = (index: number) => options.widths?.[index] ?? 24;

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
  );
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName}'!$A$1:$${lastColumn}$${lastRow}</definedName></definedNames></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  );
  // cellXfs: 0 dữ liệu (xuống dòng, canh trên) · 1 tiêu đề (chữ đậm trắng trên nền xanh VAM).
  zip.file(
    "xl/styles.xml",
    `<styleSheet xmlns="${NS}">` +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF167C4B"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
  const headerRow = headers.map((header, index) => cellXml(`${columnLetter(index)}1`, 1, header)).join("");
  const bodyRows = rows
    .map((cells, rowIndex) => {
      const r = rowIndex + 2;
      return `<row r="${r}">${headers.map((_, index) => cellXml(`${columnLetter(index)}${r}`, 0, cells[index] ?? null)).join("")}</row>`;
    })
    .join("");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="${NS}">` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<cols>${headers.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${width(index)}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData><row r="1">${headerRow}</row>${bodyRows}</sheetData>` +
      `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` +
      "</worksheet>"
  );
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
