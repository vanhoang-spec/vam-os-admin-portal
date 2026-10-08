/**
 * Nhóm nhận thư "Mentee rớt vòng hồ sơ (CV)" (BTC 07/10/2026).
 *
 * Một lá thư rớt gửi nhầm không rút lại được. Mỗi ca dưới đây là một người thật
 * khớp vào lúc viết mà KHÔNG được nhận thư: đã được mời phỏng vấn (kể cả 15 bạn
 * bị tạm khoá link, trạng thái đã bị đổi ngược), đã giữ chỗ, đã check-in, đang là
 * mentee/mentor của mùa, là tài khoản BTC, hay có một đơn khác còn sống.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `lib/bulk-mail`, chỉ giả database
 * và hàm gửi thư; đường đọc phân trang là hàng thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import {
  BULK_AUDIENCE_HINTS,
  BULK_AUDIENCE_LABELS,
  FIXED_BULK_AUDIENCES,
  isCvRejected,
  resolveAudienceChoice
} from "@/lib/bulk-mail-core";
import { countBulkRecipients, listBulkRecipients, runEmailBatch } from "@/lib/bulk-mail";

type Row = Record<string, unknown>;

/** Lọc eq/neq/in thật, phân trang keyset (gt + order + limit) và range. */
function fakeDb(tables: Record<string, Row[]>, failOn: string[] = []) {
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
        update: () => chain,
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
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
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
  return { client };
}

const S12 = "season-12";
const S11 = "season-11";

function app(id: string, over: Row = {}): Row {
  return {
    id,
    season_id: S12,
    person_id: null,
    full_name: `Bạn ${id}`,
    email_primary: `${id}@sv.ueh.edu.vn`,
    role_applied: "mentee",
    status: "screening_completed",
    ...over
  };
}

function review(appId: string, over: Row = {}): Row {
  return {
    id: `rv-${appId}-${String(over.status ?? "submitted")}`,
    application_id: appId,
    review_round: "profile_screening",
    status: "submitted",
    recommendation: "reject",
    total_score: 9,
    ...over
  };
}

/** Mỗi đơn là một lý do — tên đơn nói lý do đó. */
function tables(): Record<string, Row[]> {
  return {
    applications: [
      app("rot-reject"),
      app("rot-waitlist-duoi13", { status: "rejected_or_not_fit" }),
      app("reject-diem-cao", {}),
      app("waitlist-du-13"),
      app("pass-duoi-13"),
      app("da-moi-bi-khoa-link"),
      app("tung-giu-cho"),
      app("da-check-in"),
      app("dang-la-mentee", { person_id: "p-member" }),
      app("la-btc", { email_primary: "Core.Team@x.org" }),
      app("co-don-mentor-da-duyet", { email_primary: "mentor-too@x.org" }),
      app("mentor-cung-email", { role_applied: "mentor", status: "approved_as_mentor", email_primary: "MENTOR-TOO@x.org" }),
      app("con-phieu-dang-cham"),
      app("dang-duoc-moi", { status: "invited_to_interview" }),
      app("don-mentor-rot", { role_applied: "mentor" }),
      app("mua-cu", { season_id: S11 }),
      app("chua-co-phieu"),
      app("don-rut", { status: "withdrawn" })
    ],
    application_reviews: [
      review("rot-reject"),
      review("rot-waitlist-duoi13", { recommendation: "waitlist", total_score: 12 }),
      review("reject-diem-cao", { total_score: 21 }),
      review("waitlist-du-13", { recommendation: "waitlist", total_score: 13 }),
      review("pass-duoi-13", { recommendation: "pass_to_interview", total_score: 5 }),
      review("da-moi-bi-khoa-link", { total_score: 15 }),
      review("tung-giu-cho"),
      review("da-check-in"),
      review("dang-la-mentee"),
      review("la-btc"),
      review("co-don-mentor-da-duyet"),
      review("con-phieu-dang-cham"),
      review("con-phieu-dang-cham", { status: "assigned", recommendation: null, total_score: null }),
      review("dang-duoc-moi"),
      review("don-mentor-rot"),
      review("mua-cu"),
      review("don-rut"),
      review("chua-co-phieu", { status: "cancelled" }),
      // Phiếu phỏng vấn không phải phiếu vòng hồ sơ: một phiếu phỏng vấn còn mở
      // không được làm đơn này thôi "rớt vòng hồ sơ".
      review("rot-reject", { review_round: "interview", recommendation: null, total_score: null, status: "assigned", id: "rv-iv" })
    ],
    mentee_interview_invites: [{ id: "inv-1", application_id: "da-moi-bi-khoa-link" }],
    mentee_interview_bookings: [{ id: "bk-1", application_id: "tung-giu-cho", status: "cancelled" }],
    mentee_interview_operations: [{ id: "da-check-in" }],
    person_season_memberships: [
      { id: "m1", person_id: "p-member", season_id: S12, role: "mentee", status: "active" }
    ],
    admin_users: [{ id: "a1", email: "core.team@x.org", role: "core_team", status: "active" }],
    outbound_emails: [],
    events: [],
    person_season_invites: [],
    people: []
  };
}

function use(failOn: string[] = [], change: (t: Record<string, Row[]>) => void = () => {}) {
  const t = tables();
  change(t);
  const db = fakeDb(t, failOn);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
  return db;
}

/** Sáng 08/10: một lô của chính nhóm này đã gửi; kèm các lô KHÔNG được tính. */
function withEarlierBatches(t: Record<string, Row[]>) {
  t.email_batches = [
    { id: "lo-sang", season_id: S12, audience: "mentee_cv_rejected" },
    { id: "lo-mentee", season_id: S12, audience: "mentee" },
    { id: "lo-mua-cu", season_id: S11, audience: "mentee_cv_rejected" }
  ];
  t.outbound_emails = [
    // Đã nhận ở lô sáng → loại.
    { id: "o1", batch_id: "lo-sang", to_email: "ROT-REJECT@sv.ueh.edu.vn", related_id: "rot-reject", status: "sent" },
    // Gửi hỏng ở lô sáng → CHƯA nhận, lô sau phải gửi lại.
    { id: "o2", batch_id: "lo-sang", to_email: "rot-waitlist-duoi13@sv.ueh.edu.vn", related_id: "rot-waitlist-duoi13", status: "failed" },
    // Nhận một thư khác ở lô "Mentee" hay ở mùa cũ → không phải thư rớt mùa này.
    { id: "o3", batch_id: "lo-mentee", to_email: "reject-diem-cao@sv.ueh.edu.vn", related_id: "x", status: "sent" },
    { id: "o4", batch_id: "lo-mua-cu", to_email: "reject-diem-cao@sv.ueh.edu.vn", related_id: "y", status: "sent" }
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isCvRejected — luật rớt vòng hồ sơ", () => {
  const r = (recommendation: string | null, total_score: number | null, status = "submitted") => ({ status, recommendation, total_score });

  it("reject là rớt, bất kể điểm", () => {
    expect(isCvRejected([r("reject", 23)])).toBe(true);
  });
  it("đề xuất khác dưới 13 là rớt; đúng 13 thì không", () => {
    expect(isCvRejected([r("waitlist", 12)])).toBe(true);
    expect(isCvRejected([r("waitlist", 13)])).toBe(false);
    expect(isCvRejected([r("needs_admin_review", 0)])).toBe(true);
  });
  it("đề xuất mời phỏng vấn thì không bao giờ rớt, kể cả 0 điểm (reviewer quên nhập điểm)", () => {
    expect(isCvRejected([r("pass_to_interview", 0)])).toBe(false);
    expect(isCvRejected([r("reject", 5), r("pass_to_interview", 0)])).toBe(false);
  });
  it("chưa có phiếu đã nộp, hoặc còn phiếu đang chấm: chưa rớt", () => {
    expect(isCvRejected([])).toBe(false);
    expect(isCvRejected([r("reject", 5, "cancelled")])).toBe(false);
    expect(isCvRejected([r("reject", 5), r(null, null, "assigned")])).toBe(false);
    expect(isCvRejected([r("reject", 5), r(null, null, "returned_for_clarification")])).toBe(false);
  });
  it("đề xuất khác mà không có điểm: không đoán là rớt", () => {
    expect(isCvRejected([r("waitlist", null)])).toBe(false);
  });
});

describe("listBulkRecipients — mentee_cv_rejected", () => {
  it("chỉ đúng những người phiếu nói rớt và chưa từng bước vào vòng phỏng vấn", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_cv_rejected" });
    expect(result.error).toBeNull();
    expect(result.partition.sendable.map((row) => row.personId).sort()).toEqual(
      ["reject-diem-cao", "rot-reject", "rot-waitlist-duoi13"].sort()
    );
    expect(result.label).toBe("Mentee rớt vòng hồ sơ (CV)");
  });

  it("người nhận là ĐƠN: vai trò mentee, thư nối về applications", async () => {
    use();
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_cv_rejected" });
    for (const row of result.partition.sendable) {
      expect(row.role).toBe("mentee");
      expect(row.relationTable).toBe("applications");
    }
    const one = result.partition.sendable.find((row) => row.personId === "rot-reject")!;
    expect(one).toMatchObject({ fullName: "Bạn rot-reject", email: "rot-reject@sv.ueh.edu.vn" });
  });

  for (const table of [
    "applications",
    "application_reviews",
    "mentee_interview_invites",
    "mentee_interview_bookings",
    "mentee_interview_operations",
    "person_season_memberships",
    "admin_users"
  ]) {
    it(`đọc ${table} hỏng: báo lỗi, không trả danh sách thiếu phép loại`, async () => {
      use([table]);
      const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_cv_rejected" });
      expect(result.error).not.toBeNull();
      expect(result.partition.sendable).toEqual([]);
    });
  }
});

describe("đã nhận thư ở lô trước của nhóm này (BTC 08/10/2026)", () => {
  it("chỉ còn người CHƯA nhận: loại người đã nhận ở lô sáng; thư hỏng và thư của nhóm/mùa khác không tính", async () => {
    use([], withEarlierBatches);
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_cv_rejected" });
    expect(result.error).toBeNull();
    expect(result.partition.sendable.map((row) => row.personId).sort()).toEqual(["reject-diem-cao", "rot-waitlist-duoi13"]);
  });

  it("đã nhận rồi BTC sửa email của đơn: vẫn là người đã nhận (khớp theo đơn)", async () => {
    use([], (t) => {
      withEarlierBatches(t);
      t.applications = t.applications.map((a) => (a.id === "rot-reject" ? { ...a, email_primary: "email-moi@sv.ueh.edu.vn" } : a));
    });
    const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_cv_rejected" });
    expect(result.partition.sendable.map((row) => row.personId)).not.toContain("rot-reject");
  });

  it("số trên ô chọn đã trừ người đã nhận", async () => {
    use([], withEarlierBatches);
    const { counts } = await countBulkRecipients(S12);
    expect(counts.mentee_cv_rejected.sendable).toBe(2);
  });

  it("'Gửi tiếp' một lô đang chạy: chỉ gửi người lô đó chưa gửi, không ai nhận hai lá", async () => {
    use([], (t) => {
      t.email_batches = [{ id: "b1", season_id: S12, audience: "mentee_cv_rejected" }];
      t.outbound_emails = [{ id: "o1", batch_id: "b1", to_email: "rot-reject@sv.ueh.edu.vn", related_id: "rot-reject", status: "sent" }];
    });
    const run = await runEmailBatch({
      batch: {
        id: "b1", seasonId: S12, kind: "general_announcement", templateId: "t1", audience: "mentee_cv_rejected",
        audienceEventId: null, audienceCoversSeries: false, status: "running", requestedCount: 3, sentCount: 1,
        skippedCount: 0, failedCount: 0, note: null, createdAt: "", completedAt: null
      } as never,
      seasonCode: "UEHM-S12",
      subject: "Kết quả vòng Hồ sơ",
      body: "Chào bạn {{ten_nguoi_nhan}}."
    });
    expect(run.ok).toBe(true);
    const sentTo = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0].relation?.id).sort();
    expect(sentTo).toEqual(["reject-diem-cao", "rot-waitlist-duoi13"]);
    expect(run.remaining).toBe(0);
  });

  for (const table of ["email_batches", "outbound_emails"]) {
    it(`đọc ${table} hỏng: báo lỗi, không trả danh sách có thể gồm người đã nhận`, async () => {
      use([table], withEarlierBatches);
      const result = await listBulkRecipients({ seasonId: S12, audience: "mentee_cv_rejected" });
      expect(result.error).not.toBeNull();
      expect(result.partition.sendable).toEqual([]);
    });
  }
});

describe("màn hình và lô gửi", () => {
  it("nhóm có trong ô chọn, chọn từ form được, và có câu nói rõ là ai", () => {
    expect(FIXED_BULK_AUDIENCES).toContain("mentee_cv_rejected");
    expect(resolveAudienceChoice({ audience: "mentee_cv_rejected" })).toEqual({
      ok: true,
      choice: { audience: "mentee_cv_rejected", eventId: null, coversSeries: false }
    });
    expect(BULK_AUDIENCE_HINTS.mentee_cv_rejected).toContain("chưa từng được mời phỏng vấn");
  });

  it("nhóm 'Mentee' nói rõ là người ĐANG THAM GIA — không còn là một chữ 'Mentee' trơn", () => {
    expect(BULK_AUDIENCE_LABELS.mentee).not.toBe("Mentee");
    expect(BULK_AUDIENCE_LABELS.mentee).toContain("đang tham gia");
    expect(BULK_AUDIENCE_HINTS.mentee).toContain("ĐÃ ĐẬU");
  });

  it("số đếm trên màn hình bằng đúng số lệnh gửi tự dựng lại", async () => {
    use();
    const { counts, error } = await countBulkRecipients(S12);
    expect(error).toBeNull();
    expect(counts.mentee_cv_rejected.sendable).toBe(3);
  });

  it("lô dựng lại đúng danh sách và gửi đúng người, nối từng lá về đơn", async () => {
    use();
    const run = await runEmailBatch({
      batch: {
        id: "b1",
        seasonId: S12,
        kind: "general_announcement",
        templateId: "t1",
        audience: "mentee_cv_rejected",
        audienceEventId: null,
        audienceCoversSeries: false,
        status: "running",
        requestedCount: 3,
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        note: null,
        createdAt: "",
        completedAt: null
      } as never,
      seasonCode: "UEHM-S12",
      subject: "Kết quả vòng Hồ sơ",
      body: "Chào bạn {{ten_nguoi_nhan}}."
    });
    expect(run.ok).toBe(true);
    const calls = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.relation?.id).sort()).toEqual(["reject-diem-cao", "rot-reject", "rot-waitlist-duoi13"].sort());
    for (const call of calls) expect(call.relation?.table).toBe("applications");
    expect(calls.map((call) => call.toEmail)).not.toContain("core.team@x.org");
  });
});
