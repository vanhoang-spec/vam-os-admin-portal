/**
 * Migration 20261008190000 — Support team đổi / xác nhận nhóm ngành Vòng 2. Chạy THẬT
 * trên PostgreSQL (PGlite), sau migration phân nhóm 20261007140000.
 *
 * Điều phải đúng: Support team CÓ quyền vận hành mùa đổi được nhóm, có log mang chính
 * người đổi; Support team chỉ có quyền đọc, bị khoá tài khoản, hay Reviewer dù có quyền
 * vận hành đều bị từ chối; phân loại hàng loạt vẫn chỉ Core team trở lên; thân hàm đổi
 * nhóm giữ nguyên, chỉ đổi đúng dòng kiểm quyền.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const BASE = "supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql";
const MIGRATION = "supabase/migrations/20261008190000_support_team_doi_nhom_vong_2.sql";

const MENTEE = { person: uuid(601), app: uuid(602) };
const SUPPORT_READ = uuid(611);
const SUPPORT_LOCKED = uuid(612);
const REVIEWER_OPS = uuid(613);
const SUPPORT_OTHER_SEASON = uuid(614);

let db: PGlite;
let defBefore = "";

const SET_GROUP_SIG = "public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text)";
const functionDef = async (sig: string) =>
  (await db.query<{ def: string }>(`select pg_get_functiondef('${sig}'::regprocedure) as def`)).rows[0].def;

const menteeRow = (group: number) =>
  JSON.stringify([{ role: "mentee", personId: MENTEE.person, applicationId: MENTEE.app, group, confidence: "thap", flags: ["CAN_BTC_XEM"], secondary: [], evidence: { reasons: [] } }]);
const save = (actor: string, group: number) =>
  db.query("select vam112_save_industry_assignments($1,$2,$3::jsonb,'2026-10-07.1') as result", [actor, ids.season, menteeRow(group)]);
const setGroup = (actor: string, assignment: string, expected: number, next: number, reason: string) =>
  db.query("select vam112_set_industry_group($1,$2,$3::smallint,$4::smallint,$5) as result", [actor, assignment, expected, next, reason]);
const assignment = async () =>
  (await db.query<{ id: string; group_code: number; flags: string[]; source: string; reviewed_by: string | null; override_reason: string | null }>(
    "select id,group_code,flags,source,reviewed_by,override_reason from matching_industry_assignments where person_id=$1",
    [MENTEE.person]
  )).rows[0];
const lastLog = async (assignmentId: string) =>
  (await db.query<{ actor_id: string; action: string; old_group: number; new_group: number; reason: string }>(
    "select actor_id,action,old_group,new_group,reason from matching_industry_assignment_log where assignment_id=$1 order by id desc limit 1",
    [assignmentId]
  )).rows[0];

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  await db.query("insert into people(id,full_name) values($1,'Mentee A')", [MENTEE.person]);
  await db.query("insert into applications(id,season_id,person_id,role_applied,status) values($1,$2,$3,'mentee','approved_as_mentee')", [
    MENTEE.app,
    ids.season,
    MENTEE.person
  ]);
  // ids.support: support_team + operations mùa này (dựng sẵn). Thêm các trường hợp biên.
  await db.exec(`
    insert into admin_users values
      ('${SUPPORT_READ}','${SUPPORT_READ}','support-read@example.test','Support đọc','active','support_team'),
      ('${SUPPORT_LOCKED}','${SUPPORT_LOCKED}','support-locked@example.test','Support khoá','inactive','support_team'),
      ('${REVIEWER_OPS}','${REVIEWER_OPS}','reviewer-ops@example.test','Reviewer vận hành','active','reviewer'),
      ('${SUPPORT_OTHER_SEASON}','${SUPPORT_OTHER_SEASON}','support-s13@example.test','Support mùa khác','active','support_team');
    insert into admin_scope_access values
      ('${SUPPORT_READ}','active','${ids.season}','read'),
      ('${SUPPORT_LOCKED}','active','${ids.season}','operations'),
      ('${REVIEWER_OPS}','active','${ids.season}','operations'),
      ('${SUPPORT_OTHER_SEASON}','active','${ids.seasonNext}','operations');
  `);
  await db.exec(read(BASE));
  defBefore = await functionDef(SET_GROUP_SIG);
  await db.exec(read(MIGRATION));
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("Support team đổi nhóm", () => {
  it("Support team có quyền vận hành mùa: đổi nhóm, gỡ cờ, log mang chính người đổi", () =>
    isolated(async () => {
      await save(ids.btc, 2);
      const a = await assignment();
      await setGroup(ids.support, a.id, 2, 3, "Bạn muốn làm phân tích đầu tư");
      expect(await assignment()).toMatchObject({ group_code: 3, flags: [], source: "btc", reviewed_by: ids.support, override_reason: "Bạn muốn làm phân tích đầu tư" });
      expect(await lastLog(a.id)).toEqual({ actor_id: ids.support, action: "btc_override", old_group: 2, new_group: 3, reason: "Bạn muốn làm phân tích đầu tư" });
    }));

  it("Support team xác nhận nhóm (giữ nguyên + lý do) và Core team vẫn đổi được như trước", () =>
    isolated(async () => {
      await save(ids.btc, 2);
      const a = await assignment();
      await setGroup(ids.support, a.id, 2, 2, "Đã đọc hồ sơ, đúng nhóm");
      expect(await lastLog(a.id)).toMatchObject({ actor_id: ids.support, action: "btc_confirm" });
      await setGroup(ids.btc, a.id, 2, 4, "BTC đổi lại");
      expect(await assignment()).toMatchObject({ group_code: 4, reviewed_by: ids.btc });
    }));

  it("từ chối: Support chỉ quyền đọc, Support bị khoá, Support mùa khác, Reviewer dù có quyền vận hành", () =>
    isolated(async () => {
      await save(ids.btc, 2);
      const a = await assignment();
      for (const actor of [SUPPORT_READ, SUPPORT_LOCKED, SUPPORT_OTHER_SEASON, REVIEWER_OPS, ids.other]) {
        await db.exec("savepoint s");
        await expect(setGroup(actor, a.id, 2, 3, "lý do")).rejects.toThrow("ACCESS_DENIED");
        await db.exec("rollback to savepoint s");
      }
      expect(await assignment()).toMatchObject({ group_code: 2, source: "auto", reviewed_by: null });
    }));

  it("phân loại hàng loạt vẫn chỉ Core team trở lên — Support team không lưu được", () =>
    isolated(async () => {
      await expect(save(ids.support, 2)).rejects.toThrow("ACCESS_DENIED");
    }));
});

describe("hình dạng hàm và chạy lại", () => {
  it("thân hàm đổi nhóm giữ nguyên, chỉ đổi đúng dòng kiểm quyền", async () => {
    const after = await functionDef(SET_GROUP_SIG);
    expect(after).not.toBe(defBefore);
    expect(after.split("vam114_round2_group_editor_for_season").join("vam084_operator_for_season")).toBe(defBefore);
  });

  it("anon/authenticated không gọi được; chạy lại migration không lỗi, không đổi nhóm đã lưu", () =>
    isolated(async () => {
      await save(ids.btc, 2);
      await db.exec("reset role");
      const canRun = async (role: string, sig: string) =>
        (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${sig}', 'execute') as ok`)).rows[0].ok;
      expect(await canRun("anon", "public.vam114_round2_group_editor_for_season(uuid, uuid)")).toBe(false);
      expect(await canRun("authenticated", "public.vam114_round2_group_editor_for_season(uuid, uuid)")).toBe(false);
      expect(await canRun("anon", SET_GROUP_SIG)).toBe(false);
      expect(await canRun("service_role", SET_GROUP_SIG)).toBe(true);
      await db.exec(read(MIGRATION));
      await db.exec("set role service_role");
      expect(await assignment()).toMatchObject({ group_code: 2 });
    }));

  it("gọi ngoài service_role thì cổng trả false, dù người đó đủ quyền", () =>
    isolated(async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ ok: boolean }>("select public.vam114_round2_group_editor_for_season($1,$2) as ok", [ids.support, ids.season]);
      expect(rows[0].ok).toBe(false);
      await db.exec("set role service_role");
    }));
});
