/**
 * Cấp lại quyền tuyển sinh khi tài khoản đăng nhập cũ đã bị xoá.
 *
 * 18/09/2026, production: một mentor có dòng `admin_users` trỏ tới một `auth.users`
 * không còn tồn tại. Mỗi lần bấm "Cấp quyền đánh giá": app tạo tài khoản mới, RPC cấp
 * quyền thấy email đã gắn Auth id khác nên từ chối, app xoá tài khoản vừa tạo, màn
 * hình hiện đúng một câu "vui lòng thử lại". Bấm lại bao nhiêu lần cũng vậy.
 *
 * Canh hai thứ: app nhờ database gỡ liên kết đã chết TRƯỚC khi cấp quyền (và database
 * chỉ gỡ khi nó đã chết), và mọi lý do bị từ chối đều hiện thành câu người bấm nút
 * hiểu được thay vì một câu chung chung.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "os.alumni-mentoring.edu.vn", "x-forwarded-proto": "https" })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ canOperateSeason: vi.fn(), getAdminScopeContext: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendReviewerInvite: vi.fn() }));
vi.mock("@/lib/outbound-emails", () => ({ hasRecentSentEmail: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { enableMentorAsReviewer } from "@/lib/enable-reviewer";
import { sendReviewerInvite } from "@/lib/email";
import { hasRecentSentEmail } from "@/lib/outbound-emails";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const SEASON_ID = "22222222-2222-2222-2222-222222222222";
const ACTOR_ID = "33333333-3333-3333-3333-333333333333";
const TARGET_EMAIL = "target.person@example.com";
const SAFE_ERROR = "Không thể cấp quyền tham gia tuyển sinh. Vui lòng thử lại hoặc liên hệ admin.";
const CLEAR_RPC = "vam084_clear_stale_recruitment_auth_link";
const GRANT_RPC = "vam084_grant_recruitment_participation";

const MIGRATION = "supabase/migrations/20260918100000_reviewer_stale_auth_link.sql";
const sql = readFileSync(MIGRATION, "utf8");
const sqlCode = sql
  .split(String.fromCharCode(10))
  .map((line) => line.replace(/--.*$/, ""))
  .join(String.fromCharCode(10));

describe("1. migration: hàm gỡ liên kết Auth đã chết", () => {
  it("chỉ gỡ khi tài khoản đăng nhập KHÔNG còn trong auth.users", () => {
    const body = sqlCode.slice(sqlCode.indexOf("create or replace function"), sqlCode.indexOf("alter function"));
    const guard = body.indexOf("if exists (select 1 from auth.users u where u.id = v_auth_user_id) then");
    expect(guard).toBeGreaterThan(-1);
    expect(body.slice(guard, guard + 120)).toContain("return false;");
    expect(guard).toBeLessThan(body.indexOf("update public.admin_users"));
  });

  it("gỡ đúng dòng đã đọc, và chỉ cột auth_user_id", () => {
    const update = sqlCode.slice(sqlCode.indexOf("update public.admin_users"), sqlCode.indexOf("if not found"));
    expect(update).toContain("set auth_user_id = null");
    expect(update).toContain("where id = v_admin_id");
    expect(update).toContain("and auth_user_id = v_auth_user_id");
    expect(update).not.toMatch(/role|status|email/);
    expect(sqlCode.match(/update public[.]/g)).toHaveLength(1);
    expect(sqlCode).not.toMatch(/delete\s+from/i);
  });

  it("cùng cổng quyền với lệnh cấp quyền, kiểm trước mọi phép đọc", () => {
    const body = sqlCode.slice(sqlCode.indexOf("create or replace function"));
    const gate = body.indexOf("vam084_staffing_operator_for_season(p_actor, p_season_id)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf("from public.people"));
    expect(body.slice(gate, gate + 160)).toContain("raise exception");
  });

  it("SECURITY DEFINER với search_path ghim, vì service_role không đọc được auth.users", () => {
    const body = sqlCode.slice(sqlCode.indexOf("create or replace function"), sqlCode.indexOf("alter function"));
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path to ''");
  });

  it("chỉ service_role chạy được; anon và authenticated bị thu hồi", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sqlCode).toContain(`from ${role};`);
    }
    expect(sqlCode).toContain("grant execute on function public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) to service_role;");
    const check = sqlCode.slice(sqlCode.indexOf("do $self_check$"));
    expect(check).toContain("v_acl not like '%service_role=X%'");
    expect(check).toContain("v_acl like '%anon=X%'");
    expect(check).toContain("prosecdef");
  });

  it("ghi lại mỗi lần gỡ, dùng đúng loại hành động đã có", () => {
    expect(sqlCode).toContain("insert into public.admin_audit_log");
    expect(sqlCode).toContain("'update_admin_user_access'");
    expect(sqlCode).toContain("'operation', 'clear_stale_auth_link'");
  });

  it("một transaction, có lock_timeout, không có dấu gạch chéo ngược", () => {
    expect(sqlCode.trim().startsWith("begin;")).toBe(true);
    expect(sqlCode.trim().endsWith("commit;")).toBe(true);
    expect(sqlCode).toContain("set local lock_timeout = '10s';");
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
  });
});

describe("2. app: gỡ liên kết hỏng rồi mới cấp quyền", () => {
  function buildClient(options: { rpcByName?: Record<string, { data?: unknown; error?: unknown }> } = {}) {
    const rpc = vi.fn(async (name: string) => {
      const result = options.rpcByName?.[name];
      if (result) return { data: result.data ?? null, error: result.error ?? null };
      return { data: name === GRANT_RPC ? "admin-user-1" : true, error: null };
    });
    const deleteUser = vi.fn(async () => ({ data: null, error: null }));
    const client: any = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () =>
          table === "seasons"
            ? { data: { code: "UEHM-S12", name: "UEH Mentoring Season 12" }, error: null }
            : { data: { id: PERSON_ID, full_name: "Target Person", email_primary: TARGET_EMAIL }, error: null }
        )
      })),
      auth: {
        admin: {
          // Danh bạ rỗng: đúng cảnh production — tài khoản đăng nhập của người này đã bị xoá.
          listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
          generateLink: vi.fn(async ({ type }: { type: string }) => ({
            data: { user: { id: "auth-invited", email: TARGET_EMAIL }, properties: { hashed_token: `hash-${type}` } },
            error: null
          })),
          deleteUser
        }
      },
      rpc
    };
    return { client, rpc, deleteUser };
  }

  const grant = () =>
    enableMentorAsReviewer({ personId: PERSON_ID, seasonId: SEASON_ID, participationRole: "reviewer" });

  const namesOf = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls.map((call) => call[0]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR_ID, role: "support_team", email: "support@example.com" } as any);
    vi.mocked(getAdminScopeContext).mockResolvedValue({} as any);
    vi.mocked(canOperateSeason).mockResolvedValue(true as any);
    vi.mocked(sendReviewerInvite).mockResolvedValue({ ok: true, skipped: false } as any);
    vi.mocked(hasRecentSentEmail).mockResolvedValue({ ok: true, found: false } as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("nhờ database gỡ liên kết đã chết TRƯỚC khi cấp quyền, với actor của phiên", async () => {
    const { client, rpc } = buildClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    await expect(grant()).resolves.toMatchObject({ ok: true });

    expect(namesOf(rpc)).toEqual([CLEAR_RPC, GRANT_RPC]);
    expect(rpc).toHaveBeenNthCalledWith(1, CLEAR_RPC, {
      p_actor: ACTOR_ID,
      p_person_id: PERSON_ID,
      p_season_id: SEASON_ID
    });
  });

  it("phép kiểm liên kết hỏng không chặn lượt cấp quyền", async () => {
    const { client, rpc } = buildClient({ rpcByName: { [CLEAR_RPC]: { error: { message: "boom" } } } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    await expect(grant()).resolves.toMatchObject({ ok: true });
    expect(namesOf(rpc)).toContain(GRANT_RPC);
  });

  it("không có quyền vận hành mùa: không gọi tới database", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false as any);
    const { client, rpc } = buildClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    await expect(grant()).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["Account email is linked to a different Auth identity", "Email này đang gắn với một tài khoản đăng nhập khác. Nhờ admin rà lại tài khoản của người này trước khi cấp quyền."],
    ["Duplicate admin account emails must be reconciled first", "Có nhiều hơn một tài khoản quản trị dùng email này. Nhờ admin gộp lại trước khi cấp quyền."],
    ["Account holds a non-qualifying active scope for this season; reconcile it", "Tài khoản này đang giữ một phạm vi quyền khác cho mùa này. Nhờ admin chỉnh phạm vi quyền trước khi cấp quyền đánh giá."],
    ["Existing account role cannot join recruitment", "Vai trò hiện tại của tài khoản này không tham gia tuyển sinh được. Nhờ admin kiểm tra lại."],
    ["Inactive privileged accounts require super-admin reactivation", "Tài khoản này thuộc nhóm quản trị và đang bị khoá. Cần super admin mở lại trước."],
    ["Recruitment participant identity or season is invalid", "Email trong hồ sơ và email của tài khoản không khớp. Nhờ admin kiểm tra lại email của người này."],
    ["một lỗi lạ chưa từng gặp", SAFE_ERROR]
  ])("database từ chối vì %s: màn hình nói đúng lý do", async (dbMessage, expected) => {
    const { client, deleteUser } = buildClient({ rpcByName: { [GRANT_RPC]: { error: { message: dbMessage } } } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    await expect(grant()).resolves.toEqual({ ok: false, message: expected });
    // Tài khoản vừa tạo phải được xoá, và không lá thư nào đi khi quyền chưa cấp được.
    expect(deleteUser).toHaveBeenCalledWith("auth-invited");
    expect(sendReviewerInvite).not.toHaveBeenCalled();
  });

  it("mã nguồn không tự ghi vào admin_users: việc gỡ liên kết thuộc về database", () => {
    const source = readFileSync("lib/enable-reviewer.ts", "utf8");
    expect(source).toContain(CLEAR_RPC);
    expect(source).not.toMatch(/from\("admin_users"\)/);
    expect(source).not.toMatch(/update\(/);
  });
});
