import { parseCsvRecords } from "@/lib/account-import";
import { isValidEmail, normalizeEmail } from "@/lib/identity";

export const LEGACY_MENTOR_HEADERS = [
  "full_name",
  "email",
  "phone",
  "legacy_mentor_code",
  "prior_season",
  "notes"
] as const;

export const LEGACY_MENTOR_MAX_BYTES = 512 * 1024;
export const LEGACY_MENTOR_MAX_ROWS = 500;

export type LegacyMentorSource = "legacy_coreteam_import" | "legacy_manual_entry";

export type LegacyMentorPreviewStatus =
  | "NEW_PERSON"
  | "EXISTING_PERSON"
  | "DUPLICATE_IN_FILE"
  | "INVALID_EMAIL"
  | "INVALID_ROW"
  | "CONFLICT_REQUIRES_REVIEW";

export type LegacyMentorReference = {
  people: Array<{ id: string; fullName: string | null; email: string | null }>;
  profiles: Array<{ id: string; personId: string; mentorCode: string | null }>;
};

export type LegacyMentorRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  phone: string;
  legacyMentorCode: string;
  priorSeason: string;
  notes: string;
  status: LegacyMentorPreviewStatus;
  reason: string;
  personId: string | null;
  profileId: string | null;
  canApply: boolean;
};

export type LegacyMentorParseResult = { ok: boolean; rows: LegacyMentorRow[]; errors: string[] };

function clean(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function canonicalMentorCode(value: unknown): string {
  return clean(value, 100).toLowerCase();
}

export function classifyLegacyMentorRows(
  records: string[][],
  reference: LegacyMentorReference
): LegacyMentorRow[] {
  const peopleByEmail = new Map<string, LegacyMentorReference["people"]>();
  for (const person of reference.people) {
    const email = normalizeEmail(person.email);
    if (!email) continue;
    peopleByEmail.set(email, [...(peopleByEmail.get(email) ?? []), person]);
  }
  const profilesByPerson = new Map(reference.profiles.map((profile) => [profile.personId, profile]));
  const profilesByCode = new Map<string, LegacyMentorReference["profiles"]>();
  for (const profile of reference.profiles) {
    const code = canonicalMentorCode(profile.mentorCode);
    if (!code) continue;
    profilesByCode.set(code, [...(profilesByCode.get(code) ?? []), profile]);
  }
  const codesInFile = new Map<string, number>();
  for (const record of records) {
    const code = canonicalMentorCode(record[3]);
    if (code) codesInFile.set(code, (codesInFile.get(code) ?? 0) + 1);
  }
  const seen = new Set<string>();

  return records.map((record, index) => {
    const [rawName, rawEmail, rawPhone, rawCode, rawSeason, rawNotes] = record;
    const fullName = clean(rawName, 200);
    const email = normalizeEmail(rawEmail);
    const phone = clean(rawPhone, 50);
    const legacyMentorCode = clean(rawCode, 100);
    const priorSeason = clean(rawSeason, 100);
    const notes = clean(rawNotes, 1000);
    let status: LegacyMentorPreviewStatus = "NEW_PERSON";
    let reason = "Sẽ tạo person và hồ sơ mentor tối thiểu; chưa tạo membership.";
    let personId: string | null = null;
    let profileId: string | null = null;

    if (record.length !== LEGACY_MENTOR_HEADERS.length || !fullName) {
      status = "INVALID_ROW";
      reason = !fullName ? "Thiếu full_name bắt buộc." : `Cần đúng ${LEGACY_MENTOR_HEADERS.length} cột.`;
    } else if (!isValidEmail(email)) {
      status = "INVALID_EMAIL";
      reason = "Email không hợp lệ.";
    } else if (seen.has(email)) {
      status = "DUPLICATE_IN_FILE";
      reason = "Email trùng trong cùng tệp sau khi chuẩn hóa.";
    } else {
      const candidates = peopleByEmail.get(email) ?? [];
      if (candidates.length > 1) {
        status = "CONFLICT_REQUIRES_REVIEW";
        reason = "Nhiều person hiện có cùng canonical email; cần xử lý dữ liệu trước khi import.";
      } else if (legacyMentorCode && (codesInFile.get(canonicalMentorCode(legacyMentorCode)) ?? 0) > 1) {
        status = "CONFLICT_REQUIRES_REVIEW";
        reason = "legacy_mentor_code trùng trong cùng tệp; cần xác minh chủ sở hữu mã.";
      } else if (
        legacyMentorCode &&
        (profilesByCode.get(canonicalMentorCode(legacyMentorCode)) ?? []).some(
          (profile) => profile.personId !== candidates[0]?.id
        )
      ) {
        status = "CONFLICT_REQUIRES_REVIEW";
        reason = "legacy_mentor_code đã thuộc về một person khác; không thể tự động gán lại.";
      } else if (candidates.length === 1) {
        const person = candidates[0];
        const profile = profilesByPerson.get(person.id);
        personId = person.id;
        profileId = profile?.id ?? null;
        if (
          profile?.mentorCode &&
          legacyMentorCode &&
          profile.mentorCode.trim().toLowerCase() !== legacyMentorCode.toLowerCase()
        ) {
          status = "CONFLICT_REQUIRES_REVIEW";
          reason = `Mentor code hiện có (${profile.mentorCode}) khác legacy_mentor_code trong tệp.`;
        } else {
          status = "EXISTING_PERSON";
          reason = profile
            ? "Sẽ reuse person và hồ sơ mentor hiện có; chỉ bổ sung provenance, không tạo membership."
            : "Sẽ reuse person và tạo hồ sơ mentor tối thiểu; không tạo membership.";
        }
      }
    }
    if (email) seen.add(email);
    return {
      rowNumber: index + 2,
      fullName,
      email,
      phone,
      legacyMentorCode,
      priorSeason,
      notes,
      status,
      reason,
      personId,
      profileId,
      canApply: status === "NEW_PERSON" || status === "EXISTING_PERSON"
    };
  });
}

export function parseLegacyMentorCsv(csv: string, reference: LegacyMentorReference): LegacyMentorParseResult {
  if (new TextEncoder().encode(csv).byteLength > LEGACY_MENTOR_MAX_BYTES) {
    return { ok: false, rows: [], errors: [`Tệp vượt giới hạn ${LEGACY_MENTOR_MAX_BYTES} byte.`] };
  }
  const parsed = parseCsvRecords(csv.replace(/^\uFEFF/, ""));
  if (parsed.error) return { ok: false, rows: [], errors: [parsed.error] };
  if (!parsed.records.length) return { ok: false, rows: [], errors: ["Tệp CSV trống."] };
  const headers = parsed.records[0].map((header) => header.trim());
  if (
    headers.length !== LEGACY_MENTOR_HEADERS.length ||
    headers.some((header, index) => header !== LEGACY_MENTOR_HEADERS[index])
  ) {
    return { ok: false, rows: [], errors: [`Header phải đúng thứ tự: ${LEGACY_MENTOR_HEADERS.join(",")}`] };
  }
  const records = parsed.records.slice(1).filter((record) => record.some((value) => value.trim()));
  if (!records.length) return { ok: false, rows: [], errors: ["Tệp không có dòng dữ liệu."] };
  if (records.length > LEGACY_MENTOR_MAX_ROWS) {
    return { ok: false, rows: [], errors: [`Tệp vượt giới hạn ${LEGACY_MENTOR_MAX_ROWS} dòng dữ liệu.`] };
  }
  const rows = classifyLegacyMentorRows(records, reference);
  return { ok: rows.every((row) => row.canApply), rows, errors: [] };
}

export function legacyMentorTemplateCsv(): string {
  return `\uFEFF${LEGACY_MENTOR_HEADERS.join(",")}\nNguyễn Văn Mentor,mentor@example.com,0901234567,VM-S10-001,S10,Thông tin nguồn do Core Team cung cấp\n`;
}

export function invitationSourceFromProvenance(
  flags: unknown
): "s11_renewal" | "legacy_coreteam_import" | "legacy_manual_entry" {
  const text = String(flags ?? "");
  if (text.includes('"source":"legacy_manual_entry"')) return "legacy_manual_entry";
  if (text.includes('"source":"legacy_coreteam_import"')) return "legacy_coreteam_import";
  return "s11_renewal";
}
