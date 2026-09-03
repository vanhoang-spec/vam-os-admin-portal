import "server-only";

export const CSV_UTF8_BOM = String.fromCharCode(0xfeff);

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * Escapes one CSV cell for Excel/Sheets: always quotes, doubles internal
 * quotes, and strips embedded newlines so a value can never widen into
 * extra rows/columns. A leading =, +, - or @ is neutralized with a leading
 * apostrophe so spreadsheet software renders the cell as text instead of
 * evaluating it as a formula — required because these exports include
 * applicant-submitted free text (name, review notes) that is otherwise
 * attacker-controlled input landing directly in a spreadsheet cell.
 */
export function csvCell(value: unknown): string {
  // Strip \r\n, bare \n, and bare \r (old Mac line endings) alike — a lone
  // \r left in place is still read as a row break by common CSV/spreadsheet
  // parsers, so leaving it out would still let attacker-controlled free
  // text widen a cell into an extra row.
  let text = String(value ?? "").replace(/\r\n|\r|\n/g, " ").trim();
  if (text && FORMULA_TRIGGER_CHARS.has(text[0])) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
