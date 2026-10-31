/**
 * Migration 20261101120000 chạy THẬT trên PostgreSQL (PGlite). Điều phải đúng: tính năng mặc định tắt và
 * form cũ không đổi; một câu trả lời chỉ có một dòng theo dõi; loại thư được NỐI THÊM; anon/authenticated
 * không chạm được bảng mang dữ liệu mentee và máy chủ không xoá được; xoá người không kẹt; dán lại vẫn chạy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb } from "./support/offline-postgres";

const read = (f: string) => readFileSync(path.resolve(f), "utf8").replace(/\r/g, "");
const FORMS = read("supabase/migrations/20261015200000_form_tuy_chinh.sql");
const SQL = read("supabase/migrations/20261101120000_form_gui_mentor.sql");

let db: PGlite;
let formId: string;
let responseId: string;
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

const newResponse = async () => (await one<{ id: string }>("insert into custom_form_responses(form_id, answers, consent_at) values ($1, '{}', now()) returning id", [formId])).id;

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  await db.exec(`
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'mentee_exemption_confirm'::text])));
  `);
  await db.exec(FORMS);
  formId = (await one<{ id: string }>("insert into custom_forms(title) values ('Form cũ') returning id")).id;
  responseId = await newResponse();
  await db.exec(SQL);
  await db.exec("reset role");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("cấu hình trên custom_forms", () => {
  it("form đã có: mặc định TẮT, chữ rỗng, không có mốc bật", async () => {
    expect(await one("select mentor_forward, mentor_forward_subject, mentor_forward_body, mentor_forward_since from custom_forms where id = $1", [formId])).toEqual({
      mentor_forward: false,
      mentor_forward_subject: "",
      mentor_forward_body: "",
      mentor_forward_since: null
    });
  });

  it("không tạo dòng theo dõi nào cho câu trả lời cũ", async () => {
    expect(await one("select count(*)::int as n from custom_form_mentor_sends")).toEqual({ n: 0 });
  });

  it("chặn nội dung quá dài ở database", async () => {
    expect(await rejected("service_role", "update custom_forms set mentor_forward_body = repeat('x', 5001) where id = $1", [formId])).toBe(true);
  });
});

describe("bảng custom_form_mentor_sends", () => {
  it("mỗi câu trả lời một dòng, kể cả khác mentor", async () => {
    const id = await newResponse();
    const mentorA = (await one<{ id: string }>("insert into people(full_name) values ('A') returning id")).id;
    const mentorB = (await one<{ id: string }>("insert into people(full_name) values ('B') returning id")).id;
    await db.query("insert into custom_form_mentor_sends(response_id, form_id, mentor_person_id) values ($1, $2, $3)", [id, formId, mentorA]);
    expect(await rejected("service_role", "insert into custom_form_mentor_sends(response_id, form_id, mentor_person_id) values ($1, $2, $3)", [id, formId, mentorB])).toBe(true);
  });

  it("trạng thái lạ bị chặn; mặc định là chờ ghép cặp", async () => {
    const id = await newResponse();
    expect(await rejected("service_role", "insert into custom_form_mentor_sends(response_id, form_id, status) values ($1, $2, 'la')", [id, formId])).toBe(true);
    await db.query("insert into custom_form_mentor_sends(response_id, form_id) values ($1, $2)", [id, formId]);
    expect(await one("select status, attempts from custom_form_mentor_sends where response_id = $1", [id])).toEqual({ status: "cho_ghep_cap", attempts: 0 });
  });

  it("anon/authenticated không đọc, ghi, sửa được; service_role đọc-thêm-sửa nhưng không xoá", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select * from custom_form_mentor_sends")).toBe(true);
      expect(await rejected(role, "insert into custom_form_mentor_sends(response_id, form_id) values ($1, $2)", [responseId, formId])).toBe(true);
      expect(await rejected(role, "update custom_form_mentor_sends set status = 'da_gui'")).toBe(true);
      expect(await rejected(role, "delete from custom_form_mentor_sends")).toBe(true);
    }
    expect(await rejected("service_role", "select * from custom_form_mentor_sends")).toBe(false);
    expect(await rejected("service_role", "update custom_form_mentor_sends set attempts = 1")).toBe(false);
    expect(await rejected("service_role", "delete from custom_form_mentor_sends")).toBe(true);
    expect(await one("select relrowsecurity from pg_class where relname = 'custom_form_mentor_sends'")).toEqual({ relrowsecurity: true });
  });

  it("xoá người: dòng còn lại, tham chiếu về null", async () => {
    const id = await newResponse();
    const mentor = (await one<{ id: string }>("insert into people(full_name) values ('Sẽ xoá') returning id")).id;
    await db.query("insert into custom_form_mentor_sends(response_id, form_id, mentor_person_id, status) values ($1, $2, $3, 'da_gui')", [id, formId, mentor]);
    await db.query("delete from people where id = $1", [mentor]);
    expect(await one("select mentor_person_id, status from custom_form_mentor_sends where response_id = $1", [id])).toEqual({ mentor_person_id: null, status: "da_gui" });
  });
});

describe("loại thư", () => {
  it("NỐI THÊM: loại cũ vẫn ghi được, loại lạ vẫn bị chặn", async () => {
    await db.query("insert into outbound_emails(kind) values ('custom_form_mentor_submission'), ('custom_form_receipt'), ('mentee_session_invite'), ('mentee_exemption_confirm')");
    expect(await rejected("postgres", "insert into outbound_emails(kind) values ('loai_la')")).toBe(true);
  });
});

describe("chạy lại", () => {
  it("dán lần hai vẫn chạy, không nhân đôi loại thư, không đụng dữ liệu", async () => {
    await db.exec(SQL);
    await db.exec("reset role");
    const def = (await one<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'outbound_emails_kind_check'")).d;
    expect(def.split("custom_form_mentor_submission").length - 1).toBe(1);
  });

  it("thiếu bảng nền thì báo ngay, không tạo nửa chừng", () => {
    expect(SQL).toContain("PREREQ_MISSING");
    expect(SQL.indexOf("PREREQ_MISSING")).toBeLessThan(SQL.indexOf("alter table public.custom_forms"));
  });
});
