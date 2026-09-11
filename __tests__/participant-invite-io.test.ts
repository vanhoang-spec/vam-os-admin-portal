/**
 * Lời mời tài khoản — đường có I/O: đọc gì, ghi gì, theo thứ tự nào, và khi nào
 * KHÔNG ghi gì cả.
 *
 * Mọi lệnh ghi và mọi lời gọi ra ngoài (giữ chỗ, tạo link, ghi mối nối, gửi,
 * ghi nhật ký) đẩy vào CÙNG một mảng `h.log`, để một ca có thể khẳng định thứ
 * tự thật chứ không chỉ "có gọi".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  log: [] as string[],
  actor: null as any,
  actorError: null as unknown,
  scope: { scopeError: null } as any,
  canOperate: true,
  gate: true,
  origin: "https://os.example.org" as string | null,
  countResult: { ok: true, count: 0 } as any,
  sends: new Map<string, any[]>(),
  claimResult: { ok: true, claimId: "claim-1" } as any,
  sendResult: { ok: true, skipped: false } as any,
  sendInputs: [] as any[],
  directoryUsers: [] as Array<{ id: string; email: string }>,
  directoryError: null as unknown
}));

vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(async () => {
    if (h.actorError) throw h.actorError;
    return h.actor;
  })
}));
vi.mock("@/lib/program-scope", () => ({
  SCOPE_RESOLUTION_ERROR: "SCOPE_ERR",
  getAdminScopeContext: vi.fn(async () => h.scope),
  canOperateSeason: vi.fn(async () => h.canOperate)
}));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => h.origin) }));
vi.mock("@/lib/email-core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  evaluateEmailGate: () =>
    h.gate ? { canSend: true, provider: "brevo", apiKey: "k", from: "a@b.vn" } : { canSend: false, reason: "tắt" }
}));
vi.mock("@/lib/email", () => ({
  resolveEmailBaseUrl: (origin?: string | null) => String(origin ?? "").replace(/\/+$/, ""),
  claimParticipantInviteSend: vi.fn(async (input: { personId: string }) => {
    h.log.push(`claim:${input.personId}`);
    return h.claimResult;
  }),
  releaseOutboundEmailClaim: vi.fn(async (id: string, reason: string) => {
    h.log.push(`release:${id}:${reason}`);
  }),
  expireStaleParticipantInviteClaims: vi.fn(async () => {
    h.log.push("expire");
  }),
  sendParticipantInvite: vi.fn(async (input: any) => {
    h.log.push(`send:${input.personId}:${input.linkType}`);
    h.sendInputs.push(input);
    return h.sendResult;
  })
}));
vi.mock("@/lib/outbound-emails", () => ({
  countOutboundEmailsSince: vi.fn(async () => {
    h.log.push("count");
    return h.countResult;
  }),
  readParticipantInviteSends: vi.fn(async (ids: string[]) => ({
    ok: true,
    byPersonId: new Map(ids.map((id) => [id, h.sends.get(id) ?? []]))
  }))
}));
vi.mock("@/lib/enable-reviewer", () => {
  class AuthDirectory {
    private users: Array<{ id: string; email: string }>;
    constructor(users: Array<{ id: string; email: string }>) {
      this.users = users;
    }
    static async load() {
      h.log.push("directory");
      if (h.directoryError) throw h.directoryError;
      return new AuthDirectory(h.directoryUsers);
    }
    usersWithEmail(email: string) {
      return this.users.filter((user) => user.email === String(email).trim().toLowerCase());
    }
  }
  return { AuthDirectory };
});
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { inviteParticipantAccount, inviteParticipantsInSeason } from "@/lib/participant-invites";

const SEASON = "11111111-1111-4111-8111-111111111111";
const OTHER_SEASON = "22222222-2222-4222-8222-222222222222";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = uuid(1);
const P2 = uuid(2);
const P3 = uuid(3);

type Row = Record<string, unknown>;

function makeDb(init: { people?: Row[]; memberships?: Row[]; links?: Row[]; staff?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    people: init.people ?? [],
    person_season_memberships: init.memberships ?? [],
    account_person_auth_links: init.links ?? [],
    admin_users: init.staff ?? [],
    admin_audit_log: []
  };
  const errors: Record<string, { code?: string; message: string } | undefined> = {};
  /** Dòng xuất hiện ĐÚNG lúc một lệnh chèn bị từ chối — mô phỏng một lượt khác vừa ghi trước. */
  const raceRows: Record<string, Row | undefined> = {};
  const reads: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const inserts: Array<{ table: string; row: Row }> = [];

  function query(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let limit: number | null = null;
    const run = () => {
      reads.push({ table, filters: [...filters] });
      const error = errors[`read:${table}`];
      if (error) return { data: null, error };
      let rows = tables[table].filter((row) =>
        filters.every(([op, column, value]) => {
          if (op === "eq") return row[column] === value;
          if (op === "in") return (value as unknown[]).includes(row[column]);
          if (op === "ilike") {
            const plain = String(value).replace(/\\(.)/g, "$1");
            return String(row[column] ?? "").toLowerCase() === plain.toLowerCase();
          }
          return true;
        })
      );
      if (limit !== null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), builder),
      in: (column: string, value: unknown) => (filters.push(["in", column, value]), builder),
      ilike: (column: string, value: unknown) => (filters.push(["ilike", column, value]), builder),
      limit: (count: number) => ((limit = count), builder),
      maybeSingle: () => {
        const result = run();
        return Promise.resolve({ data: result.error ? null : (result.data as Row[])[0] ?? null, error: result.error });
      },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject)
    };
    return builder;
  }

  const generateLink = vi.fn(async ({ type, email }: { type: string; email: string }) => {
    h.log.push(`generateLink:${type}`);
    const existing = h.directoryUsers.find((user) => user.email === email);
    return {
      data: { user: { id: existing?.id ?? `auth:${email}`, email }, properties: { hashed_token: "hash-1", verification_type: type } },
      error: null
    };
  });
  const inviteUserByEmail = vi.fn();

  const client = {
    from: (table: string) => ({
      select: () => query(table),
      insert: (row: Row) => {
        h.log.push(`insert:${table}`);
        inserts.push({ table, row });
        const error = errors[`insert:${table}`] ?? null;
        if (error && raceRows[table]) tables[table].push(raceRows[table] as Row);
        if (!error) tables[table].push(row);
        return Promise.resolve({ data: null, error });
      }
    }),
    auth: { admin: { generateLink, inviteUserByEmail } }
  };

  return { client, tables, errors, raceRows, reads, inserts, generateLink, inviteUserByEmail };
}

const person = (id: string, email: string, name = "Nguyễn Văn An") => ({ id, full_name: name, email_primary: email });
const member = (personId: string, seasonId = SEASON, role = "mentor", status = "active") => ({
  person_id: personId,
  season_id: seasonId,
  role,
  status
});

const actor = (role: string) => ({
  id: "admin-1",
  email: "admin@vam.org",
  full_name: "Admin",
  role,
  status: "active",
  auth_user_id: null
});

let fake: ReturnType<typeof makeDb>;

function useDb(db: ReturnType<typeof makeDb>) {
  fake = db;
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
}

beforeEach(() => {
  h.log.length = 0;
  h.sendInputs.length = 0;
  h.actor = actor("admin");
  h.actorError = null;
  h.scope = { scopeError: null };
  h.canOperate = true;
  h.gate = true;
  h.origin = "https://os.example.org";
  h.countResult = { ok: true, count: 0 };
  h.sends = new Map();
  h.claimResult = { ok: true, claimId: "claim-1" };
  h.sendResult = { ok: true, skipped: false };
  h.directoryUsers = [];
  h.directoryError = null;
  useDb(makeDb({ people: [person(P1, "An@Example.com")], memberships: [member(P1)] }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const invite = (mode: "invite" | "reset" = "invite", personId = P1) =>
  inviteParticipantAccount({ personId, seasonId: SEASON, mode });

const writes = () => h.log.filter((entry) => /^(claim|generateLink|insert|send|release)/.test(entry));

describe("cổng quyền: từ chối trước khi đọc bất cứ gì", () => {
  it("support_team KHÔNG có quyền vận hành mùa này", async () => {
    h.actor = actor("support_team");
    h.canOperate = false;

    const result = await invite();

    expect(result.outcome).toBe("refused");
    expect(result.message).toBe("Bạn không có quyền vận hành mùa này.");
    expect(fake.reads).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it("support_team CÓ quyền vận hành mùa này thì mời được", async () => {
    h.actor = actor("support_team");
    const result = await invite();
    expect(result.outcome).toBe("sent");
  });

  it.each(["viewer", "reviewer"])("%s bị từ chối", async (role) => {
    h.actor = actor(role);
    const result = await invite();
    expect(result.message).toBe("Bạn không có quyền gửi lời mời tài khoản.");
    expect(fake.reads).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it("không đọc được phạm vi thì từ chối, không đoán", async () => {
    h.scope = { scopeError: "hỏng" };
    const result = await invite();
    expect(result.message).toBe("SCOPE_ERR");
    expect(h.log).toEqual([]);
  });

  it("không đọc được người đang đăng nhập thì từ chối", async () => {
    h.actorError = new Error("cookie hỏng");
    const result = await invite();
    expect(result.outcome).toBe("refused");
    expect(h.log).toEqual([]);
  });
});

describe("đúng mùa", () => {
  it("phép đọc tư cách thành viên lọc đúng mùa đang mời", async () => {
    await invite();
    const membershipRead = fake.reads.find((read) => read.table === "person_season_memberships");
    expect(membershipRead?.filters).toContainEqual(["eq", "season_id", SEASON]);
  });

  it("người chỉ thuộc mùa khác thì không tạo link, không giữ chỗ", async () => {
    useDb(makeDb({ people: [person(P1, "an@example.com")], memberships: [member(P1, OTHER_SEASON)] }));

    const result = await invite();

    expect(result.reason).toBe("not_in_season");
    expect(writes()).toEqual([]);
  });
});

describe("đường thuận: đúng thứ tự ghi", () => {
  it("giữ chỗ → tạo link → ghi mối nối → gửi → ghi nhật ký", async () => {
    const result = await invite();

    expect(result).toMatchObject({ outcome: "sent", ok: true, emailSent: true, linkType: "invite" });
    expect(writes()).toEqual([
      `claim:${P1}`,
      "generateLink:invite",
      "insert:account_person_auth_links",
      `send:${P1}:invite`,
      "insert:admin_audit_log"
    ]);
    expect(fake.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("mối nối ghi đúng các cột, không hơn", async () => {
    await invite();
    const link = fake.inserts.find((entry) => entry.table === "account_person_auth_links")?.row;
    expect(Object.keys(link ?? {}).sort()).toEqual(
      ["auth_user_id", "created_by", "invited_at", "link_source", "person_id", "status"].sort()
    );
    expect(link).toMatchObject({
      auth_user_id: "auth:an@example.com",
      person_id: P1,
      status: "active",
      link_source: "invite",
      created_by: "admin-1"
    });
  });

  it("thư nhận mã băm và chỗ đã giữ; email lấy từ danh bạ, đã chuẩn hoá", async () => {
    await invite();
    expect(h.sendInputs[0]).toMatchObject({
      toEmail: "an@example.com",
      tokenHash: "hash-1",
      claimedRowId: "claim-1",
      linkType: "invite",
      requestOrigin: "https://os.example.org"
    });
  });

  it("nhật ký không chứa email, tên hay mã băm", async () => {
    await invite();
    const audit = fake.inserts.find((entry) => entry.table === "admin_audit_log")?.row as Row;
    expect(audit).toMatchObject({ actor_admin_user_id: "admin-1", action_type: "participant_account_invite" });
    const details = JSON.stringify(audit.details);
    expect(details).not.toContain("an@example.com");
    expect(details).not.toContain("hash-1");
    expect(details).not.toContain("Nguyễn");
  });
});

describe("không có lá thư nào đi thì không báo là đã gửi", () => {
  it("cổng thư tắt: không giữ chỗ, không tạo link, không ghi gì", async () => {
    h.gate = false;

    const result = await invite();

    expect(result).toMatchObject({ outcome: "not_sent_gate_closed", ok: false, emailSent: false });
    expect(writes()).toEqual([]);
    expect(h.log).not.toContain("expire");
    expect(h.log).not.toContain("count");
  });

  it("nhà cung cấp trả `skipped` thì không phải đã gửi", async () => {
    h.sendResult = { ok: true, skipped: true };
    const result = await invite();
    expect(result).toMatchObject({ outcome: "not_sent_gate_closed", ok: false, emailSent: false });
  });

  it("Brevo trả 429: thư lỗi vì hết hạn mức, mối nối vẫn đã ghi", async () => {
    h.sendResult = { ok: false, skipped: false, providerStatus: 429 };

    const result = await invite();

    expect(result).toMatchObject({ outcome: "send_failed", ok: false, quota: true });
    expect(result.message).toContain("hạn mức");
    expect(h.log).toContain("insert:account_person_auth_links");
  });
});

describe("mối nối", () => {
  it("23505 mà tài khoản đang nối với NGƯỜI KHÁC: không gửi, huỷ chỗ giữ", async () => {
    fake.errors["insert:account_person_auth_links"] = { code: "23505", message: "trùng" };
    fake.raceRows.account_person_auth_links = {
      auth_user_id: "auth:an@example.com",
      person_id: "nguoi-khac",
      status: "active",
      activated_at: null
    };

    const result = await invite();

    expect(result.reason).toBe("auth_linked_to_other_person");
    expect(h.log.some((entry) => entry.startsWith("send:"))).toBe(false);
    expect(h.log.some((entry) => entry.startsWith("release:claim-1"))).toBe(true);
  });

  it("23505 mà đọc lại thấy đúng cặp: gửi bình thường", async () => {
    fake.errors["insert:account_person_auth_links"] = { code: "23505", message: "trùng" };
    fake.raceRows.account_person_auth_links = {
      auth_user_id: "auth:an@example.com",
      person_id: P1,
      status: "active",
      activated_at: null
    };

    expect((await invite()).outcome).toBe("sent");
  });

  it("lỗi ghi khác 23505: không gửi", async () => {
    fake.errors["insert:account_person_auth_links"] = { code: "23503", message: "khoá ngoại" };
    const result = await invite();
    expect(result.outcome).toBe("failed");
    expect(h.log.some((entry) => entry.startsWith("send:"))).toBe(false);
  });

  it("người đã đăng nhập: không ghi gì, không tạo link", async () => {
    h.directoryUsers = [{ id: "auth-1", email: "an@example.com" }];
    const link = { auth_user_id: "auth-1", person_id: P1, status: "active", activated_at: "2026-09-01T00:00:00.000Z" };
    useDb(makeDb({ people: [person(P1, "an@example.com")], memberships: [member(P1)], links: [link] }));

    const result = await invite();

    expect(result.outcome).toBe("already_active");
    expect(writes()).toEqual([]);
  });

  it("đặt lại mật khẩu cho người đã vào: link khôi phục, không ghi mối nối", async () => {
    h.directoryUsers = [{ id: "auth-1", email: "an@example.com" }];
    const link = { auth_user_id: "auth-1", person_id: P1, status: "active", activated_at: "2026-09-01T00:00:00.000Z" };
    useDb(makeDb({ people: [person(P1, "an@example.com")], memberships: [member(P1)], links: [link] }));

    const result = await invite("reset");

    expect(result.outcome).toBe("sent");
    expect(writes()).toEqual([`claim:${P1}`, "generateLink:recovery", `send:${P1}:recovery`, "insert:admin_audit_log"]);
  });

  it("đã nối mà chưa vào: link khôi phục, không ghi mối nối lần nữa", async () => {
    h.directoryUsers = [{ id: "auth-1", email: "an@example.com" }];
    const link = { auth_user_id: "auth-1", person_id: P1, status: "active", activated_at: null };
    useDb(makeDb({ people: [person(P1, "an@example.com")], memberships: [member(P1)], links: [link] }));

    await invite();

    expect(h.log).toContain("generateLink:recovery");
    expect(h.log).not.toContain("insert:account_person_auth_links");
  });
});

describe("link vừa tạo không khớp thì không gửi", () => {
  it("link thuộc tài khoản khác tài khoản đã biết", async () => {
    h.directoryUsers = [{ id: "auth-1", email: "an@example.com" }];
    fake.generateLink.mockResolvedValueOnce({
      data: { user: { id: "auth-9", email: "an@example.com" }, properties: { hashed_token: "hash-1", verification_type: "recovery" } },
      error: null
    } as never);

    const result = await invite();

    expect(result.outcome).toBe("failed");
    expect(h.log.some((entry) => entry.startsWith("send:"))).toBe(false);
    expect(h.log).not.toContain("insert:account_person_auth_links");
    expect(h.log.some((entry) => entry.startsWith("release:claim-1"))).toBe(true);
  });

  it("Supabase báo email đã có tài khoản (một lượt khác vừa tạo): báo tải lại", async () => {
    fake.generateLink.mockResolvedValueOnce({ data: null, error: { code: "email_exists", message: "exists" } } as never);

    const result = await invite();

    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("Tải lại");
    expect(h.log).not.toContain("insert:account_person_auth_links");
  });
});

describe("không chắc thì không mời", () => {
  it("chưa đọc hết danh bạ Auth: không giữ chỗ, không tạo link", async () => {
    h.directoryError = new Error("AuthLookupIncomplete");
    const result = await invite();
    expect(result.outcome).toBe("failed");
    expect(writes()).toEqual([]);
  });

  it("một lượt khác đang giữ chỗ: không tạo link", async () => {
    h.claimResult = { ok: false, reason: "in_flight" };
    const result = await invite();
    expect(result.reason).toBe("in_flight");
    expect(h.log).not.toContain("generateLink:invite");
  });

  it("dò email trùng bằng ilike đã thoát ký tự đại diện", async () => {
    useDb(makeDb({ people: [person(P1, "nguyen_van@x.vn")], memberships: [member(P1)] }));
    await invite();
    const probe = fake.reads.find((read) => read.table === "people" && read.filters.some(([op]) => op === "ilike"));
    expect(probe?.filters).toContainEqual(["ilike", "email_primary", "nguyen\\_van@x.vn"]);
  });

  it("nhân sự đã khoá vẫn là nhân sự: đọc admin_users KHÔNG lọc trạng thái", async () => {
    useDb(
      makeDb({
        people: [person(P1, "an@example.com")],
        memberships: [member(P1)],
        staff: [{ email: "AN@example.com", auth_user_id: null, status: "inactive" }]
      })
    );

    const result = await invite();

    expect(result.reason).toBe("is_staff");
    const staffRead = fake.reads.find((read) => read.table === "admin_users");
    expect(staffRead?.filters.some(([, column]) => column === "status")).toBe(false);
  });

  it("không đếm được thư đã gửi thì dừng trước khi làm gì", async () => {
    h.countResult = { ok: false };
    const result = await invite();
    expect(result.outcome).toBe("failed");
    expect(writes()).toEqual([]);
  });
});

describe("mời hàng loạt", () => {
  function threePeople() {
    useDb(
      makeDb({
        people: [person(P1, "p1@example.com", "Một"), person(P2, "p2@example.com", "Hai"), person(P3, "p3@example.com", "Ba")],
        memberships: [member(P1), member(P2), member(P3, OTHER_SEASON)]
      })
    );
  }

  it("đọc danh bạ Auth đúng một lần cho cả lượt; người mùa khác bị từ chối", async () => {
    threePeople();

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1, P2, P3] });

    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(h.log.filter((entry) => entry === "directory")).toHaveLength(1);
    expect(batch.results.map((result) => result.outcome)).toEqual(["sent", "sent", "refused"]);
    expect(batch.results[2].reason).toBe("not_in_season");
  });

  it("người đã từng nhận thư thì lượt hàng loạt bỏ qua, không tạo link", async () => {
    threePeople();
    h.sends.set(P1, [{ status: "sent", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1] });

    expect(batch.ok && batch.results[0].reason).toBe("bulk_already_invited");
    expect(h.log.some((entry) => entry.startsWith("generateLink"))).toBe(false);
  });

  it("tối đa 20 người một lượt; id trùng và id hỏng bị bỏ", async () => {
    const ids = Array.from({ length: 25 }, (_, index) => uuid(index + 1));
    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [...ids, "khong-phai-uuid", ids[0]] });

    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.results).toHaveLength(20);
    expect(batch.remainingPersonIds).toEqual(ids.slice(20));
  });

  it("đã chạm hạn mức: dừng trước khi giữ chỗ cho ai", async () => {
    threePeople();
    h.countResult = { ok: true, count: 240 };

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1, P2] });

    expect(batch.ok && batch.stoppedBy).toBe("daily_budget");
    expect(batch.ok && batch.results).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("Brevo báo hết hạn mức giữa lượt: dừng ngay", async () => {
    threePeople();
    h.sendResult = { ok: false, skipped: false, providerStatus: 429 };

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1, P2] });

    expect(batch.ok && batch.stoppedBy).toBe("daily_budget");
    expect(h.log.filter((entry) => entry.startsWith("send:"))).toHaveLength(1);
  });

  it("ba thư lỗi liên tiếp: dừng", async () => {
    const ids = Array.from({ length: 5 }, (_, index) => uuid(index + 1));
    useDb(
      makeDb({
        people: ids.map((id, index) => person(id, `p${index}@example.com`)),
        memberships: ids.map((id) => member(id))
      })
    );
    h.sendResult = { ok: false, skipped: false, providerStatus: 500 };

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: ids });

    expect(batch.ok && batch.stoppedBy).toBe("send_failures");
    expect(h.log.filter((entry) => entry.startsWith("send:"))).toHaveLength(3);
  });

  it("hết ngân sách thời gian: dừng, người còn lại trả về để lượt sau", async () => {
    threePeople();
    let clock = 0;
    const now = () => (clock += 20_000);

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1, P2], now });

    expect(batch.ok && batch.stoppedBy).toBe("time_budget");
    expect(batch.ok && batch.results).toHaveLength(1);
    expect(batch.ok && batch.remainingPersonIds).toEqual([P2]);
  });

  it("cổng thư tắt: dừng, không giữ chỗ cho ai", async () => {
    threePeople();
    h.gate = false;

    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1, P2] });

    expect(batch.ok && batch.stoppedBy).toBe("gate_closed");
    expect(writes()).toEqual([]);
  });

  it("không có quyền vận hành mùa: từ chối cả lượt, không đọc gì", async () => {
    h.canOperate = false;
    const batch = await inviteParticipantsInSeason({ seasonId: SEASON, personIds: [P1] });
    expect(batch).toEqual({ ok: false, message: "Bạn không có quyền vận hành mùa này." });
    expect(fake.reads).toEqual([]);
  });
});
