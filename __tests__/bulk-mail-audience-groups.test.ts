/**
 * Nhóm nhận thư mới: Ban tổ chức, mentor quay lại mùa, người đăng ký sự kiện.
 *
 * Mỗi nhóm có một cách gửi nhầm người mà không ai thấy, và bộ test canh từng cách:
 *   - BTC lọt reviewer/viewer, hoặc rơi mất người chỉ vì tài khoản trống họ tên;
 *   - "mentor quay lại" gồm cả người đã từ chối, hoặc đã rút khỏi mùa;
 *   - nhóm sự kiện nhận event id của MÙA KHÁC, gửi cho phiếu đã huỷ/bị từ chối,
 *     hoặc lần "Gửi tiếp" không nhớ sự kiện nào mà vẫn dựng ra một danh sách.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `lib/bulk-mail`, chỉ giả database
 * và hàm gửi thư; đường đọc phân trang là hàng thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import {
  BULK_AUDIENCES,
  BULK_AUDIENCE_LABELS,
  FIXED_BULK_AUDIENCES,
  STAFF_ROLES,
  buildRecipientValues,
  partitionRecipients,
  resolveAudienceChoice
} from "@/lib/bulk-mail-core";
import { renderTemplate } from "@/lib/email-templates-core";
import { countBulkRecipients, listBulkRecipients, runEmailBatch } from "@/lib/bulk-mail";

type Row = Record<string, unknown>;

/**
 * Bản giả đủ cho mọi đường đọc của module: lọc eq/neq/in/ilike thật, phân trang
 * theo range và theo keyset (gt + order + limit), và ghi lại bảng nào đã bị đọc
 * — để ca "không được đọc gì" khẳng định được đúng điều nó nói.
 */
function fakeDb(tables: Record<string, Row[]>, failOn: string[] = []) {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      let rows = (tables[table] ?? []).slice();
      let limitN: number | null = null;
      let span: [number, number] | null = null;
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
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
        gt: (column: string, value: unknown) => {
          rows = rows.filter((row) => String(row[column]) > String(value));
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
        update: () => chain,
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          reads.push(table);
          if (failOn.includes(table)) {
            return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }).then(resolve, reject);
          }
          let out = rows;
          if (span) out = out.slice(span[0], span[1] + 1);
          if (limitN !== null) out = out.slice(0, limitN);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
  return { client, reads };
}

const S12 = "season-12";
const S11 = "season-11";
const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const E3 = "33333333-3333-4333-8333-333333333333";
const SERIES = "44444444-4444-4444-8444-444444444444";

function tables(): Record<string, Row[]> {
  return {
    admin_users: [
      { id: "a1", full_name: "Nguyễn Admin", email: "admin@x.org", role: "admin", status: "active" },
      { id: "a2", full_name: null, email: "core@x.org", role: "core_team", status: "active" },
      { id: "a3", full_name: "Người Chấm", email: "rev@x.org", role: "reviewer", status: "active" },
      { id: "a4", full_name: "Người Xem", email: "view@x.org", role: "viewer", status: "active" },
      { id: "a5", full_name: "Đã Nghỉ", email: "old@x.org", role: "admin", status: "inactive" },
      { id: "a6", full_name: "Hỗ Trợ", email: "sup@x.org", role: "support_team", status: "active" },
      { id: "a7", full_name: "Cấp Cao", email: "super@x.org", role: "super_admin", status: "active" }
    ],
    people: [
      { id: "p1", full_name: "Trần Core", email_primary: "Core@X.org" },
      { id: "p2", full_name: "Mentor Quay Lại", email_primary: "back@x.org" },
      { id: "p3", full_name: "Mentor Từ Chối", email_primary: "no@x.org" },
      { id: "p4", full_name: "Mentor Đã Rút", email_primary: "left@x.org" },
      { id: "p5", full_name: "Mentee Một", email_primary: "mentee@x.org" }
    ],
    person_season_invites: [
      { id: "i1", person_id: "p2", season_id: S12, role: "mentor", outcome: "accepted" },
      { id: "i2", person_id: "p3", season_id: S12, role: "mentor", outcome: "declined" },
      { id: "i3", person_id: "p4", season_id: S12, role: "mentor", outcome: "accepted" }
    ],
    person_season_memberships: [
      { id: "m1", person_id: "p2", season_id: S12, role: "mentor", status: "active" },
      { id: "m2", person_id: "p3", season_id: S12, role: "mentor", status: "active" },
      { id: "m3", person_id: "p4", season_id: S12, role: "mentor", status: "opted_out" },
      { id: "m4", person_id: "p5", season_id: S12, role: "mentee", status: "active" }
    ],
    events: [
      {
        id: E1, season_id: S12, series_id: SERIES, series_index: 1, series_total: 2,
        event_name: "Mentor Orientation", starts_at: "2026-09-20T01:00:00.000Z", status: "scheduled"
      },
      {
        id: E2, season_id: S12, series_id: SERIES, series_index: 2, series_total: 2,
        event_name: "Mentor Orientation", starts_at: "2026-09-27T01:00:00.000Z", status: "scheduled"
      },
      {
        id: E3, season_id: S11, series_id: null, series_index: null, series_total: null,
        event_name: "Sự kiện mùa cũ", starts_at: "2025-09-20T01:00:00.000Z", status: "scheduled"
      }
    ],
    event_registrations: [
      { id: "r1", event_id: E1, full_name: "Người Một", email: "one@x.org", registration_status: "registered" },
      { id: "r2", event_id: E1, full_name: "Người Hai", email: "two@x.org", registration_status: "cancelled" },
      { id: "r3", event_id: E1, full_name: "Người Ba", email: "three@x.org", registration_status: "rejected" },
      { id: "r4", event_id: E2, full_name: "Người Bốn", email: "four@x.org", registration_status: "registered" },
      { id: "r5", event_id: E2, full_name: "Người Một", email: "ONE@x.org", registration_status: "confirmed" },
      { id: "r6", event_id: E3, full_name: "Mùa Cũ", email: "old-season@x.org", registration_status: "registered" }
    ],
    outbound_emails: [],
    email_batches: []
  };
}

function use(failOn: string[] = []) {
  const db = fakeDb(tables(), failOn);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
  return db;
}

const emailsOf = (result: { partition: { sendable: Array<{ email: string }> } }) =>
  result.partition.sendable.map((row) => row.email).sort();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("1. chọn nhóm từ form", () => {
  it("nhóm không mang tham số thì BỎ event id và cờ chuỗi đi kèm", () => {
    expect(resolveAudienceChoice({ audience: "staff", eventId: E1, coversSeries: "true" })).toEqual({
      ok: true,
      choice: { audience: "staff", eventId: null, coversSeries: false }
    });
  });

  it("nhóm sự kiện thiếu sự kiện, hoặc event id không phải UUID, thì từ chối", () => {
    expect(resolveAudienceChoice({ audience: "event", eventId: "" }).ok).toBe(false);
    expect(resolveAudienceChoice({ audience: "event", eventId: "abc" }).ok).toBe(false);
  });

  it("nhóm sự kiện đọc đúng sự kiện và cờ chuỗi", () => {
    expect(resolveAudienceChoice({ audience: "event", eventId: E1, coversSeries: "true" })).toEqual({
      ok: true,
      choice: { audience: "event", eventId: E1, coversSeries: true }
    });
    const single = resolveAudienceChoice({ audience: "event", eventId: E1, coversSeries: "false" });
    expect(single.ok && single.choice.coversSeries).toBe(false);
  });

  it("nhóm lạ thì từ chối", () => {
    expect(resolveAudienceChoice({ audience: "reviewer" }).ok).toBe(false);
  });

  it("mọi nhóm có nhãn; nhóm sự kiện không nằm trong nhóm cố định", () => {
    for (const audience of BULK_AUDIENCES) expect(BULK_AUDIENCE_LABELS[audience].trim()).not.toBe("");
    expect(FIXED_BULK_AUDIENCES as readonly string[]).not.toContain("event");
  });

  it("Ban tổ chức gồm đúng bốn vai trò — không có reviewer, không có viewer", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["admin", "core_team", "super_admin", "support_team"]);
  });
});

describe("2. ô {{vai_tro}} có chữ cho mọi nhóm", () => {
  it.each([
    ["staff", "ban tổ chức"],
    ["attendee", "người tham dự"],
    ["mentor", "mentor"],
    ["mentee", "mentee"]
  ] as const)("%s → %s, và lá thư dùng ô đó dựng được", (role, word) => {
    const values = buildRecipientValues({
      kind: "general_announcement",
      recipient: { personId: "x", fullName: "A", email: "a@x.org", role },
      seasonCode: "UEHM-S12"
    });
    expect(values.vai_tro).toBe(word);
    const letter = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo",
      body: "Chào {{ten_nguoi_nhan}}, {{vai_tro}}.",
      values
    });
    expect(letter.ok).toBe(true);
  });

  it("tách danh sách vẫn giữ nguồn của người nhận", () => {
    const { sendable } = partitionRecipients([
      { personId: "r1", fullName: "A", email: "a@x.org", role: "attendee", relationTable: "event_registrations" }
    ]);
    expect(sendable[0].relationTable).toBe("event_registrations");
  });
});

describe("3. Ban tổ chức", () => {
  it("chỉ tài khoản ĐANG HOẠT ĐỘNG mang một trong bốn vai trò", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "staff" });
    expect(result.error).toBeNull();
    expect(emailsOf(result)).toEqual(["admin@x.org", "core@x.org", "sup@x.org", "super@x.org"]);
  });

  it("tài khoản trống họ tên lấy tên trong danh bạ theo cùng email, không rơi vào 'không gửi được'", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "staff" });
    expect(result.partition.sendable.find((row) => row.email === "core@x.org")?.fullName).toBe("Trần Core");
    expect(result.partition.unreachable).toEqual([]);
  });

  it("sổ thư nối lá thư về tài khoản BTC", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "staff" });
    for (const row of result.partition.sendable) {
      expect(row.relationTable).toBe("admin_users");
      expect(row.role).toBe("staff");
    }
  });

  it("đọc hỏng thì báo lỗi, không đưa ra danh sách nào", async () => {
    use(["admin_users"]);
    const result = await listBulkRecipients({ seasonId: S12, audience: "staff" });
    expect(result.error).toBeTruthy();
    expect(result.partition.sendable).toEqual([]);
  });
});

describe("4. Mentor đã xác nhận quay lại mùa", () => {
  it("chỉ người đã chấp nhận VÀ còn đang hoạt động — không người từ chối, không người đã rút", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "returning_mentor" });
    expect(result.error).toBeNull();
    expect(emailsOf(result)).toEqual(["back@x.org"]);
  });

  it("đọc hỏng thì báo lỗi", async () => {
    use(["person_season_invites"]);
    const result = await listBulkRecipients({ seasonId: S12, audience: "returning_mentor" });
    expect(result.error).toBeTruthy();
  });
});

describe("5. Người đã đăng ký một sự kiện", () => {
  it("một buổi: bỏ phiếu đã huỷ và phiếu bị từ chối, lấy họ tên và email từ phiếu", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "event", eventId: E1 });
    expect(result.error).toBeNull();
    expect(emailsOf(result)).toEqual(["one@x.org"]);
    expect(result.partition.sendable[0]).toMatchObject({
      fullName: "Người Một",
      role: "attendee",
      relationTable: "event_registrations"
    });
    expect(result.label).toContain("Mentor Orientation");
  });

  it("cả chuỗi: gộp mọi buổi, người đăng ký hai buổi chỉ nhận một lá", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "event", eventId: E1, coversSeries: true });
    expect(emailsOf(result)).toEqual(["four@x.org", "one@x.org"]);
    expect(result.label).toContain("cả chuỗi");
  });

  it("sự kiện của MÙA KHÁC: từ chối, và không đọc phiếu đăng ký nào", async () => {
    const db = use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "event", eventId: E3 });
    expect(result.error).toContain("không thuộc mùa");
    expect(result.partition.sendable).toEqual([]);
    expect(db.reads).not.toContain("event_registrations");
  });

  it("thiếu sự kiện: từ chối trước khi đọc bất cứ bảng nào", async () => {
    const db = use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "event" });
    expect(result.error).toBeTruthy();
    expect(db.reads).toEqual([]);
  });

  it("sự kiện không tồn tại: từ chối", async () => {
    use();
    const result = await listBulkRecipients({
      seasonId: S12,
      audience: "event",
      eventId: "55555555-5555-4555-8555-555555555555"
    });
    expect(result.error).toBeTruthy();
  });
});

describe("6. Gửi tiếp một lô của nhóm sự kiện", () => {
  const batch = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "b1",
      seasonId: S12,
      kind: "general_announcement",
      templateId: "t1",
      audience: "event",
      audienceEventId: E1,
      audienceCoversSeries: true,
      status: "running",
      requestedCount: 2,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      note: null,
      createdAt: "",
      completedAt: null,
      ...overrides
    }) as never;

  it("lô không nhớ sự kiện nào: từ chối, không gửi lá nào", async () => {
    use();
    const run = await runEmailBatch({
      batch: batch({ audienceEventId: null }),
      seasonCode: "UEHM-S12",
      subject: "Thông báo",
      body: "Chào {{ten_nguoi_nhan}}."
    });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("không ghi lại sự kiện");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("dựng lại đúng danh sách của lô, và sổ thư nối từng lá về phiếu đăng ký", async () => {
    use();
    const run = await runEmailBatch({
      batch: batch(),
      seasonCode: "UEHM-S12",
      subject: "Thông báo",
      body: "Chào {{ten_nguoi_nhan}}."
    });
    expect(run.ok).toBe(true);
    const calls = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.toEmail).sort()).toEqual(["four@x.org", "one@x.org"]);
    for (const call of calls) expect(call.relation?.table).toBe("event_registrations");
  });
});

describe("7. Đếm cho màn hình", () => {
  it("đếm đủ năm nhóm cố định", async () => {
    use();
    const { counts, error } = await countBulkRecipients(S12);
    expect(error).toBeNull();
    expect(counts.staff.sendable).toBe(4);
    expect(counts.returning_mentor.sendable).toBe(1);
    expect(counts.mentor.sendable).toBe(2);
    expect(counts.mentee.sendable).toBe(1);
    expect(counts.both.sendable).toBe(3);
  });

  it("liệt kê sự kiện của ĐÚNG mùa, mới nhất trước, kèm số người của buổi và của cả chuỗi", async () => {
    use();
    const { events } = await countBulkRecipients(S12);
    expect(events.map((row) => row.id)).toEqual([E2, E1]);
    const first = events.find((row) => row.id === E1)!;
    expect(first.sendable).toBe(1);
    expect(first.seriesSendable).toBe(2);
    expect(first.label).toContain("(buổi 1/2)");
    expect(events.find((row) => row.id === E3)).toBeUndefined();
  });
});

describe("8. migration", () => {
  const sql = readFileSync("supabase/migrations/20260913210000_email_batches_audience_groups.sql", "utf8");

  it("nới ràng buộc bằng mẫu một-hoặc-nhiều dấu đóng ngoặc, không phải đúng ba dấu", () => {
    // Ràng buộc hiện có kết thúc bằng BỐN dấu `)`, vì còn vế `audience IS NULL`.
    // Khuôn ba dấu sẽ dừng lại báo "dạng lạ".
    expect(sql).toContain("'(\\]\\)+)$'");
    expect(sql).not.toContain("'\\]\\)\\)\\)$'");
  });

  it("tự kiểm có đủ ba nhóm mới và không mất ba nhóm cũ", () => {
    const check = sql.slice(sql.indexOf("$email_batches_groups_contract$"));
    for (const value of ["staff", "returning_mentor", "event", "mentee", "mentor", "both"]) {
      expect(check).toContain(`'${value}'`);
    }
    expect(check).toContain("đã MẤT nhóm cũ");
  });

  it("lô nhớ sự kiện nào và có gồm cả chuỗi không", () => {
    expect(sql).toContain("add column if not exists audience_event_id uuid references public.events(id) on delete restrict");
    expect(sql).toContain("add column if not exists audience_covers_series boolean not null default false");
    expect(sql).toContain("email_batches_audience_event_shape_check");
  });

  it("bảng vẫn server-only, và không đụng dữ liệu", () => {
    expect(sql).toContain("email_batches lại có policy");
    expect(sql).not.toMatch(/create\s+policy|delete\s+from|update\s+public\.email_batches|truncate/i);
  });
});

describe("9. màn hình gửi", () => {
  const panel = readFileSync("app/operations/mail/send-panel.tsx", "utf8");

  it("form gửi mang theo sự kiện và cờ chuỗi của nhóm sự kiện", () => {
    expect(panel).toContain('name="event_id"');
    expect(panel).toContain('name="covers_series"');
  });

  it("nhóm sự kiện mà không còn sự kiện nào thì rơi về nhóm có thật, không để ô chọn và form lệch nhau", () => {
    expect(panel).toContain('audienceChoice === "event" && !eventOptions.length ? "mentee" : audienceChoice');
  });
});
