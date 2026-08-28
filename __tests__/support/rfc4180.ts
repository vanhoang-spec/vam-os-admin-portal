/**
 * An RFC 4180 CSV reader, used to check the export the way a spreadsheet
 * program reads it rather than the way the writer wrote it.
 *
 * WHY NOT `split(",")`
 * -------------------
 * Every interesting case in the CSV contract is a case `split` gets wrong. A
 * name containing a comma ("Nguyễn, Văn A"), a reviewer note containing a
 * newline, a quoted field containing doubled quotes — under `split(",")` and
 * `split("\n")` these all read as extra fields and extra records, so a test
 * built on them asserts on garbage and passes or fails for reasons unrelated to
 * the file's correctness. It also cannot notice the opposite defect: a writer
 * that fails to quote at all produces a file `split` parses "successfully".
 *
 * This is a straight state machine over the grammar in RFC 4180 section 2:
 * fields are separated by commas and records by CRLF or LF; a field may be
 * enclosed in double quotes, inside which commas, line breaks and doubled
 * quotes ("") are literal. It is deliberately independent of `escapeCSV` —
 * it implements the standard, not the mirror image of the writer.
 */

export type CsvOptions = {
  /**
   * Strip a leading UTF-8 BOM. The export emits one on purpose (Excel needs it
   * to read UTF-8), and it belongs to the file, not to the first field.
   */
  stripBom?: boolean;
};

export function parseCsv(input: string, options: CsvOptions = {}): string[][] {
  let text = input;
  if (options.stripBom !== false && text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote; a single
        // quote ends the field.
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (char === ",") {
      endField();
      continue;
    }
    if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRecord();
      continue;
    }
    if (char === "\n") {
      endRecord();
      continue;
    }
    field += char;
    fieldStarted = true;
  }

  if (inQuotes) throw new Error("rfc4180: unterminated quoted field");
  // A file ending in a record separator has no trailing empty record.
  if (field.length || record.length) endRecord();

  return records;
}

/** Header row plus data records, with the header dropped. */
export function parseCsvTable(input: string) {
  const rows = parseCsv(input);
  return { header: rows[0] ?? [], rows: rows.slice(1) };
}
