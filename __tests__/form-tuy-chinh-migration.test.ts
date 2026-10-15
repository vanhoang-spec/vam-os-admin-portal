/**
 * Form tùy chỉnh — migration 20261015200000 chạy THẬT trên PostgreSQL (PGlite). BTC 15/10/2026.
 *
 * Điều phải đúng:
 *   - hai bảng bật RLS; anon và authenticated không đọc, không ghi được (khoá công khai nằm sẵn trong
 *     mã trang web; bảng có họ tên, email, SĐT, có thể có CCCD);
 *   - máy chủ thêm/sửa form nhưng không xoá; thêm câu trả lời nhưng không sửa, không xoá;
 *   - chỉ mục chặn gửi trùng: cùng form + cùng email bị từ chối; khác form, hoặc không bật chặn
 *     (dedupe_key null) thì không;
 *   - ràng buộc: mã công khai sinh sẵn đúng dạng, tiêu đề không rỗng, fields là mảng, giờ đóng sau giờ
 *     mở, form có câu trả lời không xoá được kể cả bằng quyền chủ bảng;
 *   - dán lại lần hai vẫn chạy, không mất dữ liệu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb } from "./support/offline-postgres";

const SQL = readFileSync(path.resolve("supabase/migrations/20261015200000_form_tuy_chinh.sql"), "utf8").replace(/\r/g, "");

let db: PGlite;
let form = "";
let otherForm = "";
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

async function rejected(role: string, sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  } finally {
    await db.exec("rollback");
    await db.exec("reset role");
  }
}
async function asServer<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
const insertResponse = (formId: string, key: string | null) =>
  db.query("insert into custom_form_responses(form_id, answers, dedupe_key, consent_at) values ($1, '{}'::jsonb, $2, now())", [formId, key]);

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Sổ thư như trên production: ràng buộc loại thư đã có sẵn vài loại — migration phải NỐI THÊM.
  await db.exec(`
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'mentee_exemption_confirm'::text])));
  `);
  await db.exec(SQL);
  await db.exec("reset role");
  form = (await asServer(() => one<{ id: string }>("insert into custom_forms(title) values ('Tuyển mentee Job Shadowing') returning id")))!.id;
  otherForm = (await asServer(() => one<{ id: string }>("insert into custom_forms(title) values ('Form khác') returning id")))!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 20261015200000 — form tùy chỉnh", () => {
  it("hai bảng bật RLS; mã công khai sinh sẵn đúng dạng; mặc định là nháp, bật chặn trùng", async () => {
    for (const table of ["custom_forms", "custom_form_responses"]) {
      expect((await one<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${table}`]))!.rls).toBe(true);
    }
    const row = await one<{ public_code: string; status: string; one_per_email: boolean; fields: unknown }>(
      "select public_code, status, one_per_email, fields from custom_forms where id = $1",
      [form]
    );
    expect(row!.public_code).toMatch(/^[a-z0-9]{12}$/);
    expect(row).toMatchObject({ status: "draft", one_per_email: true, fields: [] });
  });

  it("anon và authenticated: không đọc, không ghi bảng nào", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select * from custom_forms")).toBe(true);
      expect(await rejected(role, "select * from custom_form_responses")).toBe(true);
      expect(await rejected(role, "insert into custom_forms(title) values ('x')")).toBe(true);
      expect(await rejected(role, "insert into custom_form_responses(form_id, answers, consent_at) values ($1, '{}', now())", [form])).toBe(true);
    }
  });

  it("máy chủ: sửa được form nhưng không xoá; câu trả lời chỉ thêm, không sửa, không xoá", async () => {
    await asServer(() => db.query("update custom_forms set status = 'published' where id = $1", [form]));
    expect(await rejected("service_role", "delete from custom_forms where id = $1", [otherForm])).toBe(true);
    await asServer(() => insertResponse(form, "an@x.vn"));
    expect(await rejected("service_role", "update custom_form_responses set answers = '{}' where form_id = $1", [form])).toBe(true);
    expect(await rejected("service_role", "delete from custom_form_responses where form_id = $1", [form])).toBe(true);
  });

  it("chặn gửi trùng: cùng form + cùng email bị từ chối; khác form hay không bật chặn (null) thì được", async () => {
    expect(await rejected("service_role", "insert into custom_form_responses(form_id, answers, dedupe_key, consent_at) values ($1, '{}', 'an@x.vn', now())", [form])).toBe(true);
    await asServer(() => insertResponse(otherForm, "an@x.vn"));
    await asServer(() => insertResponse(form, null));
    await asServer(() => insertResponse(form, null));
    expect((await one<{ n: number }>("select count(*)::int as n from custom_form_responses where form_id = $1", [form]))!.n).toBe(3);
  });

  it("ràng buộc: tiêu đề rỗng, fields không phải mảng, giờ đóng trước giờ mở, câu trả lời không phải object, chưa đồng ý → từ chối", async () => {
    expect(await rejected("service_role", "insert into custom_forms(title) values ('   ')")).toBe(true);
    expect(await rejected("service_role", "insert into custom_forms(title, fields) values ('x', '{}'::jsonb)")).toBe(true);
    expect(await rejected("service_role", "insert into custom_forms(title, opens_at, closes_at) values ('x', now(), now() - interval '1 hour')")).toBe(true);
    expect(await rejected("service_role", "insert into custom_forms(title, public_code) values ('x', 'KHONG-HOP-LE')")).toBe(true);
    expect(await rejected("service_role", "insert into custom_form_responses(form_id, answers, consent_at) values ($1, '[]'::jsonb, now())", [form])).toBe(true);
    expect(await rejected("service_role", "insert into custom_form_responses(form_id, answers) values ($1, '{}'::jsonb)", [form])).toBe(true);
  });

  it("form đã có câu trả lời không xoá được, kể cả bằng quyền chủ bảng", async () => {
    await db.exec("begin");
    try {
      await expect(db.query("delete from custom_forms where id = $1", [form])).rejects.toThrow();
    } finally {
      await db.exec("rollback");
    }
  });

  it("thư tự động: ba cột mặc định tắt và rỗng; nội dung quá 5.000 ký tự bị từ chối", async () => {
    expect(await one("select auto_reply, auto_reply_subject, auto_reply_body from custom_forms where id = $1", [otherForm])).toEqual({
      auto_reply: false,
      auto_reply_subject: "",
      auto_reply_body: ""
    });
    expect(await rejected("service_role", "update custom_forms set auto_reply_body = repeat('x', 5001) where id = $1", [otherForm])).toBe(true);
  });

  it("loại thư 'custom_form_receipt' được NỐI THÊM: loại cũ vẫn ghi được, loại lạ vẫn bị chặn", async () => {
    await db.query("insert into outbound_emails(kind) values ('custom_form_receipt'), ('mentee_session_invite'), ('mentee_exemption_confirm')");
    expect(await rejected("postgres", "insert into outbound_emails(kind) values ('loai_la')")).toBe(true);
  });

  it("dán lại lần hai vẫn chạy, không mất dữ liệu, không nối loại thư hai lần", async () => {
    await db.exec(SQL);
    await db.exec("reset role");
    expect((await one<{ n: number }>("select count(*)::int as n from custom_forms"))!.n).toBe(2);
    expect((await one<{ n: number }>("select count(*)::int as n from custom_form_responses"))!.n).toBe(4);
    const def = (await one<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.outbound_emails'::regclass and conname = 'outbound_emails_kind_check'"
    ))!.def;
    expect(def.split("custom_form_receipt").length - 1).toBe(1);
    expect(def).toContain("mentee_exemption_confirm");
  }, 120_000);
});
