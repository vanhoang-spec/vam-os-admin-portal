/**
 * Migration 20261008180000 — chạy THẬT trên PostgreSQL (PGlite): nới ràng buộc nhóm
 * nhận thư theo lối cộng thêm, tạo mẫu thư NHÁP (chưa ai gửi được tới khi BTC duyệt),
 * chạy lại không tạo trùng và không ghi đè bản BTC đã sửa.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(path.resolve("supabase/migrations/20261008180000_thu_rut_loi_moi_pv.sql"), "utf8");
const TEMPLATE = "97fb0a2a-d243-42fc-9d7f-01aefb1abf50";
// Đúng ràng buộc trên production sau migration 20261007234500.
const CHECK_AFTER_CV =
  "check ((audience is null) or (audience = any (array['mentee'::text, 'mentor'::text, 'both'::text, 'staff'::text, 'returning_mentor'::text, 'event'::text, 'mentee_cv_rejected'::text])))";
const CHECK_BEFORE_CV =
  "check ((audience is null) or (audience = any (array['mentee'::text, 'mentor'::text, 'both'::text, 'staff'::text, 'returning_mentor'::text, 'event'::text])))";

let db: PGlite | null = null;

async function fresh(check = CHECK_AFTER_CV) {
  db = new PGlite();
  await db.exec(`
    create table seasons (id uuid primary key, code text);
    insert into seasons values ('32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'UEHM-S12');
    create table email_batches (id uuid primary key default gen_random_uuid(), audience text,
      constraint email_batches_audience_check ${check});
    create table email_templates (id uuid primary key default gen_random_uuid(), season_id uuid, kind text, name text,
      subject text, body text, status text, created_by uuid, approved_by uuid, approved_at timestamptz,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table email_template_log (id uuid primary key default gen_random_uuid(), template_id uuid, action text,
      detail jsonb, actor_admin_user_id uuid, created_at timestamptz default now());
  `);
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

describe("nhóm mentee_invite_withdrawn", () => {
  it("nhận nhóm mới; mọi nhóm cũ vẫn nhận; giá trị lạ vẫn bị chặn", async () => {
    await fresh();
    expect(await accepts("mentee_invite_withdrawn")).toBe(false);
    await db!.exec(SQL);
    for (const v of ["mentee_invite_withdrawn", "mentee_cv_rejected", "mentee", "mentor", "both", "staff", "returning_mentor", "event"]) {
      expect(await accepts(v)).toBe(true);
    }
    expect(await accepts("ai_cung_duoc")).toBe(false);
  });

  it("thiếu nhóm mentee_cv_rejected (chưa dán migration trước): dừng, không đụng gì", async () => {
    await fresh(CHECK_BEFORE_CV);
    await expect(db!.exec(SQL)).rejects.toThrow(/20261007234500/);
    expect((await db!.query("select count(*)::int n from email_templates")).rows[0]).toEqual({ n: 0 });
  });
});

describe("mẫu thư nháp", () => {
  it("tạo đúng một mẫu NHÁP, có ô tên, nhắc thư mời 07/10 và lời xin lỗi; ghi nhật ký 'created'", async () => {
    await fresh();
    await db!.exec(SQL);
    const row = (await db!.query<{ status: string; kind: string; subject: string; body: string; approved_at: string | null }>(
      "select status, kind, subject, body, approved_at from email_templates where id = $1",
      [TEMPLATE]
    )).rows[0];
    expect(row).toMatchObject({ status: "draft", kind: "general_announcement", approved_at: null });
    expect(row.body.startsWith("Chào bạn {{ten_nguoi_nhan}},\n\n")).toBe(true);
    expect(row.body).toContain("Ngày 07/10, bạn đã nhận được thư mời chọn ca phỏng vấn");
    expect(row.body).toContain("thành thật xin lỗi");
    expect(row.body).toContain("Mỹ Anh (0394 983 679), Hoàng Vy (0936 359 670)");
    expect(row.body).not.toContain("{{vai_tro}}");
    const logs = (await db!.query<{ action: string }>("select action from email_template_log where template_id = $1", [TEMPLATE])).rows;
    expect(logs).toEqual([{ action: "created" }]);
  });

  it("chạy lại: không tạo mẫu thứ hai, không ghi đè bản BTC đã sửa", async () => {
    await fresh();
    await db!.exec(SQL);
    await db!.query("update email_templates set body = 'BTC đã sửa' where id = $1", [TEMPLATE]);
    await db!.exec(SQL);
    const rows = (await db!.query<{ body: string }>("select body from email_templates")).rows;
    expect(rows).toEqual([{ body: "BTC đã sửa" }]);
    expect((await db!.query("select count(*)::int n from email_template_log")).rows[0]).toEqual({ n: 1 });
  });
});
