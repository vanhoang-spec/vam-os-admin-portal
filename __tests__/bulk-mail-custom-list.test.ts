/**
 * Danh sách tùy chỉnh (VAM00026) — phía máy chủ.
 *
 * Mỗi ca canh một cách gửi nhầm người mà không ai thấy:
 *   - gộp nhiều nguồn mà một người nhận hai lá, hoặc vai trò điền sai;
 *   - lọc check-in đọc sai cột, hoặc làm đổi danh sách của nhóm `event` cũ;
 *   - thêm tay một id bịa / một người không thuộc mùa;
 *   - form gửi lên một khoá không có trong tập máy chủ tự dựng;
 *   - "Gửi tiếp" của lô custom dựng lại danh sách thay vì đọc danh sách đã chốt.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/bulk-mail và lib/bulk-mail-custom-core; chỉ giả
 * database và hàm gửi thư. Đường đọc phân trang là hàng thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { buildRecipientValues, type BulkRecipient } from "@/lib/bulk-mail-core";
import {
  customListSignature,
  matchesCheckinFilter,
  mergeCustomSources,
  readCustomListSpec,
  recipientKey,
  selectCustomRecipients,
  type CustomListSpec
} from "@/lib/bulk-mail-custom-core";
import {
  buildCustomRecipientUniverse,
  createCustomEmailBatch,
  listBulkRecipients,
  runEmailBatch,
  searchCustomListPeople,
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
const S11 = u(11);
const E1 = u(101);
const E2 = u(102);
const E_OLD = u(103);
const SERIES = u(104);

// Người trong danh bạ.
const P_MENTOR = u(1);
const P_MENTEE = u(2);
const P_BOTH = u(3);
const P_APPLICANT = u(4); // chỉ có đơn trong mùa
const P_OPTED_OUT = u(5); // membership đã rút
const P_OLD = u(6); // chỉ thuộc mùa trước
const P_STAFF = u(7); // không membership, cùng email với tài khoản BTC
// Tài khoản BTC.
const A_ADMIN = u(21);
const A_REVIEWER = u(22);
// Phiếu đăng ký.
const R_IN = u(31);
const R_PENDING = u(32);
const R_CANCELLED = u(33);
const R_MENTOR_DUP = u(34);
const R_NO_SHOW = u(35);
const R_E2 = u(36);

function seed(): Record<string, Row[]> {
  return {
    people: [
      { id: P_MENTOR, full_name: "An Mentor", email_primary: "an@x.org", member_code: "UEHR0001" },
      { id: P_MENTEE, full_name: "Bình Mentee", email_primary: "binh@x.org", member_code: "UEHE0002" },
      { id: P_BOTH, full_name: "Chi Cả Hai", email_primary: "chi@x.org", member_code: null },
      { id: P_APPLICANT, full_name: "Dũng Ứng Viên", email_primary: "dung@x.org", member_code: null },
      { id: P_OPTED_OUT, full_name: "Giang Đã Rút", email_primary: "giang@x.org", member_code: null },
      { id: P_OLD, full_name: "Hà Mùa Cũ", email_primary: "ha@x.org", member_code: "UEHR0009" },
      { id: P_STAFF, full_name: "Khoa BTC", email_primary: "Khoa@X.org", member_code: "UEHC0003" }
    ],
    person_season_memberships: [
      { id: u(41), person_id: P_MENTOR, season_id: S12, role: "mentor", status: "active" },
      { id: u(42), person_id: P_MENTEE, season_id: S12, role: "mentee", status: "active" },
      { id: u(43), person_id: P_BOTH, season_id: S12, role: "mentee", status: "active" },
      { id: u(44), person_id: P_BOTH, season_id: S12, role: "mentor", status: "active" },
      { id: u(45), person_id: P_OPTED_OUT, season_id: S12, role: "mentor", status: "opted_out" },
      { id: u(46), person_id: P_OLD, season_id: S11, role: "mentor", status: "active" }
    ],
    applications: [
      { id: u(51), person_id: P_APPLICANT, season_id: S12, role_applied: "mentee", status: "submitted" },
      { id: u(52), person_id: P_OLD, season_id: S11, role_applied: "mentor", status: "approved_as_mentor" }
    ],
    admin_users: [
      { id: A_ADMIN, full_name: "Khoa BTC", email: "khoa@x.org", role: "admin", status: "active" },
      { id: A_REVIEWER, full_name: "Người Chấm", email: "rev@x.org", role: "reviewer", status: "active" }
    ],
    events: [
      { id: E1, season_id: S12, series_id: SERIES, series_index: 1, series_total: 2, event_name: "Orientation", starts_at: "2026-11-01T01:00:00.000Z", status: "scheduled" },
      { id: E2, season_id: S12, series_id: SERIES, series_index: 2, series_total: 2, event_name: "Orientation", starts_at: "2026-11-08T01:00:00.000Z", status: "scheduled" },
      { id: E_OLD, season_id: S11, series_id: null, event_name: "Mùa cũ", starts_at: "2025-11-01T01:00:00.000Z", status: "scheduled" }
    ],
    event_registrations: [
      { id: R_IN, event_id: E1, full_name: "Lan Đã Đến", email: "lan@x.org", registration_status: "registered", attendance_status: "checked_in" },
      { id: R_PENDING, event_id: E1, full_name: "Minh Chưa Đến", email: "minh@x.org", registration_status: "registered", attendance_status: "pending" },
      { id: R_NO_SHOW, event_id: E1, full_name: "Nga Vắng", email: "nga@x.org", registration_status: "confirmed", attendance_status: "no_show" },
      { id: R_CANCELLED, event_id: E1, full_name: "Oanh Huỷ", email: "oanh@x.org", registration_status: "cancelled", attendance_status: "checked_in" },
      // Mentor cũng đăng ký sự kiện, email viết hoa: chỉ một lá, vai trò mentor.
      { id: R_MENTOR_DUP, event_id: E1, full_name: "An (phiếu)", email: "AN@x.org", registration_status: "registered", attendance_status: "checked_in" },
      { id: R_E2, event_id: E2, full_name: "Phúc Buổi Hai", email: "phuc@x.org", registration_status: "registered", attendance_status: "pending" }
    ],
    outbound_emails: [],
    email_batches: [],
    email_batch_recipients: []
  };
}

function use(options: Parameters<typeof fakeDb>[1] = {}, tables = seed()) {
  const db = fakeDb(tables, options);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
  return db;
}

function spec(overrides: Partial<CustomListSpec> = {}): CustomListSpec {
  return { mentor: false, mentee: false, staff: false, event: null, addedPersonIds: [], ...overrides };
}

const emails = (rows: Array<{ email: string }>) => rows.map((row) => row.email).sort();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("1. đọc nguồn từ form", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
    return data;
  };

  it("đọc đủ nguồn, sự kiện, check-in, người thêm tay (bỏ trùng)", () => {
    const parsed = readCustomListSpec(
      form({
        src_mentor: "true",
        src_staff: "true",
        src_event_id: E1,
        src_event_series: "true",
        src_event_checkin: "checked_in",
        added_person_id: [P_APPLICANT, P_APPLICANT]
      })
    );
    expect(parsed).toEqual({
      ok: true,
      spec: { mentor: true, mentee: false, staff: true, event: { eventId: E1, coversSeries: true, checkin: "checked_in" }, addedPersonIds: [P_APPLICANT] }
    });
  });

  it("không nguồn nào, check-in lạ, sự kiện hay id thêm tay sai dạng: từ chối", () => {
    expect(readCustomListSpec(form({})).ok).toBe(false);
    expect(readCustomListSpec(form({ src_event_id: E1, src_event_checkin: "maybe" })).ok).toBe(false);
    expect(readCustomListSpec(form({ src_event_id: "abc" })).ok).toBe(false);
    expect(readCustomListSpec(form({ src_mentor: "true", added_person_id: "nguoi@ngoai.com" })).ok).toBe(false);
  });

  it("chữ ký đổi khi đổi bất kỳ nguồn nào, không đổi theo thứ tự người thêm tay", () => {
    const base = spec({ mentor: true, addedPersonIds: [P_MENTOR, P_MENTEE] });
    expect(customListSignature(base)).toBe(customListSignature({ ...base, addedPersonIds: [P_MENTEE, P_MENTOR] }));
    expect(customListSignature(base)).not.toBe(customListSignature({ ...base, staff: true }));
    expect(customListSignature(spec({ event: { eventId: E1, coversSeries: false, checkin: "all" } }))).not.toBe(
      customListSignature(spec({ event: { eventId: E1, coversSeries: false, checkin: "checked_in" } }))
    );
  });
});

describe("2. lọc check-in", () => {
  it("đúng attendance_status = 'checked_in'; 'chưa' là mọi giá trị còn lại", () => {
    expect(matchesCheckinFilter("checked_in", "checked_in")).toBe(true);
    expect(matchesCheckinFilter("pending", "checked_in")).toBe(false);
    expect(matchesCheckinFilter("no_show", "not_checked_in")).toBe(true);
    expect(matchesCheckinFilter("checked_in", "not_checked_in")).toBe(false);
    expect(matchesCheckinFilter(null, "all")).toBe(true);
  });

  it.each([
    ["checked_in", ["an@x.org", "lan@x.org"]],
    ["not_checked_in", ["minh@x.org", "nga@x.org"]],
    ["all", ["an@x.org", "lan@x.org", "minh@x.org", "nga@x.org"]]
  ] as const)("sự kiện + %s: bỏ phiếu đã huỷ, lọc đúng người", async (checkin, expected) => {
    use();
    const result = await buildCustomRecipientUniverse({
      seasonId: S12,
      spec: spec({ event: { eventId: E1, coversSeries: false, checkin } })
    });
    expect(result.error).toBeNull();
    expect(emails(result.partition.sendable)).toEqual(expected);
  });

  it("nhóm `event` cũ không đổi: vẫn mọi phiếu chưa huỷ, không lọc check-in", async () => {
    use();
    const single = await listBulkRecipients({ seasonId: S12, audience: "event", eventId: E1 });
    expect(emails(single.partition.sendable)).toEqual(["an@x.org", "lan@x.org", "minh@x.org", "nga@x.org"]);
    expect(single.label).toBe("Người đã đăng ký Orientation · 01/11/2026");
    const series = await listBulkRecipients({ seasonId: S12, audience: "event", eventId: E1, coversSeries: true });
    expect(emails(series.partition.sendable)).toEqual(["an@x.org", "lan@x.org", "minh@x.org", "nga@x.org", "phuc@x.org"]);
  });

  it("sự kiện của mùa khác: từ chối cả danh sách", async () => {
    use();
    const result = await buildCustomRecipientUniverse({
      seasonId: S12,
      spec: spec({ mentor: true, event: { eventId: E_OLD, coversSeries: false, checkin: "all" } })
    });
    expect(result.error).toContain("không thuộc mùa");
    expect(result.partition.sendable).toEqual([]);
  });
});

describe("3. hợp các nguồn, mỗi email một lá", () => {
  it("mentor + mentee + BTC + sự kiện: hợp, bỏ trùng theo email, nguồn trước giữ vai trò", async () => {
    use();
    const result = await buildCustomRecipientUniverse({
      seasonId: S12,
      spec: spec({ mentor: true, mentee: true, staff: true, event: { eventId: E1, coversSeries: false, checkin: "checked_in" } })
    });
    expect(result.error).toBeNull();
    expect(emails(result.partition.sendable)).toEqual(["an@x.org", "binh@x.org", "chi@x.org", "khoa@x.org", "lan@x.org"]);
    const an = result.partition.sendable.filter((row) => row.email === "an@x.org");
    expect(an).toHaveLength(1);
    expect(an[0]).toMatchObject({ role: "mentor", personId: P_MENTOR });
    expect(recipientKey(an[0])).toBe(`people:${P_MENTOR}`);
    expect(result.partition.sendable.find((row) => row.email === "khoa@x.org")).toMatchObject({ role: "staff", relationTable: "admin_users" });
    expect(result.partition.sendable.find((row) => row.email === "lan@x.org")).toMatchObject({ role: "attendee", relationTable: "event_registrations" });
    expect(result.label).toContain("mentor + mentee + BTC");
  });

  it("nguồn mentor là ĐÚNG nhóm `mentor` cố định", async () => {
    use();
    const custom = await buildCustomRecipientUniverse({ seasonId: S12, spec: spec({ mentor: true }) });
    const fixed = await listBulkRecipients({ seasonId: S12, audience: "mentor" });
    expect(emails(custom.partition.sendable)).toEqual(emails(fixed.partition.sendable));
  });

  it("một nguồn đọc hỏng: báo lỗi, không trả nửa danh sách", async () => {
    use({ failOn: ["admin_users"] });
    const result = await buildCustomRecipientUniverse({ seasonId: S12, spec: spec({ mentor: true, staff: true }) });
    expect(result.error).toBeTruthy();
    expect(result.partition.sendable).toEqual([]);
  });

  it("gộp thuần: trùng email giữ bản của nguồn đứng trước", () => {
    const a: BulkRecipient = { personId: P_MENTOR, fullName: "Zed", email: "same@x.org", role: "mentor" };
    const b: BulkRecipient = { personId: R_IN, fullName: "Ánh", email: "SAME@x.org", role: "attendee", relationTable: "event_registrations" };
    expect(mergeCustomSources([[a], [b]]).sendable).toEqual([{ ...a }]);
  });
});

describe("4. thêm tay", () => {
  it("người thuộc mùa: lấy tên và email từ danh bạ, vai trò theo tư cách đang hoạt động", async () => {
    use();
    const result = await buildCustomRecipientUniverse({
      seasonId: S12,
      spec: spec({ addedPersonIds: [P_BOTH, P_APPLICANT, P_OPTED_OUT, P_STAFF] })
    });
    expect(result.error).toBeNull();
    const byId = new Map(result.partition.sendable.map((row) => [row.personId, row]));
    expect(byId.get(P_BOTH)).toMatchObject({ role: "mentor", email: "chi@x.org", relationTable: "people" });
    expect(byId.get(P_APPLICANT)?.role).toBe("attendee");
    expect(byId.get(P_OPTED_OUT)?.role).toBe("attendee");
    expect(byId.get(P_STAFF)).toMatchObject({ role: "staff", email: "khoa@x.org" });
  });

  it("vai trò điền được vào thư cho người thêm tay", async () => {
    use();
    const result = await buildCustomRecipientUniverse({ seasonId: S12, spec: spec({ addedPersonIds: [P_APPLICANT] }) });
    const values = buildRecipientValues({ kind: "general_announcement", recipient: result.partition.sendable[0], seasonCode: "UEHM-S12" });
    expect(values).toMatchObject({ ten_nguoi_nhan: "Dũng Ứng Viên", vai_tro: "người tham dự", mua: "UEHM-S12" });
  });

  it.each([
    ["chỉ thuộc mùa trước", P_OLD],
    ["id không có trong danh bạ", u(999)]
  ])("%s: từ chối cả danh sách", async (_label, id) => {
    use();
    const result = await buildCustomRecipientUniverse({ seasonId: S12, spec: spec({ mentor: true, addedPersonIds: [P_MENTEE, id] }) });
    expect(result.error).toContain("không thuộc mùa này");
    expect(result.partition.sendable).toEqual([]);
  });

  it("tìm người: chỉ trả về người thuộc mùa (hoặc BTC), theo tên/email/mã thành viên", async () => {
    use();
    const byCode = await searchCustomListPeople({ seasonId: S12, query: "UEHR" });
    expect(byCode.rows.map((row) => row.personId)).toEqual([P_MENTOR]);
    const byEmail = await searchCustomListPeople({ seasonId: S12, query: "khoa@x" });
    expect(byEmail.rows).toEqual([{ personId: P_STAFF, fullName: "Khoa BTC", email: "Khoa@X.org", memberCode: "UEHC0003", role: "staff" }]);
    const old = await searchCustomListPeople({ seasonId: S12, query: "Hà Mùa" });
    expect(old.rows).toEqual([]);
  });

  it("tìm người: chữ quá ngắn thì không đọc gì; ký tự lọc của PostgREST bị bỏ", async () => {
    const db = use();
    expect((await searchCustomListPeople({ seasonId: S12, query: " a " })).error).toBeTruthy();
    expect(db.reads).toEqual([]);
    const injected = await searchCustomListPeople({ seasonId: S12, query: "an,id.neq.x)%_" });
    expect(injected.error).toBeNull();
    // Đúng ba vế họ tên / email / mã — dấu phẩy người gõ không mở được vế lọc thứ tư.
    expect(db.ors.at(-1)?.split(",")).toHaveLength(3);
    expect(db.ors.at(-1)).not.toMatch(/[()]/);
  });
});

describe("5. khoá form gửi lên phải nằm trong tập máy chủ tự dựng", () => {
  const universe: BulkRecipient[] = [
    { personId: P_MENTOR, fullName: "An", email: "an@x.org", role: "mentor" },
    { personId: R_IN, fullName: "Lan", email: "lan@x.org", role: "attendee", relationTable: "event_registrations" }
  ];

  it("bỏ tick một người: chỉ người còn tick", () => {
    const result = selectCustomRecipients(universe, [`event_registrations:${R_IN}`]);
    expect(result).toEqual({ ok: true, rows: [universe[1]] });
  });

  it.each([
    ["id bịa", [`people:${P_MENTOR}`, `people:${u(777)}`]],
    ["đúng id nhưng sai bảng", [`admin_users:${P_MENTOR}`]],
    ["email thay cho khoá", ["nguoi@ngoai.com"]],
    ["khoá trùng", [`people:${P_MENTOR}`, `people:${P_MENTOR}`]],
    ["bảng lạ", [`matches:${P_MENTOR}`]],
    ["rỗng", []]
  ])("%s: từ chối cả lượt", (_label, keys) => {
    expect(selectCustomRecipients(universe, keys).ok).toBe(false);
  });

  it("khoá của một dòng là bảng + id", () => {
    expect(recipientKey(universe[0])).toBe(`people:${P_MENTOR}`);
    expect(recipientKey(universe[1])).toBe(`event_registrations:${R_IN}`);
  });
});

describe("6. chốt danh sách vào lô", () => {
  const rows: BulkRecipient[] = [
    { personId: P_MENTOR, fullName: "An Mentor", email: "an@x.org", role: "mentor", relationTable: "people" },
    { personId: R_IN, fullName: "Lan Đã Đến", email: "lan@x.org", role: "attendee", relationTable: "event_registrations" }
  ];
  const base = { seasonId: S12, kind: "general_announcement" as const, templateId: u(61), note: "Danh sách tùy chỉnh · Mẫu", actorAdminUserId: A_ADMIN };

  it("mở lô custom (không sự kiện), rồi ghi đúng từng dòng theo thứ tự", async () => {
    const db = use();
    const created = await createCustomEmailBatch({ ...base, recipients: rows });
    expect(created.error).toBeNull();
    const batchInsert = db.writes.find((w) => w.table === "email_batches" && w.op === "insert")?.payload as Row;
    expect(batchInsert).toMatchObject({ audience: "custom", audience_event_id: null, audience_covers_series: false, requested_count: 2, status: "running" });
    const frozen = db.writes.filter((w) => w.table === "email_batch_recipients").flatMap((w) => w.payload as Row[]);
    expect(frozen).toEqual([
      { batch_id: created.batch!.id, position: 0, relation_table: "people", relation_id: P_MENTOR, email: "an@x.org", full_name: "An Mentor", role: "mentor" },
      { batch_id: created.batch!.id, position: 1, relation_table: "event_registrations", relation_id: R_IN, email: "lan@x.org", full_name: "Lan Đã Đến", role: "attendee" }
    ]);
  });

  it("ghi danh sách hỏng: đóng lô (failed), báo lỗi, không trả lô để gửi", async () => {
    const db = use({ failInsertOn: ["email_batch_recipients"] });
    const created = await createCustomEmailBatch({ ...base, recipients: rows });
    expect(created.batch).toBeNull();
    expect(created.error).toContain("chưa lá thư nào đi");
    const close = db.writes.find((w) => w.table === "email_batches" && w.op === "update");
    expect(close?.payload).toMatchObject({ status: "failed" });
    expect(close?.filter?.[0]).toBe("id");
  });

  it("danh sách rỗng: không mở lô", async () => {
    const db = use();
    expect((await createCustomEmailBatch({ ...base, recipients: [] })).batch).toBeNull();
    expect(db.writes).toEqual([]);
  });
});

describe("7. Gửi tiếp của lô custom đọc danh sách đã chốt", () => {
  const BATCH = u(71);
  const batch = (overrides: Partial<EmailBatchRow> = {}): EmailBatchRow => ({
    id: BATCH, seasonId: S12, kind: "general_announcement", templateId: u(61), audience: "custom",
    audienceEventId: null, audienceCoversSeries: false, status: "running", requestedCount: 3,
    sentCount: 0, skippedCount: 0, failedCount: 0, note: null, createdAt: "", completedAt: null, ...overrides
  });
  const frozen = (): Row[] => [
    // Thứ tự id khác thứ tự chốt — phải gửi theo position.
    { id: u(81), batch_id: BATCH, position: 2, relation_table: "event_registrations", relation_id: R_IN, email: "lan@x.org", full_name: "Lan Đã Đến", role: "attendee" },
    { id: u(83), batch_id: BATCH, position: 0, relation_table: "people", relation_id: P_MENTOR, email: "an@x.org", full_name: "An Mentor", role: "mentor" },
    { id: u(82), batch_id: BATCH, position: 1, relation_table: "admin_users", relation_id: A_ADMIN, email: "khoa@x.org", full_name: "Khoa BTC", role: "staff" },
    { id: u(84), batch_id: u(72), position: 0, relation_table: "people", relation_id: P_MENTEE, email: "binh@x.org", full_name: "Bình", role: "mentee" }
  ];
  const run = (b = batch()) =>
    runEmailBatch({ batch: b, seasonCode: "UEHM-S12", subject: "Thông báo {{mua}}", body: "Chào {{ten_nguoi_nhan}}, {{vai_tro}}." });

  it("gửi đúng danh sách chốt, đúng thứ tự, không đọc lại một nguồn nào", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen();
    // Dữ liệu nguồn đổi sau khi chốt: thêm một mentor mới. Người này KHÔNG được nhận.
    tables.person_season_memberships.push({ id: u(49), person_id: P_APPLICANT, season_id: S12, role: "mentor", status: "active" });
    const db = use({}, tables);
    const result = await run();
    expect(result).toMatchObject({ ok: true, sent: 3, remaining: 0, error: null });
    const calls = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.toEmail)).toEqual(["an@x.org", "khoa@x.org", "lan@x.org"]);
    expect(calls.map((call) => call.relation)).toEqual([
      { table: "people", id: P_MENTOR },
      { table: "admin_users", id: A_ADMIN },
      { table: "event_registrations", id: R_IN }
    ]);
    expect(calls[1].body).toContain("Chào Khoa BTC, ban tổ chức.");
    for (const call of calls) expect(call.batchId).toBe(BATCH);
    // `people` được đọc lúc gửi, nhưng chỉ để lấy mã thành viên và giới tính cho dòng đã chốt
    // (mục 8) — không bảng nguồn nào được đọc lại để dựng danh sách.
    for (const table of ["person_season_memberships", "admin_users", "event_registrations", "events", "applications"]) {
      expect(db.reads).not.toContain(table);
    }
  });

  it("bỏ người đã có dòng trong sổ thư của lô — không ai nhận hai lá", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen();
    tables.outbound_emails = [{ id: u(91), batch_id: BATCH, to_email: "an@x.org" }];
    use({}, tables);
    const result = await run();
    expect(vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0].toEmail)).toEqual(["khoa@x.org", "lan@x.org"]);
    expect(result.remaining).toBe(0);
  });

  it("số dòng chốt khác số của lô: từ chối, không gửi lá nào", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen().slice(0, 2);
    use({}, tables);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("không đầy đủ");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("đọc danh sách chốt hỏng: từ chối, không gửi lá nào", async () => {
    const tables = seed();
    tables.email_batch_recipients = frozen();
    use({ failOn: ["email_batch_recipients"] }, tables);
    expect((await run()).ok).toBe(false);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("tên nhóm custom không dựng lại được danh sách nào", async () => {
    const db = use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "custom" });
    // Đúng lời từ chối của nhóm custom — không phải lỗi "chưa chọn sự kiện" của nhánh event bên dưới.
    expect(result.error).toBe("Danh sách tùy chỉnh không dựng lại được từ tên nhóm.");
    expect(result.partition.sendable).toEqual([]);
    expect(db.reads).toEqual([]);
  });

  it("lô nhóm cũ vẫn dựng lại từ nhóm, không đọc bảng danh sách chốt", async () => {
    const db = use();
    const result = await run(batch({ audience: "mentor", requestedCount: 2 }));
    expect(result.ok).toBe(true);
    expect(vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0].toEmail).sort()).toEqual(["an@x.org", "chi@x.org"]);
    expect(db.reads).not.toContain("email_batch_recipients");
  });
});

describe("8. ô {{ma_thanh_vien}} và {{xung_ho}} của lô custom (VAM00024)", () => {
  const BATCH = u(73);
  const P_LEGACY = u(8); // mentor chưa có mã mới, chỉ có mã cũ trong hồ sơ mentor
  const batch = (requestedCount: number): EmailBatchRow => ({
    id: BATCH, seasonId: S12, kind: "general_announcement", templateId: u(61), audience: "custom",
    audienceEventId: null, audienceCoversSeries: false, status: "running", requestedCount,
    sentCount: 0, skippedCount: 0, failedCount: 0, note: null, createdAt: "", completedAt: null
  });
  const frozenRow = (position: number, relation_table: string, relation_id: string, email: string, full_name: string, role: string): Row => ({
    id: u(200 + position), batch_id: BATCH, position, relation_table, relation_id, email, full_name, role
  });
  const tablesWithDetails = () => {
    const tables = seed();
    for (const person of tables.people) {
      if (person.id === P_MENTOR) person.gender = "male";
      if (person.id === P_MENTEE) person.gender = "female";
      // BTC có mã mới và giới tính trong danh bạ, nhưng dòng chốt nối về tài khoản BTC.
      if (person.id === P_STAFF) person.gender = "male";
    }
    tables.people.push({ id: P_LEGACY, full_name: "Quỳnh Mã Cũ", email_primary: "quynh@x.org", member_code: null, gender: "female" });
    tables.mentor_profiles = [{ id: u(301), person_id: P_LEGACY, mentor_code: "MT-S11-007" }];
    tables.mentee_profiles = [];
    // Danh sách chốt KHÔNG mang mã hay giới tính — hai ô phải được đọc lúc gửi.
    tables.email_batch_recipients = [
      frozenRow(0, "people", P_MENTOR, "an@x.org", "An Mentor", "mentor"),
      frozenRow(1, "people", P_LEGACY, "quynh@x.org", "Quỳnh Mã Cũ", "mentor"),
      frozenRow(2, "people", P_MENTEE, "binh@x.org", "Bình Mentee", "mentee"),
      frozenRow(3, "admin_users", A_ADMIN, "khoa@x.org", "Khoa BTC", "staff"),
      frozenRow(4, "event_registrations", R_IN, "lan@x.org", "Lan Đã Đến", "attendee")
    ];
    return tables;
  };
  const run = () =>
    runEmailBatch({
      batch: batch(5),
      seasonCode: "UEHM-S12",
      subject: "Thông báo {{mua}}",
      body: "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}} (mã {{ma_thanh_vien}})."
    });
  const bodyFor = (email: string) =>
    vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]).find((call) => call.toEmail === email)?.body ?? "";

  it("mentor: mã thành viên và Anh/Chị; mã cũ khi chưa có mã mới", async () => {
    use({}, tablesWithDetails());
    const result = await run();
    expect(result).toMatchObject({ ok: true, sent: 5, error: null });
    expect(bodyFor("an@x.org")).toContain("Kính gửi Anh An Mentor (mã UEHR0001).");
    expect(bodyFor("quynh@x.org")).toContain("Kính gửi Chị Quỳnh Mã Cũ (mã MT-S11-007).");
  });

  it("mentee: không xưng hô, mã như các nhóm khác; BTC và người tham dự: cả hai ô trống", async () => {
    use({}, tablesWithDetails());
    await run();
    const mentee = bodyFor("binh@x.org");
    expect(mentee).toContain("Kính gửi Bình Mentee (mã UEHE0002).");
    expect(mentee).not.toMatch(/Anh|Chị/);
    for (const [email, name] of [["khoa@x.org", "Khoa BTC"], ["lan@x.org", "Lan Đã Đến"]]) {
      const body = bodyFor(email);
      expect(body).toContain(`Kính gửi ${name} (mã`);
      expect(body).not.toMatch(/Anh |Chị |UEH/);
    }
  });

  it("mã đọc lúc gửi: đổi mã sau khi chốt thì thư mang mã mới", async () => {
    const tables = tablesWithDetails();
    (tables.people.find((person) => person.id === P_MENTOR) as Row).member_code = "UEHR0100";
    use({}, tables);
    await run();
    expect(bodyFor("an@x.org")).toContain("(mã UEHR0100)");
  });

  it("đọc danh bạ hoặc mã cũ hỏng: không gửi lá nào", async () => {
    for (const table of ["people", "mentor_profiles"]) {
      vi.mocked(sendTemplatedEmail).mockClear();
      use({ failOn: [table] }, tablesWithDetails());
      const result = await run();
      expect(result.ok, table).toBe(false);
      expect(sendTemplatedEmail).not.toHaveBeenCalled();
    }
  });
});
