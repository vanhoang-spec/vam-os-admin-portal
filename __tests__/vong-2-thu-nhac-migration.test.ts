/**
 * Vòng 2 — thư nhắc: migration 20261016220000 chạy THẬT trên PostgreSQL (PGlite). BTC 16/10/2026.
 *
 * Migration chỉ nối thêm loại thư 'matching_round2_reminder' vào outbound_emails_kind_check. Điều phải đúng:
 *   - dựng lại đúng ràng buộc như trên production (21 loại, kể cả custom_form_receipt): loại mới ghi được,
 *     MỌI loại cũ vẫn ghi được, loại lạ vẫn bị chặn — viết đè cả danh sách sẽ làm sót loại cũ và lặng lẽ
 *     chặn thư loại đó;
 *   - dán lại lần hai vẫn chạy và không nối hai lần;
 *   - thiếu ràng buộc thì dừng ồn ào (không báo thành công giả);
 *   - không thêm bảng hay cột nào.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb } from "./support/offline-postgres";

const SQL = readFileSync(path.resolve("supabase/migrations/20261016220000_vong_2_thu_nhac.sql"), "utf8").replace(/\r/g, "");
// Danh sách loại thư trên production lúc 15/10/2026 20:13 (đọc bằng pg_get_constraintdef) + custom_form_receipt.
const PRODUCTION_KINDS = [
  "mentor_confirmation_link", "mentee_application_confirmation", "mentor_application_confirmation", "review_batch_assigned",
  "interview_scheduled", "reviewer_invite", "interview_round_invite", "general_announcement", "event_registration_confirmation",
  "event_schedule_change", "participant_invite", "staff_invite", "event_reminder", "event_survey", "interview_slot_invite",
  "interview_slot_cancelled", "mentee_session_invite", "mentee_session_confirmed", "matching_round2_invite",
  "mentee_exemption_confirm", "custom_form_receipt"
];

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const constraintDef = async () =>
  (await one<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.outbound_emails'::regclass and conname = 'outbound_emails_kind_check'"
  ))!.def;

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

async function freshDb(withConstraint = true) {
  db = await offlineDb();
  await db.exec("reset role");
  const list = PRODUCTION_KINDS.map((k) => `'${k}'::text`).join(", ");
  await db.exec(
    `create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null${
      withConstraint ? `, constraint outbound_emails_kind_check check (kind = any (array[${list}]))` : ""
    });`
  );
}

beforeAll(async () => {
  await freshDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 20261016220000 — thư nhắc Vòng 2", () => {
  it("trước khi dán: loại mới bị chặn; sau khi dán: loại mới ghi được, mọi loại cũ vẫn ghi được, loại lạ vẫn bị chặn", async () => {
    expect(await rejected("insert into outbound_emails(kind) values ('matching_round2_reminder')")).toBe(true);
    await db.exec(SQL);
    await db.exec("reset role");
    for (const kind of [...PRODUCTION_KINDS, "matching_round2_reminder"]) {
      expect(await rejected("insert into outbound_emails(kind) values ($1)", [kind]), kind).toBe(false);
    }
    expect(await rejected("insert into outbound_emails(kind) values ('loai_la')")).toBe(true);
    const def = await constraintDef();
    for (const kind of PRODUCTION_KINDS) expect(def, kind).toContain(`'${kind}'`);
  });

  it("dán lại lần hai: vẫn chạy, không nối loại thư hai lần, dữ liệu cũ còn nguyên", async () => {
    await db.query("insert into outbound_emails(kind) values ('matching_round2_reminder'), ('matching_round2_invite')");
    await db.exec(SQL);
    await db.exec("reset role");
    expect((await constraintDef()).split("matching_round2_reminder").length - 1).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from outbound_emails where kind = 'matching_round2_reminder'"))!.n).toBe(1);
  }, 120_000);

  it("không thêm bảng hay cột nào: bảng thư vẫn đúng hai cột", async () => {
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'outbound_emails' order by column_name")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "kind"]);
  });

  it("không có ràng buộc loại thư (môi trường lạ): dừng ồn ào, không báo thành công giả", async () => {
    await db.close();
    await freshDb(false);
    await expect(db.exec(SQL)).rejects.toThrow(/SCHEMA_CONTRACT_VIOLATION/);
  }, 120_000);
});
