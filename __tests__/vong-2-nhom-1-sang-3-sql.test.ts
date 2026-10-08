/**
 * SQL dữ liệu 20261008223000 — 16 mentor nhóm 1 sang nhóm 3. Chạy THẬT trên PostgreSQL
 * (PGlite), sau hai migration phân nhóm (20261007140000) và cổng Support (20261008190000).
 *
 * Điều phải đúng: chỉ đúng người trong danh sách đang ở nhóm 1 bị chuyển, qua hàm đổi
 * nhóm (log mang người đổi + lý do có tên công ty); người đã được đổi sang nhóm khác thì
 * bỏ qua; mentor ngân hàng ngoài danh sách không bị chạm; thiếu một người thì dừng cả
 * lô; chạy lại không đổi gì; vai trò phiên trả về như cũ sau khi chạy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const SQL_FILE = "supabase/migrations/20261008223000_vong_2_mentor_nhom_1_sang_nhom_3.sql";
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const ACTOR = "a3f45586-8747-49d9-860a-4b903cfdc7bc";
const BANK_MENTOR = uuid(701);

// Danh sách lấy thẳng từ file SQL — test và file không thể lệch nhau.
const TARGETS = Array.from(read(SQL_FILE).matchAll(/\('([0-9a-f-]{36})'::uuid, '([^']+)', '([^']+)'\)/g)).map((m) => ({
  personId: m[1],
  name: m[2],
  company: m[3]
}));
const ALREADY_MOVED = TARGETS[10]; // Support team đã đổi tay sang nhóm 8 trước khi chạy

let db: PGlite;

const groupOf = async (personId: string) =>
  (await db.query<{ group_code: number; source: string; flags: string[]; reviewed_by: string | null }>(
    "select group_code, source, flags, reviewed_by from matching_industry_assignments where season_id=$1 and person_id=$2 and role='mentor'",
    [S12, personId]
  )).rows[0];
const logCount = async () => (await db.query<{ n: number }>("select count(*)::int as n from matching_industry_assignment_log")).rows[0].n;

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
  await db.exec(read("supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql"));
  await db.exec(read("supabase/migrations/20261008190000_support_team_doi_nhom_vong_2.sql"));
  await db.query("insert into seasons values($1,$2,'UEHM-S12-PROD')", [S12, ids.program]);
  await db.query("insert into admin_users values($1,$1,'hoang@example.test','Hoàng','active','super_admin')", [ACTOR]);
  const everyone = [...TARGETS.map((t) => ({ personId: t.personId, name: t.name })), { personId: BANK_MENTOR, name: "Mentor BIDV" }];
  for (const p of everyone) {
    await db.query("insert into people(id,full_name) values($1,$2)", [p.personId, p.name]);
    const { rows: [app] } = await db.query<{ id: string }>(
      "insert into applications(season_id,person_id,role_applied,status) values($1,$2,'mentor','approved_as_mentor') returning id",
      [S12, p.personId]
    );
    await db.query(
      `insert into matching_industry_assignments(season_id,person_id,role,application_id,group_code,confidence,flags,rule_version)
       values($1,$2,'mentor',$3,$4,'thap','{CAN_BTC_XEM}','2026-10-07.1')`,
      [S12, p.personId, app.id, p.personId === ALREADY_MOVED.personId ? 8 : 1]
    );
  }
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("SQL chuyển mentor nhóm 1 sang nhóm 3", () => {
  it("danh sách trong file đúng 16 người, không trùng", () => {
    expect(TARGETS).toHaveLength(16);
    expect(new Set(TARGETS.map((t) => t.personId)).size).toBe(16);
  });

  it("thiếu một người trong danh sách thì dừng cả lô — kể cả khi người thiếu nằm cuối danh sách", () =>
    isolated(async () => {
      const last = TARGETS[TARGETS.length - 1];
      await db.query("delete from matching_industry_assignments where person_id=$1", [last.personId]);
      await db.exec("savepoint s");
      await expect(db.exec(read(SQL_FILE))).rejects.toThrow(`NOT_FOUND: ${last.name}`);
      await db.exec("rollback to savepoint s");
      expect(await groupOf(TARGETS[0].personId)).toMatchObject({ group_code: 1, source: "auto" });
      expect(await logCount()).toBe(0);
    }));

  it("SQL Editor chạy cả file trong một giao dịch: sau khối đổi nhóm, vai trò trả về như cũ", () =>
    isolated(async () => {
      await db.exec(read(SQL_FILE));
      expect((await db.query<{ u: string }>("select current_user as u")).rows[0].u).toBe("postgres");
    }));

  it("chuyển đúng 15 người đang ở nhóm 1 qua hàm đổi nhóm; người đã đổi tay và mentor ngân hàng không bị chạm", async () => {
    const before = await logCount();
    const results = await db.exec(read(SQL_FILE));
    expect((await db.query<{ u: string }>("select current_user as u")).rows[0].u).toBe("postgres");

    for (const t of TARGETS) {
      if (t.personId === ALREADY_MOVED.personId) continue;
      expect(await groupOf(t.personId)).toEqual({ group_code: 3, source: "btc", flags: [], reviewed_by: ACTOR });
    }
    expect(await groupOf(ALREADY_MOVED.personId)).toMatchObject({ group_code: 8, source: "auto" });
    expect(await groupOf(BANK_MENTOR)).toMatchObject({ group_code: 1, source: "auto" });

    const logs = (
      await db.query<{ actor_id: string; action: string; old_group: number; new_group: number; reason: string; full_name: string }>(
        `select l.actor_id, l.action, l.old_group, l.new_group, l.reason, p.full_name
           from matching_industry_assignment_log l
           join matching_industry_assignments a on a.id = l.assignment_id
           join people p on p.id = a.person_id
          order by l.id`
      )
    ).rows.slice(before);
    expect(logs).toHaveLength(15);
    for (const log of logs) {
      const t = TARGETS.find((x) => x.name === log.full_name)!;
      expect(log).toMatchObject({ actor_id: ACTOR, action: "btc_override", old_group: 1, new_group: 3 });
      expect(log.reason).toContain(`(${t.company})`);
    }

    // Bảng kết quả cuối file: đủ 16 dòng, người đã đổi tay hiện đúng nhóm 8.
    const table = results.at(-1)!.rows as Array<{ mentor: string; nhom_hien_tai: number }>;
    expect(table).toHaveLength(16);
    expect(table.find((r) => r.mentor === ALREADY_MOVED.name)?.nhom_hien_tai).toBe(8);
    expect(table.filter((r) => r.nhom_hien_tai === 3)).toHaveLength(15);
  });

  it("chạy lại lần hai: không đổi gì, không thêm log", async () => {
    const before = await logCount();
    await db.exec(read(SQL_FILE));
    expect(await logCount()).toBe(before);
    expect(await groupOf(TARGETS[0].personId)).toMatchObject({ group_code: 3 });
  });
});
