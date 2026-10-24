/**
 * Migration 20261024120000 — chạy THẬT trên PostgreSQL (PGlite): nới ràng buộc nhóm nhận thư theo
 * lối cộng thêm cho nhóm "Mentee không trúng tuyển vòng phỏng vấn"; mọi nhóm cũ vẫn nhận; chạy lại
 * không sao; thiếu migration trước thì dừng ồn ào.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(path.resolve("supabase/migrations/20261024120000_nhom_thu_mentee_rot_phong_van.sql"), "utf8");
// Đúng ràng buộc trên production sau migration 20261008180000.
const CHECK_AFTER_WITHDRAWN =
  "check ((audience is null) or (audience = any (array['mentee'::text, 'mentor'::text, 'both'::text, 'staff'::text, 'returning_mentor'::text, 'event'::text, 'mentee_cv_rejected'::text, 'mentee_invite_withdrawn'::text])))";
const CHECK_BEFORE_WITHDRAWN =
  "check ((audience is null) or (audience = any (array['mentee'::text, 'mentor'::text, 'both'::text, 'staff'::text, 'returning_mentor'::text, 'event'::text, 'mentee_cv_rejected'::text])))";
const DB_TIMEOUT = 120_000;
const OLD = ["mentee", "mentor", "both", "staff", "returning_mentor", "event", "mentee_cv_rejected", "mentee_invite_withdrawn"];

let db: PGlite | null = null;

async function fresh(check = CHECK_AFTER_WITHDRAWN) {
  db = new PGlite();
  await db.exec(`create table email_batches (id uuid primary key default gen_random_uuid(), audience text, constraint email_batches_audience_check ${check});`);
  return db;
}
const accepts = async (audience: string) => {
  try {
    await db!.query("insert into email_batches (audience) values ($1)", [audience]);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  await db?.close();
  db = null;
});

describe("nhóm mentee_interview_rejected", () => {
  it("trước khi dán: bị chặn; sau khi dán: nhận nhóm mới, mọi nhóm cũ vẫn nhận, giá trị lạ vẫn bị chặn", async () => {
    await fresh();
    expect(await accepts("mentee_interview_rejected")).toBe(false);
    await db!.exec(SQL);
    for (const v of [...OLD, "mentee_interview_rejected"]) expect(await accepts(v), v).toBe(true);
    expect(await accepts("ai_cung_duoc")).toBe(false);
  }, DB_TIMEOUT);

  it("dán lại lần hai không nối trùng", async () => {
    await fresh();
    await db!.exec(SQL);
    await db!.exec(SQL);
    const def = (await db!.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'email_batches_audience_check'"
    )).rows[0].def;
    expect(def.split("mentee_interview_rejected").length - 1).toBe(1);
  }, DB_TIMEOUT);

  it("thiếu nhóm mentee_invite_withdrawn (chưa dán migration trước): dừng, không đụng gì", async () => {
    await fresh(CHECK_BEFORE_WITHDRAWN);
    await expect(db!.exec(SQL)).rejects.toThrow(/20261008180000/);
    expect(await accepts("mentee_interview_rejected")).toBe(false);
  }, DB_TIMEOUT);
});
