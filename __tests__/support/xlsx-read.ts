import PizZip from "pizzip";

/** Đọc lại file .xlsx do lib/xlsx-grouped-table.ts dựng ra: tên sheet, tiêu đề cột (dòng 2) và các dòng dữ liệu (từ dòng 3). */
export type ReadSheet = {
  zip: PizZip;
  sheetNames: string[];
  sheetXml: string;
  groupTitles: string[];
  headers: string[];
  rows: Array<Array<string | number | null>>;
};

const unescape = (value: string) =>
  value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function columnIndex(letters: string) {
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

export function readSheet(bytes: Buffer | ArrayBuffer | Uint8Array): ReadSheet {
  const zip = new PizZip(bytes as Buffer);
  const workbook = zip.file("xl/workbook.xml")!.asText();
  const sheetNames = Array.from(workbook.matchAll(/<sheet name="([^"]*)"/g), (m) => unescape(m[1]));
  const sheetXml = zip.file("xl/worksheets/sheet1.xml")!.asText();
  const byRow = new Map<number, Array<string | number | null>>();
  const cell = /<c r="([A-Z]+)(\d+)" s="\d+"(?: t="inlineStr")?(?:\/>|><v>([^<]*)<\/v><\/c>|><is><t xml:space="preserve">([^<]*)<\/t><\/is><\/c>)/g;
  for (const m of Array.from(sheetXml.matchAll(cell))) {
    const row = Number(m[2]);
    const cells = byRow.get(row) ?? [];
    cells[columnIndex(m[1])] = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? unescape(m[4]) : null;
    byRow.set(row, cells);
  }
  const width = (byRow.get(2) ?? []).length;
  const fill = (cells: Array<string | number | null> | undefined) => Array.from({ length: width }, (_, i) => cells?.[i] ?? null);
  const lastRow = Math.max(2, ...Array.from(byRow.keys()));
  const rows: Array<Array<string | number | null>> = [];
  for (let r = 3; r <= lastRow; r++) rows.push(fill(byRow.get(r)));
  return {
    zip,
    sheetNames,
    sheetXml,
    groupTitles: fill(byRow.get(1)).filter((v): v is string => typeof v === "string"),
    headers: fill(byRow.get(2)).map((v) => String(v ?? "")),
    rows
  };
}

/** Giá trị của một cột (theo tiêu đề) trên mọi dòng. */
export function columnValues(sheet: ReadSheet, header: string) {
  const index = sheet.headers.indexOf(header);
  if (index < 0) throw new Error(`Không có cột "${header}"`);
  return sheet.rows.map((row) => row[index]);
}
