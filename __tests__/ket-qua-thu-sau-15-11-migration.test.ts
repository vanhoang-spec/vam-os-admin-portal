/**
 * Thư kết quả — migration 20261023120000 (thư sau 15/11) chạy THẬT trên PostgreSQL (PGlite).
 *
 * Điều phải đúng: một người có thể có hai dòng thông báo — thư sau 15/11 (special) gửi bây giờ, thư
 * thường (standard) gửi sau khi kết nối chính thức — nhưng không bao giờ hai dòng cùng một loại thư;
 * dán lại lần hai không sao; thiếu bảng của migration trước thì dừng ồn ào.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb } from "./support/offline-postgres";

const read = (f: string) => readFileSync(path.resolve(f), "utf8").replace(/\r/g, "");
const PR1 = read("supabase/migrations/20261022120000_ket_qua_ghep_cap.sql");
const SQL = read("supabase/migrations/20261023120000_ket_qua_thu_sau_15_11.sql");
const KINDS = ["general_announcement", "custom_form_receipt", "matching_round2_invite", "matching_round2_reminder"];

let db: PGlite;

async function rejected(sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  } finally {
    await db.exec("rollback");
  }
}

const insertNotice = (variant: string) =>
  db.query("insert into match_result_notices(season_id, person_id, role, variant) values ($1, $2, 'mentor', $3)", [ids.season, ids.person, variant]);
const insertNoticeSql = "insert into match_result_notices(season_id, person_id, role, variant) values ($1, $2, 'mentor', $3)";

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  const list = KINDS.map((k) => `'${k}'::text`).join(", ");
  await db.exec(`create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null, constraint outbound_emails_kind_check check (kind = any (array[${list}])));`);
  await db.exec(PR1);
  await db.exec("reset role");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 20261023120000 — mỗi người một dòng thông báo cho mỗi loại thư", () => {
  it("trước khi dán: người đã có dòng thư thường không có thêm được dòng thư sau 15/11", async () => {
    await insertNotice("standard");
    expect(await rejected(insertNoticeSql, [ids.season, ids.person, "special"])).toBe(true);
  });

  it("sau khi dán: thêm được dòng thư sau 15/11; hai dòng cùng loại thư vẫn bị chặn; loại thư lạ vẫn bị chặn", async () => {
    await db.exec(SQL);
    await db.exec("reset role");
    expect(await rejected(insertNoticeSql, [ids.season, ids.person, "special"])).toBe(false);
    await insertNotice("special");
    expect(await rejected(insertNoticeSql, [ids.season, ids.person, "special"])).toBe(true);
    expect(await rejected(insertNoticeSql, [ids.season, ids.person, "standard"])).toBe(true);
    expect(await rejected(insertNoticeSql, [ids.season, ids.person, "khac"])).toBe(true);
  });

  it("dán lại lần hai không sao, dữ liệu giữ nguyên", async () => {
    await db.exec(SQL);
    await db.exec("reset role");
    const r = await db.query<{ n: number }>("select count(*)::int as n from match_result_notices");
    expect(r.rows[0].n).toBe(2);
  });

  it("vẫn khoá như cũ: anon/authenticated không đọc được, máy chủ không xoá được", async () => {
    const p = await db.query<{ a: boolean; u: boolean; d: boolean }>(
      "select has_table_privilege('anon','public.match_result_notices','select') a, has_table_privilege('authenticated','public.match_result_notices','select') u, has_table_privilege('service_role','public.match_result_notices','delete') d"
    );
    expect(p.rows[0]).toEqual({ a: false, u: false, d: false });
  });

  it("chưa chạy migration trước: dừng ồn ào", async () => {
    const fresh = await offlineDb();
    await fresh.exec("reset role");
    await expect(fresh.exec(SQL)).rejects.toThrow(/PREREQ_MISSING/);
    await fresh.close();
  }, 120_000);
});
