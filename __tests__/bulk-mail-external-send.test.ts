/**
 * Email ngoài VAM trong lô Danh sách tùy chỉnh (VAM00027) — phía máy chủ: chốt vào lô, gửi, hạn mức.
 *
 * Canh:
 *   - dòng chốt của người ngoài KHÔNG trỏ vào hồ sơ nào (relation_id null), tên rỗng vẫn chốt được;
 *   - lá thư của người ngoài nối sổ về chính dòng chốt (uuid thật), để "Gửi tiếp" không gửi lại;
 *   - người ngoài không bao giờ mang mã thành viên / xưng hô của ai — kể cả khi id dòng chốt trùng
 *     id một người, hay email trùng email một người trong danh bạ;
 *   - lô custom đi trong hạn mức chung 24 giờ; các nhóm cố định không đổi cách chạy.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/bulk-mail; chỉ giả database và hàm gửi thư.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { BULK_SEND_CHUNK, type BulkRecipient } from "@/lib/bulk-mail-core";
import { BULK_CUSTOM_QUOTA_RESERVE } from "@/lib/bulk-mail-external-core";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";
import { createCustomEmailBatch, runEmailBatch, type EmailBatchRow } from "@/lib/bulk-mail";

type Row = Record<string, unknown>;
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Bản giả tối giản: đọc (eq/in/gte/range/order), đếm (count), thêm, sửa; ghi lại mọi lệnh ghi. */
function fakeDb(tables: Record<string, Row[]>, options: { failCountOn?: boolean } = {}) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const counts: string[] = [];
  let seq = 900;
  const client = {
    from(table: string) {
      let rows = (tables[table] ?? []).slice();
      let mode: "read" | "insert" | "update" = "read";
      let inserted: Row[] = [];
      let single = false;
      let head = false;
      let span: [number, number] | null = null;
      let limitN: number | null = null;
      const chain: any = {
        select: (_columns?: string, opts?: { head?: boolean }) => {
          if (opts?.head) head = true;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return chain;
        },
        gte: (column: string, value: unknown) => {
          rows = rows.filter((row) => String(row[column] ?? "") >= String(value));
          return chain;
        },
        gt: (column: string, value: unknown) => {
          rows = rows.filter((row) => String(row[column]) > String(value));
          return chain;
        },
        order: (column: string) => {
          rows.sort((x, y) => String(x[column]).localeCompare(String(y[column])));
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
          if (mode === "insert") {
            tables[table] = [...(tables[table] ?? []), ...inserted];
            return Promise.resolve({ data: single ? inserted[0] : inserted, error: null }).then(resolve, reject);
          }
          if (mode === "update") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          if (head) {
            counts.push(table);
            if (options.failCountOn) return Promise.resolve({ count: null, error: { message: "boom" } }).then(resolve, reject);
            return Promise.resolve({ count: rows.length, data: null, error: null }).then(resolve, reject);
          }
          let out = span ? rows.slice(span[0], span[1] + 1) : rows;
          if (limitN !== null) out = out.slice(0, limitN);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
  return { client, writes, counts, tables };
}

function use(tables: Record<string, Row[]>, options: Parameters<typeof fakeDb>[1] = {}) {
  const db = fakeDb(tables, options);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
  return db;
}

const SEASON = u(12);
const BATCH = u(71);
const P_MENTOR = u(1);
const NOW = Date.parse("2026-11-09T10:00:00Z");

const batch = (overrides: Partial<EmailBatchRow> = {}): EmailBatchRow => ({
  id: BATCH, seasonId: SEASON, kind: "general_announcement", templateId: u(61), audience: "custom",
  audienceEventId: null, audienceCoversSeries: false, status: "running", requestedCount: 2,
  sentCount: 0, skippedCount: 0, failedCount: 0, note: null, createdAt: "", completedAt: null, ...overrides
});

const run = (b = batch(), body = "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}} (mã {{ma_thanh_vien}}), {{vai_tro}}.") =>
  runEmailBatch({ batch: b, seasonCode: "UEHM-S12", subject: "Thông báo {{mua}}", body, now: () => NOW });

const sentCalls = () => vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("chốt người ngoài vào lô", () => {
  it("dòng ngoài: relation_table external, relation_id NULL, tên có thể rỗng; dòng VAM giữ nguyên", async () => {
    const db = use({ email_batches: [] });
    const recipients: BulkRecipient[] = [
      { personId: P_MENTOR, fullName: "An Mentor", email: "an@x.org", role: "mentor", relationTable: "people" },
      { personId: "", fullName: "", email: "khach@y.vn", role: "external", relationTable: "external" },
      { personId: "", fullName: "Bình Khách", email: "binh@y.vn", role: "external", relationTable: "external" }
    ];
    const created = await createCustomEmailBatch({
      seasonId: SEASON, kind: "general_announcement", templateId: u(61), recipients, note: "n", actorAdminUserId: "a1"
    });
    expect(created.error).toBeNull();
    const freeze = db.writes.find((write) => write.table === "email_batch_recipients");
    expect(freeze?.payload).toEqual([
      expect.objectContaining({ position: 0, relation_table: "people", relation_id: P_MENTOR, email: "an@x.org", role: "mentor" }),
      expect.objectContaining({ position: 1, relation_table: "external", relation_id: null, email: "khach@y.vn", full_name: "", role: "external" }),
      expect.objectContaining({ position: 2, relation_table: "external", relation_id: null, email: "binh@y.vn", full_name: "Bình Khách", role: "external" })
    ]);
  });
});

describe("gửi cho người ngoài", () => {
  // Id dòng chốt của người ngoài CỐ Ý trùng id một người trong danh bạ có mã và giới tính, và email
  // của một người ngoài trùng email người đó: không đường nào được gán mã của người ấy cho người ngoài.
  const FROZEN_EXTERNAL = u(500);
  const tables = (): Record<string, Row[]> => ({
    people: [
      { id: P_MENTOR, full_name: "An Mentor", email_primary: "an@x.org", member_code: "UEHR0001", gender: "male" },
      { id: FROZEN_EXTERNAL, full_name: "Người Trùng Id", email_primary: "trung@z.vn", member_code: "UEHR0999", gender: "female" },
      { id: u(501), full_name: "Người Trùng Email", email_primary: "khach@y.vn", member_code: "UEHE0777", gender: "male" }
    ],
    mentor_profiles: [{ id: u(301), person_id: FROZEN_EXTERNAL, mentor_code: "MT-S11-001" }],
    mentee_profiles: [],
    outbound_emails: [],
    email_batches: [],
    email_batch_recipients: [
      { id: u(400), batch_id: BATCH, position: 0, relation_table: "people", relation_id: P_MENTOR, email: "an@x.org", full_name: "An Mentor", role: "mentor" },
      { id: FROZEN_EXTERNAL, batch_id: BATCH, position: 1, relation_table: "external", relation_id: null, email: "khach@y.vn", full_name: "Khách Mời", role: "external" }
    ]
  });

  it("thư đi; người ngoài là khách mời, KHÔNG mã, KHÔNG xưng hô; người VAM vẫn đủ", async () => {
    use(tables());
    const result = await run();
    expect(result).toMatchObject({ ok: true, sent: 2, failed: 0, error: null });
    const byEmail = new Map(sentCalls().map((call) => [call.toEmail, call]));
    expect(byEmail.get("an@x.org")?.body).toContain("Kính gửi Anh An Mentor (mã UEHR0001), mentor.");
    expect(byEmail.get("khach@y.vn")?.body).toContain("Kính gửi Khách Mời (mã), khách mời.");
    expect(byEmail.get("khach@y.vn")?.body).not.toMatch(/UEH|MT-|Anh|Chị/);
  });

  it("sổ thư của người ngoài nối về dòng chốt (uuid), của người VAM nối về people", async () => {
    use(tables());
    await run();
    const relations = new Map(sentCalls().map((call) => [call.toEmail, call.relation]));
    expect(relations.get("khach@y.vn")).toEqual({ table: "email_batch_recipients", id: FROZEN_EXTERNAL });
    expect(relations.get("an@x.org")).toEqual({ table: "people", id: P_MENTOR });
  });

  it("người ngoài đã có thư trong lô thì “Gửi tiếp” không gửi lại", async () => {
    const t = tables();
    t.outbound_emails = [{ id: u(600), batch_id: BATCH, to_email: "khach@y.vn", status: "sent", created_at: "2026-11-09T09:00:00Z" }];
    use(t);
    const result = await run();
    expect(result).toMatchObject({ sent: 1, remaining: 0 });
    expect(sentCalls().map((call) => call.toEmail)).toEqual(["an@x.org"]);
  });

  it("người ngoài trống tên mà mẫu dùng ô tên: lá đó KHÔNG đi, báo bằng email (không gửi “Kính gửi ,”)", async () => {
    const t = tables();
    (t.email_batch_recipients[1] as Row).full_name = "";
    use(t);
    const result = await run();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.problems[0]).toMatch(/^khach@y\.vn: Thiếu dữ liệu cho ô: \{\{ten_nguoi_nhan\}\}/);
    expect(sentCalls().map((call) => call.toEmail)).toEqual(["an@x.org"]);
  });

  it("người ngoài trống tên, mẫu không dùng ô tên: thư vẫn đi", async () => {
    const t = tables();
    (t.email_batch_recipients[1] as Row).full_name = "";
    use(t);
    const result = await run(batch(), "Chào bạn, thư mùa {{mua}}.");
    expect(result).toMatchObject({ sent: 2, failed: 0 });
  });

  it("dòng chốt hỏng hình dạng (ngoài mà có relation_id, VAM mà thiếu) thì không gửi lá nào", async () => {
    for (const broken of [
      { relation_table: "external", relation_id: P_MENTOR },
      { relation_table: "people", relation_id: null }
    ]) {
      vi.mocked(sendTemplatedEmail).mockClear();
      const t = tables();
      Object.assign(t.email_batch_recipients[1] as Row, broken);
      use(t);
      const result = await run();
      expect(result.ok).toBe(false);
      expect(sendTemplatedEmail).not.toHaveBeenCalled();
    }
  });
});

describe("hạn mức chung 24 giờ", () => {
  const manyFrozen = (count: number): Row[] =>
    Array.from({ length: count }, (_, index) => ({
      id: u(700 + index), batch_id: BATCH, position: index, relation_table: "external", relation_id: null,
      email: `k${index}@y.vn`, full_name: `Khách ${index}`, role: "external"
    }));
  const sentInWindow = (count: number, at = "2026-11-09T05:00:00Z"): Row[] =>
    Array.from({ length: count }, (_, index) => ({ id: u(5000 + index), batch_id: null, to_email: `o${index}@x.vn`, status: "sent", created_at: at }));

  it("còn ít chỗ thì chỉ gửi đúng số chỗ còn lại", async () => {
    const db = use({
      email_batch_recipients: manyFrozen(10),
      outbound_emails: sentInWindow(DAILY_EMAIL_LIMIT - BULK_CUSTOM_QUOTA_RESERVE - 3)
    });
    const result = await run(batch({ requestedCount: 10 }));
    expect(result).toMatchObject({ ok: true, sent: 3, remaining: 7 });
    expect(db.counts).toEqual(["outbound_emails"]);
  });

  it("thư cũ hơn 24 giờ không tính", async () => {
    use({
      email_batch_recipients: manyFrozen(10),
      outbound_emails: sentInWindow(DAILY_EMAIL_LIMIT, "2026-11-08T09:00:00Z")
    });
    expect((await run(batch({ requestedCount: 10 }))).sent).toBe(10);
  });

  it("đã chạm hạn mức: không gửi lá nào, nói rõ, lô vẫn mở để Gửi tiếp", async () => {
    const db = use({ email_batch_recipients: manyFrozen(10), outbound_emails: sentInWindow(DAILY_EMAIL_LIMIT - BULK_CUSTOM_QUOTA_RESERVE) });
    const result = await run(batch({ requestedCount: 10 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/hạn mức chung/);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
    expect(db.writes.filter((write) => write.table === "email_batches")).toEqual([]);
  });

  it("không đếm được thư đã gửi: không gửi (fail-closed)", async () => {
    use({ email_batch_recipients: manyFrozen(2), outbound_emails: [] }, { failCountOn: true });
    const result = await run();
    expect(result.ok).toBe(false);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("nhóm cố định (mentor) không đếm hạn mức — cách chạy cũ không đổi", async () => {
    const db = use({
      person_season_memberships: [{ id: u(800), person_id: P_MENTOR, season_id: SEASON, role: "mentor", status: "active" }],
      people: [{ id: P_MENTOR, full_name: "An Mentor", email_primary: "an@x.org", member_code: "UEHR0001", gender: "male" }],
      mentor_profiles: [],
      mentee_profiles: [],
      outbound_emails: sentInWindow(DAILY_EMAIL_LIMIT)
    });
    const result = await run(batch({ audience: "mentor", requestedCount: 1 }));
    expect(db.counts).toEqual([]);
    expect(result.sent).toBe(1);
  });

  it(`mỗi lần chạy vẫn không quá ${BULK_SEND_CHUNK} thư`, async () => {
    use({ email_batch_recipients: manyFrozen(BULK_SEND_CHUNK + 5), outbound_emails: [] });
    const result = await run(batch({ requestedCount: BULK_SEND_CHUNK + 5 }));
    expect(result).toMatchObject({ sent: BULK_SEND_CHUNK, remaining: 5 });
  });
});
