/**
 * lib/mentee-exemption-core.ts — mentee đặc cách (Support team), phần thuần, không I/O.
 *
 * BTC 11/10/2026: các bạn Support team làm mentee mùa này mà không qua phỏng vấn. BTC chốt
 * danh sách, gửi thư mời, người nhận bấm "Xác nhận" là xong. Luật ghi nằm trong database
 * (migration 20261011150000); ở đây chỉ có: ai được GỢI Ý vào danh sách, mỗi dòng đang ở
 * bước nào, ai sẽ nhận thư ở lượt bấm tới, và câu chữ cho từng mã kết quả.
 *
 * Gợi ý không phải quyết định. Tháng 8/2026 BTC đã tự tay cho 19 bạn làm mentee theo hai
 * lối (gắn thẳng tư cách; bấm duyệt đơn) mà không lối nào để lại dấu "Support team", và
 * trong CRM chỉ có đúng một tài khoản mang vai trò Support team. Nên hệ thống chỉ gom những
 * người CÓ DẤU HIỆU đặc cách để BTC tick — không tự thêm ai.
 */

export const MENTEE_CONFIRM_PATH_PREFIX = "/xac-nhan-mentee";

export function menteeConfirmUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${MENTEE_CONFIRM_PATH_PREFIX}/${token}`;
}

/** Sau bao lâu thì một người chưa xác nhận được nhận thư lần nữa khi BTC bấm gửi lại. */
export const EXEMPTION_RESEND_AFTER_MS = 20 * 60 * 60 * 1000;

export type ExemptionRow = {
  id: string;
  personId: string;
  token: string;
  addedAt: string | null;
  sendCount: number;
  lastSentAt: string | null;
  claimedAt: string | null;
  lastError: string | null;
  confirmedAt: string | null;
  revokedAt: string | null;
};

export type ExemptionState = "confirmed" | "revoked" | "sent" | "not_sent";

export const EXEMPTION_STATE_LABELS: Record<ExemptionState, string> = {
  confirmed: "Đã xác nhận",
  revoked: "Đã gỡ khỏi danh sách",
  sent: "Đã gửi thư, chờ xác nhận",
  not_sent: "Chưa gửi thư"
};

/** Thứ tự xét là thứ tự ưu tiên: đã xác nhận thắng mọi thứ, kể cả một dấu gỡ còn sót. */
export function exemptionState(row: Pick<ExemptionRow, "confirmedAt" | "revokedAt" | "sendCount">): ExemptionState {
  if (row.confirmedAt) return "confirmed";
  if (row.revokedAt) return "revoked";
  return row.sendCount > 0 ? "sent" : "not_sent";
}

/**
 * Người sẽ nhận thư ở lượt bấm "Gửi thư mời" tới: còn trong danh sách, chưa xác nhận, có
 * email, và hoặc chưa nhận thư nào, hoặc thư gần nhất đã cũ hơn EXEMPTION_RESEND_AFTER_MS.
 *
 * Điều kiện cuối là thứ cho phép BTC bấm lại hôm sau để NHẮC người chưa xác nhận mà không
 * cần một nút riêng — và cũng là thứ chặn hai lần bấm liền nhau gửi hai thư cho một người.
 */
export function isExemptionRecipient(
  row: Pick<ExemptionRow, "confirmedAt" | "revokedAt" | "lastSentAt"> & { email: string | null },
  nowMs: number
): boolean {
  if (row.confirmedAt || row.revokedAt) return false;
  if (!String(row.email ?? "").trim()) return false;
  if (!row.lastSentAt) return true;
  const last = Date.parse(row.lastSentAt);
  // Mốc không đọc được thì KHÔNG gửi: thà thiếu một thư nhắc còn hơn gửi trùng.
  return Number.isFinite(last) && nowMs - last >= EXEMPTION_RESEND_AFTER_MS;
}

/** Vì sao một người chưa vào được danh sách / chưa xác nhận được — mã do database trả. */
const BLOCKER_LABELS: Record<string, string> = {
  person_not_found: "không tìm thấy hồ sơ người",
  no_email: "hồ sơ thiếu họ tên hoặc email",
  email_ambiguous: "có hơn một hồ sơ người dùng chung email này",
  application_ambiguous: "có hơn một đơn mentee của mùa này",
  application_closed: "đơn mentee mùa này đã bị từ chối hoặc đã rút",
  application_other_person: "đơn mentee cùng email đang nối với hồ sơ người khác",
  profile_ambiguous: "có hơn một mentee profile",
  membership_ambiguous: "có hơn một tư cách mentee của mùa này",
  membership_inactive: "tư cách mentee mùa này đã ngừng (rút, tạm dừng hoặc kết thúc)",
  season_without_program: "mùa chưa gắn chương trình"
};

export function exemptionBlockerLabel(code: unknown): string {
  const key = String(code ?? "");
  return BLOCKER_LABELS[key] ?? "cần ban tổ chức kiểm tra hồ sơ";
}

export type ExemptionAddOutcome = { personId: string; code: string };

/** Câu tổng kết sau khi BTC bấm "Thêm vào danh sách". */
export function summarizeAddOutcomes(outcomes: readonly ExemptionAddOutcome[], names: ReadonlyMap<string, string>): { ok: boolean; message: string } {
  const added = outcomes.filter((o) => o.code === "added" || o.code === "restored").length;
  const existing = outcomes.filter((o) => o.code === "exists").length;
  const refused = outcomes.filter((o) => !["added", "restored", "exists"].includes(o.code));
  const parts: string[] = [];
  if (added) parts.push(`Đã thêm ${added} người vào danh sách đặc cách.`);
  if (existing) parts.push(`${existing} người đã có sẵn trong danh sách.`);
  if (refused.length) {
    parts.push(
      `${refused.length} người chưa thêm được: ` +
        refused.map((o) => `${names.get(o.personId) ?? "(không rõ tên)"} — ${exemptionBlockerLabel(o.code)}`).join("; ") +
        "."
    );
  }
  if (!parts.length) parts.push("Không có ai được thêm.");
  return { ok: added > 0 || (existing > 0 && refused.length === 0), message: parts.join(" ") };
}

export type ConfirmPageState = "ready" | "confirmed" | "revoked" | "invalid";

const CONFIRM_MESSAGES: Record<string, string> = {
  confirmed: "Ban tổ chức đã ghi nhận: bạn tham gia với vai trò Mentee trong mùa này. Cảm ơn bạn!",
  already_confirmed: "Bạn đã xác nhận trước đó rồi — không cần làm gì thêm.",
  invalid_token: "Đường dẫn không đúng hoặc đã hết hiệu lực. Bạn mở lại đúng đường dẫn trong thư mời giúp ban tổ chức.",
  revoked: "Đường dẫn này đã được ban tổ chức thu hồi. Nếu bạn nghĩ đây là nhầm lẫn, vui lòng liên hệ ban tổ chức.",
  needs_btc: "Hệ thống chưa ghi nhận được xác nhận của bạn vì hồ sơ cần ban tổ chức kiểm tra. Bạn nhắn ban tổ chức để được hỗ trợ nhé — chưa có gì bị thay đổi."
};

export function exemptionConfirmMessage(code: unknown): string {
  return CONFIRM_MESSAGES[String(code ?? "")] ?? "Hệ thống đang bận, bạn thử lại sau ít phút.";
}

// ---------------------------------------------------------------------------
// Gợi ý người vào danh sách
// ---------------------------------------------------------------------------

export type CandidateSignal = "support_account" | "membership_without_interview" | "approved_without_interview";

export const CANDIDATE_SIGNAL_LABELS: Record<CandidateSignal, string> = {
  support_account: "Có tài khoản vai trò Support team",
  membership_without_interview: "Được gắn tay tư cách mentee mùa này, chưa có đơn",
  approved_without_interview: "Đơn mentee được duyệt tay, không có phiếu phỏng vấn"
};

export type CandidatePerson = { id: string; name: string; email: string | null };
export type CandidateApplication = { id: string; personId: string | null; email: string | null; status: string };

export type ExemptionCandidate = {
  personId: string;
  name: string;
  email: string | null;
  signals: CandidateSignal[];
  /** Trạng thái đơn mentee mùa này của người đó, null nếu chưa có đơn. */
  applicationStatus: string | null;
};

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();

/**
 * Gom những người có dấu hiệu đang được đặc cách mà CHƯA nằm trong danh sách.
 *
 *   - tài khoản CRM vai trò Support team (đang hoạt động) khớp email với một hồ sơ người;
 *   - người có tư cách mentee đang hoạt động của mùa nhưng không có đơn mentee mùa này;
 *   - người có đơn mentee đã duyệt mà đơn đó không có dòng phỏng vấn nào.
 *
 * Người đã có dòng phỏng vấn (đạt hay không) không bao giờ được gợi ý: họ đi đường thường.
 */
export function suggestExemptionCandidates(input: {
  people: readonly CandidatePerson[];
  /** Email các tài khoản CRM vai trò Support team đang hoạt động. */
  supportAccountEmails: readonly string[];
  /** person_id có tư cách mentee đang hoạt động của mùa. */
  activeMenteePersonIds: readonly string[];
  /** Mọi đơn mentee của mùa. */
  applications: readonly CandidateApplication[];
  /** id các đơn có dòng phỏng vấn (mentee_interview_operations). */
  interviewedApplicationIds: readonly string[];
  /** person_id đang nằm trong danh sách (chưa bị gỡ). */
  listedPersonIds: readonly string[];
}): ExemptionCandidate[] {
  const listed = new Set(input.listedPersonIds);
  const supportEmails = new Set(input.supportAccountEmails.map(norm).filter(Boolean));
  const activeMentees = new Set(input.activeMenteePersonIds);
  const interviewed = new Set(input.interviewedApplicationIds);

  const result: ExemptionCandidate[] = [];
  for (const person of input.people) {
    if (listed.has(person.id)) continue;
    const email = norm(person.email);
    const own = input.applications.filter((a) => a.personId === person.id || (email !== "" && norm(a.email) === email));
    if (own.some((a) => interviewed.has(a.id))) continue;

    const signals: CandidateSignal[] = [];
    if (email !== "" && supportEmails.has(email)) signals.push("support_account");
    if (activeMentees.has(person.id) && own.length === 0) signals.push("membership_without_interview");
    if (own.some((a) => a.status === "approved_as_mentee")) signals.push("approved_without_interview");
    if (!signals.length) continue;

    result.push({
      personId: person.id,
      name: person.name,
      email: person.email,
      signals,
      applicationStatus: own.length ? own[0].status : null
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "vi") || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));
}

export type ExemptionCounts = { listed: number; confirmed: number; waiting: number; notSent: number; revoked: number };

export function countExemptions(rows: readonly Pick<ExemptionRow, "confirmedAt" | "revokedAt" | "sendCount">[]): ExemptionCounts {
  const counts: ExemptionCounts = { listed: 0, confirmed: 0, waiting: 0, notSent: 0, revoked: 0 };
  for (const row of rows) {
    const state = exemptionState(row);
    if (state === "revoked") {
      counts.revoked += 1;
      continue;
    }
    counts.listed += 1;
    if (state === "confirmed") counts.confirmed += 1;
    else if (state === "sent") counts.waiting += 1;
    else counts.notSent += 1;
  }
  return counts;
}
