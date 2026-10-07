/**
 * Migration phân nhóm ngành Vòng 2 — chạy THẬT trên PostgreSQL (PGlite).
 *
 * Điều phải đúng: nhóm đã lưu bị KHOÁ (lần lưu sau không đổi, chỉ ghi drift); chỉ một
 * đường đổi nhóm, có lý do và có log; người không vận hành mùa không ghi được gì; và
 * bảng mới không mở cho anon.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const MIGRATION = "supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql";

const MENTEE = { person: uuid(401), app: uuid(402) };
const OUTSIDER = { person: uuid(403), app: uuid(404) };
let mentorApp = "";

let db: PGlite;
const rows = (overrides: Array<Record<string, unknown>>) => JSON.stringify(overrides);
const mentorRow = (group: number) => ({ role: "mentor", personId: ids.person, applicationId: mentorApp, group, confidence: "trung_binh", flags: [], secondary: [3], evidence: { reasons: ["Chức năng: marketing"] } });
const menteeRow = (group: number, flags: string[] = []) => ({ role: "mentee", personId: MENTEE.person, applicationId: MENTEE.app, group, confidence: flags.length ? "thap" : "cao", flags, secondary: [], evidence: { reasons: [] } });

async function save(actor: string, payload: string) {
  const { rows: [r] } = await db.query<{ result: Record<string, number> }>(
    "select vam112_save_industry_assignments($1,$2,$3::jsonb,'2026-10-07.1') as result",
    [actor, ids.season, payload]
  );
  return r.result;
}
async function setGroup(actor: string, assignment: string, expected: number, next: number, reason: string | null) {
  return db.query("select vam112_set_industry_group($1,$2,$3::smallint,$4::smallint,$5) as result", [actor, assignment, expected, next, reason]);
}
const assignment = async (personId: string) =>
  (await db.query<{ id: string; group_code: number; drift_group: number | null; flags: string[]; source: string; confidence: string }>(
    "select id,group_code,drift_group,flags,source,confidence from matching_industry_assignments where person_id=$1",
    [personId]
  )).rows[0];
const logActions = async (assignmentId: string) =>
  (await db.query<{ action: string; old_group: number | null; new_group: number | null; reason: string | null }>(
    "select action,old_group,new_group,reason from matching_industry_assignment_log where assignment_id=$1 order by id",
    [assignmentId]
  )).rows;

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
  mentorApp = (await db.query<{ id: string }>("select id from applications where person_id=$1", [ids.person])).rows[0].id;
  await db.query("insert into people(id,full_name) values($1,'Mentee A'),($2,'Người ngoài')", [MENTEE.person, OUTSIDER.person]);
  await db.query(
    `insert into applications(id,season_id,person_id,role_applied,status) values
       ($1,$2,$3,'mentee','approved_as_mentee'),
       ($4,$2,$5,'mentee','needs_more_review')`,
    [MENTEE.app, ids.season, MENTEE.person, OUTSIDER.app, OUTSIDER.person]
  );
  await db.exec(read(MIGRATION));
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("vam112_save_industry_assignments", () => {
  it("lưu người chưa có nhóm, kèm log; lần lưu sau KHÔNG đổi nhóm, chỉ ghi drift", () =>
    isolated(async () => {
      expect(await save(ids.btc, rows([mentorRow(4), menteeRow(2, ["CAN_BTC_XEM"])]))).toEqual({ ok: true, newMentors: 1, newMentees: 1, drift: 0 });
      const mentee = await assignment(MENTEE.person);
      expect(mentee).toMatchObject({ group_code: 2, drift_group: null, flags: ["CAN_BTC_XEM"], source: "auto", confidence: "thap" });
      expect(await logActions(mentee.id)).toEqual([{ action: "auto_assign", old_group: null, new_group: 2, reason: null }]);

      // Dữ liệu đổi → nhóm giữ nguyên, ghi drift + log (một lần, không lặp khi lưu lại).
      expect(await save(ids.btc, rows([mentorRow(4), menteeRow(3)]))).toEqual({ ok: true, newMentors: 0, newMentees: 0, drift: 1 });
      expect(await save(ids.btc, rows([mentorRow(4), menteeRow(3)]))).toEqual({ ok: true, newMentors: 0, newMentees: 0, drift: 0 });
      expect(await assignment(MENTEE.person)).toMatchObject({ group_code: 2, drift_group: 3 });
      expect((await logActions(mentee.id)).map((l) => l.action)).toEqual(["auto_assign", "drift"]);

      // Dữ liệu quay về nhóm cũ → drift được xoá.
      await save(ids.btc, rows([menteeRow(2)]));
      expect(await assignment(MENTEE.person)).toMatchObject({ group_code: 2, drift_group: null });
    }));

  it("người không vận hành mùa không ghi được gì", () =>
    isolated(async () => {
      for (const actor of [ids.support, ids.mentor, ids.other]) {
        await db.exec("savepoint s");
        await expect(save(actor, rows([menteeRow(2)]))).rejects.toThrow("ACCESS_DENIED");
        await db.exec("rollback to savepoint s");
      }
      expect((await db.query("select count(*)::int as n from matching_industry_assignments")).rows).toEqual([{ n: 0 }]);
    }));

  it("người chưa được duyệt bị từ chối, và cả lần lưu không ghi dở", () =>
    isolated(async () => {
      const bad = { role: "mentee", personId: OUTSIDER.person, applicationId: OUTSIDER.app, group: 4, confidence: "cao", flags: [], secondary: [], evidence: {} };
      await expect(save(ids.btc, rows([menteeRow(2), bad]))).rejects.toThrow("NOT_APPROVED");
    }));

  it("dữ liệu sai hình dạng bị từ chối", () =>
    isolated(async () => {
      await db.exec("savepoint s");
      await expect(save(ids.btc, rows([menteeRow(10)]))).rejects.toThrow("INVALID_ROW");
      await db.exec("rollback to savepoint s");
      await expect(save(ids.btc, JSON.stringify({ not: "array" }))).rejects.toThrow("INVALID_ROWS");
    }));
});

describe("khoá nhóm", () => {
  it("lệnh update gõ tay không đổi được nhóm hay người", () =>
    isolated(async () => {
      await save(ids.btc, rows([menteeRow(2)]));
      await db.exec("savepoint s");
      await expect(db.query("update matching_industry_assignments set group_code=5 where person_id=$1", [MENTEE.person])).rejects.toThrow(
        "INDUSTRY_GROUP_LOCKED"
      );
      await db.exec("rollback to savepoint s");
      await expect(db.query("update matching_industry_assignments set person_id=$1 where person_id=$2", [OUTSIDER.person, MENTEE.person])).rejects.toThrow(
        "INDUSTRY_ASSIGNMENT_IMMUTABLE"
      );
    }));
});

describe("vam112_set_industry_group", () => {
  it("BTC đổi nhóm có lý do: nhóm mới, nguồn btc, gỡ cờ, có log — và khoá vẫn còn sau đó", () =>
    isolated(async () => {
      await save(ids.btc, rows([menteeRow(2, ["CAN_BTC_XEM"])]));
      await save(ids.btc, rows([menteeRow(3)])); // drift
      const a = await assignment(MENTEE.person);
      await setGroup(ids.btc, a.id, 2, 3, "Bạn muốn làm phân tích đầu tư");
      expect(await assignment(MENTEE.person)).toMatchObject({ group_code: 3, source: "btc", flags: [], drift_group: null, confidence: "cao" });
      expect((await logActions(a.id)).at(-1)).toEqual({ action: "btc_override", old_group: 2, new_group: 3, reason: "Bạn muốn làm phân tích đầu tư" });
      await expect(db.query("update matching_industry_assignments set group_code=1 where id=$1", [a.id])).rejects.toThrow("INDUSTRY_GROUP_LOCKED");
    }));

  it("giữ nguyên nhóm = xác nhận, gỡ cờ", () =>
    isolated(async () => {
      await save(ids.btc, rows([menteeRow(9, ["CAN_BTC_XEM"])]));
      const a = await assignment(MENTEE.person);
      await setGroup(ids.btc, a.id, 9, 9, "Đã đọc hồ sơ, đúng nhóm Khác");
      expect(await assignment(MENTEE.person)).toMatchObject({ group_code: 9, flags: [], source: "btc" });
      expect((await logActions(a.id)).at(-1)?.action).toBe("btc_confirm");
    }));

  it("từ chối: nhóm đã bị đổi ở nơi khác, thiếu lý do, nhóm ngoài 1–9, người không vận hành mùa", () =>
    isolated(async () => {
      await save(ids.btc, rows([menteeRow(2)]));
      const a = await assignment(MENTEE.person);
      const cases: Array<[() => Promise<unknown>, string]> = [
        [() => setGroup(ids.btc, a.id, 4, 3, "lý do"), "STALE_GROUP"],
        [() => setGroup(ids.btc, a.id, 2, 3, "   "), "REASON_REQUIRED"],
        [() => setGroup(ids.btc, a.id, 2, 0, "lý do"), "INVALID_GROUP"],
        [() => setGroup(ids.support, a.id, 2, 3, "lý do"), "ACCESS_DENIED"],
        [() => setGroup(ids.btc, uuid(999), 2, 3, "lý do"), "NOT_FOUND"]
      ];
      for (const [run, code] of cases) {
        await db.exec("savepoint s");
        await expect(run()).rejects.toThrow(code);
        await db.exec("rollback to savepoint s");
      }
      expect(await assignment(MENTEE.person)).toMatchObject({ group_code: 2, source: "auto" });
    }));
});

describe("quyền và chạy lại", () => {
  it("anon không đọc được; service_role không xoá được; log không sửa được", () =>
    isolated(async () => {
      await db.exec("reset role");
      const priv = async (role: string, table: string, p: string) =>
        (await db.query<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${table}', '${p}') as ok`)).rows[0].ok;
      expect(await priv("anon", "matching_industry_assignments", "select")).toBe(false);
      expect(await priv("authenticated", "matching_industry_assignment_log", "select")).toBe(false);
      expect(await priv("service_role", "matching_industry_assignments", "delete")).toBe(false);
      expect(await priv("service_role", "matching_industry_assignment_log", "update")).toBe(false);
      expect(await priv("service_role", "matching_industry_assignments", "update")).toBe(true);
    }));

  it("chạy lại migration không lỗi, không mất nhóm đã lưu", () =>
    isolated(async () => {
      await save(ids.btc, rows([menteeRow(2)]));
      await db.exec("reset role");
      await db.exec(read(MIGRATION));
      await db.exec("set role service_role");
      expect(await assignment(MENTEE.person)).toMatchObject({ group_code: 2 });
    }));
});
