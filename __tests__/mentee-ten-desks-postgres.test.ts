import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, ids, offlineDb, save, uuid } from "./support/offline-postgres";

const migration = readFileSync("supabase/migrations/20261009100000_phong_pv_10_ban.sql", "utf8");
const rpc = "public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)";

describe("10 bàn mỗi phòng — thực thi PostgreSQL qua RPC thật", () => {
  let db: PGlite;
  let oldDefinition: string;
  beforeAll(async () => {
    db = await offlineDb();
    await db.exec("reset role;");
    oldDefinition = (await db.query<{ def: string }>("select pg_get_functiondef($1::regprocedure) as def", [rpc])).rows[0].def;
    await db.exec(migration);
    await db.exec("set role service_role;");
  }, 60000);
  afterAll(async () => { await db?.close(); });

  async function isolated(run: () => Promise<void>) {
    await db.exec("begin");
    try { await run(); } finally { await db.exec("rollback"); }
  }
  async function rejects(run: () => Promise<unknown>, error: string) {
    await db.exec("savepoint expected_failure");
    await expect(run()).rejects.toThrow(error);
    await db.exec("rollback to savepoint expected_failure");
  }

  it("chỉ nới cận bàn của RPC, giữ nguyên toàn bộ luật quyền và phiếu chấm", async () => {
    const def = (await db.query<{ def: string }>("select pg_get_functiondef($1::regprocedure) as def", [rpc])).rows[0].def;
    expect(def).toBe(oldDefinition.replace("v_desk not between 1 and 6", "v_desk not between 1 and 10"));
  });

  it.each([7, 10])("sáng 10/10: 3 phòng, ca 18 chỗ vẫn lưu được bàn %s", (desk) => isolated(async () => {
    await db.exec("reset role;");
    await db.query("update interview_sessions set starts_at='2026-10-10 08:00:00+07', ends_at='2026-10-10 08:30:00+07', venue='Phòng E501, E502, E504 — Cơ sở E' where id=$1", [ids.session]);
    await db.exec("set role service_role;");
    await save(db, "checkin", 0);
    await save(db, "assign", 1, { room: 3, desk, interviewerId: ids.mentor });
    expect((await db.query("select room,desk,interviewer_id from mentee_interview_operations where id=$1", [ids.app])).rows)
      .toEqual([{ room: 3, desk, interviewer_id: ids.mentor }]);
  }));

  it("Chủ nhật: phòng thứ 6 bàn 10 lưu được; phòng 7, bàn 0/11 và mentor thiếu quyền bị chặn", () => isolated(async () => {
    const app = uuid(821);
    await addCandidate(db, app, ids.sessionSun);
    await save(db, "checkin", 0, {}, ids.support, app);
    for (const desk of [0, 11]) {
      await rejects(() => save(db, "assign", 1, { room: 6, desk, interviewerId: ids.mentor }, ids.support, app), "INVALID_ASSIGNMENT");
    }
    await rejects(() => save(db, "assign", 1, { room: 7, desk: 10, interviewerId: ids.mentor }, ids.support, app), "INVALID_ASSIGNMENT");
    await rejects(() => save(db, "assign", 1, { room: 6, desk: 10, interviewerId: ids.other }, ids.support, app), "INVALID_ASSIGNMENT");
    expect((await db.query("select room,desk,revision from mentee_interview_operations where id=$1", [app])).rows)
      .toEqual([{ room: null, desk: null, revision: 1 }]);
    await save(db, "assign", 1, { room: 6, desk: 10, interviewerId: ids.mentor }, ids.support, app);
    expect((await db.query("select room,desk from mentee_interview_operations where id=$1", [app])).rows)
      .toEqual([{ room: 6, desk: 10 }]);
  }));

  it("ghi trực tiếp vẫn bị CHECK chặn bàn 11 và trigger chặn phòng vượt địa điểm", () => isolated(async () => {
    await save(db, "checkin", 0);
    await rejects(() => db.query("update mentee_interview_operations set room=1,desk=11 where id=$1", [ids.app]), "ROOM_DESK_OUT_OF_RANGE");
    await rejects(() => db.query("update mentee_interview_operations set room=4,desk=10 where id=$1", [ids.app]), "ROOM_DESK_OUT_OF_RANGE");
    await db.exec("reset role; alter table mentee_interview_operations disable trigger vam104_room_desk_bounds;");
    await rejects(() => db.query("update mentee_interview_operations set room=1,desk=11 where id=$1", [ids.app]), "mentee_interview_operations_desk_check");
  }));

  it("SQL dán lại được, không đổi số chỗ mentee hoặc địa điểm ca", async () => {
    const before = (await db.query("select id,venue,seat_limit from interview_sessions order by id")).rows;
    await db.exec("reset role;");
    await db.exec(migration);
    expect((await db.query("select id,venue,seat_limit from interview_sessions order by id")).rows).toEqual(before);
    await db.exec("set role service_role;");
  });
});
