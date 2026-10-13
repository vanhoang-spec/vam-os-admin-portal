/**
 * Quyền tài khoản theo bậc và vai trò Cross mentor — chạy migration THẬT trên
 * Postgres.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO PHẢI LÀ POSTGRES THẬT
 * ---------------------------------------------------------------------------
 * Lỗi mà migration này sửa đã sống ba tuần qua cả bốn cổng: từ 20/09/2026 tầng
 * mã cho admin và Core team sửa tài khoản cấp dưới, trang hiện đủ nút, test
 * xanh — còn `vam062_admin_mutation_atomic` trên database vẫn chỉ nhận super
 * admin. Test của tầng mã dùng database giả, và database giả nói "được".
 *
 * Nên ở đây không có bản giả nào: các hàm vam062/vam063 là bản đang chạy trên
 * production (20260913150000, 20260912100000), rồi migration mới chạy đè lên,
 * và mọi khẳng định là về những gì database thật sự ghi hoặc từ chối.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261013100000_quyen_theo_bac_va_cross_mentor.sql";
const BASE_062 = "supabase/migrations/20260913150000_admin_user_provisioning_rpcs.sql";
const BASE_063 = "supabase/migrations/20260912100000_membership_roles_trainer_speaker.sql";
const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ID = {
  program: uuid(1), season: uuid(2),
  superA: uuid(10), admin: uuid(11), admin2: uuid(12), core: uuid(13), core2: uuid(14),
  support: uuid(15), reviewer: uuid(16), viewer: uuid(17), adminOff: uuid(18), coreNoScope: uuid(19),
  person: uuid(30), person2: uuid(31)
};
const HASH = "a".repeat(64);

function table(file: string, name: string) {
  const match = new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i").exec(read(file));
  if (!match) throw new Error(`Không thấy DDL của ${name}`);
  return match[0];
}

let db: PGlite;
/** Định nghĩa hai ràng buộc vai trò TRƯỚC khi migration mới chạy. */
let checksBefore: Record<string, string> = {};

async function roleChecks(target: PGlite) {
  const { rows } = await target.query<{ conname: string; def: string }>(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('person_season_memberships_role_check','person_season_membership_log_role_check')`
  );
  return Object.fromEntries(rows.map((row) => [row.conname, row.def]));
}
const quoted = (def: string) => Array.from(def.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);

beforeAll(async () => {
  db = new PGlite();
  // Bảng nền có trước lịch sử migration: chỉ những cột các hàm này đụng tới.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    -- vam062_current_admin_id đọc auth.uid(); Supabase có sẵn, Postgres trần thì không.
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table programs(id uuid primary key, code text unique, name text, is_active boolean not null default true);
    create table seasons(id uuid primary key, program_id uuid references programs, code text unique);
    create table intake_batches(id uuid primary key, season_id uuid references seasons);
    create table admin_users(id uuid primary key default gen_random_uuid(), auth_user_id uuid, email text unique,
      full_name text, role text, status text);
    create table admin_scope_access(id uuid primary key default gen_random_uuid(), user_id uuid, program_id text,
      season_id text, role text, status text);
    create unique index admin_scope_access_active_uidx on admin_scope_access
      (user_id, (coalesce(program_id, '')), (coalesce(season_id, '')), role) where (status = 'active');
    create table admin_audit_log(id uuid primary key default gen_random_uuid(), actor_admin_user_id uuid,
      action_type text, target_admin_user_id uuid, before_data jsonb, after_data jsonb, details jsonb,
      created_at timestamptz not null default now());
    create table people(id uuid primary key default gen_random_uuid(), full_name text not null);
    -- Trên production hàm này đọc vai trò từ claim của request; ở đây đọc từ một
    -- biến phiên để test bật/tắt được "ngữ cảnh máy chủ".
    create function public.vam063_trusted_api_role() returns table(api_role text) language sql stable
      as $$ select nullif(current_setting('test.api_role', true), '') $$;
    -- Chép nguyên định nghĩa đang chạy trên production (đọc 13/10/2026).
    create function public.vam063_authorized_for_scope(p_actor_admin_user_id uuid, p_program_id uuid, p_season_id uuid)
      returns boolean language sql stable security definer set search_path to 'public' as $$
      select exists (
        select 1 from public.admin_users a
        where a.id = p_actor_admin_user_id and a.status = 'active' and (
          a.role = 'super_admin'
          or exists (
            select 1 from public.admin_scope_access s
            where s.user_id = a.auth_user_id and s.status = 'active'
              and s.role in ('full_access','operations')
              and s.program_id = p_program_id::text and s.season_id = p_season_id::text
          )
        )
      )
    $$;
    -- Bản giữ chỗ: migration trainer/speaker đòi hàm này có sẵn rồi mới chép đè.
    create function public.vam063_add_membership_role(p_actor_admin_user_id uuid, p_person_id uuid, p_program_id uuid,
      p_season_id uuid, p_role text, p_reason text) returns table(outcome_status text, membership_id uuid)
      language sql as $$ select null::text, null::uuid $$;
  `);
  for (const name of ["person_season_memberships", "person_season_membership_log"]) {
    await db.exec(table("supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql", name));
  }
  await db.exec("grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role;");
  await db.exec(read(BASE_063));
  await db.exec(read(BASE_062));
  checksBefore = await roleChecks(db);

  await db.exec(read(MIGRATION));

  await db.exec(`
    insert into programs values ('${ID.program}', 'UEHM', 'UEH Mentoring', true);
    insert into seasons values ('${ID.season}', '${ID.program}', 'S12');
    insert into admin_users(id, auth_user_id, email, full_name, role, status) values
      ('${ID.superA}', '${ID.superA}', 'super@example.test', 'Super', 'super_admin', 'active'),
      ('${ID.admin}', '${ID.admin}', 'admin@example.test', 'Admin Một', 'admin', 'active'),
      ('${ID.admin2}', '${ID.admin2}', 'admin2@example.test', 'Admin Hai', 'admin', 'active'),
      ('${ID.core}', '${ID.core}', 'core@example.test', 'Core Một', 'core_team', 'active'),
      ('${ID.core2}', '${ID.core2}', 'core2@example.test', 'Core Hai', 'core_team', 'active'),
      ('${ID.support}', '${ID.support}', 'support@example.test', 'Support', 'support_team', 'active'),
      ('${ID.reviewer}', '${ID.reviewer}', 'reviewer@example.test', 'Reviewer', 'reviewer', 'active'),
      ('${ID.viewer}', '${ID.viewer}', 'viewer@example.test', 'Viewer', 'viewer', 'active'),
      ('${ID.adminOff}', '${ID.adminOff}', 'adminoff@example.test', 'Admin Nghỉ', 'admin', 'inactive'),
      ('${ID.coreNoScope}', '${ID.coreNoScope}', 'corenoscope@example.test', 'Core Không Scope', 'core_team', 'active');
    insert into admin_scope_access(user_id, program_id, season_id, role, status) values
      ('${ID.admin}', '${ID.program}', '${ID.season}', 'full_access', 'active'),
      ('${ID.admin2}', '${ID.program}', '${ID.season}', 'full_access', 'active'),
      ('${ID.core}', '${ID.program}', '${ID.season}', 'operations', 'active'),
      ('${ID.core2}', '${ID.program}', '${ID.season}', 'operations', 'active'),
      ('${ID.support}', '${ID.program}', '${ID.season}', 'operations', 'active'),
      ('${ID.reviewer}', '${ID.program}', '${ID.season}', 'review', 'active');
    insert into people(id, full_name) values ('${ID.person}', 'Mentor A'), ('${ID.person2}', 'Mentor B');
  `);
}, 120_000);

// Mỗi ca chạy trong một transaction rồi quay lui: ca sau luôn thấy đúng dữ liệu gốc.
beforeEach(async () => {
  await db.exec("begin; select set_config('test.api_role', 'service_role', true);");
});
afterEach(async () => {
  await db.exec("rollback");
});

/** Chạy một lệnh; trả về null nếu thành công, hoặc lời báo lỗi của database. */
async function attempt(sql: string, params: unknown[] = []): Promise<string | null> {
  await db.exec("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.exec("release savepoint attempt");
    return null;
  } catch (error) {
    await db.exec("rollback to savepoint attempt");
    return String((error as Error).message);
  }
}

type Payload = Record<string, unknown>;
const payload = (over: Payload = {}): Payload => ({
  full_name: "Tên Mới", role: "core_team", status: "active", scope_id: "",
  program_id: ID.program, season_id: ID.season, scope_role: "operations", scope_status: "active", ...over
});
const mutate = (actor: string, operation: string, target: string | null, body: Payload) =>
  attempt("select public.vam062_admin_mutation_atomic($1, $2, $3, $4::jsonb)", [actor, operation, target, JSON.stringify(body)]);
const createPayload = (email: string, over: Payload = {}) =>
  payload({ auth_user_id: uuid(900), email, full_name: "Người Mới", ...over });

async function account(id: string) {
  const { rows } = await db.query<{ role: string; status: string; full_name: string; email: string }>(
    "select role, status, full_name, email from admin_users where id = $1", [id]);
  return rows[0] ?? null;
}
async function accountByEmail(email: string) {
  const { rows } = await db.query<{ id: string; role: string; status: string; auth_user_id: string }>(
    "select id, role, status, auth_user_id from admin_users where email = $1", [email]);
  return rows[0] ?? null;
}
async function audit(action: string) {
  const { rows } = await db.query<{ actor: string; target: string }>(
    "select actor_admin_user_id as actor, target_admin_user_id as target from admin_audit_log where action_type = $1", [action]);
  return rows;
}
async function auditCount() {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from admin_audit_log");
  return rows[0].n;
}
async function activeScopes(authUserId: string) {
  const { rows } = await db.query<{ role: string }>(
    "select role from admin_scope_access where user_id = $1 and status = 'active' order by role", [authUserId]);
  return rows.map((row) => row.role);
}

describe("1. bảng bậc — một chỗ cho mọi hàm", () => {
  const allows = async (actor: string | null, target: string | null) =>
    (await db.query<{ ok: boolean }>("select public.vam120_account_tier_allows($1, $2) as ok", [actor, target])).rows[0].ok;

  it.each([
    ["admin", "core_team", true], ["admin", "support_team", true], ["admin", "reviewer", true], ["admin", "viewer", true],
    ["admin", "admin", false], ["admin", "super_admin", false],
    ["core_team", "support_team", true], ["core_team", "reviewer", true], ["core_team", "viewer", true],
    ["core_team", "core_team", false], ["core_team", "admin", false], ["core_team", "super_admin", false],
    ["support_team", "viewer", false], ["reviewer", "viewer", false], ["viewer", "viewer", false],
    ["super_admin", "admin", false]
  ] as const)("%s → %s: %s", async (actor, target, expected) => {
    // super_admin trả false ở đây là CHỦ Ý: các hàm cho super admin đi thẳng,
    // không hỏi bảng này. Nếu ai đó gọi bảng cho super admin thì câu trả lời an
    // toàn là "không".
    expect(await allows(actor, target)).toBe(expected);
  });

  it("thiếu một trong hai vai trò là KHÔNG", async () => {
    expect(await allows("admin", null)).toBe(false);
    expect(await allows(null, "viewer")).toBe(false);
    expect(await allows("admin", "vai_tro_la")).toBe(false);
  });

  it.each([
    ["core_team", "operations", true], ["core_team", "review", true], ["core_team", "full_access", false],
    ["support_team", "operations", true], ["support_team", "full_access", false],
    ["reviewer", "review", true], ["reviewer", "read", true], ["reviewer", "operations", false],
    ["viewer", "read", true], ["viewer", "review", false],
    ["admin", "read", false], ["core_team", null, false], ["core_team", "khac", false]
  ] as const)("phạm vi: cấp %s nhận %s: %s", async (role, scope, expected) => {
    const { rows } = await db.query<{ ok: boolean }>("select public.vam120_scope_within_role($1, $2) as ok", [role, scope]);
    expect(rows[0].ok).toBe(expected);
  });
});

describe("2. sửa tài khoản (update)", () => {
  it("admin sửa được một tài khoản Core team — đúng điều trước đây bị từ chối", async () => {
    expect(await mutate(ID.admin, "update", ID.core, payload({ full_name: "Core Đổi Tên" }))).toBeNull();
    expect(await account(ID.core)).toMatchObject({ role: "core_team", status: "active", full_name: "Core Đổi Tên" });
    expect(await audit("update_admin_user")).toEqual([{ actor: ID.admin, target: ID.core }]);
  });

  it("admin đưa một reviewer lên Core team, và phạm vi vận hành được cấp kèm", async () => {
    expect(await mutate(ID.admin, "update", ID.reviewer, payload({ role: "core_team", scope_role: "operations" }))).toBeNull();
    expect((await account(ID.reviewer))?.role).toBe("core_team");
    expect(await activeScopes(ID.reviewer)).toEqual(["operations", "review"]);
  });

  it("admin đưa một người ra khỏi Core team (hạ xuống Support team)", async () => {
    expect(await mutate(ID.admin, "update", ID.core, payload({ role: "support_team" }))).toBeNull();
    expect((await account(ID.core))?.role).toBe("support_team");
  });

  it("admin KHÔNG sửa được admin khác, cũng không sửa được super admin", async () => {
    const before = await auditCount();
    expect(await mutate(ID.admin, "update", ID.admin2, payload({ role: "core_team" }))).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.admin, "update", ID.superA, payload({ role: "core_team" }))).toContain("VAM120 target above actor tier");
    expect((await account(ID.admin2))?.role).toBe("admin");
    expect((await account(ID.superA))?.role).toBe("super_admin");
    expect(await auditCount()).toBe(before);
  });

  it("admin KHÔNG đặt được ai thành admin hay super admin", async () => {
    expect(await mutate(ID.admin, "update", ID.core, payload({ role: "admin", scope_role: "operations" }))).toContain("VAM120 role above actor tier");
    expect(await mutate(ID.admin, "update", ID.core, payload({ role: "super_admin", scope_role: "operations" }))).toContain("VAM120 role above actor tier");
    expect((await account(ID.core))?.role).toBe("core_team");
  });

  it("không ai dưới super admin tự sửa chính mình", async () => {
    // Không có dòng kiểm riêng: cấp của mình không nằm trong danh sách mình quản.
    expect(await mutate(ID.admin, "update", ID.admin, payload({ role: "core_team" }))).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.core, "update", ID.core, payload({ role: "support_team" }))).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.core, "remove", ID.core, {})).toContain("VAM120 target above actor tier");
    expect((await account(ID.admin))?.role).toBe("admin");
    expect(await account(ID.core)).toMatchObject({ role: "core_team", status: "active" });
  });

  it("Core team sửa được Support team, reviewer, viewer", async () => {
    expect(await mutate(ID.core, "update", ID.support, payload({ role: "support_team", full_name: "Support Mới" }))).toBeNull();
    expect(await mutate(ID.core, "update", ID.viewer, payload({ role: "reviewer", scope_role: "review" }))).toBeNull();
    expect((await account(ID.support))?.full_name).toBe("Support Mới");
    expect((await account(ID.viewer))?.role).toBe("reviewer");
  });

  it("Core team KHÔNG sửa được Core team khác, và không nâng ai lên Core team", async () => {
    expect(await mutate(ID.core, "update", ID.core2, payload({ role: "support_team" }))).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.core, "update", ID.admin, payload({ role: "support_team" }))).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.core, "update", ID.support, payload({ role: "core_team" }))).toContain("VAM120 role above actor tier");
    expect((await account(ID.core2))?.role).toBe("core_team");
    expect((await account(ID.support))?.role).toBe("support_team");
  });

  it.each([["support_team", ID.support], ["reviewer", ID.reviewer], ["viewer", ID.viewer]] as const)(
    "%s không sửa được tài khoản nào", async (_label, actor) => {
      expect(await mutate(actor, "update", ID.viewer === actor ? ID.reviewer : ID.viewer, payload({ role: "viewer", scope_role: "read" })))
        .toContain("VAM062V3 unauthorized actor");
    });

  it("admin đã bị tạm khoá không còn quyền gì", async () => {
    expect(await mutate(ID.adminOff, "update", ID.core, payload())).toContain("VAM062V3 unauthorized actor");
  });

  it("người gọi không tồn tại bị từ chối", async () => {
    expect(await mutate(uuid(999), "update", ID.core, payload())).toContain("VAM062V3 unauthorized actor");
  });

  it("phạm vi mùa không vượt được cấp của tài khoản", async () => {
    expect(await mutate(ID.admin, "update", ID.core, payload({ scope_role: "full_access" }))).toContain("VAM120 scope above role");
    expect(await mutate(ID.admin, "update", ID.reviewer, payload({ role: "reviewer", scope_role: "operations" }))).toContain("VAM120 scope above role");
    expect(await mutate(ID.core, "update", ID.viewer, payload({ role: "viewer", scope_role: "review" }))).toContain("VAM120 scope above role");
    expect(await activeScopes(ID.core)).toEqual(["operations"]);
    expect(await activeScopes(ID.reviewer)).toEqual(["review"]);
  });

  it("tài khoản đích không tồn tại: báo đúng điều đó, không báo sai thành thiếu quyền", async () => {
    expect(await mutate(ID.admin, "update", uuid(998), payload())).toContain("VAM062V3 target missing");
  });

  it("ngoài ngữ cảnh máy chủ thì admin cũng bị từ chối", async () => {
    await db.exec("select set_config('test.api_role', 'authenticated', true)");
    expect(await mutate(ID.admin, "update", ID.core, payload())).toContain("trusted server context required");
    expect(await mutate(ID.superA, "update", ID.core, payload())).toContain("trusted server context required");
  });

  it("super admin giữ nguyên như trước: sửa được admin, đặt được mọi cấp và mọi phạm vi", async () => {
    expect(await mutate(ID.superA, "update", ID.admin2, payload({ role: "super_admin", scope_role: "full_access" }))).toBeNull();
    expect((await account(ID.admin2))?.role).toBe("super_admin");
    expect(await mutate(ID.superA, "update", ID.reviewer, payload({ role: "reviewer", scope_role: "operations" }))).toBeNull();
    expect(await activeScopes(ID.reviewer)).toEqual(["operations", "review"]);
  });
});

describe("3. tạm khoá, kích hoạt lại, gỡ quyền", () => {
  it("admin tạm khoá rồi kích hoạt lại một tài khoản Core team", async () => {
    expect(await mutate(ID.admin, "status", ID.core, { status: "inactive" })).toBeNull();
    expect((await account(ID.core))?.status).toBe("inactive");
    expect(await activeScopes(ID.core)).toEqual([]);
    expect(await audit("deactivate_admin_user")).toEqual([{ actor: ID.admin, target: ID.core }]);

    expect(await mutate(ID.admin, "status", ID.core, {
      status: "active", program_id: ID.program, season_id: ID.season, scope_role: "operations"
    })).toBeNull();
    expect((await account(ID.core))?.status).toBe("active");
    expect(await activeScopes(ID.core)).toEqual(["operations"]);
    expect(await audit("reactivate_admin_user")).toEqual([{ actor: ID.admin, target: ID.core }]);
  });

  it("admin gỡ quyền một tài khoản Core team", async () => {
    expect(await mutate(ID.admin, "remove", ID.core, {})).toBeNull();
    expect((await account(ID.core))?.status).toBe("inactive");
    expect(await audit("remove_admin_access")).toEqual([{ actor: ID.admin, target: ID.core }]);
  });

  it("admin KHÔNG tạm khoá hay gỡ quyền được admin khác, super admin, hay chính mình", async () => {
    expect(await mutate(ID.admin, "status", ID.admin2, { status: "inactive" })).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.admin, "remove", ID.superA, {})).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.admin, "remove", ID.admin, {})).toContain("VAM120 target above actor tier");
    expect((await account(ID.admin2))?.status).toBe("active");
    expect((await account(ID.superA))?.status).toBe("active");
    expect((await account(ID.admin))?.status).toBe("active");
  });

  it("Core team tạm khoá được Support team, không tạm khoá được Core team khác", async () => {
    expect(await mutate(ID.core, "status", ID.support, { status: "inactive" })).toBeNull();
    expect((await account(ID.support))?.status).toBe("inactive");
    expect(await mutate(ID.core, "remove", ID.core2, {})).toContain("VAM120 target above actor tier");
    expect((await account(ID.core2))?.status).toBe("active");
  });

  it("Support team không tạm khoá được ai", async () => {
    expect(await mutate(ID.support, "status", ID.viewer, { status: "inactive" })).toContain("VAM062V3 unauthorized actor");
    expect((await account(ID.viewer))?.status).toBe("active");
  });
});

describe("4. tạo tài khoản (upsert)", () => {
  it("admin tạo được một tài khoản Core team mới — thêm người vào Core team", async () => {
    expect(await mutate(ID.admin, "upsert", null, createPayload("moi@example.test"))).toBeNull();
    const created = await accountByEmail("moi@example.test");
    expect(created).toMatchObject({ role: "core_team", status: "active", auth_user_id: uuid(900) });
    expect(await activeScopes(uuid(900))).toEqual(["operations"]);
    expect(await audit("create_admin_user")).toEqual([{ actor: ID.admin, target: created!.id }]);
  });

  it("admin KHÔNG tạo được tài khoản admin hay super admin", async () => {
    expect(await mutate(ID.admin, "upsert", null, createPayload("a@example.test", { role: "admin" }))).toContain("VAM120 role above actor tier");
    expect(await mutate(ID.admin, "upsert", null, createPayload("b@example.test", { role: "super_admin" }))).toContain("VAM120 role above actor tier");
    expect(await accountByEmail("a@example.test")).toBeNull();
    expect(await accountByEmail("b@example.test")).toBeNull();
  });

  it("\"tạo\" trùng email của super admin không hạ cấp được super admin", async () => {
    // upsert ghi đè theo email. Đây là đường vòng duy nhất còn lại nếu cổng chỉ
    // nhìn vai trò trong payload mà không nhìn dòng đang lưu.
    expect(await mutate(ID.admin, "upsert", null, createPayload("super@example.test"))).toContain("VAM120 target above actor tier");
    expect(await mutate(ID.admin, "upsert", null, createPayload("ADMIN2@example.test "))).toContain("VAM120 target above actor tier");
    expect(await account(ID.superA)).toMatchObject({ role: "super_admin", full_name: "Super" });
    expect(await account(ID.admin2)).toMatchObject({ role: "admin", full_name: "Admin Hai" });
  });

  it("tạo trùng email của một tài khoản cấp dưới thì cập nhật tài khoản đó, như super admin vẫn làm", async () => {
    expect(await mutate(ID.admin, "upsert", null, createPayload("reviewer@example.test"))).toBeNull();
    expect(await account(ID.reviewer)).toMatchObject({ role: "core_team", full_name: "Người Mới" });
    expect(await audit("update_admin_user")).toEqual([{ actor: ID.admin, target: ID.reviewer }]);
  });

  it("phạm vi cấp kèm không vượt cấp của tài khoản mới", async () => {
    expect(await mutate(ID.admin, "upsert", null, createPayload("c@example.test", { scope_role: "full_access" }))).toContain("VAM120 scope above role");
    expect(await accountByEmail("c@example.test")).toBeNull();
  });

  it("Core team KHÔNG tạo được tài khoản, kể cả cấp mình quản được", async () => {
    expect(await mutate(ID.core, "upsert", null, createPayload("d@example.test", { role: "support_team" }))).toContain("VAM062V3 unauthorized actor");
    expect(await accountByEmail("d@example.test")).toBeNull();
  });

  it("super admin giữ nguyên: tạo được admin với full_access", async () => {
    expect(await mutate(ID.superA, "upsert", null, createPayload("e@example.test", { role: "admin", scope_role: "full_access" }))).toBeNull();
    expect((await accountByEmail("e@example.test"))?.role).toBe("admin");
  });

  it("đồng bộ Auth (link_auth) vẫn chỉ của super admin", async () => {
    const body = payload({ auth_user_id: uuid(901), scope_role: "operations" });
    expect(await mutate(ID.admin, "link_auth", ID.core, body)).toContain("VAM062V3 unauthorized actor");
    expect(await mutate(ID.core, "link_auth", ID.support, body)).toContain("VAM062V3 unauthorized actor");
    expect(await mutate(ID.superA, "link_auth", ID.core, body)).toBeNull();
    expect(await audit("sync_auth")).toEqual([{ actor: ID.superA, target: ID.core }]);
  });

  it("thao tác lạ từ admin bị từ chối như thiếu quyền, không lọt tới nhánh nào", async () => {
    expect(await mutate(ID.admin, "purge", ID.core, {})).toContain("VAM062V3 unauthorized actor");
  });
});

describe("5. nhật ký của luồng tạo — admin ghi được, Core team thì không", () => {
  const begin = (actor: string, operation: string) =>
    attempt("select * from public.vam062_begin_auth_operation($1, $2, 'manual', $3, null)", [actor, operation, HASH]);
  const stage = (actor: string, operation: string) =>
    attempt("select public.vam062_record_auth_operation_stage($1, $2, 'prelookup_zero', 'not_found', null, false, null)", [actor, operation]);
  const reconcile = (actor: string, operation: string) =>
    attempt("select public.vam062_record_auth_reconciliation($1, $2, $3, 'create_admin_user', 'x', 'required', '{}'::jsonb)", [actor, operation, HASH]);

  it("admin mở được nhật ký, ghi được từng bước, ghi được đối soát", async () => {
    expect(await begin(ID.admin, uuid(700))).toBeNull();
    expect(await stage(ID.admin, uuid(700))).toBeNull();
    expect(await reconcile(ID.admin, uuid(701))).toBeNull();
    const { rows } = await db.query<{ actor: string; pre: string }>(
      "select actor_admin_user_id as actor, pre_lookup_state as pre from account_auth_operations where operation_id = $1", [uuid(700)]);
    expect(rows).toEqual([{ actor: ID.admin, pre: "zero" }]);
  });

  it("super admin vẫn ghi được như trước", async () => {
    expect(await begin(ID.superA, uuid(702))).toBeNull();
    expect(await stage(ID.superA, uuid(702))).toBeNull();
    expect(await reconcile(ID.superA, uuid(703))).toBeNull();
  });

  it.each([["Core team", ID.core], ["Support team", ID.support], ["admin đã tạm khoá", ID.adminOff]] as const)(
    "%s không mở được nhật ký nào", async (_label, actor) => {
      expect(await begin(actor, uuid(704))).toContain("VAM062V3 operation rejected");
      expect(await reconcile(actor, uuid(705))).toContain("VAM062V3 reconciliation rejected");
      // Có sẵn một dòng nhật ký của admin thì người khác cũng không ghi tiếp được.
      expect(await begin(ID.admin, uuid(706))).toBeNull();
      expect(await stage(actor, uuid(706))).toContain("VAM062V3 operation update rejected");
    });

  it("ngoài ngữ cảnh máy chủ thì admin cũng không ghi được nhật ký", async () => {
    await db.exec("select set_config('test.api_role', '', true)");
    expect(await begin(ID.admin, uuid(707))).toContain("VAM062V3 operation rejected");
  });
});

describe("6. Cross mentor là một vai trò trong mùa", () => {
  const addRole = (actor: string, role: string, person = ID.person) =>
    attempt("select * from public.vam063_add_membership_role($1, $2, $3, $4, $5, $6)",
      [actor, person, ID.program, ID.season, role, "Bổ nhiệm theo đề nghị của BTC"]);
  async function memberships(person = ID.person) {
    const { rows } = await db.query<{ role: string; status: string; source: string; created_by: string }>(
      "select role, status, source, created_by from person_season_memberships where person_id = $1 order by role", [person]);
    return rows;
  }

  it("hai ràng buộc nhận cross_mentor và KHÔNG mất giá trị nào có trước đó", async () => {
    const after = await roleChecks(db);
    for (const name of ["person_season_memberships_role_check", "person_season_membership_log_role_check"]) {
      const before = quoted(checksBefore[name]);
      expect(before.length).toBeGreaterThanOrEqual(11);
      expect(before).not.toContain("cross_mentor");
      expect(quoted(after[name]).sort()).toEqual([...before, "cross_mentor"].sort());
    }
  });

  it("Core team bổ nhiệm cross mentor: ghi membership, ghi log, ghi nhật ký", async () => {
    expect(await addRole(ID.core, "cross_mentor")).toBeNull();
    expect(await memberships()).toEqual([{ role: "cross_mentor", status: "active", source: "manual", created_by: ID.core }]);
    const { rows: log } = await db.query<{ role: string; new_status: string; transition_type: string; changed_by: string; reason: string }>(
      "select role, new_status, transition_type, changed_by, reason from person_season_membership_log where person_id = $1", [ID.person]);
    expect(log).toEqual([{ role: "cross_mentor", new_status: "active", transition_type: "created", changed_by: ID.core, reason: "Bổ nhiệm theo đề nghị của BTC" }]);
    const { rows: audits } = await db.query<{ actor: string; role: string }>(
      "select actor_admin_user_id as actor, after_data->>'role' as role from admin_audit_log where action_type = 'add_membership_role'");
    expect(audits).toEqual([{ actor: ID.core, role: "cross_mentor" }]);
  });

  it("bổ nhiệm lần hai không tạo dòng trùng", async () => {
    expect(await addRole(ID.admin, "cross_mentor")).toBeNull();
    const { rows } = await db.query<{ outcome_status: string }>(
      "select outcome_status from public.vam063_add_membership_role($1, $2, $3, $4, 'cross_mentor', null)",
      [ID.admin, ID.person, ID.program, ID.season]);
    expect(rows[0].outcome_status).toBe("noop");
    expect(await memberships()).toHaveLength(1);
  });

  it("admin và super admin bổ nhiệm được trainer và cross mentor", async () => {
    expect(await addRole(ID.admin, "trainer")).toBeNull();
    expect(await addRole(ID.superA, "cross_mentor")).toBeNull();
    expect((await memberships()).map((row) => row.role)).toEqual(["cross_mentor", "trainer"]);
  });

  it("Support team KHÔNG bổ nhiệm được trainer hay cross mentor, dù có phạm vi vận hành mùa", async () => {
    expect(await addRole(ID.support, "cross_mentor")).toContain("VAM120 appointment requires core team");
    expect(await addRole(ID.support, "trainer")).toContain("VAM120 appointment requires core team");
    expect(await memberships()).toEqual([]);
  });

  it("Support team vẫn thêm được mentee và speaker như trước", async () => {
    expect(await addRole(ID.support, "mentee")).toBeNull();
    expect(await addRole(ID.support, "speaker")).toBeNull();
    expect((await memberships()).map((row) => row.role)).toEqual(["mentee", "speaker"]);
  });

  it("Core team chưa có phạm vi của mùa thì không bổ nhiệm được", async () => {
    expect(await addRole(ID.coreNoScope, "cross_mentor")).toContain("not authorized for this program-season scope");
  });

  it("vai trò ngoài danh sách vẫn bị từ chối", async () => {
    expect(await addRole(ID.admin, "reviewer")).toContain("VAM063 unsupported participant role");
    expect(await addRole(ID.admin, "cross_mentee")).toContain("VAM063 unsupported participant role");
  });
});

describe("7. quyền chạy và tính chạy lại được", () => {
  const FUNCTIONS = [
    "public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb)",
    "public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid)",
    "public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text)",
    "public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb)",
    "public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)"
  ];
  const HELPERS = ["public.vam120_account_tier_allows(text,text)", "public.vam120_scope_within_role(text,text)"];

  it("anon và authenticated không chạy được hàm nào; service_role chạy được các hàm máy chủ gọi", async () => {
    for (const fn of [...FUNCTIONS, ...HELPERS]) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authenticated,
                has_function_privilege('service_role', $1, 'execute') as service`, [fn]);
      expect(rows[0].anon, `${fn} lộ cho anon`).toBe(false);
      expect(rows[0].authenticated, `${fn} lộ cho authenticated`).toBe(false);
      expect(rows[0].service, fn).toBe(FUNCTIONS.includes(fn));
    }
  });

  it("gọi thẳng bằng vai trò anon bị database chặn, không tới được thân hàm", async () => {
    await db.exec("set local role anon");
    const denied = await mutate(ID.admin, "update", ID.core, payload());
    await db.exec("reset role");
    expect(denied).toContain("permission denied");
  });

  it("service_role gọi được và các hàm vẫn chạy bằng quyền chủ sở hữu", async () => {
    await db.exec("set local role service_role");
    const result = await mutate(ID.admin, "update", ID.core, payload({ full_name: "Qua Service Role" }));
    await db.exec("reset role");
    expect(result).toBeNull();
    expect((await account(ID.core))?.full_name).toBe("Qua Service Role");
  });

  it("chạy lại migration lần hai không lỗi và không nhân đôi giá trị", async () => {
    await db.exec(read(MIGRATION));
    const after = await roleChecks(db);
    for (const def of Object.values(after)) {
      expect(quoted(def).filter((value) => value === "cross_mentor")).toHaveLength(1);
    }
    expect(await mutate(ID.admin, "update", ID.core, payload())).toBeNull();
  });
});

describe("8. thân hàm: chỉ đổi phần cổng, mọi dòng khác giữ nguyên", () => {
  const lf = (text: string) => text.replace(/\r/g, "");
  function body(file: string, fn: string, open: string, close: string) {
    const sql = lf(read(file));
    const start = sql.indexOf(`create or replace function public.${fn}(`);
    expect(start, fn).toBeGreaterThanOrEqual(0);
    const from = sql.indexOf(open, start) + open.length;
    return sql.slice(from, sql.indexOf(close, from)).split("\n").map((line) => line.trimEnd()).filter(Boolean);
  }
  /** Mọi dòng của `kept` xuất hiện trong `next`, đúng thứ tự. */
  function isSubsequence(kept: string[], next: string[]) {
    let at = 0;
    for (const line of kept) {
      at = next.indexOf(line, at);
      if (at < 0) return line;
      at += 1;
    }
    return null;
  }

  it("vam062_admin_mutation_atomic: ngoài ba dòng cổng cũ, không dòng nào bị mất hay đổi", () => {
    const before = body(BASE_062, "vam062_admin_mutation_atomic", "as $$", "$$;");
    const after = body(MIGRATION, "vam062_admin_mutation_atomic", "as $function$", "$function$;");
    const oldGate = "  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then";
    expect(before).toContain(oldGate);
    expect(after).not.toContain(oldGate);
    expect(isSubsequence(before.filter((line) => line !== oldGate), after)).toBeNull();
    expect(before.length).toBeGreaterThan(80);
  });

  it.each(["vam062_begin_auth_operation", "vam062_record_auth_operation_stage", "vam062_record_auth_reconciliation"])(
    "%s: đổi đúng một chỗ — thêm admin", (fn) => {
      const before = body(BASE_062, fn, "as $$", "$$;").join("\n");
      const after = body(MIGRATION, fn, "as $function$", "$function$;").join("\n");
      expect(after).toBe(before.replace("role='super_admin' and status='active'", "role in ('super_admin','admin') and status='active'"));
      expect(after).not.toBe(before);
    });

  it("vam063_add_membership_role: mọi dòng cũ còn nguyên trừ dòng danh sách vai trò", () => {
    const before = body(BASE_063, "vam063_add_membership_role", "as $function$", "$function$;");
    const after = body(MIGRATION, "vam063_add_membership_role", "as $function$", "$function$;");
    const oldList = "  if p_role not in ('mentor','mentee','trainer','speaker') then";
    expect(before).toContain(oldList);
    expect(isSubsequence(before.filter((line) => line !== oldList), after)).toBeNull();
    expect(after).toContain("  if p_role not in ('mentor','mentee','trainer','speaker','cross_mentor') then");
  });
});
