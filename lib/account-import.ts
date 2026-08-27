import { isAccountImportRole, isParticipantImportRole, type AccountImportRole } from "@/lib/account-roles";
import { isValidEmail, normalizeEmail } from "@/lib/identity";

export const ACCOUNT_IMPORT_HEADERS = [
  "email",
  "display_name",
  "role",
  "program_code",
  "season_code",
  "intake_batch_code"
] as const;
export const ACCOUNT_IMPORT_MAX_BYTES = 512 * 1024;
export const ACCOUNT_IMPORT_MAX_ROWS = 500;

export type AccountImportReference = {
  programs: Array<{ id: string; code: string }>;
  seasons: Array<{ id: string; code: string; programId: string }>;
  intakeBatches: Array<{ id: string; code: string; seasonId: string }>;
};

export type AccountImportRow = {
  rowNumber: number;
  email: string;
  displayName: string;
  role: AccountImportRole | "";
  programCode: string;
  seasonCode: string;
  intakeBatchCode: string;
  programId: string | null;
  seasonId: string | null;
  intakeBatchId: string | null;
  valid: boolean;
  reasons: string[];
};

export type AccountImportParseResult = {
  ok: boolean;
  rows: AccountImportRow[];
  errors: string[];
};

export function parseCsvRecords(input: string): { records: string[][]; error?: string } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') {
      if (field.length) return { records, error: "Dấu ngoặc kép không hợp lệ." };
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (quoted) return { records, error: "Dòng CSV có dấu ngoặc kép chưa đóng." };
  record.push(field.replace(/\r$/, ""));
  if (record.some((value) => value.length > 0)) records.push(record);
  return { records };
}

function cleanCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function parseAccountImportCsv(csv: string, reference: AccountImportReference): AccountImportParseResult {
  if (new TextEncoder().encode(csv).byteLength > ACCOUNT_IMPORT_MAX_BYTES) {
    return { ok: false, rows: [], errors: [`Tệp vượt giới hạn ${ACCOUNT_IMPORT_MAX_BYTES} byte.`] };
  }
  const source = csv.replace(/^\uFEFF/, "");
  const parsed = parseCsvRecords(source);
  if (parsed.error) return { ok: false, rows: [], errors: [parsed.error] };
  if (!parsed.records.length) return { ok: false, rows: [], errors: ["Tệp CSV trống."] };
  const headers = parsed.records[0].map((header) => header.trim());
  if (headers.length !== ACCOUNT_IMPORT_HEADERS.length || headers.some((header, index) => header !== ACCOUNT_IMPORT_HEADERS[index])) {
    return { ok: false, rows: [], errors: [`Header phải đúng thứ tự: ${ACCOUNT_IMPORT_HEADERS.join(",")}`] };
  }
  const data = parsed.records.slice(1).filter((record) => record.some((value) => value.trim()));
  if (data.length > ACCOUNT_IMPORT_MAX_ROWS) {
    return { ok: false, rows: [], errors: [`Tệp vượt giới hạn ${ACCOUNT_IMPORT_MAX_ROWS} dòng dữ liệu.`] };
  }
  const seen = new Set<string>();
  const programs = new Map(reference.programs.map((item) => [cleanCode(item.code), item]));
  const seasons = new Map(reference.seasons.map((item) => [cleanCode(item.code), item]));
  const batches = new Map(reference.intakeBatches.map((item) => [cleanCode(item.code), item]));
  const rows = data.map((record, index): AccountImportRow => {
    const reasons: string[] = [];
    if (record.length !== ACCOUNT_IMPORT_HEADERS.length) reasons.push(`Cần đúng ${ACCOUNT_IMPORT_HEADERS.length} cột.`);
    const [rawEmail, rawName, rawRole, rawProgram, rawSeason, rawBatch] = record;
    const email = normalizeEmail(rawEmail);
    const roleText = String(rawRole ?? "").trim().toLowerCase();
    const programCode = cleanCode(rawProgram);
    const seasonCode = cleanCode(rawSeason);
    const intakeBatchCode = cleanCode(rawBatch);
    if (!isValidEmail(email)) reasons.push("Email không hợp lệ.");
    if (seen.has(email)) reasons.push("Email trùng trong cùng tệp sau khi chuẩn hóa.");
    if (email) seen.add(email);
    if (!isAccountImportRole(roleText)) reasons.push("Vai trò không được hỗ trợ.");
    const program = programs.get(programCode);
    const season = seasons.get(seasonCode);
    const batch = intakeBatchCode ? batches.get(intakeBatchCode) : undefined;
    if (!program) reasons.push("Program không tồn tại hoặc không hoạt động.");
    if (!season) reasons.push("Season không tồn tại hoặc không hoạt động.");
    if (program && season && season.programId !== program.id) reasons.push("Season không thuộc program đã chọn.");
    if (intakeBatchCode && !batch) reasons.push("Intake batch không tồn tại.");
    if (batch && season && batch.seasonId !== season.id) reasons.push("Intake batch không thuộc season đã chọn.");
    if (isParticipantImportRole(roleText) && !String(rawName ?? "").trim()) reasons.push("Mentor/mentee cần display_name.");
    return {
      rowNumber: index + 2,
      email,
      displayName: String(rawName ?? "").trim(),
      role: isAccountImportRole(roleText) ? roleText : "",
      programCode,
      seasonCode,
      intakeBatchCode,
      programId: program?.id ?? null,
      seasonId: season?.id ?? null,
      intakeBatchId: batch?.id ?? null,
      valid: reasons.length === 0,
      reasons
    };
  });
  return { ok: rows.length > 0 && rows.every((row) => row.valid), rows, errors: rows.length ? [] : ["Tệp không có dòng dữ liệu."] };
}

export function accountImportTemplateCsv() {
  return `\uFEFF${ACCOUNT_IMPORT_HEADERS.join(",")}\nops.ueh@example.com,Nguyen Van Ops,viewer,UEH,UEHM-S12,UEHM-S12-B01\nmentor.synthetic@example.com,Tran Mentor,mentor,UEH,UEHM-S12,UEHM-S12-B01\n`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function accountImportResultsCsv(rows: Array<{ rowNumber: number; status: string; reason: string }>) {
  return `\uFEFFrow_number,status,reason\n${rows.map((row) => [row.rowNumber, row.status, row.reason].map(csvCell).join(",")).join("\n")}\n`;
}
