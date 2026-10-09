import { beforeAll, afterAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb, ids, uuid } from "./support/offline-postgres";
let db: PGlite;
let rows: Array<{ assignmentId: string; expectedGroup: number; expectedDrift: null }>;
beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  for (const file of ["20261007140000_vong_2_phan_nhom_nganh.sql", "20261008190000_support_team_doi_nhom_vong_2.sql", "20261009235000_round2_bulk_confirm_mentors.sql"])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const n of [901, 902]) {
    await db.query("insert into people(id,full_name) values($1,$2)", [uuid(n), `Mentor ${n}`]);
    await db.query("insert into applications(person_id,season_id,role_applied,status) values($1,$2,'mentor','approved_as_mentor')", [uuid(n), ids.season]);
    await db.query("insert into matching_industry_assignments(person_id,season_id,role,group_code,confidence,rule_version,flags) values($1,$2,'mentor',3,'thap','test',array['CAN_BTC_XEM'])", [uuid(n), ids.season]);
  }
  rows = (await db.query<{ id: string }>("select id from matching_industry_assignments order by id")).rows.map((r) => ({ assignmentId: r.id, expectedGroup: 3, expectedDrift: null }));
  await db.exec("set role service_role");
}, 30000);
afterAll(async () => { await db?.close(); });
const confirm = (actor: string, input = rows) => db.query("select public.vam115_confirm_mentor_groups($1,$2,$3::jsonb) as result", [actor, ids.season, JSON.stringify(input)]);
it("từ chối người không có quyền, không ghi gì", async () => {
  await expect(confirm(ids.mentor)).rejects.toThrow("ACCESS_DENIED");
  expect((await db.query("select count(*)::int as n from matching_industry_assignment_log")).rows[0]).toEqual({ n: 0 });
});
it("một nhóm đã đổi khiến cả lô rollback", async () => {
  await expect(confirm(ids.support, rows.map((r, i) => ({ ...r, expectedGroup: i === 1 ? 4 : 3 })))).rejects.toThrow("STALE_GROUP");
  expect((await db.query<{ source: string }>("select source from matching_industry_assignments")).rows.every((r) => r.source === "auto")).toBe(true);
  expect((await db.query("select count(*)::int as n from matching_industry_assignment_log")).rows[0]).toEqual({ n: 0 });
});
it("từ chối ID trùng và nhóm có dữ liệu mới khác", async () => {
  await expect(confirm(ids.support, [rows[0], rows[0]])).rejects.toThrow("INVALID_ROWS");
  await expect(db.query("select public.vam115_confirm_mentor_groups($1,$2,$3::jsonb)",
    [ids.support, ids.season, JSON.stringify([{ ...rows[0], expectedDrift: 2 }])])).rejects.toThrow("STALE_GROUP");
  expect((await db.query("select count(*)::int as n from matching_industry_assignment_log")).rows[0]).toEqual({ n: 0 });
});
it("Support duyệt đúng cả lô, có nhật ký và gỡ cờ; lô cũ không duyệt lại", async () => {
  expect((await confirm(ids.support)).rows[0]).toEqual({ result: { ok: true, approved: 2 } });
  const saved = (await db.query("select source,reviewed_by,flags,group_code from matching_industry_assignments")).rows;
  expect(saved).toHaveLength(2);
  for (const row of saved) expect(row).toEqual({ source: "btc", reviewed_by: ids.support, flags: [], group_code: 3 });
  const log = (await db.query("select action,actor_id,old_group,new_group from matching_industry_assignment_log")).rows;
  expect(log).toHaveLength(2);
  for (const row of log) expect(row).toEqual({ action: "btc_confirm", actor_id: ids.support, old_group: 3, new_group: 3 });
  await expect(confirm(ids.support)).rejects.toThrow("STALE_GROUP");
});
