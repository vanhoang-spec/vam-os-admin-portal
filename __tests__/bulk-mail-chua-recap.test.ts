/**
 * Nhóm "Mentee chưa có recap trong tháng" — đường đọc, chốt lô, gửi (lib/bulk-mail.ts).
 *
 * Điều phải đúng:
 *   - danh sách = mentee trong mẫu số chưa có recap của tháng, mỗi thư CC mentor của cặp mới nhất;
 *   - mentor thiếu email: mentee VẪN nhận, dòng mang cảnh báo, thư đi không CC;
 *   - mở lô: ghi tháng vào lô, chốt từng người nhận KÈM CC;
 *   - mỗi lần chạy (lần đầu và "Gửi tiếp") đọc danh sách chốt và gửi đúng CC của từng thư, không
 *     dựng lại từ recap đã đổi sau lúc bấm;
 *   - lô thiếu tháng / CC chốt hỏng: không gửi lá nào.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `lib/bulk-mail`, chỉ giả database và hàm gửi thư.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import {
  countBulkRecipients,
  createNoRecapEmailBatch,
  listBulkRecipients,
  runEmailBatch,
  type EmailBatchRow
} from "@/lib/bulk-mail";


type Row = Record<string, unknown>;
type Write = { table: string; op: "insert" | "update"; payload: unknown; filter?: [string, unknown] };

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Bản giả đủ cho mọi đường đọc/ghi của danh sách tùy chỉnh; ghi lại bảng đã đọc và mọi lệnh ghi. */
function fakeDb(tables: Record<string, Row[]>, options: { failOn?: string[]; failInsertOn?: string[] } = {}) {
  const reads: string[] = [];
  const writes: Write[] = [];
  const ors: string[] = [];
  let seq = 900;
  const client = {
    from(table: string) {
      let rows = (tables[table] ?? []).slice();
      let limitN: number | null = null;
      let span: [number, number] | null = null;
      let mode: "read" | "insert" | "update" = "read";
      let inserted: Row[] = [];
      let single = false;
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          if (mode === "update") writes[writes.length - 1].filter = [column, value];
          rows = rows.filter((row) => row[column] === value);
          return chain;
        },
        neq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] !== value);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return chain;
        },
        ilike: (column: string, pattern: string) => {
          const wanted = String(pattern).replace(/\\(.)/g, "$1").toLowerCase();
          rows = rows.filter((row) => String(row[column] ?? "").toLowerCase() === wanted);
          return chain;
        },
        or: (expression: string) => {
          ors.push(expression);
          const clauses = expression.split(",").map((part) => {
            const [column, , ...rest] = part.split(".");
            return { column, needle: rest.join(".").replace(/%/g, "").toLowerCase() };
          });
          rows = rows.filter((row) =>
            clauses.some(({ column, needle }) => String(row[column] ?? "").toLowerCase().includes(needle))
          );
          return chain;
        },
        gt: (column: string, value: unknown) => {
          rows = rows.filter((row) => String(row[column]) > String(value));
          return chain;
        },
        // Đếm thư trong 24 giờ (hạn mức chung, VAM00027): lô custom đếm trước khi gửi.
        gte: (column: string, value: unknown) => {
          rows = rows.filter((row) => String(row[column] ?? "") >= String(value));
          return chain;
        },
        order: (column: string) => {
          rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
          return chain;
        },
        limit: (n: number) => {
          limitN = n;
          return chain;
        },
        range: (from: number, to: number) => {
          span = [from, to];
          return chain;
        },
        single: () => {
          single = true;
          return chain;
        },
        insert: (payload: Row | Row[]) => {
          mode = "insert";
          inserted = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: u(seq++), ...row }));
          writes.push({ table, op: "insert", payload });
          return chain;
        },
        update: (payload: Row) => {
          mode = "update";
          writes.push({ table, op: "update", payload });
          return chain;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const boom = { data: null, error: { code: "XX000", message: "boom" } };
          if (mode === "insert") {
            if (options.failInsertOn?.includes(table)) return Promise.resolve(boom).then(resolve, reject);
            tables[table] = [...(tables[table] ?? []), ...inserted];
            return Promise.resolve({ data: single ? inserted[0] : inserted, error: null }).then(resolve, reject);
          }
          if (mode === "update") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          reads.push(table);
          if (options.failOn?.includes(table)) return Promise.resolve(boom).then(resolve, reject);
          let out = rows;
          if (span) out = out.slice(span[0], span[1] + 1);
          if (limitN !== null) out = out.slice(0, limitN);
          return Promise.resolve({ data: out, error: null, count: out.length }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
  return { client, reads, writes, tables, ors };
}

const S12 = u(12);
const T1 = u(61);
const A_ADMIN = u(21);
// Mentee
const ME_MET = u(1); // đã có recap tháng 11
const ME_NONE = u(2); // chưa có recap — mentor có email
const ME_NO_MAIL_MENTOR = u(3); // chưa có recap — mentor thiếu email
const ME_CHANGED = u(4); // đổi cặp: cặp cũ dropped, cặp mới active
const ME_DROPPED = u(5); // cặp dropped trong tháng 10
// Mentor
const MR_A = u(11);
const MR_B = u(13);
const MR_OLD = u(14);
const MR_NEW = u(15);

function seed(): Record<string, Row[]> {
  return {
    people: [
      { id: ME_MET, full_name: "An Đã Gặp", email_primary: "an@x.org", member_code: "UEHE0001" },
      { id: ME_NONE, full_name: "Bình Chưa Gặp", email_primary: "binh@x.org", member_code: "UEHE0002" },
      { id: ME_NO_MAIL_MENTOR, full_name: "Chi Mentor Thiếu Mail", email_primary: "chi@x.org", member_code: null },
      { id: ME_CHANGED, full_name: "Dũng Đổi Cặp", email_primary: "dung@x.org", member_code: "UEHE0004" },
      { id: ME_DROPPED, full_name: "Giang Đã Dừng", email_primary: "giang@x.org", member_code: null },
      { id: MR_A, full_name: "Mentor A", email_primary: "Mentor.A@X.org" },
      { id: MR_B, full_name: "Mentor B", email_primary: null },
      { id: MR_OLD, full_name: "Mentor Cũ", email_primary: "cu@x.org" },
      { id: MR_NEW, full_name: "Mentor Mới", email_primary: "moi@x.org" }
    ],
    matches: [
      { id: u(31), season_id: S12, mentee_person_id: ME_MET, mentor_person_id: MR_A, status: "active", matched_at: "2026-10-03T00:00:00+00:00", ended_at: null, updated_at: "2026-10-03T00:00:00+00:00" },
      { id: u(32), season_id: S12, mentee_person_id: ME_NONE, mentor_person_id: MR_A, status: "active", matched_at: "2026-10-03T00:00:00+00:00", ended_at: null, updated_at: "2026-10-03T00:00:00+00:00" },
      { id: u(33), season_id: S12, mentee_person_id: ME_NO_MAIL_MENTOR, mentor_person_id: MR_B, status: "active", matched_at: "2026-10-03T00:00:00+00:00", ended_at: null, updated_at: "2026-10-03T00:00:00+00:00" },
      { id: u(34), season_id: S12, mentee_person_id: ME_CHANGED, mentor_person_id: MR_OLD, status: "dropped", matched_at: "2026-10-03T00:00:00+00:00", ended_at: null, updated_at: "2026-10-20T00:00:00+00:00" },
      { id: u(35), season_id: S12, mentee_person_id: ME_CHANGED, mentor_person_id: MR_NEW, status: "active", matched_at: "2026-10-25T00:00:00+00:00", ended_at: null, updated_at: "2026-10-25T00:00:00+00:00" },
      { id: u(36), season_id: S12, mentee_person_id: ME_DROPPED, mentor_person_id: MR_A, status: "dropped", matched_at: "2026-10-03T00:00:00+00:00", ended_at: "2026-10-28T00:00:00+00:00", updated_at: "2026-10-28T00:00:00+00:00" },
      // Mùa khác: không được đọc vào.
      { id: u(37), season_id: u(11), mentee_person_id: u(9), mentor_person_id: MR_A, status: "active", matched_at: "2025-10-03T00:00:00+00:00", ended_at: null, updated_at: "2025-10-03T00:00:00+00:00" }
    ],
    mentoring_recaps: [
      // Bài quét 19/11 kể buổi gặp tháng 10 → vẫn là recap tháng 11.
      { id: u(41), season_id: S12, mentee_person_id: ME_MET, meeting_date: "2026-10-30", meeting_month: "2026-10", status: "submitted", captured_by: "claude-quet-facebook", created_at: "2026-11-19T15:17:58+00:00" },
      // Recap bị từ chối không tính.
      { id: u(42), season_id: S12, mentee_person_id: ME_NONE, meeting_date: "2026-11-05", meeting_month: "2026-11", status: "rejected", captured_by: null, created_at: "2026-11-05T00:00:00+00:00" }
    ],
    mentor_profiles: [],
    mentee_profiles: [{ person_id: ME_NO_MAIL_MENTOR, mentee_code: "S12-CU-03" }],
    outbound_emails: [],
    email_batches: [],
    email_batch_recipients: [],
    email_batch_attachments: []
  };
}

function use(options: Parameters<typeof fakeDb>[1] = {}, tables = seed()) {
  const db = fakeDb(tables, options);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.mocked(sendTemplatedEmail).mockClear();
});

describe("1. danh sách nhắc + CC", () => {
  it("đúng mentee chưa có recap, mỗi người CC mentor của cặp mới nhất; mentor thiếu email → cảnh báo, không CC", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_no_recap_month", month: "2026-11" });
    expect(result.error).toBeNull();
    expect(result.label).toBe("Mentee chưa có recap tháng 11/2026");
    expect(result.partition.unreachable).toEqual([]);
    expect(
      result.partition.sendable.map((row) => ({ email: row.email, cc: row.ccEmails, warn: Boolean(row.ccWarning), code: row.memberCode }))
    ).toEqual([
      { email: "binh@x.org", cc: ["mentor.a@x.org"], warn: false, code: "UEHE0002" },
      { email: "chi@x.org", cc: undefined, warn: true, code: "S12-CU-03" },
      { email: "dung@x.org", cc: ["moi@x.org"], warn: false, code: "UEHE0004" }
    ]);
    expect(result.partition.sendable[1].ccWarning).toContain("Mentor B");
  });

  it("thiếu tháng: từ chối, không đọc bảng nào", async () => {
    const db = use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_no_recap_month" });
    expect(result.error).toContain("Chưa chọn tháng");
    expect(db.reads).toEqual([]);
  });

  it("đọc recap hỏng: báo lỗi cho cả nhóm, không trả danh sách thiếu", async () => {
    use({ failOn: ["mentoring_recaps"] });
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_no_recap_month", month: "2026-11" });
    expect(result.error).toBeTruthy();
    expect(result.partition.sendable).toEqual([]);
  });

  it("ô chọn tháng đếm đúng số mentee và số mentor CC như lệnh gửi", async () => {
    use();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    try {
      const counted = await countBulkRecipients(S12);
      expect(counted.error).toBeNull();
      expect(counted.recapMonths).toEqual([
        { month: "2026-11", label: "Tháng 11/2026", sendable: 3, unreachable: 0, ccMentors: 2, ccMissing: 1 },
        // Tháng 10: chưa ai có recap tháng 10 (bài quét tính tháng 11), nên An cũng bị nhắc. Giang dừng
        // 28/10 (trước cuối tháng) → ngoài mẫu số. Dũng: cặp cũ dừng 20/10 → CC mentor cặp mới.
        { month: "2026-10", label: "Tháng 10/2026", sendable: 4, unreachable: 0, ccMentors: 2, ccMissing: 1 }
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("2. mở lô: chốt tháng và CC của từng thư", () => {
  it("ghi audience_month vào lô, chốt từng người nhận kèm cc_emails", async () => {
    const db = use();
    const list = await listBulkRecipients({ seasonId: S12, audience: "mentee_no_recap_month", month: "2026-11" });
    const created = await createNoRecapEmailBatch({
      seasonId: S12, kind: "general_announcement", templateId: T1, month: "2026-11",
      recipients: list.partition.sendable, note: "Nhắc", actorAdminUserId: A_ADMIN
    });
    expect(created.error).toBeNull();
    const batchInsert = db.writes.find((w) => w.table === "email_batches" && w.op === "insert")?.payload as Row;
    expect(batchInsert).toMatchObject({ audience: "mentee_no_recap_month", audience_month: "2026-11", audience_event_id: null, requested_count: 3 });
    const frozen = db.writes.filter((w) => w.table === "email_batch_recipients").flatMap((w) => w.payload as Row[]);
    expect(frozen.map((row) => [row.email, row.cc_emails, row.relation_id, row.role])).toEqual([
      ["binh@x.org", ["mentor.a@x.org"], ME_NONE, "mentee"],
      ["chi@x.org", [], ME_NO_MAIL_MENTOR, "mentee"],
      ["dung@x.org", ["moi@x.org"], ME_CHANGED, "mentee"]
    ]);
  });

  it("tháng sai dạng: không mở lô, không ghi gì", async () => {
    const db = use();
    const created = await createNoRecapEmailBatch({
      seasonId: S12, kind: "general_announcement", templateId: T1, month: "11/2026",
      recipients: [{ personId: ME_NONE, fullName: "B", email: "binh@x.org", role: "mentee" }], note: "x", actorAdminUserId: A_ADMIN
    });
    expect(created.batch).toBeNull();
    expect(db.writes).toEqual([]);
  });
});

describe("3. chạy lô (lần đầu và Gửi tiếp): đúng danh sách chốt, đúng CC từng thư", () => {
  const BATCH = u(71);
  const batch = (overrides: Partial<EmailBatchRow> = {}): EmailBatchRow => ({
    id: BATCH, seasonId: S12, kind: "general_announcement", templateId: T1, audience: "mentee_no_recap_month",
    audienceEventId: null, audienceCoversSeries: false, audienceMonth: "2026-11", status: "running", requestedCount: 3,
    sentCount: 0, skippedCount: 0, failedCount: 0, note: null, createdAt: "", completedAt: null, ...overrides
  });
  const frozen = (): Row[] => [
    { id: u(81), batch_id: BATCH, position: 1, relation_table: "people", relation_id: ME_NO_MAIL_MENTOR, email: "chi@x.org", full_name: "Chi Mentor Thiếu Mail", role: "mentee", cc_emails: [] },
    { id: u(82), batch_id: BATCH, position: 0, relation_table: "people", relation_id: ME_NONE, email: "binh@x.org", full_name: "Bình Chưa Gặp", role: "mentee", cc_emails: ["mentor.a@x.org"] },
    { id: u(83), batch_id: BATCH, position: 2, relation_table: "people", relation_id: ME_CHANGED, email: "dung@x.org", full_name: "Dũng Đổi Cặp", role: "mentee", cc_emails: ["moi@x.org"] }
  ];
  const run = (b = batch()) =>
    runEmailBatch({ batch: b, seasonCode: "UEHM-S12", subject: "Nhắc recap", body: "Chào {{ten_nguoi_nhan}} #{{ma_thanh_vien}}" });

  it("gửi theo thứ tự chốt, mỗi thư mang đúng CC của nó; không đọc lại recap hay cặp", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen();
    // Sau lúc chốt, Bình đăng recap — lô vẫn gửi đúng danh sách đã xác nhận.
    tables.mentoring_recaps.push({ id: u(43), season_id: S12, mentee_person_id: ME_NONE, meeting_date: "2026-11-21", meeting_month: "2026-11", status: "submitted", captured_by: null, created_at: "2026-11-21T00:00:00Z" });
    const db = use({}, tables);
    const result = await run();
    expect(result).toMatchObject({ ok: true, sent: 3, remaining: 0, error: null });
    const calls = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => [call.toEmail, call.cc])).toEqual([
      ["binh@x.org", ["mentor.a@x.org"]],
      ["chi@x.org", undefined],
      ["dung@x.org", ["moi@x.org"]]
    ]);
    expect(calls[0].body).toContain("#UEHE0002");
    for (const table of ["mentoring_recaps", "matches"]) expect(db.reads).not.toContain(table);
  });

  it("Gửi tiếp: bỏ người đã có thư trong lô, người còn lại vẫn đúng CC", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen();
    tables.outbound_emails = [{ id: u(91), batch_id: BATCH, to_email: "binh@x.org", status: "sent" }];
    use({}, tables);
    const result = await run(batch({ sentCount: 1 }));
    expect(result).toMatchObject({ ok: true, sent: 2, remaining: 0 });
    const calls = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => [call.toEmail, call.cc])).toEqual([
      ["chi@x.org", undefined],
      ["dung@x.org", ["moi@x.org"]]
    ]);
  });

  it("lô không nhớ tháng: từ chối, không gửi lá nào", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen();
    use({}, tables);
    const result = await run(batch({ audienceMonth: null }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("tháng");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("CC chốt hỏng (không phải mảng / địa chỉ lạ): từ chối cả lô, không gửi lá nào thiếu CC", async () => {
    for (const broken of [null, ["khong-phai-email"]]) {
      const tables = seed();
      tables.email_batch_recipients = frozen();
      tables.email_batch_recipients[1].cc_emails = broken;
      use({}, tables);
      const result = await run();
      expect(result.ok, JSON.stringify(broken)).toBe(false);
      expect(sendTemplatedEmail).not.toHaveBeenCalled();
    }
  });
});
