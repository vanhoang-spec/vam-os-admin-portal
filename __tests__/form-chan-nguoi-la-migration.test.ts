/**
 * Migration 20261030200000 chạy THẬT trên PostgreSQL (PGlite): form cũ giữ nguyên hành vi, màu chỉ nhận
 * #rrggbb chữ thường, dán lại lần hai vẫn chạy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb } from "./support/offline-postgres";

const SQL = readFileSync(path.resolve("supabase/migrations/20261030200000_form_chan_nguoi_la_mau.sql"), "utf8").replace(/\r/g, "");
let db: PGlite;

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  await db.exec("create table public.custom_forms (id serial primary key, title text); insert into public.custom_forms(title) values ('cũ');");
  await db.exec(SQL);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("form chặn người lạ + màu", () => {
  it("form đã có: không chặn, không màu", async () => {
    const { rows } = await db.query<{ require_known_person: boolean; theme_color: string | null }>("select require_known_person, theme_color from public.custom_forms");
    expect(rows).toEqual([{ require_known_person: false, theme_color: null }]);
  });
  it("cột màu từ chối giá trị ngoài #rrggbb chữ thường", async () => {
    await db.exec("update public.custom_forms set theme_color = '#0f766e'");
    await expect(db.exec("update public.custom_forms set theme_color = '#ABCDEF'")).rejects.toThrow();
    await expect(db.exec("update public.custom_forms set theme_color = 'red'")).rejects.toThrow();
  });
  it("dán lại lần hai vẫn chạy", async () => {
    await expect(db.exec(SQL)).resolves.toBeTruthy();
  });
});
