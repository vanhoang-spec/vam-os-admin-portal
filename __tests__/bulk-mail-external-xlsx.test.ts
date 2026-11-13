/**
 * File Excel danh sách email ngoài VAM (VAM00027) — đọc THẬT bằng lib/ai/uploads.ts › readEmailListXlsx
 * và lib/ai/extract-text.ts (chế độ "table"), trên file .xlsx dựng bằng pizzip.
 *
 * Canh: cột không được dồn khi có ô trống (email trượt sang cột tên); chỉ đọc sheet đầu; file quá
 * lớn, sai đuôi, byte ảnh đội tên .xlsx, file hỏng, bom zip đều bị từ chối và nói rõ; số dòng Excel
 * báo đúng dòng người dùng mở ra sửa.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — không giả bộ đọc nào.
 */
import PizZip from "pizzip";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readEmailListXlsx } from "@/lib/ai/uploads";
import { MAX_EMAIL_LIST_FILE_BYTES } from "@/lib/ai/upload-core";
import { parseExternalRecipientTable } from "@/lib/bulk-mail-external-core";

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Một ô: chữ → chuỗi inline; `{ s: n }` → chuỗi chia sẻ thứ n. */
type Cell = string | { s: number } | null;

function sheetXml(rows: Array<{ r: number; cells: Array<[string, Cell]> }>): string {
  const body = rows
    .map(
      (row) =>
        `<row r="${row.r}">${row.cells
          .map(([ref, value]) => {
            if (value === null) return `<c r="${ref}" s="1"/>`;
            if (typeof value === "string") return `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
            return `<c r="${ref}" t="s"><v>${value.s}</v></c>`;
          })
          .join("")}</row>`
    )
    .join("");
  return xml(`<worksheet ${MAIN}><sheetData>${body}</sheetData></worksheet>`);
}

function makeXlsx(sheets: string[], shared: string[] = []): Buffer {
  const zip = new PizZip();
  zip.file(
    "xl/workbook.xml",
    xml(`<workbook ${MAIN} ${REL}><sheets>${sheets.map((_, i) => `<sheet name="S${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`)
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`
    )
  );
  zip.file("xl/sharedStrings.xml", xml(`<sst ${MAIN}>${shared.map((t) => `<si><t>${esc(t)}</t></si>`).join("")}</sst>`));
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function upload(bytes: Uint8Array | Buffer, name = "danh-sach.xlsx") {
  const data = new FormData();
  data.append("external_file", new File([new Uint8Array(bytes)], name));
  return data;
}

async function readOk(bytes: Buffer, name?: string) {
  const read = await readEmailListXlsx(upload(bytes, name), "external_file");
  if (!read.ok) throw new Error(read.message);
  return read;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("đọc đúng cột, đúng dòng, chỉ sheet đầu", () => {
  it("ô Họ tên trống không làm email trượt sang cột tên; số dòng Excel đi kèm", async () => {
    const file = makeXlsx(
      [
        sheetXml([
          { r: 1, cells: [["A1", { s: 0 }], ["B1", { s: 1 }]] },
          { r: 2, cells: [["A2", "Nguyễn An"], ["B2", "an@x.vn"]] },
          { r: 3, cells: [["A3", null], ["B3", "binh@y.org"]] },
          { r: 5, cells: [["B5", "cuong@sai"]] }
        ]),
        sheetXml([{ r: 1, cells: [["A1", "lac@sheet2.vn"]] }])
      ],
      ["Họ và tên", "Email"]
    );
    const read = await readOk(file);
    const parsed = parseExternalRecipientTable(read.table);
    expect(parsed.ok && parsed.entries).toEqual([
      { email: "an@x.vn", name: "Nguyễn An" },
      { email: "binh@y.org", name: "" }
    ]);
    expect(parsed.ok && parsed.problems).toEqual(["Dòng 5: “cuong@sai” không phải email hợp lệ"]);
    expect(read.table).not.toContain("sheet2");
  });

  it("dòng chỉ có định dạng (<row/> tự đóng) không nuốt dữ liệu dòng sau", async () => {
    const sheet = xml(
      `<worksheet ${MAIN}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Email</t></is></c></row><row r="2" spans="1:2"/><row r="3"><c r="A3" t="inlineStr"><is><t>an@x.vn</t></is></c></row></sheetData></worksheet>`
    );
    const read = await readOk(makeXlsx([sheet]));
    expect(read.table.split("\n")).toEqual(["1\tEmail", "3\tan@x.vn"]);
  });
});

describe("từ chối và nói rõ", () => {
  it("quá 2MB", async () => {
    const big = Buffer.concat([makeXlsx([sheetXml([{ r: 1, cells: [["A1", "a@x.vn"]] }])]), Buffer.alloc(MAX_EMAIL_LIST_FILE_BYTES)]);
    const read = await readEmailListXlsx(upload(big), "external_file");
    expect(read).toEqual({ ok: false, message: "danh-sach.xlsx (quá 2MB)" });
  });

  it.each(["danh-sach.xls", "danh-sach.csv", "danh-sach.docx", "danh-sach"])("sai đuôi: %s", async (name) => {
    const read = await readEmailListXlsx(upload(makeXlsx([sheetXml([])]), name), "external_file");
    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toMatch(/chỉ nhận file Excel \.xlsx/);
  });

  it("byte ảnh PNG đội tên .xlsx", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const read = await readEmailListXlsx(upload(png), "external_file");
    expect(read).toEqual({ ok: false, message: "danh-sach.xlsx (không nhận file ảnh)" });
  });

  it("chữ thường đội tên .xlsx (không phải ZIP)", async () => {
    const read = await readEmailListXlsx(upload(Buffer.from("an@x.vn\nbinh@y.org")), "external_file");
    expect(read).toEqual({ ok: false, message: "danh-sach.xlsx (nội dung không phải file Excel .xlsx)" });
  });

  it("file hỏng: có chữ ký ZIP nhưng ruột rác", async () => {
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]);
    const read = await readEmailListXlsx(upload(broken), "external_file");
    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toMatch(/không đọc được/);
  });

  it("file hỏng: ZIP thật nhưng không có workbook", async () => {
    const zip = new PizZip();
    zip.file("readme.txt", "an@x.vn");
    const read = await readEmailListXlsx(upload(zip.generate({ type: "nodebuffer" })), "external_file");
    expect(read.ok).toBe(false);
  });

  it("bom zip: sheet nở ra quá 16MB khi giải nén thì không đọc", async () => {
    const filler = `<row r="1"><c r="A1" t="inlineStr"><is><t>${"a".repeat(17 * 1024 * 1024)}</t></is></c></row>`;
    const sheet = xml(`<worksheet ${MAIN}><sheetData>${filler}<row r="2"><c r="A2" t="inlineStr"><is><t>an@x.vn</t></is></c></row></sheetData></worksheet>`);
    const file = makeXlsx([sheet]);
    expect(file.length).toBeLessThan(MAX_EMAIL_LIST_FILE_BYTES);
    const read = await readEmailListXlsx(upload(file), "external_file");
    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toMatch(/quá lớn khi giải nén|không đọc được/);
  });

  it("quá nhiều dữ liệu sau khi đọc: từ chối cả file, không cắt danh sách làm đôi", async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({
      r: i + 1,
      cells: [["A" + (i + 1), `nguoi${i}@congty-rat-dai-de-vuot-tran.vn`], ["B" + (i + 1), "Nguyễn Văn Một Cái Tên Rất Dài ".repeat(4)]] as Array<[string, Cell]>
    }));
    const read = await readEmailListXlsx(upload(makeXlsx([sheetXml(rows)])), "external_file");
    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toMatch(/quá nhiều dữ liệu/);
  });

  it("không chọn file, hay chọn hai file", async () => {
    expect((await readEmailListXlsx(new FormData(), "external_file")).ok).toBe(false);
    const two = upload(makeXlsx([sheetXml([])]));
    two.append("external_file", new File([new Uint8Array(makeXlsx([sheetXml([])]))], "b.xlsx"));
    expect(await readEmailListXlsx(two, "external_file")).toEqual({ ok: false, message: "Chọn đúng một file Excel (.xlsx)." });
  });
});
