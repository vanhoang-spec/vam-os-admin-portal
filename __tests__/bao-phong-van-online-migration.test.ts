/**
 * Migration 20261008163000 — chạy THẬT trên PostgreSQL (PGlite): thêm dấu "đã báo
 * phỏng vấn online" trên lời mời của mentee, không đụng dữ liệu, chạy lại vô hại.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb } from "./support/offline-postgres";

const SQL = readFileSync(path.resolve("supabase/migrations/20261008163000_bao_phong_van_online.sql"), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Bảng trên production đã bật RLS; bộ dựng thử có thể chưa — bật cho đúng production.
  await db.exec("alter table mentee_interview_invites enable row level security");
});
afterAll(async () => db?.close());

describe("dấu đã báo phỏng vấn online", () => {
  it("thêm cột timestamptz, để trống mặc định; dòng có sẵn không đổi", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int n from mentee_interview_invites")).rows[0].n;
    await db.exec(SQL);
    const col = (await db.query<{ data_type: string; is_nullable: string }>(
      "select data_type, is_nullable from information_schema.columns where table_name = 'mentee_interview_invites' and column_name = 'online_notified_at'"
    )).rows[0];
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });
    const after = (await db.query<{ n: number; stamped: number }>(
      "select count(*)::int n, count(online_notified_at)::int stamped from mentee_interview_invites"
    )).rows[0];
    expect(after).toEqual({ n: before, stamped: 0 });
  });

  it("chạy lại vô hại", async () => {
    await expect(db.exec(SQL)).resolves.toBeDefined();
  });

  it("tự kiểm dừng lại nếu bảng mất RLS", async () => {
    await db.exec("alter table mentee_interview_invites disable row level security");
    await expect(db.exec(SQL)).rejects.toThrow(/mất RLS/);
    await db.exec("alter table mentee_interview_invites enable row level security");
  });
});
