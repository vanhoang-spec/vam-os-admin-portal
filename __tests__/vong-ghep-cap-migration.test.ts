/**
 * Vòng ghép cặp (BTC 07/10/2026) — chạy THẬT trên PostgreSQL (PGlite), qua đúng hàm
 * vam104 mà người phỏng vấn bấm lúc nhận mentee.
 *
 * Luật: mentee được người phỏng vấn nhận ngay tại buổi phỏng vấn là ghép cặp VÒNG 1, ở
 * mọi đợt. Đợt 03–04/10 được gắn bằng phần cập nhật của migration; đợt 10–11/10 trở đi
 * phải tự gắn lúc nhận, không ai phải nhớ chạy thêm gì.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, assigned, ids, offlineDb, pass, save, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const MIGRATION = "supabase/migrations/20261007120000_vong_ghep_cap.sql";

const P = {
  droppedLinked: uuid(301),
  manualMentee: uuid(302),
  wave2: uuid(303)
};

let db: PGlite;
const round = async (matchId: string) =>
  (await db.query<{ matching_round: number | null }>("select matching_round from matches where id=$1", [matchId])).rows[0]
    ?.matching_round;
const linkedMatch = async (appId: string) =>
  (await db.query<{ match_id: string | null }>("select match_id from mentee_interview_operations where id=$1", [appId])).rows[0]
    ?.match_id ?? null;

let wave1Match = "";
let droppedMatch = "";
let manualMatch = "";

beforeAll(async () => {
  db = await offlineDb();
  // Mentor thử nhận nhiều mentee trong bài này; sức nhận 1 của bộ dựng chung sẽ chặn.
  await db.exec("reset role");
  await db.exec(`update mentor_profiles set capacity_target=5 where person_id='${ids.person}'`);
  await db.exec("set role service_role");

  // ── Trạng thái TRƯỚC migration, giống production sau đợt 03–04/10 ──
  // 1) Người phỏng vấn nhận mentee tại buổi phỏng vấn (qua vam104 thật).
  await assigned(db);
  await save(db, "result", 2, pass, ids.mentor);
  wave1Match = (await linkedMatch(ids.app))!;

  await db.exec("reset role");
  // 2) Cặp nhận tại buổi phỏng vấn rồi bị huỷ vì bấm nhầm, liên kết vẫn còn.
  await addCandidate(db, P.droppedLinked, ids.sessionSun);
  await db.query("insert into people(id,full_name) values($1,'Mentee huỷ')", [P.droppedLinked]);
  droppedMatch = (
    await db.query<{ id: string }>(
      "insert into matches(season_id,mentor_person_id,mentee_person_id,status) values($1,$2,$3,'dropped') returning id",
      [ids.season, ids.person, P.droppedLinked]
    )
  ).rows[0].id;
  await db.query("insert into mentee_interview_operations(id,session_id,outcome,match_id) values($1,$2,'passed',$3)", [
    P.droppedLinked,
    ids.sessionSun,
    droppedMatch
  ]);
  // 3) Cặp BTC ghép tay ở trang Ghép cặp — không qua buổi phỏng vấn.
  await db.query("insert into people(id,full_name) values($1,'Mentee ghép tay')", [P.manualMentee]);
  manualMatch = (
    await db.query<{ id: string }>(
      "insert into matches(season_id,mentor_person_id,mentee_person_id,status) values($1,$2,$3,'active') returning id",
      [ids.season, ids.person, P.manualMentee]
    )
  ).rows[0].id;

  await db.exec(read(MIGRATION));
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("migration vòng ghép cặp", () => {
  it("gắn Vòng 1 cho cặp nhận tại buổi phỏng vấn đang đồng hành — không gắn cặp đã huỷ hay cặp ghép tay", async () => {
    expect(wave1Match).toBeTruthy();
    expect(await round(wave1Match)).toBe(1);
    expect(await round(droppedMatch)).toBeNull();
    expect(await round(manualMatch)).toBeNull();
  });

  it("đợt sau (10–11/10): người phỏng vấn nhận mentee là tự thành Vòng 1, không cần chạy thêm gì", async () => {
    await db.exec("begin");
    try {
      await addCandidate(db, P.wave2, ids.sessionSun);
      await assigned(db, P.wave2, 2, 2);
      await save(db, "result", 2, pass, ids.mentor, P.wave2);
      const match = await linkedMatch(P.wave2);
      expect(match).toBeTruthy();
      expect(await round(match!)).toBe(1);

      // Sửa nhầm rồi nhận lại: cặp cũ bị huỷ, cặp MỚI cũng là vòng 1.
      await save(db, "result", 3, { ...pass, outcome: "rejected", takeChoice: null, reason: "Chọn nhầm" }, ids.mentor, P.wave2);
      await save(db, "result", 4, { ...pass, reason: "Đã kiểm lại" }, ids.mentor, P.wave2);
      const again = await linkedMatch(P.wave2);
      expect(again).toBeTruthy();
      expect(again).not.toBe(match);
      expect(await round(again!)).toBe(1);
    } finally {
      await db.exec("rollback");
    }
  });

  it("đạt nhưng KHÔNG nhận thì không sinh cặp, không có gì để gắn", async () => {
    await db.exec("begin");
    try {
      await addCandidate(db, P.wave2, ids.sessionSun);
      await assigned(db, P.wave2, 2, 2);
      const before = (await db.query<{ n: number }>("select count(*)::int as n from matches where matching_round=1")).rows[0].n;
      await save(db, "result", 2, { ...pass, takeChoice: "recommend_other" }, ids.mentor, P.wave2);
      expect(await linkedMatch(P.wave2)).toBeNull();
      expect((await db.query<{ n: number }>("select count(*)::int as n from matches where matching_round=1")).rows[0].n).toBe(before);
    } finally {
      await db.exec("rollback");
    }
  });

  it("cặp đã mang vòng khác không bị kéo về vòng 1 khi phiếu được lưu lại", async () => {
    await db.exec("begin");
    try {
      await db.query("update matches set matching_round=2 where id=$1", [manualMatch]);
      await db.query("update mentee_interview_operations set match_id=$1 where id=$2", [manualMatch, P.droppedLinked]);
      expect(await round(manualMatch)).toBe(2);
    } finally {
      await db.exec("rollback");
    }
  });

  it("chạy lại migration không lỗi và không đổi gì", async () => {
    await db.exec("begin");
    try {
      await db.exec("reset role");
      const snapshot = async () =>
        (await db.query("select id,matching_round from matches order by id")).rows;
      const before = await snapshot();
      await db.exec(read(MIGRATION));
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.exec("rollback");
      await db.exec("set role service_role");
    }
  });

  it("chỉ nhận số vòng từ 1 trở lên", async () => {
    await db.exec("begin");
    try {
      await expect(db.query("update matches set matching_round=0 where id=$1", [manualMatch])).rejects.toThrow(
        "matches_matching_round_check"
      );
    } finally {
      await db.exec("rollback");
    }
  });
});
