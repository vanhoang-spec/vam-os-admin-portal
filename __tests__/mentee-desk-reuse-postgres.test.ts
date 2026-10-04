/**
 * Bàn / người phỏng vấn không còn bị khoá (migration 20261004110000).
 *
 * Sự cố 03/10/2026: chỉ số duy nhất khoá cả buổi đã chấm → 20261003100000 chỉ khoá
 * buổi CHƯA có kết quả. Sự cố 04/10/2026 (sáng): vẫn ~90 lần chặn — mentor nhận bạn
 * kế tiếp ngay khi phỏng vấn xong, còn phiếu bạn trước viết sau. Bỏ hẳn hai khoá;
 * Support thấy lời nhắc "bàn này đang có ai" trên màn hình thay vì bị chặn.
 */
import { readFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, ids, offlineDb, pass, save } from "./support/offline-postgres";

const PARTIAL = readFileSync("supabase/migrations/20261003100000_mentee_ban_pv_mo_lai_sau_khi_cham.sql", "utf8");
const UNLOCK = readFileSync("supabase/migrations/20261004110000_mentee_bo_khoa_ban_pv.sql", "utf8");
const B = "00000000-0000-4000-8000-000000000801";
const C = "00000000-0000-4000-8000-000000000802";
// Không chọn nhận (mentor thử chỉ có 1 chỗ) — để thử riêng chuyện nộp phiếu, không đụng trần nhận.
const other = () => ({ ...pass, takeChoice: "recommend_other" }); // đọc pass lúc gọi: mã phiếu điền sau khi dựng database

let db: PGlite;
const place = async (id: string) =>
  (await db.query<{ room: number; desk: number; interviewer_id: string; outcome: string | null }>(
    "select room, desk, interviewer_id, outcome from mentee_interview_operations where id = $1", [id]
  )).rows[0];

beforeEach(async () => {
  db = await offlineDb();
  await db.exec("reset role;");
  await addCandidate(db, B);
  await addCandidate(db, C);
  // Đúng thứ tự đã lên production: khoá một phần (03/10) rồi bỏ khoá (04/10).
  await db.exec(PARTIAL);
  await db.exec(UNLOCK);
  await db.exec("set role service_role;");
  // Mentee A (ids.app) vào phòng 1 bàn 1 với mentor.
  await save(db, "checkin", 0, {}, ids.support, ids.app);
  await save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, ids.app);
  await save(db, "checkin", 0, {}, ids.support, B);
  await save(db, "checkin", 0, {}, ids.support, C);
}, 60000);

it("migration bỏ đúng hai khoá, giữ khoá chính", async () => {
  const { rows } = await db.query<{ indexname: string }>(
    "select indexname from pg_indexes where schemaname = 'public' and tablename = 'mentee_interview_operations' order by 1"
  );
  expect(rows.map((r) => r.indexname)).toEqual(["mentee_interview_operations_pkey"]);
});

it("A CHƯA có kết quả: bạn kế tiếp vẫn vào đúng bàn đó với đúng mentor đó (sự cố 04/10)", async () => {
  await save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, B);
  expect(await place(B)).toEqual({ room: 1, desk: 1, interviewer_id: ids.mentor, outcome: null });
  // Bạn thứ ba cũng vậy: mentor giữ được nhiều bạn chưa chấm.
  await save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, C);
  expect(await place(C)).toMatchObject({ room: 1, desk: 1, interviewer_id: ids.mentor });
});

it("mentor nộp phiếu từng bạn sau, không bạn nào đè kết quả bạn nào", async () => {
  await save(db, "assign", 1, { room: 1, desk: 1, interviewerId: ids.mentor }, ids.support, B);
  await save(db, "result", 2, other(), ids.mentor, B);
  expect((await place(B)).outcome).toBe("passed");
  expect((await place(ids.app)).outcome).toBeNull();
  await save(db, "result", 2, other(), ids.mentor, ids.app);
  expect((await place(ids.app)).outcome).toBe("passed");
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from application_reviews where application_id in ($1, $2) and status = 'submitted'", [ids.app, B]
  );
  expect(rows[0].n).toBe(2);
});

it("tự kiểm của migration báo lỗi nếu khoá còn sót", async () => {
  await db.exec("reset role;");
  await db.exec("create unique index mentee_interview_desk_uidx on public.mentee_interview_operations (session_id, room, desk) where room is not null and outcome is null");
  const selfCheck = UNLOCK.slice(UNLOCK.indexOf("do $bo_khoa_ban_self_check$"), UNLOCK.indexOf("commit;"));
  await expect(db.exec(selfCheck)).rejects.toThrow(/vẫn còn chỉ số khoá/);
});
