/**
 * Bàn / người phỏng vấn được giải phóng sau khi chấm xong (migration 20261003100000).
 *
 * Sự cố 03/10/2026: ca 08:30 chạy trễ, mentor chấm xong một mentee rồi nhận tiếp
 * mentee CÙNG ca tại cùng bàn — bị chặn vì chỉ số duy nhất khoá cả buổi đã chấm.
 */
import { readFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, ids, offlineDb, pass, save } from "./support/offline-postgres";

const MIGRATION = readFileSync("supabase/migrations/20261003100000_mentee_ban_pv_mo_lai_sau_khi_cham.sql", "utf8");
const B = "00000000-0000-4000-8000-000000000801";
const C = "00000000-0000-4000-8000-000000000802";

let db: PGlite;
beforeEach(async () => {
  db = await offlineDb();
  await db.exec("reset role;");
  await addCandidate(db, B);
  await addCandidate(db, C);
  await db.exec(MIGRATION);
  await db.exec("set role service_role;");
  // Mentee A (ids.app) vào phòng 1 bàn 1 với mentor.
  await save(db, "checkin", 0, {}, ids.support, ids.app);
  await save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, ids.app);
  await save(db, "checkin", 0, {}, ids.support, B);
}, 60000);

it("A chưa có kết quả: mentee khác cùng ca KHÔNG vào được cùng bàn, cùng mentor", async () => {
  await expect(save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, B)).rejects.toThrow();
});

it("A đã chấm xong: mentee kế tiếp cùng ca vào được ĐÚNG bàn đó với ĐÚNG mentor đó", async () => {
  await save(db, "result", 2, pass, ids.mentor, ids.app);
  await save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, B);
  const { rows } = await db.query<{ room: number; desk: number; interviewer_id: string }>(
    "select room, desk, interviewer_id from mentee_interview_operations where id = $1", [B]
  );
  expect(rows[0]).toEqual({ room: 1, desk: 1, interviewer_id: ids.mentor });
  // Vẫn không có HAI mentee đang phỏng vấn cùng lúc tại một bàn.
  await save(db, "checkin", 0, {}, ids.support, C);
  await expect(save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, C)).rejects.toThrow();
});
