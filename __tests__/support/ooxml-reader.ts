/**
 * An INDEPENDENT reader for the `.xlsx` bytes the export produces.
 *
 * WHY IT EXISTS
 * -------------
 * The previous R4 evidence for "the XLSX is valid" was a test that mocked
 * `write-excel-file` to resolve `Buffer.from("fake-excel-data")` and then
 * asserted the route returned those bytes. That proves the route can copy a
 * buffer; it says nothing about whether a real workbook was produced, and in
 * fact the production code was handing `Response` the library's result OBJECT,
 * which serialises to the literal string "[object Object]". A mock cannot
 * catch that class of defect, because the mock IS the thing under test.
 *
 * So this module re-implements just enough of ZIP and SpreadsheetML to open the
 * real bytes from the outside:
 *
 *   * the ZIP central directory is walked directly, and entries are inflated
 *     with Node's built-in `zlib` — no dependency on `fflate`, which is what
 *     `write-excel-file` itself compresses with, so a bug in that path cannot
 *     cancel out here;
 *   * `[Content_Types].xml` must be present, which is what makes the archive an
 *     OOXML package rather than a plain zip;
 *   * sheet names come from `xl/workbook.xml`, resolved to their parts through
 *     `xl/_rels/workbook.xml.rels`, exactly as a spreadsheet program does;
 *   * cell values are read from the worksheet XML, following `t="s"` into
 *     `xl/sharedStrings.xml`.
 *
 * The `cellTypes` map is the other half of the evidence: an MSSV that survives
 * as the STRING "0012345678" and one silently coerced to the NUMBER 12345678
 * are both "present" in the file. Only the type tells them apart, and only the
 * string form is correct.
 *
 * This is a reader for files WE generate. It handles the subset of the format
 * `write-excel-file` emits (deflate or stored entries, shared strings, inline
 * numbers) and throws on anything else rather than guessing.
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Every entry in the package, by its archive path. */
export type ZipEntries = Map<string, Buffer>;

/**
 * Walks the ZIP central directory. Reading the central directory (rather than
 * scanning for local headers) is what a real unzip implementation does, and it
 * is the part that fails loudly if the bytes are not actually an archive.
 */
export function readZip(bytes: Buffer): ZipEntries {
  const eocd = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);

  const entries: ZipEntries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`ooxml-reader: corrupt central directory at entry ${index}`);
    }
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    // The local header repeats the name and extra fields with its OWN lengths;
    // trusting the central directory's copy misplaces the data start.
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) entries.set(name, Buffer.from(raw));
    else if (method === 8) entries.set(name, inflateRawSync(raw));
    else throw new Error(`ooxml-reader: unsupported compression method ${method} for "${name}"`);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(bytes: Buffer) {
  // The EOCD record is last, but a trailing comment may follow it. Scan back.
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("ooxml-reader: not a ZIP archive (no end-of-central-directory record)");
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Ampersand last: decoding it first would re-interpret "&amp;lt;" as "<".
    .replace(/&amp;/g, "&");
}

function readSharedStrings(entries: ZipEntries) {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [] as string[];
  // One <si> per shared string; its text may be split across several <t> runs.
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map(([, body]) =>
    Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map(([, text]) => decodeXmlText(text))
      .join("")
  );
}

/** "C" -> 2, "AB" -> 27. Cell references are base-26 with no zero digit. */
function columnIndex(reference: string) {
  const letters = reference.replace(/\d+$/, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export type SheetCell = { value: string | number | null; type: "string" | "number" | "empty" };

export type Workbook = {
  entries: ZipEntries;
  sheetNames: string[];
  /** Sheet name -> rows -> cell text. Missing cells read as "". */
  sheets: Record<string, string[][]>;
  /** Sheet name -> rows -> typed cell, so a string "0012345678" is provable. */
  cellTypes: Record<string, SheetCell[][]>;
};

export function readXlsx(bytes: Buffer | Uint8Array): Workbook {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const entries = readZip(buffer);

  if (!entries.has("[Content_Types].xml")) {
    throw new Error("ooxml-reader: archive is not an OOXML package ([Content_Types].xml missing)");
  }

  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  if (!workbookXml) throw new Error("ooxml-reader: xl/workbook.xml missing");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";

  const targetByRelId = new Map<string, string>();
  for (const [, id, target] of Array.from(relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g))) {
    targetByRelId.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  // Attribute order is not fixed by the spec; accept Target before Id too.
  for (const [, target, id] of Array.from(relsXml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g))) {
    if (!targetByRelId.has(id)) targetByRelId.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sharedStrings = readSharedStrings(entries);
  const sheetNames: string[] = [];
  const sheets: Record<string, string[][]> = {};
  const cellTypes: Record<string, SheetCell[][]> = {};

  let positional = 0;
  for (const [, attributes] of Array.from(workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g))) {
    const name = decodeXmlText(attributes.match(/\bname="([^"]*)"/)?.[1] ?? "");
    if (!name) continue;
    positional += 1;
    sheetNames.push(name);

    const relId = attributes.match(/\br:id="([^"]*)"/)?.[1] ?? "";
    const target = targetByRelId.get(relId) ?? `worksheets/sheet${positional}.xml`;
    const sheetXml = entries.get(`xl/${target}`)?.toString("utf8");
    if (!sheetXml) throw new Error(`ooxml-reader: worksheet part for "${name}" missing (xl/${target})`);

    const typedRows: SheetCell[][] = [];
    for (const [, rowBody] of Array.from(sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g))) {
      const cells: SheetCell[] = [];
      for (const [, cellAttributes, cellBody] of Array.from(rowBody.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
        const at = columnIndex(cellAttributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "A1");
        while (cells.length < at) cells.push({ value: null, type: "empty" });
        const cellType = cellAttributes.match(/\bt="([^"]*)"/)?.[1] ?? "";
        const rawValue = cellBody?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = cellBody?.match(/<is>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];

        if (cellType === "s" && rawValue !== undefined) {
          cells.push({ value: sharedStrings[Number(rawValue)] ?? "", type: "string" });
        } else if (cellType === "inlineStr" && inline !== undefined) {
          cells.push({ value: decodeXmlText(inline), type: "string" });
        } else if (cellType === "str" && rawValue !== undefined) {
          cells.push({ value: decodeXmlText(rawValue), type: "string" });
        } else if (rawValue !== undefined && rawValue !== "") {
          cells.push({ value: Number(rawValue), type: "number" });
        } else {
          cells.push({ value: null, type: "empty" });
        }
      }
      typedRows.push(cells);
    }

    cellTypes[name] = typedRows;
    sheets[name] = typedRows.map((row) => row.map((cell) => (cell.value === null ? "" : String(cell.value))));
  }

  return { entries, sheetNames, sheets, cellTypes };
}
