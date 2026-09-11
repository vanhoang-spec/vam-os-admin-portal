/**
 * Dữ liệu màn hình /participant-accounts.
 *
 * Tính chất cần khoá: một phép đọc hỏng KHÔNG BAO GIỜ hiện ra thành một mùa
 * toàn "chưa mời". Người vận hành tin con số đó và gửi lại thư cho những người
 * đang dùng tài khoản.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/season-cohort", () => ({ getSeasonCohortRoleMap: vi.fn() }));

import { loadLoginInviteRoster } from "@/lib/login-invite-roster";
import { getSeasonCohortRoleMap } from "@/lib/season-cohort";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb, fakeClient, requestsFor, type FakeDb } from "./support/fake-postgrest";

const SEASON = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-11T03:00:00.000Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: FakeDb;

function cohort(ids: string[], role: "mentor" | "mentee" = "mentor") {
  vi.mocked(getSeasonCohortRoleMap).mockResolvedValue({
    data: new Map(ids.map((personId) => [personId, [role]])),
    error: null
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createFakeDb();
  db.tables.people = [];
  db.tables.account_person_auth_links = [];
  db.tables.outbound_emails = [];
  db.tables.admin_users = [];
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
});

describe("không hiện số sai", () => {
  it("không có client service-role thì báo lỗi", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);
    cohort([id(1)]);
    expect((await loadLoginInviteRoster(SEASON, NOW)).ok).toBe(false);
  });

  it("không đọc được thành viên của mùa thì báo lỗi", async () => {
    vi.mocked(getSeasonCohortRoleMap).mockResolvedValue({ data: new Map(), error: "hỏng" });
    expect((await loadLoginInviteRoster(SEASON, NOW)).ok).toBe(false);
  });

  it.each(["account_person_auth_links", "outbound_emails", "people", "admin_users"])(
    "đọc %s hỏng thì cả trang báo lỗi, không trả danh sách",
    async (table) => {
      cohort([id(1)]);
      db.tables.people = [{ id: id(1), full_name: "An", email_primary: "an@example.com" }];
      db.errors[table] = { code: "57014", message: "statement timeout" };

      const roster = await loadLoginInviteRoster(SEASON, NOW);

      expect(roster).toEqual({ ok: false, error: expect.stringContaining("tránh báo sai") });
    }
  );
});

describe("trạng thái đọc từ đúng nguồn", () => {
  it("mối nối chưa đăng nhập + thư đã gửi là 'đã gửi thư, chưa vào', không phải 'đã vào'", async () => {
    cohort([id(1)]);
    db.tables.people = [{ id: id(1), full_name: "An", email_primary: "an@example.com" }];
    db.tables.account_person_auth_links = [
      { id: "l1", person_id: id(1), auth_user_id: "auth-1", status: "active", activated_at: null }
    ];
    db.tables.outbound_emails = [
      { id: "e1", kind: "participant_invite", related_table: "people", related_id: id(1), status: "sent", created_at: "2026-09-10T01:00:00Z", error: null }
    ];

    const roster = await loadLoginInviteRoster(SEASON, NOW);

    expect(roster.ok && roster.rows[0].status).toBe("invited_pending");
  });

  it("một thư thông báo chung gửi cho người này không phải thư mời", async () => {
    cohort([id(1)]);
    db.tables.people = [{ id: id(1), full_name: "An", email_primary: "an@example.com" }];
    db.tables.outbound_emails = [
      { id: "e1", kind: "general_announcement", related_table: "people", related_id: id(1), status: "sent", created_at: "2026-09-10T01:00:00Z", error: null }
    ];

    const roster = await loadLoginInviteRoster(SEASON, NOW);

    expect(roster.ok && roster.rows[0].status).toBe("not_invited");
    const request = requestsFor(db, "outbound_emails")[0];
    expect(request.filters).toContain('"column":"kind","value":"participant_invite"');
    expect(request.filters).toContain('"column":"related_table","value":"people"');
  });

  it("email trùng với một tài khoản nhân sự thì không mời được", async () => {
    cohort([id(1)]);
    db.tables.people = [{ id: id(1), full_name: "An", email_primary: "AN@example.com" }];
    db.tables.admin_users = [{ id: "a1", email: "an@example.com" }];

    const roster = await loadLoginInviteRoster(SEASON, NOW);

    expect(roster.ok && roster.rows[0]).toMatchObject({ status: "blocked", blockReason: "is_staff" });
  });
});

describe("mùa lớn", () => {
  it("1.050 người, trần mỗi trang thấp hơn cỡ một khối: vẫn đọc đủ, không trùng", async () => {
    db = createFakeDb({ maxRows: 150 });
    const ids = Array.from({ length: 1050 }, (_, index) => id(index + 1));
    db.tables.people = ids.map((personId, index) => ({ id: personId, full_name: `Người ${index}`, email_primary: `p${index}@example.com` }));
    db.tables.account_person_auth_links = ids.map((personId, index) => ({
      id: `link-${String(index).padStart(6, "0")}`,
      person_id: personId,
      auth_user_id: `auth-${index}`,
      status: "active",
      activated_at: "2026-09-01T00:00:00Z"
    }));
    db.tables.outbound_emails = [];
    db.tables.admin_users = [];
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
    cohort(ids);

    const roster = await loadLoginInviteRoster(SEASON, NOW);

    expect(roster.ok).toBe(true);
    if (!roster.ok) return;
    expect(roster.rows).toHaveLength(1050);
    expect(roster.summary.active).toBe(1050);
    expect(roster.rows.find((row) => row.personId === id(1050))?.status).toBe("active");
  });
});
