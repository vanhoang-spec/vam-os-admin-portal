/**
 * Migration 20261010200000 — vam116_set_mentor_capacity: Core team sửa số mentee tối đa
 * của một mentor trong mùa. Chạy THẬT trên PostgreSQL (PGlite), trên cùng lược đồ với
 * trigger vam104_match_capacity_guard — con số sửa ở đây phải là con số ghép cặp cưỡng chế.
 *
 * Điều phải đúng: đúng một cột của đúng một hồ sơ đổi, có dòng log; ai không phải Core
 * team trở lên có quyền vận hành mùa đều bị từ chối và không có gì được ghi; không hạ
 * dưới số cặp đang hoạt động của mùa; số đang thấy đã cũ thì dừng; chỉ sửa mentor đang
 * tham dự mùa.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const MIGRATION = readFileSync(path.resolve("supabase/migrations/20261010200000_suc_nhan_mentor_theo_mua.sql"), "utf8");
const SIG = "public.vam116_set_mentor_capacity(uuid,uuid,uuid,integer,integer)";

const MENTOR = uuid(801); // mentor mùa này, sức nhận 1
const OTHER = uuid(802); // mentor khác của mùa — không được bị chạm
const BUSY = uuid(803); // sức nhận 3, đang có 2 cặp
const NO_VALUE = uuid(804); // chưa khai sức nhận
const WITHDRAWN = uuid(805); // có hồ sơ mentor nhưng đã rút khỏi mùa
const NEXT_SEASON_ONLY = uuid(806); // mentor của mùa khác
const NOT_MENTOR = uuid(807); // tham dự mùa với vai mentee
const TWO_PROFILES = uuid(808);
const NO_PROFILE = uuid(809);
const MENTEES = [uuid(821), uuid(822), uuid(823), uuid(824), uuid(825)];

const SUPER = uuid(831);
const ADMIN_OPS = uuid(832);
const CORE_READ = uuid(833);
const CORE_LOCKED = uuid(834);
const CORE_OTHER_SEASON = uuid(835);
const REVIEWER_OPS = uuid(836);

let db: PGlite;

const setCapacity = (actor: string, person: string, expected: number | null, capacity: number | null, season = ids.season) =>
  db.query<{ result: Record<string, unknown> }>("select vam116_set_mentor_capacity($1,$2,$3,$4,$5) as result", [actor, season, person, expected, capacity]);
const profile = async (person: string) =>
  (await db.query<{ capacity_target: number | null; company_current: string | null; updated_at: string }>(
    "select capacity_target, company_current, updated_at::text from mentor_profiles where person_id = $1 order by id",
    [person]
  )).rows;
const logs = async () =>
  (await db.query<{ actor_admin_user_id: string; action_type: string; before_data: unknown; after_data: unknown; details: Record<string, unknown> }>(
    "select actor_admin_user_id, action_type, before_data, after_data, details from admin_audit_log order by created_at, id"
  )).rows;
const snapshot = async () =>
  JSON.stringify((await db.query("select person_id, capacity_target, company_current, updated_at::text from mentor_profiles order by person_id, id")).rows);

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}
/** Chạy với vai trò khác rồi trả lại service_role — kể cả khi câu lệnh hỏng giữa giao dịch. */
async function asRole(role: string | null, run: () => Promise<unknown>) {
  await db.exec("savepoint vai_tro");
  await db.exec(role ? `set role ${role}` : "reset role");
  try {
    await run();
  } finally {
    await db.exec("rollback to savepoint vai_tro");
    await db.exec("set role service_role");
  }
}

async function mentor(person: string, name: string, capacity: number | null, membership: { season?: string; role?: string; status?: string } | null = {}) {
  await db.query("insert into people(id, full_name) values ($1, $2)", [person, name]);
  await db.query("insert into mentor_profiles(person_id, capacity_target, company_current) values ($1, $2, 'Công ty giữ nguyên')", [person, capacity]);
  if (membership) {
    await db.query("insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, $4, $5)", [
      person, ids.program, membership.season ?? ids.season, membership.role ?? "mentor", membership.status ?? "active"
    ]);
  }
}
const match = (mentorPerson: string, mentee: string, status = "active", season = ids.season) =>
  db.query("insert into matches(season_id, mentor_person_id, mentee_person_id, status) values ($1, $2, $3, $4)", [season, mentorPerson, mentee, status]);

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Bảng nền của bộ thử chỉ có vài cột; thêm đúng những cột hàm chạm tới và bảng log
  // với ràng buộc action_type như Production (rút gọn, vẫn có update_mentor_profile).
  await db.exec(`
    alter table mentor_profiles add column company_current text, add column updated_at timestamptz not null default now();
    create table admin_audit_log(
      id uuid primary key default gen_random_uuid(), actor_admin_user_id uuid, target_admin_user_id uuid,
      action_type text not null, before_data jsonb, after_data jsonb, details jsonb, created_at timestamptz default now(),
      constraint admin_audit_log_action_type_check check (action_type = any (array['update_mentor_profile','create_mentor_profile','delete_person','unknown']))
    );
    grant all on admin_audit_log to service_role;
  `);
  await db.exec(`
    insert into admin_users values
      ('${SUPER}','${SUPER}','super@example.test','Super','active','super_admin'),
      ('${ADMIN_OPS}','${ADMIN_OPS}','admin@example.test','Admin','active','admin'),
      ('${CORE_READ}','${CORE_READ}','core-read@example.test','Core đọc','active','core_team'),
      ('${CORE_LOCKED}','${CORE_LOCKED}','core-locked@example.test','Core khoá','inactive','core_team'),
      ('${CORE_OTHER_SEASON}','${CORE_OTHER_SEASON}','core-s13@example.test','Core mùa khác','active','core_team'),
      ('${REVIEWER_OPS}','${REVIEWER_OPS}','reviewer-ops@example.test','Reviewer vận hành','active','reviewer');
    insert into admin_scope_access values
      ('${ADMIN_OPS}','active','${ids.season}','full_access'),
      ('${CORE_READ}','active','${ids.season}','read'),
      ('${CORE_LOCKED}','active','${ids.season}','operations'),
      ('${CORE_OTHER_SEASON}','active','${ids.seasonNext}','operations'),
      ('${REVIEWER_OPS}','active','${ids.season}','operations');
  `);
  await mentor(MENTOR, "Mentor Một", 1);
  await mentor(OTHER, "Mentor Khác", 2);
  await mentor(BUSY, "Mentor Bận", 3);
  await mentor(NO_VALUE, "Mentor Chưa Khai", null);
  await mentor(WITHDRAWN, "Mentor Đã Rút", 2, { status: "withdrawn" });
  await mentor(NEXT_SEASON_ONLY, "Mentor Mùa Sau", 2, { season: ids.seasonNext });
  await mentor(NOT_MENTOR, "Chỉ Là Mentee", 2, { role: "mentee" });
  await mentor(TWO_PROFILES, "Hai Hồ Sơ", 2);
  await db.query("insert into mentor_profiles(person_id, capacity_target) values ($1, 3)", [TWO_PROFILES]);
  await db.query("insert into people(id, full_name) values ($1, 'Không Hồ Sơ')", [NO_PROFILE]);
  await db.query("insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, 'mentor', 'active')", [NO_PROFILE, ids.program, ids.season]);
  for (let i = 0; i < MENTEES.length; i += 1) await db.query("insert into people(id, full_name) values ($1, $2)", [MENTEES[i], `Mentee ${i + 1}`]);
  // Mentor Bận: 2 cặp đang hoạt động mùa này + 1 cặp đã kết thúc + 1 cặp đang hoạt động MÙA SAU.
  await match(BUSY, MENTEES[0]);
  await match(BUSY, MENTEES[1]);
  await match(BUSY, MENTEES[2], "dropped");
  await match(BUSY, MENTEES[3], "active", ids.seasonNext);
  await db.exec(MIGRATION);
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("vam116_set_mentor_capacity", () => {
  it("Core team có quyền vận hành mùa: đổi đúng một cột của đúng một người, có dòng log", () =>
    isolated(async () => {
      const [before] = await profile(MENTOR);
      const otherBefore = await profile(OTHER);

      const { rows } = await setCapacity(ids.btc, MENTOR, 1, 3);

      expect(rows[0].result).toEqual({ ok: true, changed: true, capacity: 3, previous: 1, active: 0 });
      const [after] = await profile(MENTOR);
      expect(after.capacity_target).toBe(3);
      expect(after.company_current).toBe("Công ty giữ nguyên");
      expect(after.updated_at).not.toBe(before.updated_at);
      expect(await profile(OTHER)).toEqual(otherBefore);
      expect(await logs()).toEqual([
        {
          actor_admin_user_id: ids.btc,
          action_type: "update_mentor_profile",
          before_data: { capacity_target: 1 },
          after_data: { capacity_target: 3 },
          details: expect.objectContaining({ field: "capacity_target", person_id: MENTOR, season_id: ids.season, active_matches: 0 })
        }
      ]);
    }));

  it("Super admin (không cần dòng phạm vi) và Admin có full_access cũng sửa được", () =>
    isolated(async () => {
      await setCapacity(SUPER, MENTOR, 1, 2);
      await setCapacity(ADMIN_OPS, MENTOR, 2, 3);
      expect((await profile(MENTOR))[0].capacity_target).toBe(3);
      // Hai dòng log cùng một giao dịch nên cùng created_at: xếp theo chính số đã đặt,
      // đừng dựa vào thứ tự đọc ra (id ngẫu nhiên — test từng lúc xanh lúc đỏ).
      const written = (await logs())
        .map((l) => [l.actor_admin_user_id, (l.after_data as { capacity_target: number }).capacity_target] as const)
        .sort((a, b) => a[1] - b[1]);
      expect(written).toEqual([[SUPER, 2], [ADMIN_OPS, 3]]);
    }));

  it("từ chối và KHÔNG ghi gì: Support team, Reviewer dù có quyền vận hành, Core chỉ đọc, Core bị khoá, Core mùa khác, người lạ", () =>
    isolated(async () => {
      const before = await snapshot();
      for (const actor of [ids.support, REVIEWER_OPS, CORE_READ, CORE_LOCKED, CORE_OTHER_SEASON, uuid(899)]) {
        await db.exec("savepoint tu_choi");
        await expect(setCapacity(actor, MENTOR, 1, 3)).rejects.toThrow(/ACCESS_DENIED/);
        await db.exec("rollback to savepoint tu_choi");
      }
      expect(await snapshot()).toBe(before);
      expect(await logs()).toEqual([]);
    }));

  it("quyền theo MÙA: Core team của mùa sau không sửa được qua mùa này, và ngược lại", () =>
    isolated(async () => {
      await db.exec("savepoint s");
      await expect(setCapacity(ids.btc, NEXT_SEASON_ONLY, 2, 3)).rejects.toThrow(/NOT_SEASON_MENTOR/);
      await db.exec("rollback to savepoint s");
      // ids.btc có quyền cả hai mùa trong bộ thử: gọi đúng mùa của người đó thì được.
      await setCapacity(ids.btc, NEXT_SEASON_ONLY, 2, 3, ids.seasonNext);
      expect((await profile(NEXT_SEASON_ONLY))[0].capacity_target).toBe(3);
      await db.exec("savepoint s2");
      await expect(setCapacity(CORE_OTHER_SEASON, MENTOR, 1, 3, ids.seasonNext)).rejects.toThrow(/NOT_SEASON_MENTOR/);
      await db.exec("rollback to savepoint s2");
      expect((await profile(MENTOR))[0].capacity_target).toBe(1);
    }));

  it("gọi không qua service_role thì bị từ chối: chủ database bị cổng chặn, anon / authenticated không có quyền gọi hàm", () =>
    isolated(async () => {
      await asRole(null, () => expect(setCapacity(ids.btc, MENTOR, 1, 3)).rejects.toThrow(/ACCESS_DENIED/));
      for (const role of ["anon", "authenticated"]) {
        await asRole(role, () => expect(setCapacity(ids.btc, MENTOR, 1, 3)).rejects.toThrow(/permission denied/));
      }
      expect((await profile(MENTOR))[0].capacity_target).toBe(1);
      const { rows } = await db.query<{ definer: boolean; anon: boolean; auth: boolean; service: boolean }>(
        `select prosecdef as definer, has_function_privilege('anon', oid, 'execute') as anon,
                has_function_privilege('authenticated', oid, 'execute') as auth, has_function_privilege('service_role', oid, 'execute') as service
         from pg_proc where oid = '${SIG}'::regprocedure`
      );
      expect(rows[0]).toEqual({ definer: false, anon: false, auth: false, service: true });
    }));

  it("số mới phải là 1..10", () =>
    isolated(async () => {
      for (const bad of [0, -1, 11, 100, null]) {
        await db.exec("savepoint s");
        await expect(setCapacity(ids.btc, MENTOR, 1, bad)).rejects.toThrow(/INVALID_CAPACITY/);
        await db.exec("rollback to savepoint s");
      }
      await setCapacity(ids.btc, MENTOR, 1, 10);
      expect((await profile(MENTOR))[0].capacity_target).toBe(10);
      expect(await logs()).toHaveLength(1);
    }));

  it("không hạ dưới số cặp ĐANG hoạt động của MÙA này; cặp đã kết thúc và cặp mùa khác không tính", () =>
    isolated(async () => {
      await db.exec("savepoint s");
      await expect(setCapacity(ids.btc, BUSY, 3, 1)).rejects.toThrow(/CAPACITY_BELOW_ACTIVE/);
      await db.exec("rollback to savepoint s");
      expect((await profile(BUSY))[0].capacity_target).toBe(3);
      // Bằng đúng số đang nhận thì được: 2 cặp đang hoạt động (không phải 3, không phải 4).
      const { rows } = await setCapacity(ids.btc, BUSY, 3, 2);
      expect(rows[0].result).toMatchObject({ changed: true, capacity: 2, previous: 3, active: 2 });
      expect((await logs())[0].details).toMatchObject({ active_matches: 2 });
    }));

  it("số đang thấy trên màn hình đã cũ thì dừng — kể cả so với giá trị chưa khai", () =>
    isolated(async () => {
      for (const [person, expected] of [[MENTOR, 2], [MENTOR, null], [NO_VALUE, 3]] as const) {
        await db.exec("savepoint s");
        await expect(setCapacity(ids.btc, person, expected, 3)).rejects.toThrow(/STALE_CAPACITY/);
        await db.exec("rollback to savepoint s");
      }
      // Chưa khai (null) + gửi đúng null → đặt được.
      const { rows } = await setCapacity(ids.btc, NO_VALUE, null, 2);
      expect(rows[0].result).toMatchObject({ changed: true, capacity: 2, previous: null });
      expect((await logs())[0]).toMatchObject({ before_data: { capacity_target: null }, after_data: { capacity_target: 2 } });
    }));

  it("lưu lại đúng số cũ: báo không đổi, không ghi log, không đụng updated_at", () =>
    isolated(async () => {
      const before = await snapshot();
      const { rows } = await setCapacity(ids.btc, MENTOR, 1, 1);
      expect(rows[0].result).toEqual({ ok: true, changed: false, capacity: 1, active: 0 });
      expect(await snapshot()).toBe(before);
      expect(await logs()).toEqual([]);
    }));

  it("chỉ sửa mentor ĐANG tham dự mùa: đã rút, vai mentee, mentor mùa khác đều bị từ chối", () =>
    isolated(async () => {
      const before = await snapshot();
      for (const person of [WITHDRAWN, NOT_MENTOR, NEXT_SEASON_ONLY, uuid(898)]) {
        await db.exec("savepoint s");
        await expect(setCapacity(ids.btc, person, 2, 3)).rejects.toThrow(/NOT_SEASON_MENTOR/);
        await db.exec("rollback to savepoint s");
      }
      expect(await snapshot()).toBe(before);
    }));

  it("không có đúng một hồ sơ mentor thì không đoán: hai hồ sơ hoặc không hồ sơ đều dừng", () =>
    isolated(async () => {
      const before = await snapshot();
      for (const person of [TWO_PROFILES, NO_PROFILE]) {
        await db.exec("savepoint s");
        await expect(setCapacity(ids.btc, person, 2, 3)).rejects.toThrow(/MENTOR_IDENTITY_AMBIGUOUS/);
        await db.exec("rollback to savepoint s");
      }
      expect(await snapshot()).toBe(before);
    }));

  it("trần mới có hiệu lực ngay với ghép cặp: mentor đầy được nới thì nhận thêm được đúng một cặp nữa", () =>
    isolated(async () => {
      await match(MENTOR, MENTEES[4]);
      await db.exec("savepoint day");
      await expect(match(MENTOR, MENTEES[2])).rejects.toThrow(/MENTOR_FULL/);
      await db.exec("rollback to savepoint day");

      await setCapacity(ids.btc, MENTOR, 1, 2);

      await match(MENTOR, MENTEES[2]);
      await db.exec("savepoint day2");
      await expect(match(MENTOR, MENTEES[3])).rejects.toThrow(/MENTOR_FULL/);
      await db.exec("rollback to savepoint day2");
    }));
});

describe("migration", () => {
  it("chạy lại lần hai không lỗi và không đổi dữ liệu", () =>
    isolated(async () => {
      const before = await snapshot();
      await db.exec("reset role");
      await db.exec(MIGRATION);
      await db.exec("set role service_role");
      expect(await snapshot()).toBe(before);
      expect(await logs()).toEqual([]);
    }));

  it("dừng sớm nếu ràng buộc action_type của admin_audit_log không nhận update_mentor_profile", () =>
    isolated(async () => {
      await db.exec("reset role");
      await db.exec(`
        alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
        alter table admin_audit_log add constraint admin_audit_log_action_type_check check (action_type = any (array['delete_person','unknown']));
      `);
      await db.exec("savepoint m");
      await expect(db.exec(MIGRATION)).rejects.toThrow(/PREREQ_MISSING/);
      await db.exec("rollback to savepoint m");
      await db.exec("set role service_role");
    }));
});
