/**
 * VAM00029 — ô {{ma_thanh_vien}} của người nhận lấy từ nguồn "người đăng ký sự kiện" trong lô
 * Danh sách tùy chỉnh.
 *
 * Lỗi thật: lô chốt dòng `event_registrations` (vai trò "người tham dự") cho các mentee đã check-in,
 * và lúc gửi chỉ dòng nối về `people` được tra mã — nên thư của họ trống ô mã, dù hồ sơ có mã. Gửi
 * thử thì dùng giá trị mẫu, nên luôn thấy có mã.
 *
 * Mỗi ca canh một cách gửi sai mà không ai thấy:
 *   - người có mã nhận thư trống mã (lỗi gốc);
 *   - người nhận A mang mã của người nhận B;
 *   - email trùng hai hồ sơ mà vẫn chọn bừa một mã;
 *   - người ngoài chương trình được gán một mã;
 *   - mã cũ tra theo một vai trò người đó không mang trong lô (mã mentor cho mentee);
 *   - người tham dự có xưng hô Anh/Chị.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng runEmailBatch; chỉ giả database và hàm gửi thư.
 * Đường đọc phân trang là hàng thật. Mọi tên, email, mã là dữ liệu bịa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { runEmailBatch, type EmailBatchRow } from "@/lib/bulk-mail";

type Row = Record<string, unknown>;

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Bản giả đủ cho đường gửi của lô custom; ghi lại bảng đã đọc. */
function fakeDb(tables: Record<string, Row[]>, failOn: string[] = []) {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      let rows = (tables[table] ?? []).slice();
      let limitN: number | null = null;
      let span: [number, number] | null = null;
      let mode: "read" | "write" = "read";
      // Đọc đếm (select head) cho bước kiểm hạn mức gửi chung của lô tùy chỉnh (VAM00027).
      let head = false;
      const chain: any = {
        select: (_columns?: string, opts?: { head?: boolean }) => {
          if (opts?.head) head = true;
          return chain;
        },
        gte: (column: string, value: unknown) => {
          rows = rows.filter((row) => String(row[column] ?? "") >= String(value));
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
        update: () => {
          mode = "write";
          return chain;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          if (mode === "write") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          reads.push(table);
          if (failOn.includes(table)) {
            return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }).then(resolve, reject);
          }
          if (head) return Promise.resolve({ count: rows.length, data: null, error: null }).then(resolve, reject);
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

const S12 = u(12);
const BATCH = u(70);
const E1 = u(101);

// Hồ sơ trong danh bạ.
const P_MENTEE_A = u(1); // mentee có mã mới
const P_MENTEE_B = u(2); // mentee khác có mã mới; email lưu hoa thường lẫn lộn, có khoảng trắng
const P_DUP_1 = u(3); // hai hồ sơ cùng một email, mỗi hồ sơ một mã
const P_DUP_2 = u(4);
const P_LEGACY_MENTEE = u(5); // chưa có mã mới, chỉ có mã cũ trong hồ sơ mentee
const P_MENTOR = u(6); // mentor nữ có mã, đi sự kiện
const P_ATTENDEE = u(7); // người thêm tay, không giữ vai trò nào trong mùa, có mã
// Phiếu đăng ký sự kiện.
const R_A = u(31);
const R_B = u(32);
const R_DUP = u(33);
const R_GUEST = u(34);
const R_LEGACY = u(35);
const R_MENTOR = u(36);

function seed(): Record<string, Row[]> {
  return {
    people: [
      { id: P_MENTEE_A, full_name: "Mentee Một", email_primary: "mot@example.org", member_code: "UEHE9001", gender: "female" },
      { id: P_MENTEE_B, full_name: "Mentee Hai", email_primary: "  Hai@Example.ORG ", member_code: "UEHE9002", gender: "male" },
      { id: P_DUP_1, full_name: "Trùng Một", email_primary: "trung@example.org", member_code: "UEHE9003", gender: null },
      { id: P_DUP_2, full_name: "Trùng Hai", email_primary: "TRUNG@example.org", member_code: "UEHR9004", gender: null },
      { id: P_LEGACY_MENTEE, full_name: "Mentee Mã Cũ", email_primary: "macu@example.org", member_code: null, gender: "female" },
      { id: P_MENTOR, full_name: "Mentor Đi Sự Kiện", email_primary: "mentor@example.org", member_code: "UEHR9006", gender: "female" },
      { id: P_ATTENDEE, full_name: "Người Thêm Tay", email_primary: "themtay@example.org", member_code: "UEHE9007", gender: "male" }
    ],
    // Mã cũ: hồ sơ mentee của người chưa có mã mới, và một hồ sơ mentor cũng mang mã — không được
    // rơi vào thư của ai trong lô này, vì không ai mang vai trò mentor/mentee ở các dòng đăng ký.
    mentee_profiles: [{ id: u(301), person_id: P_LEGACY_MENTEE, mentee_code: "ME-S11-005" }],
    mentor_profiles: [{ id: u(302), person_id: P_LEGACY_MENTEE, mentor_code: "MT-S11-005" }],
    event_registrations: [
      { id: R_A, event_id: E1, full_name: "Mentee Một", email: "mot@example.org", registration_status: "registered", attendance_status: "checked_in" }
    ],
    person_season_memberships: [],
    admin_users: [],
    outbound_emails: [],
    email_batches: [],
    email_batch_recipients: []
  };
}

const frozenRow = (position: number, relation_table: string, relation_id: string, email: string, full_name: string, role: string): Row => ({
  id: u(200 + position),
  batch_id: BATCH,
  position,
  relation_table,
  relation_id,
  email,
  full_name,
  role
});

/** Đúng dạng lô thật của 07/11: mọi dòng từ nguồn check-in sự kiện, vai trò "người tham dự". */
function registrationBatch(): Row[] {
  return [
    frozenRow(0, "event_registrations", R_A, "mot@example.org", "Mentee Một", "attendee"),
    frozenRow(1, "event_registrations", R_B, "hai@example.org", "Mentee Hai", "attendee"),
    frozenRow(2, "event_registrations", R_DUP, "trung@example.org", "Trùng Một", "attendee"),
    frozenRow(3, "event_registrations", R_GUEST, "khach@example.org", "Khách Ngoài", "attendee"),
    frozenRow(4, "event_registrations", R_LEGACY, "macu@example.org", "Mentee Mã Cũ", "attendee"),
    frozenRow(5, "event_registrations", R_MENTOR, "mentor@example.org", "Mentor Đi Sự Kiện", "attendee")
  ];
}

function use(frozen: Row[], failOn: string[] = []) {
  const tables = seed();
  tables.email_batch_recipients = frozen;
  const db = fakeDb(tables, failOn);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
  return db;
}

function batch(requestedCount: number): EmailBatchRow {
  return {
    id: BATCH,
    seasonId: S12,
    kind: "general_announcement",
    templateId: u(61),
    audience: "custom",
    audienceEventId: null,
    audienceCoversSeries: false,
    status: "running",
    requestedCount,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    note: null,
    createdAt: "",
    completedAt: null
  };
}

const run = (requestedCount: number) =>
  runEmailBatch({
    batch: batch(requestedCount),
    seasonCode: "UEHM-S12",
    subject: "[{{ma_thanh_vien}}] Thông báo {{mua}}",
    body: "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},\nMã thành viên: {{ma_thanh_vien}}"
  });

function sent(): Map<string, { subject: string; body: string; relation: unknown }> {
  return new Map(
    vi.mocked(sendTemplatedEmail).mock.calls.map(([arg]) => [
      arg.toEmail,
      { subject: arg.subject, body: arg.body, relation: (arg as { relation?: unknown }).relation }
    ])
  );
}

const ALL_CODES = ["UEHE9001", "UEHE9002", "UEHE9003", "UEHR9004", "ME-S11-005", "MT-S11-005", "UEHR9006", "UEHE9007"];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("VAM00029: mã thành viên của dòng đăng ký sự kiện trong lô tùy chỉnh", () => {
  it("dựng lại lỗi: mentee có mã, chốt vào lô từ nguồn check-in sự kiện, nhận thư CÓ mã của mình", async () => {
    use(registrationBatch());
    const result = await run(6);
    expect(result).toMatchObject({ ok: true, sent: 6, error: null });
    expect(sent().get("mot@example.org")).toMatchObject({
      subject: "[UEHE9001] Thông báo UEHM-S12",
      body: "Kính gửi Mentee Một,\nMã thành viên: UEHE9001"
    });
  });

  it("hai người nhận khác nhau mang hai mã khác nhau, mỗi người đúng mã của mình", async () => {
    use(registrationBatch());
    await run(6);
    const mail = sent();
    // Email trong hồ sơ viết hoa và có khoảng trắng vẫn khớp địa chỉ nhận thư đã chuẩn hoá.
    expect(mail.get("hai@example.org")?.body).toBe("Kính gửi Mentee Hai,\nMã thành viên: UEHE9002");
    expect(mail.get("mot@example.org")?.body).not.toContain("UEHE9002");
    expect(mail.get("hai@example.org")?.body).not.toContain("UEHE9001");
    // Thư vẫn nối về đúng phiếu đăng ký — chỉ ô mã được tra theo hồ sơ, không đổi người nhận.
    expect(mail.get("mot@example.org")?.relation).toEqual({ table: "event_registrations", id: R_A });
    expect(mail.get("hai@example.org")?.relation).toEqual({ table: "event_registrations", id: R_B });
  });

  it("email trùng hai hồ sơ (khác hoa thường): không đoán, ô mã trống", async () => {
    use(registrationBatch());
    await run(6);
    const mail = sent().get("trung@example.org");
    expect(mail).toMatchObject({ subject: "[] Thông báo UEHM-S12", body: "Kính gửi Trùng Một,\nMã thành viên:" });
  });

  it("người không có hồ sơ trong danh bạ: ô mã trống", async () => {
    use(registrationBatch());
    await run(6);
    expect(sent().get("khach@example.org")).toMatchObject({
      subject: "[] Thông báo UEHM-S12",
      body: "Kính gửi Khách Ngoài,\nMã thành viên:"
    });
  });

  it("người tham dự chưa có mã mới: không tra mã cũ theo một vai trò họ không mang trong lô", async () => {
    use(registrationBatch());
    await run(6);
    // Có cả mã mentee cũ lẫn mã mentor cũ; dòng chốt là "người tham dự" nên không lấy mã nào.
    expect(sent().get("macu@example.org")?.body).toBe("Kính gửi Mentee Mã Cũ,\nMã thành viên:");
  });

  it("mentor đi sự kiện (vai trò người tham dự): có mã, không có xưng hô Anh/Chị", async () => {
    use(registrationBatch());
    await run(6);
    expect(sent().get("mentor@example.org")?.body).toBe("Kính gửi Mentor Đi Sự Kiện,\nMã thành viên: UEHR9006");
  });

  it("không thư nào mang mã của một người khác", async () => {
    use(registrationBatch());
    await run(6);
    const own: Record<string, string[]> = {
      "mot@example.org": ["UEHE9001"],
      "hai@example.org": ["UEHE9002"],
      "trung@example.org": [],
      "khach@example.org": [],
      "macu@example.org": [],
      "mentor@example.org": ["UEHR9006"]
    };
    const mails = Array.from(sent().entries());
    expect(mails).toHaveLength(6);
    for (const [email, mail] of mails) {
      for (const code of ALL_CODES) {
        if (own[email].includes(code)) continue;
        expect(`${mail.subject}\n${mail.body}`, `${email} không được mang ${code}`).not.toContain(code);
      }
    }
  });

  it("lô trộn dòng people và dòng đăng ký: dòng people giữ nguyên luật cũ, kể cả vai trò người tham dự", async () => {
    use([
      frozenRow(0, "people", P_LEGACY_MENTEE, "macu@example.org", "Mentee Mã Cũ", "mentee"),
      frozenRow(1, "people", P_ATTENDEE, "themtay@example.org", "Người Thêm Tay", "attendee"),
      frozenRow(2, "event_registrations", R_A, "mot@example.org", "Mentee Một", "attendee")
    ]);
    const result = await run(3);
    expect(result).toMatchObject({ ok: true, sent: 3 });
    const mail = sent();
    // Dòng people vai trò mentee: mã cũ của hồ sơ MENTEE, không phải mã mentor cũ.
    expect(mail.get("macu@example.org")?.body).toBe("Kính gửi Mentee Mã Cũ,\nMã thành viên: ME-S11-005");
    // Dòng people vai trò người tham dự: mã mới của hồ sơ, không xưng hô.
    expect(mail.get("themtay@example.org")?.body).toBe("Kính gửi Người Thêm Tay,\nMã thành viên: UEHE9007");
    expect(mail.get("mot@example.org")?.body).toBe("Kính gửi Mentee Một,\nMã thành viên: UEHE9001");
  });

  it("không đọc lại phiếu đăng ký lúc gửi: danh sách vẫn là danh sách đã chốt", async () => {
    const db = use(registrationBatch());
    await run(6);
    expect(db.reads).not.toContain("event_registrations");
  });

  it("đọc danh bạ hỏng: không gửi lá nào, không gửi thư với ô mã lặng lẽ trống", async () => {
    use(registrationBatch(), ["people"]);
    const result = await run(6);
    expect(result.ok).toBe(false);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });
});
