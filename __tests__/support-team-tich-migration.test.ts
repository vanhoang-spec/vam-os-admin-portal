/**
 * Support team tích trên hồ sơ — migration 20261013160000 chạy THẬT trên PostgreSQL (PGlite).
 *
 * Việc này biến một người thành mentee của mùa mà không qua phỏng vấn, do người vận hành bấm
 * ngay trên hồ sơ. Nên mọi luật phải nằm trong hàm và phải được soi ở đây:
 *   - cổng quyền nằm TRONG hàm (không thể dùng vam104_offline_access vì nó kiểm current_user),
 *     nên phải giữ đúng bằng nó với mọi tài khoản × mọi mùa;
 *   - người có đơn đã bị từ chối / đã rút, tư cách đã ngừng, hồ sơ nhập nhằng: KHÔNG ghi gì,
 *     kể cả không để lại dòng đặc cách dở;
 *   - tích: có đơn đã duyệt (duyệt đơn sẵn có hoặc tạo đơn tối thiểu), mentee profile, tư cách
 *     mentee đang hoạt động — lịch sử ghi TÊN người đã tích; tích lần hai không ghi thêm;
 *   - đường link cũ (người nhận bấm) vẫn ghi y hệt như trước dù đã đi qua hàm chung.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const OLD = readFileSync(path.resolve("supabase/migrations/20261011150000_mentee_dac_cach_support_team.sql"), "utf8");
const THIS = readFileSync(path.resolve("supabase/migrations/20261013160000_support_team_tich_tren_ho_so.sql"), "utf8");

const ADMIN = uuid(41);
const SUPER = uuid(42);
const SUPPORT_NO_SCOPE = uuid(43);
const SUPPORT_READ = uuid(44);
const CORE_INACTIVE = uuid(45);
const GHOST = uuid(46);
const REVIEWER_OPS = uuid(47);
const VIEWER_OPS = uuid(48);

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

type TickResult = { ok: boolean; code: string };
const tick = async (person: string, actor: string | null = ids.support, season: string = ids.season) =>
  (await one<{ r: TickResult }>("select vam121_set_support_team($1, $2, $3) as r", [actor, season, person])).r;
const confirm = async (token: string) =>
  (await one<{ r: { ok: boolean; code: string; reason?: string } }>("select vam117_confirm_mentee_exemption($1) as r", [token])).r;
const addToList = async (people: string[], actor = ids.btc) =>
  one("select vam117_add_mentee_exemptions($1, $2, $3::text::uuid[]) as r", [actor, ids.season, `{${people.join(",")}}`]);

type Exemption = {
  id: string; season_id: string; person_id: string; reason: string; token: string; added_by: string | null;
  confirmed_at: string | null; application_id: string | null; revoked_at: string | null; send_count: number;
};
const exemption = (personId: string, season: string = ids.season) =>
  one<Exemption>("select * from mentee_exemptions where person_id = $1 and season_id = $2", [personId, season]);

let seq = 3000;
async function person(name: string, email: string | null = `${name.replace(/\s+/g, ".").toLowerCase()}@example.test`) {
  const id = uuid(++seq);
  await db.query("insert into people(id, full_name, email_primary, phone_primary) values ($1, $2, $3, '0900000000')", [id, name, email]);
  return { id, email };
}
async function menteeApp(input: { person?: string | null; email: string | null; status: string; season?: string }) {
  const id = uuid(++seq);
  await db.query(
    "insert into applications(id, season_id, person_id, role_applied, status, source, full_name, email_primary, raw_payload) values ($1, $2, $3, 'mentee', $4, 'vam_os_form', 'Đơn', $5, '{}'::jsonb)",
    [id, input.season ?? ids.season, input.person ?? null, input.status, input.email]
  );
  return id;
}
async function membership(personId: string, status = "active", season: string = ids.season) {
  const id = uuid(++seq);
  await db.query(
    "insert into person_season_memberships(id, person_id, program_id, season_id, role, status, source) values ($1, $2, $3, $4, 'mentee', $5, 'manual')",
    [id, personId, ids.program, season, status]
  );
  return id;
}
const profile = (personId: string) => db.query("insert into mentee_profiles(person_id) values ($1)", [personId]);

const appsOf = (personId: string, email: string | null) =>
  all<{ id: string; person_id: string | null; status: string; source: string | null; season_id: string; role_applied: string; consent_data_storage: boolean; raw_payload: Record<string, any> }>(
    "select id, person_id, status, source, season_id, role_applied, consent_data_storage, raw_payload from applications where person_id = $1 or lower(btrim(email_primary)) = lower(btrim($2)) order by season_id, id",
    [personId, email]
  );
const decisionsOf = (applicationId: string) =>
  all<{ decided_by: string | null; decided_by_name: string | null; decision: string; previous_status: string | null; new_status: string; decision_note: string | null }>(
    "select decided_by, decided_by_name, decision, previous_status, new_status, decision_note from application_decisions where application_id = $1 order by created_at, id",
    [applicationId]
  );
const membershipsOf = (personId: string) =>
  all<{ id: string; season_id: string; role: string; status: string; source: string }>(
    "select id, season_id, role, status, source from person_season_memberships where person_id = $1 order by season_id, role",
    [personId]
  );
const membershipLog = (personId: string) =>
  all<{ old_status: string | null; new_status: string; transition_type: string; changed_by: string | null; reason: string | null }>(
    "select old_status, new_status, transition_type, changed_by, reason from person_season_membership_log where person_id = $1 order by changed_at, id",
    [personId]
  );
const profileCount = async (personId: string) => (await all("select id from mentee_profiles where person_id = $1", [personId])).length;

/** Đếm mọi dòng của các bảng hàm có thể ghi — để khẳng định "không ghi gì". */
async function footprint() {
  const count = async (table: string) => Number((await one<{ n: number }>(`select count(*)::int as n from ${table}`)).n);
  return {
    applications: await count("applications"),
    decisions: await count("application_decisions"),
    memberships: await count("person_season_memberships"),
    membershipLog: await count("person_season_membership_log"),
    profiles: await count("mentee_profiles"),
    exemptions: await count("mentee_exemptions")
  };
}

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
    await db.exec("set role service_role");
  }
}
const asOwner = async <T>(run: () => Promise<T>): Promise<T> => {
  await db.exec("reset role");
  try {
    return await run();
  } finally {
    await db.exec("set role service_role");
  }
};
/** Lệnh phải bị từ chối; savepoint để giao dịch bên ngoài còn dùng được. */
async function refused(run: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("savepoint refused");
  await expect(run()).rejects.toThrow(pattern);
  await db.exec("rollback to savepoint refused");
}

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Thứ production có mà bộ dựng chung không có — cùng khối chuẩn bị với mentee-dac-cach-migration.test.ts.
  await db.exec(`
    create table vam063_trusted_api_role_result(api_role text);
    insert into vam063_trusted_api_role_result values ('service_role');
    create function vam063_trusted_api_role() returns table(api_role text) language sql stable as
      'select api_role from public.vam063_trusted_api_role_result limit 1';
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'matching_round2_invite'::text])));
    alter table applications add column consent_data_storage boolean not null default false, add column submitted_at date;
    create unique index applications_season_role_canonical_email_key on applications (season_id, role_applied, lower(btrim(email_primary)))
      where season_id is not null and role_applied is not null and nullif(btrim(email_primary), '') is not null;
    create unique index applications_s12_role_person_key on applications (season_id, role_applied, person_id)
      where person_id is not null and role_applied is not null;
    grant all on vam063_trusted_api_role_result, outbound_emails to service_role;
  `);
  // Supabase cấp sẵn quyền gọi cho anon / authenticated / service_role trên MỌI hàm mới trong
  // schema public (default privileges). PGlite thì không — nên không bắt chước thì các lệnh
  // "revoke … service_role" của migration trông thừa và đột biến bỏ chúng sống sót. Đặt SAU khi
  // dựng bảng, TRƯỚC khi nạp hai migration.
  await db.exec("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
  await db.exec(OLD);
  await db.exec(THIS);
  // Thêm các tài khoản để dựng ma trận quyền (bộ dựng chung đã có support / btc / mentor / other).
  await db.exec(`
    insert into admin_users values
      ('${ADMIN}','${ADMIN}','admin@example.test','Admin','active','admin'),
      ('${SUPER}','${SUPER}','super@example.test','Super','active','super_admin'),
      ('${SUPPORT_NO_SCOPE}','${SUPPORT_NO_SCOPE}','nosc@example.test','Support không phạm vi','active','support_team'),
      ('${SUPPORT_READ}','${SUPPORT_READ}','read@example.test','Support chỉ đọc','active','support_team'),
      ('${CORE_INACTIVE}','${CORE_INACTIVE}','off@example.test','Core đã khoá','suspended','core_team'),
      ('${REVIEWER_OPS}','${REVIEWER_OPS}','rev@example.test','Reviewer cấp nhầm','active','reviewer'),
      ('${VIEWER_OPS}','${VIEWER_OPS}','view@example.test','Viewer cấp nhầm','active','viewer');
    insert into admin_scope_access values
      ('${ADMIN}','active','${ids.season}','operations'),
      ('${SUPPORT_READ}','active','${ids.season}','read'),
      ('${CORE_INACTIVE}','active','${ids.season}','operations'),
      ('${REVIEWER_OPS}','active','${ids.season}','operations'),
      ('${VIEWER_OPS}','active','${ids.season}','operations');
  `);
  await db.exec("set role service_role");
}, 90000);
afterAll(async () => {
  await db?.close();
});

describe("cổng quyền", () => {
  const actors: Array<[string, string | null, { [season: string]: boolean }]> = [
    ["Support có phạm vi operations", ids.support, { [ids.season]: true, [ids.seasonNext]: false }],
    ["Core team", ids.btc, { [ids.season]: true, [ids.seasonNext]: true }],
    ["Admin có phạm vi", ADMIN, { [ids.season]: true, [ids.seasonNext]: false }],
    ["Super admin (không cần phạm vi)", SUPER, { [ids.season]: true, [ids.seasonNext]: true }],
    ["Support không có phạm vi", SUPPORT_NO_SCOPE, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Support chỉ có phạm vi đọc", SUPPORT_READ, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Reviewer có phạm vi review", ids.mentor, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Reviewer không phạm vi", ids.other, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Core team đã bị khoá", CORE_INACTIVE, { [ids.season]: false, [ids.seasonNext]: false }],
    // Cấp nhầm quyền operations cho reviewer / viewer: cổng vẫn phải đóng (cùng luật với vam084/vam104).
    ["Reviewer bị cấp nhầm quyền operations", REVIEWER_OPS, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Viewer bị cấp nhầm quyền operations", VIEWER_OPS, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Tài khoản không tồn tại", GHOST, { [ids.season]: false, [ids.seasonNext]: false }],
    ["Không có tài khoản (null)", null, { [ids.season]: false, [ids.seasonNext]: false }]
  ];

  it.each(actors)("%s: hàm kiểm quyền trong hàm GIỐNG HỆT vam104_offline_access(…, true) ở cả hai mùa", async (_label, actor, expected) => {
    for (const season of [ids.season, ids.seasonNext]) {
      const inside = await asOwner(async () =>
        (await one<{ ok: boolean }>("select vam121_actor_may_operate_season($1, $2) as ok", [actor, season])).ok
      );
      const reference = (await one<{ ok: boolean }>("select vam104_offline_access($1, $2, true) as ok", [actor, season])).ok;
      expect(inside, `hàm trong database, mùa ${season}`).toBe(expected[season]);
      expect(reference, `vam104_offline_access, mùa ${season}`).toBe(expected[season]);
      expect(inside).toBe(reference);
    }
  });

  it.each(actors.filter(([, , expected]) => !expected[ids.season]))(
    "%s: bị từ chối, không ghi gì",
    (_label, actor) =>
      isolated(async () => {
        const target = await person("Bạn A");
        const before = await footprint();
        await refused(() => tick(target.id, actor), /ACCESS_DENIED/);
        expect(await footprint()).toEqual(before);
      })
  );

  it("đúng người nhưng sai mùa (Support chỉ có phạm vi mùa 12) bị từ chối ở mùa khác", () =>
    isolated(async () => {
      const target = await person("Bạn B");
      const before = await footprint();
      await refused(() => tick(target.id, ids.support, ids.seasonNext), /ACCESS_DENIED/);
      expect(await footprint()).toEqual(before);
    }));

  it("chỉ máy chủ tin cậy gọi được: ngữ cảnh khác service_role bị từ chối trước mọi phép kiểm", () =>
    isolated(async () => {
      const target = await person("Bạn C");
      await asOwner(async () => {
        await db.exec("update vam063_trusted_api_role_result set api_role = 'authenticated'");
      });
      await refused(() => tick(target.id, ids.btc), /Trusted server context required/);
      await asOwner(async () => {
        await db.exec("update vam063_trusted_api_role_result set api_role = 'service_role'");
      });
    }));
});

describe("cấu trúc và quyền gọi", () => {
  it("hàm tích và hàm xác nhận chạy bằng quyền chủ hàm; hàm giúp việc thì không mở cho API", async () => {
    const rows = await all<{ proname: string; prosecdef: boolean }>(
      "select proname, prosecdef from pg_proc where proname in ('vam121_set_support_team','vam121_grant_mentee_exemption','vam121_actor_may_operate_season','vam117_confirm_mentee_exemption') order by proname"
    );
    expect(Object.fromEntries(rows.map((r) => [r.proname, r.prosecdef]))).toEqual({
      vam117_confirm_mentee_exemption: true,
      vam121_actor_may_operate_season: false,
      vam121_grant_mentee_exemption: true,
      vam121_set_support_team: true
    });
    const flags = await one<Record<string, boolean>>(`select
      has_function_privilege('anon', 'public.vam121_set_support_team(uuid, uuid, uuid)', 'execute') as anon_tick,
      has_function_privilege('authenticated', 'public.vam121_set_support_team(uuid, uuid, uuid)', 'execute') as auth_tick,
      has_function_privilege('service_role', 'public.vam121_set_support_team(uuid, uuid, uuid)', 'execute') as server_tick,
      has_function_privilege('service_role', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute') as server_confirm,
      has_function_privilege('anon', 'public.vam121_grant_mentee_exemption(uuid, uuid, text, text)', 'execute') as anon_grant,
      has_function_privilege('authenticated', 'public.vam121_grant_mentee_exemption(uuid, uuid, text, text)', 'execute') as auth_grant,
      has_function_privilege('service_role', 'public.vam121_grant_mentee_exemption(uuid, uuid, text, text)', 'execute') as server_grant,
      has_function_privilege('anon', 'public.vam121_actor_may_operate_season(uuid, uuid)', 'execute') as anon_gate,
      has_function_privilege('service_role', 'public.vam121_actor_may_operate_season(uuid, uuid)', 'execute') as server_gate`);
    expect(flags).toEqual({
      anon_tick: false, auth_tick: false, server_tick: true, server_confirm: true,
      anon_grant: false, auth_grant: false, server_grant: false, anon_gate: false, server_gate: false
    });
  });

  it("máy chủ vẫn không tự đặt được dấu xác nhận (migration này không nới quyền bảng)", async () => {
    const flags = await one<Record<string, boolean>>(`select
      has_column_privilege('service_role', 'public.mentee_exemptions', 'confirmed_at', 'update') as confirmed_at,
      has_column_privilege('service_role', 'public.mentee_exemptions', 'application_id', 'update') as application_id,
      has_table_privilege('service_role', 'public.mentee_exemptions', 'delete') as can_delete`);
    expect(flags).toEqual({ confirmed_at: false, application_id: false, can_delete: false });
  });
});

describe("tích Support team", () => {
  it("bạn chưa có gì: tạo đơn đặc cách đã duyệt + hồ sơ mentee + tư cách đang hoạt động, ghi TÊN người tích", () =>
    isolated(async () => {
      const a = await person("Bạn Mới");

      expect(await tick(a.id, ids.support)).toEqual({ ok: true, code: "marked" });

      const apps = await appsOf(a.id, a.email);
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ person_id: a.id, status: "approved_as_mentee", source: "s12_mentee_exemption", season_id: ids.season, role_applied: "mentee", consent_data_storage: true });
      expect(apps[0].raw_payload).toMatchObject({ source: "s12_mentee_exemption", exemption_reason: "support_team" });

      const decisions = await decisionsOf(apps[0].id);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ decided_by: ids.support, decided_by_name: "Support", decision: "approved_as_mentee", previous_status: null, new_status: "approved_as_mentee" });
      expect(decisions[0].decision_note).toContain("Support team");

      expect(await profileCount(a.id)).toBe(1);
      const memberships = await membershipsOf(a.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ season_id: ids.season, role: "mentee", status: "active", source: "application" });
      const log = await membershipLog(a.id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ old_status: null, new_status: "active", transition_type: "created", changed_by: ids.support });

      const e = await exemption(a.id);
      expect(e).toMatchObject({ reason: "support_team", added_by: ids.support, application_id: apps[0].id, revoked_at: null, send_count: 0 });
      expect(e.confirmed_at).not.toBeNull();
    }));

  it("bạn đã có tư cách mentee đang hoạt động và hồ sơ mentee nhưng KHÔNG có đơn mùa này (đúng 12 bạn trên production): thêm đơn, không nhân đôi gì", () =>
    isolated(async () => {
      const a = await person("Bạn Chuyển Tiếp");
      await profile(a.id);
      const membershipId = await membership(a.id, "active");

      expect(await tick(a.id, ids.btc)).toEqual({ ok: true, code: "marked" });

      const apps = await appsOf(a.id, a.email);
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ status: "approved_as_mentee", source: "s12_mentee_exemption" });
      expect(await profileCount(a.id)).toBe(1);
      const memberships = await membershipsOf(a.id);
      expect(memberships.map((m) => m.id)).toEqual([membershipId]);
      expect(memberships[0].status).toBe("active");
      // Tư cách đã đúng sẵn nên không có dòng lịch sử tư cách nào mới.
      expect(await membershipLog(a.id)).toHaveLength(0);
      expect((await decisionsOf(apps[0].id))[0]).toMatchObject({ decided_by: ids.btc, decided_by_name: "BTC" });
    }));

  it("bạn đang có đơn chờ chốt: duyệt chính đơn đó (không tạo đơn thứ hai), lịch sử ghi trạng thái cũ", () =>
    isolated(async () => {
      const a = await person("Bạn Có Đơn");
      const appId = await menteeApp({ person: a.id, email: a.email, status: "ready_for_final_decision" });

      expect(await tick(a.id)).toEqual({ ok: true, code: "marked" });

      const apps = await appsOf(a.id, a.email);
      expect(apps.map((x) => [x.id, x.status])).toEqual([[appId, "approved_as_mentee"]]);
      expect(await decisionsOf(appId)).toEqual([
        expect.objectContaining({ decided_by: ids.support, previous_status: "ready_for_final_decision", new_status: "approved_as_mentee" })
      ]);
    }));

  it("đơn nộp bằng email mà chưa nối hồ sơ người: duyệt đơn đó và nối người", () =>
    isolated(async () => {
      const a = await person("Bạn Nối");
      const appId = await menteeApp({ person: null, email: a.email, status: "screening_completed" });

      expect(await tick(a.id)).toEqual({ ok: true, code: "marked" });

      const row = await one<{ person_id: string; status: string }>("select person_id, status from applications where id = $1", [appId]);
      expect(row).toEqual({ person_id: a.id, status: "approved_as_mentee" });
      expect(await appsOf(a.id, a.email)).toHaveLength(1);
    }));

  it("đơn đã duyệt từ trước: không thêm quyết định, vẫn ghi dấu Support team", () =>
    isolated(async () => {
      const a = await person("Bạn Đã Duyệt");
      const appId = await menteeApp({ person: a.id, email: a.email, status: "approved_as_mentee" });
      await membership(a.id, "active");
      await profile(a.id);

      expect(await tick(a.id)).toEqual({ ok: true, code: "marked" });

      expect(await decisionsOf(appId)).toHaveLength(0);
      expect(await appsOf(a.id, a.email)).toHaveLength(1);
      const e = await exemption(a.id);
      expect(e.confirmed_at).not.toBeNull();
      expect(e.application_id).toBe(appId);
    }));

  it("tư cách đang 'invited' thì bật lên 'active' và ghi lịch sử tư cách có tên người tích", () =>
    isolated(async () => {
      const a = await person("Bạn Được Mời");
      await membership(a.id, "invited");

      expect(await tick(a.id)).toEqual({ ok: true, code: "marked" });

      expect((await membershipsOf(a.id))[0].status).toBe("active");
      expect(await membershipLog(a.id)).toEqual([
        expect.objectContaining({ old_status: "invited", new_status: "active", transition_type: "status_change", changed_by: ids.support })
      ]);
    }));

  it("tích lần hai: 'already', không ghi thêm gì", () =>
    isolated(async () => {
      const a = await person("Bạn Hai Lần");
      await tick(a.id);
      const before = await footprint();

      expect(await tick(a.id, ids.btc)).toEqual({ ok: true, code: "already" });

      expect(await footprint()).toEqual(before);
      // Người tích lần hai không đè tên người tích lần đầu.
      expect((await exemption(a.id)).added_by).toBe(ids.support);
    }));

  it("bạn đã nằm trong danh sách thư mời (đã gửi thư, chưa xác nhận): tích là xác nhận luôn, giữ link và số lần gửi", () =>
    isolated(async () => {
      const a = await person("Bạn Đã Gửi Thư");
      await addToList([a.id]);
      await db.exec(`update mentee_exemptions set send_count = 2, last_sent_at = now() where person_id = '${a.id}'`);
      const before = await exemption(a.id);

      expect(await tick(a.id)).toEqual({ ok: true, code: "marked" });

      const after = await exemption(a.id);
      expect(after.id).toBe(before.id);
      expect(after.token).toBe(before.token);
      expect(after.send_count).toBe(2);
      expect(after.added_by).toBe(ids.btc);
      expect(after.confirmed_at).not.toBeNull();
      // Link cũ trong hộp thư mở lại thì chỉ báo "đã xác nhận", không ghi thêm.
      const fp = await footprint();
      expect(await confirm(before.token)).toEqual({ ok: true, code: "already_confirmed" });
      expect(await footprint()).toEqual(fp);
    }));

  it("bạn từng bị gỡ khỏi danh sách: tích là đưa lại và xác nhận, giữ link cũ", () =>
    isolated(async () => {
      const a = await person("Bạn Từng Bị Gỡ");
      await addToList([a.id]);
      const before = await exemption(a.id);
      await db.exec(`update mentee_exemptions set revoked_at = now(), revoked_by = '${ids.btc}' where id = '${before.id}'`);

      expect(await tick(a.id)).toEqual({ ok: true, code: "marked" });

      const after = await exemption(a.id);
      expect(after.token).toBe(before.token);
      expect(after.revoked_at).toBeNull();
      expect(after.confirmed_at).not.toBeNull();
    }));

  it("mỗi mùa một dòng: tích ở mùa này không đụng mùa kia, và mùa kia tích riêng được", () =>
    isolated(async () => {
      const a = await person("Bạn Hai Mùa");
      await tick(a.id, ids.btc, ids.season);

      expect(await exemption(a.id, ids.seasonNext)).toBeUndefined();
      expect(await tick(a.id, ids.btc, ids.seasonNext)).toEqual({ ok: true, code: "marked" });

      const rows = await all<{ season_id: string; status: string }>(
        "select season_id, status from applications where person_id = $1 order by season_id", [a.id]
      );
      expect(rows.map((r) => r.season_id).sort()).toEqual([ids.season, ids.seasonNext].sort());
      expect((await membershipsOf(a.id)).map((m) => m.season_id).sort()).toEqual([ids.season, ids.seasonNext].sort());
    }));

  it("không có người này trong hệ thống: PERSON_NOT_FOUND, không ghi gì", () =>
    isolated(async () => {
      const before = await footprint();
      await refused(() => tick(uuid(999999)), /PERSON_NOT_FOUND/);
      expect(await footprint()).toEqual(before);
    }));
});

describe("điều cản: KHÔNG ghi gì, không để lại dòng đặc cách dở", () => {
  const cases: Array<[string, string, (a: { id: string; email: string | null }) => Promise<void>]> = [
    ["đơn mentee đã bị từ chối", "application_closed", async (a) => { await menteeApp({ person: a.id, email: a.email, status: "rejected_or_not_fit" }); }],
    ["đơn mentee đã rút", "application_closed", async (a) => { await menteeApp({ person: a.id, email: a.email, status: "withdrawn" }); }],
    ["tư cách mentee đã rút", "membership_inactive", async (a) => { await membership(a.id, "withdrawn"); }],
    ["tư cách mentee tạm dừng", "membership_inactive", async (a) => { await membership(a.id, "paused"); }],
    ["đơn cùng email nối với người khác", "application_other_person", async (a) => {
      const other = await person("Người Khác");
      await menteeApp({ person: other.id, email: a.email, status: "ready_for_final_decision" });
    }],
    ["hai hồ sơ mentee", "profile_ambiguous", async (a) => { await profile(a.id); await profile(a.id); }]
  ];

  it.each(cases)("%s", (_label, reason, arrange) =>
    isolated(async () => {
      const a = await person(`Bạn Bị Chặn ${reason}`);
      await arrange(a);
      const before = await footprint();

      await refused(() => tick(a.id), new RegExp(`NEEDS_BTC:${reason}`));

      expect(await footprint()).toEqual(before);
      expect(await exemption(a.id)).toBeUndefined();
    }));

  it("hai hồ sơ người dùng chung email", () =>
    isolated(async () => {
      const shared = "chung@example.test";
      const a = await person("Người Một", shared);
      await person("Người Hai", shared);
      const before = await footprint();
      await refused(() => tick(a.id), /NEEDS_BTC:email_ambiguous/);
      expect(await footprint()).toEqual(before);
    }));

  it("hồ sơ thiếu email", () =>
    isolated(async () => {
      const a = await person("Bạn Không Email", null);
      const before = await footprint();
      await refused(() => tick(a.id), /NEEDS_BTC:no_email/);
      expect(await footprint()).toEqual(before);
    }));

  it("đã nằm trong danh sách rồi bị chặn lúc tích: dòng danh sách giữ nguyên, không bị xác nhận", () =>
    isolated(async () => {
      const a = await person("Bạn Vào Danh Sách Rồi Bị Chặn");
      await addToList([a.id]);
      await menteeApp({ person: a.id, email: a.email, status: "rejected_or_not_fit" });
      const before = await footprint();
      const row = await exemption(a.id);

      await refused(() => tick(a.id), /NEEDS_BTC:application_closed/);

      expect(await footprint()).toEqual(before);
      expect(await exemption(a.id)).toEqual(row);
    }));
});

describe("đường link cũ vẫn ghi y hệt như trước (đã đi qua hàm chung)", () => {
  it("bấm xác nhận: đơn đặc cách + hồ sơ + tư cách; người ghi là không ai, lời ghi là của mentee tự xác nhận", () =>
    isolated(async () => {
      const a = await person("Bạn Bấm Link");
      await addToList([a.id]);
      const e = await exemption(a.id);

      expect(await confirm(e.token)).toEqual({ ok: true, code: "confirmed" });

      const apps = await appsOf(a.id, a.email);
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ status: "approved_as_mentee", source: "s12_mentee_exemption" });
      expect(await decisionsOf(apps[0].id)).toEqual([
        {
          decided_by: null,
          decided_by_name: "Mentee tự xác nhận (đặc cách Support team)",
          decision: "approved_as_mentee",
          previous_status: null,
          new_status: "approved_as_mentee",
          decision_note: "Đặc cách Support team: không qua phỏng vấn. Mentee tự xác nhận tham gia qua link riêng."
        }
      ]);
      expect(await membershipLog(a.id)).toEqual([
        expect.objectContaining({ new_status: "active", transition_type: "created", changed_by: null, reason: "Đặc cách Support team: không qua phỏng vấn. Mentee tự xác nhận tham gia qua link riêng." })
      ]);
      expect(await profileCount(a.id)).toBe(1);
      expect((await exemption(a.id)).confirmed_at).not.toBeNull();
    }));

  it("bấm lần hai: không ghi thêm", () =>
    isolated(async () => {
      const a = await person("Bạn Bấm Hai Lần");
      await addToList([a.id]);
      const { token } = await exemption(a.id);
      await confirm(token);
      const before = await footprint();

      expect(await confirm(token)).toEqual({ ok: true, code: "already_confirmed" });

      expect(await footprint()).toEqual(before);
    }));

  it("token lạ và link đã thu hồi: không ghi gì", () =>
    isolated(async () => {
      const a = await person("Bạn Bị Thu Hồi");
      await addToList([a.id]);
      const e = await exemption(a.id);
      await db.exec(`update mentee_exemptions set revoked_at = now() where id = '${e.id}'`);
      const before = await footprint();

      expect(await confirm(e.token)).toEqual({ ok: false, code: "revoked" });
      expect(await confirm(uuid(777777))).toEqual({ ok: false, code: "invalid_token" });

      expect(await footprint()).toEqual(before);
    }));

  it("bị chặn sau khi đã vào danh sách: trả needs_btc kèm lý do và không ghi gì", () =>
    isolated(async () => {
      const a = await person("Bạn Bị Chặn Sau");
      await addToList([a.id]);
      const e = await exemption(a.id);
      await menteeApp({ person: a.id, email: a.email, status: "withdrawn" });
      const before = await footprint();

      expect(await confirm(e.token)).toEqual({ ok: false, code: "needs_btc", reason: "application_closed" });

      expect(await footprint()).toEqual(before);
    }));

  it("ngày nộp của đơn tạo ra là ngày Việt Nam, không phải ngày UTC — cả đường tích lẫn đường link", () =>
    isolated(async () => {
      const a = await person("Ngay VN Tich");
      await tick(a.id);
      const b = await person("Ngay VN Link");
      await addToList([b.id]);
      await confirm((await exemption(b.id)).token);

      const rows = await all<{ submitted: string; vn: string }>(
        "select submitted_at::text as submitted, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as vn from applications where person_id = any($1::uuid[])",
        [[a.id, b.id]]
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.submitted).toBe(row.vn);

      // Phép so trên chỉ phân biệt được ngày VN với ngày UTC khi test chạy trong khoảng 00:00–07:00 giờ
      // Việt Nam; ngoài khoảng đó hai ngày trùng nhau. Nên ghim thêm chính phép tính trong thân hàm
      // chung: đổi sang ngày UTC (v_now::date) là đỏ ở mọi giờ.
      const src = async (name: string) =>
        (await one<{ src: string }>("select prosrc as src from pg_proc where proname = $1", [name])).src;
      const grant = await src("vam121_grant_mentee_exemption");
      expect(grant).toContain("(v_now at time zone 'Asia/Ho_Chi_Minh')::date");
      expect(grant).not.toContain("v_now::date");
      // Hai đường chỉ còn một cửa: hàm xác nhận và hàm tích không tự ghi đơn nữa.
      for (const name of ["vam117_confirm_mentee_exemption", "vam121_set_support_team"]) {
        const body = await src(name);
        expect(body, name).toContain("vam121_grant_mentee_exemption");
        expect(body, name).not.toContain("insert into public.applications");
      }
    }));
});
