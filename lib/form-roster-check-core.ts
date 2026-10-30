/**
 * lib/form-roster-check-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đối chiếu câu trả lời của một form tùy chỉnh với danh sách mentee/mentor chính thức của mùa
 * (Support team 25/10/2026): ai đã nộp, ai chưa, ai nộp mà không có trong danh sách.
 *
 * Khớp người nộp với danh sách theo thứ tự tin cậy:
 *   1. Email — email trong hồ sơ, hoặc email trên đơn mùa đó (người nộp hay dùng email khác).
 *   2. Số điện thoại — đã chuẩn hoá (+84 / 84 → 0, bỏ khoảng trắng và dấu).
 *   3. Họ tên bỏ dấu — CHỈ khi đúng một người trong danh sách mang tên đó, và gắn cờ "cần xem lại":
 *      hai bạn trùng tên là chuyện thường, một lần khớp nhầm là báo "đã nộp" cho người chưa nộp.
 *
 * Email/SĐT khớp một người ở VAI KIA (vd. mentor nộp form mentee) thì người nộp nằm ở "ngoài danh
 * sách" kèm ghi chú, không được tính là đã nộp.
 *
 * Module thuần, không I/O.
 */
import { foldPersonName } from "@/lib/bulk-mail-core";
import { nameField, type CustomFormAnswers, type CustomFormField } from "@/lib/custom-form-core";

export type RosterCheckRole = "mentee" | "mentor";
export const ROSTER_CHECK_ROLES: readonly RosterCheckRole[] = ["mentee", "mentor"];
export const ROSTER_CHECK_ROLE_LABELS: Record<RosterCheckRole, string> = { mentee: "Mentee", mentor: "Mentor" };

export type RosterPerson = {
  personId: string;
  name: string;
  /** Email chính trước, rồi email trên đơn mùa đó. */
  emails: string[];
  phones: string[];
  roles: RosterCheckRole[];
};

export type FormSubmission = {
  responseId: string;
  createdAt: string;
  name: string;
  emails: string[];
  phones: string[];
};

export type MatchedBy = "email" | "phone" | "name";
export const MATCHED_BY_LABELS: Record<MatchedBy, string> = {
  email: "Email",
  phone: "Số điện thoại",
  name: "Họ tên — cần xem lại"
};

export type SubmittedEntry = {
  person: RosterPerson;
  /** Mới nhất trước. */
  submissions: FormSubmission[];
  /** Cách khớp tin cậy nhất trong các lần nộp. */
  matchedBy: MatchedBy;
};

export type OutsiderEntry = { submission: FormSubmission; note: string };

export type RosterCheckResult = {
  role: RosterCheckRole;
  rosterSize: number;
  submitted: SubmittedEntry[];
  notSubmitted: RosterPerson[];
  outsiders: OutsiderEntry[];
};

export function normalizeMatchEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** "+84 912 345 678", "84912345678", "0912.345.678" → "0912345678". Không đủ 9 chữ số thì bỏ. */
export function normalizeMatchPhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits.length >= 9 ? digits : "";
}

/** Ô họ tên — một định nghĩa, dùng chung với luật của form gắn sự kiện. */
export { nameField };

function texts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? ""));
  return value === undefined || value === null ? [] : [String(value)];
}

/** Họ tên, mọi email và mọi SĐT người nộp đã điền — kể cả ở câu đang ẩn: dữ liệu cũ vẫn là của họ. */
export function submissionIdentity(
  fields: CustomFormField[],
  response: { id: string; createdAt: string; answers: CustomFormAnswers }
): FormSubmission {
  const name = nameField(fields);
  const pick = (type: CustomFormField["type"], norm: (v: unknown) => string) =>
    Array.from(new Set(fields.filter((f) => f.type === type).flatMap((f) => texts(response.answers[f.id]).map(norm)).filter(Boolean)));
  return {
    responseId: response.id,
    createdAt: response.createdAt,
    name: name ? texts(response.answers[name.id]).join(" ").trim() : "",
    emails: pick("email", normalizeMatchEmail),
    phones: pick("phone", normalizeMatchPhone)
  };
}

function index(people: RosterPerson[], keys: (p: RosterPerson) => string[]): Map<string, RosterPerson[]> {
  const map = new Map<string, RosterPerson[]>();
  for (const person of people) {
    for (const key of Array.from(new Set(keys(person).filter(Boolean)))) map.set(key, [...(map.get(key) ?? []), person]);
  }
  return map;
}

const RANK: Record<MatchedBy, number> = { email: 0, phone: 1, name: 2 };

export function checkFormAgainstRoster(input: {
  role: RosterCheckRole;
  /** Mọi thành viên chính thức của mùa, cả hai vai — để nhận ra người nộp nhầm vai. */
  people: RosterPerson[];
  submissions: FormSubmission[];
}): RosterCheckResult {
  const target = input.people.filter((p) => p.roles.includes(input.role));
  const others = input.people.filter((p) => !p.roles.includes(input.role));
  // Chuẩn hoá cả hai phía ở đây, không trông vào người gọi: một email còn chữ hoa là một người nộp
  // bị báo "chưa nộp".
  const emailsOf = (list: string[]) => list.map(normalizeMatchEmail);
  const phonesOf = (list: string[]) => list.map(normalizeMatchPhone);
  const byEmail = index(target, (p) => emailsOf(p.emails));
  const byPhone = index(target, (p) => phonesOf(p.phones));
  const byName = index(target, (p) => [foldPersonName(p.name)]);
  const otherByEmail = index(others, (p) => emailsOf(p.emails));
  const otherByPhone = index(others, (p) => phonesOf(p.phones));

  const hits = new Map<string, SubmittedEntry>();
  const outsiders: OutsiderEntry[] = [];
  const unique = (list: RosterPerson[] | undefined) => {
    const ids = new Set((list ?? []).map((p) => p.personId));
    return ids.size === 1 ? list![0] : null;
  };
  const firstUnique = (keys: string[], map: Map<string, RosterPerson[]>) => {
    for (const key of keys) {
      const person = unique(map.get(key));
      if (person) return person;
    }
    return null;
  };

  for (const submission of input.submissions) {
    const emails = emailsOf(submission.emails).filter(Boolean);
    const phones = phonesOf(submission.phones).filter(Boolean);
    let person: RosterPerson | null = firstUnique(emails, byEmail);
    let matchedBy: MatchedBy = "email";
    if (!person) {
      person = firstUnique(phones, byPhone);
      matchedBy = "phone";
    }
    if (!person) {
      const key = foldPersonName(submission.name);
      person = key ? unique(byName.get(key)) : null;
      matchedBy = "name";
    }
    if (person) {
      const entry = hits.get(person.personId) ?? { person, submissions: [], matchedBy };
      entry.submissions.push(submission);
      if (RANK[matchedBy] < RANK[entry.matchedBy]) entry.matchedBy = matchedBy;
      hits.set(person.personId, entry);
      continue;
    }
    const other = firstUnique(emails, otherByEmail) ?? firstUnique(phones, otherByPhone);
    const sameName = foldPersonName(submission.name) ? (byName.get(foldPersonName(submission.name)) ?? []).length : 0;
    outsiders.push({
      submission,
      note: other
        ? `Email/SĐT trùng ${other.roles.map((r) => ROSTER_CHECK_ROLE_LABELS[r].toLowerCase()).join(", ")} ${other.name} — không phải ${ROSTER_CHECK_ROLE_LABELS[input.role].toLowerCase()}`
        : sameName > 1
          ? `Trùng họ tên với ${sameName} người trong danh sách nhưng email/SĐT không khớp ai — cần xem tay`
          : ""
    });
  }

  const byNewest = (a: FormSubmission, b: FormSubmission) => b.createdAt.localeCompare(a.createdAt) || b.responseId.localeCompare(a.responseId);
  const byName2 = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "vi");
  const submitted = Array.from(hits.values()).map((e) => ({ ...e, submissions: [...e.submissions].sort(byNewest) }));
  return {
    role: input.role,
    rosterSize: target.length,
    submitted: submitted.sort((a, b) => byName2(a.person, b.person)),
    notSubmitted: target.filter((p) => !hits.has(p.personId)).sort(byName2),
    outsiders: outsiders.sort((a, b) => byNewest(a.submission, b.submission))
  };
}
