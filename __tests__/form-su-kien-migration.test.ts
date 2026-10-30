/**
 * Form ↔ Sự kiện — migration 20261030120000 chạy THẬT trên PostgreSQL (PGlite). VAM00008, 30/10/2026.
 *
 * Điều phải đúng:
 *   - hàm ghi đăng ký đếm chỗ như lib/events.ts (registered + pending_review + confirmed), chặn khi đủ,
 *     xếp chờ khi có danh sách chờ, chờ duyệt khi sự kiện cần duyệt;
 *   - giới hạn riêng của form KHÔNG thay sức chứa sự kiện: sự kiện 3 chỗ đã có 2 người từ nguồn khác
 *     thì form giới hạn 3 chỉ nhận thêm 1;
 *   - huỷ đăng ký trả lại chỗ cho cả sự kiện lẫn giới hạn form;
 *   - email đã có đăng ký còn hiệu lực → trả "existing", không ghi gì;
 *   - form độc lập: giới hạn riêng đếm câu trả lời; trùng email → "duplicate";
 *   - anon/authenticated không gọi được hàm, không đọc được cảnh báo trùng; câu trả lời chỉ sửa được
 *     ba cột cho phép, không sửa được ở cấp bảng;
 *   - dán lại lần hai vẫn chạy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { offlineDb } from "./support/offline-postgres";

const read = (f: string) => readFileSync(path.resolve(f), "utf8").replace(/\r/g, "");
const FORMS = read("supabase/migrations/20261015200000_form_tuy_chinh.sql");
const SQL = read("supabase/migrations/20261030120000_form_su_kien.sql");

let db: PGlite;
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

type R = { status: string; id?: string; registration_status?: string; full_name?: string };
const register = (eventId: string, formId: string, limit: number | null, email: string, name = "Bạn A") =>
  asServer(async () =>
    (
      await one<{ r: R }>("select public.vam_custom_form_event_register($1, $2, $3, $4) as r", [
        eventId,
        formId,
        limit,
        JSON.stringify({ email, full_name: name, consent_given: true, khong_co_cot_nay: "bỏ qua" })
      ])
    ).r
  );
const newForm = async (title: string) => (await one<{ id: string }>("insert into custom_forms(title) values ($1) returning id", [title])).id;
const newEvent = async (cfg: { cap?: number | null; waitlist?: boolean; approval?: boolean; status?: string } = {}) =>
  (
    await one<{ id: string }>(
      `insert into events(status, capacity_limit_enabled, capacity_limit, waitlist_enabled, approval_required)
       values ($1, $2, $3, $4, $5) returning id`,
      [cfg.status ?? "active", cfg.cap != null, cfg.cap ?? null, cfg.waitlist ?? false, cfg.approval ?? false]
    )
  ).id;
const otherSource = (eventId: string, email: string, status = "registered") =>
  db.query("insert into event_registrations(event_id, full_name, email, registration_status) values ($1, 'Nguồn khác', $2, $3)", [eventId, email, status]);

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  await db.exec(`
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'mentee_exemption_confirm'::text])));
    create table events(id uuid primary key default gen_random_uuid(), status text default 'active',
      capacity_limit_enabled boolean default false, capacity_limit integer, waitlist_enabled boolean default false,
      approval_required boolean default false);
    create table event_registrations(id uuid primary key default gen_random_uuid(),
      event_id uuid not null references events(id) on delete cascade, full_name text not null, email text not null,
      phone text, consent_given boolean not null default false, registration_status text not null default 'registered',
      attendance_status text not null default 'pending', created_at timestamptz not null default now());
    create unique index event_registrations_event_lower_email_active_uidx
      on event_registrations(event_id, lower(email)) where registration_status <> 'cancelled';
    grant select, insert, update on events, event_registrations to service_role;
  `);
  await db.exec(FORMS);
  await db.exec(SQL);
  await db.exec("reset role");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("1. đăng ký sự kiện từ form", () => {
  it("ghi một dòng, gắn form, email chữ thường; cột lạ trong payload bị bỏ qua", async () => {
    const ev = await newEvent();
    const form = await newForm("F1");
    const r = await register(ev, form, null, "  An@Gmail.com ");
    expect(r.status).toBe("inserted");
    expect(r.registration_status).toBe("registered");
    const row = await one<{ email: string; custom_form_id: string; consent_given: boolean }>(
      "select email, custom_form_id, consent_given from event_registrations where id = $1",
      [r.id]
    );
    expect(row).toEqual({ email: "an@gmail.com", custom_form_id: form, consent_given: true });
  });

  it("ví dụ của đề xuất: sự kiện 3 chỗ, 2 chỗ đã có từ nguồn khác → form giới hạn 3 chỉ nhận thêm 1", async () => {
    const ev = await newEvent({ cap: 3 });
    const form = await newForm("F2");
    await otherSource(ev, "x1@x.vn");
    await otherSource(ev, "x2@x.vn", "confirmed");
    await otherSource(ev, "x3@x.vn", "waitlisted"); // chờ không giữ chỗ
    expect((await register(ev, form, 3, "a@x.vn")).status).toBe("inserted");
    expect((await register(ev, form, 3, "b@x.vn")).status).toBe("event_full");
    expect(Number((await one<{ n: number }>("select count(*)::int as n from event_registrations where event_id = $1", [ev])).n)).toBe(4);
  });

  it("giới hạn riêng của form đủ trước sức chứa sự kiện → form_full", async () => {
    const ev = await newEvent({ cap: 100 });
    const form = await newForm("F3");
    expect((await register(ev, form, 1, "a@x.vn")).status).toBe("inserted");
    expect((await register(ev, form, 1, "b@x.vn")).status).toBe("form_full");
  });

  it("huỷ trả lại chỗ cho cả sự kiện lẫn form", async () => {
    const ev = await newEvent({ cap: 1 });
    const form = await newForm("F4");
    const a = await register(ev, form, 1, "a@x.vn");
    expect((await register(ev, form, 1, "b@x.vn")).status).toBe("form_full");
    await db.query("update event_registrations set registration_status = 'cancelled' where id = $1", [a.id]);
    expect((await register(ev, form, 1, "b@x.vn")).status).toBe("inserted");
  });

  it("đủ chỗ nhưng có danh sách chờ → waitlisted; sự kiện cần duyệt → pending_review", async () => {
    const full = await newEvent({ cap: 1, waitlist: true });
    const form = await newForm("F5");
    await otherSource(full, "x@x.vn");
    expect((await register(full, form, null, "a@x.vn")).registration_status).toBe("waitlisted");
    const review = await newEvent({ approval: true });
    expect((await register(review, form, null, "a@x.vn")).registration_status).toBe("pending_review");
  });

  it("email đã có đăng ký còn hiệu lực (kể cả từ form Sự kiện) → existing, kèm tên cũ, không ghi gì", async () => {
    const ev = await newEvent();
    const form = await newForm("F6");
    await otherSource(ev, "Trung@x.vn");
    const r = await register(ev, form, null, "trung@x.vn", "Tên Khác");
    expect(r.status).toBe("existing");
    expect(r.full_name).toBe("Nguồn khác");
    expect(Number((await one<{ n: number }>("select count(*)::int as n from event_registrations where event_id = $1", [ev])).n)).toBe(1);
  });

  it("sự kiện đã huỷ hoặc không tồn tại → event_closed; email trống → invalid", async () => {
    const form = await newForm("F7");
    expect((await register(await newEvent({ status: "cancelled" }), form, null, "a@x.vn")).status).toBe("event_closed");
    expect((await register("00000000-0000-4000-8000-999999999999", form, null, "a@x.vn")).status).toBe("event_closed");
    expect((await register(await newEvent(), form, null, " ")).status).toBe("invalid");
  });
});

describe("2. form độc lập", () => {
  const insert = (form: string, limit: number | null, key: string | null) =>
    asServer(async () =>
      (
        await one<{ r: R }>("select public.vam_custom_form_insert_response($1, $2, $3) as r", [
          form,
          limit,
          JSON.stringify({ answers: { f_x: "1" }, dedupe_key: key })
        ])
      ).r
    );

  it("giới hạn riêng đếm câu trả lời; trùng email → duplicate", async () => {
    const form = await newForm("G1");
    expect((await insert(form, 2, "a@x.vn")).status).toBe("inserted");
    expect((await insert(form, 2, "a@x.vn")).status).toBe("duplicate");
    expect((await insert(form, 2, null)).status).toBe("inserted");
    expect((await insert(form, 2, "c@x.vn")).status).toBe("full");
    // Đủ rồi mà người cũ gửi lại: báo trùng, không báo đủ.
    expect((await insert(form, 2, "a@x.vn")).status).toBe("duplicate");
    expect((await insert(form, null, "d@x.vn")).status).toBe("inserted");
  });
});

describe("3. quyền", () => {
  it("anon/authenticated không gọi được hai hàm và không đọc được cảnh báo trùng", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select public.vam_custom_form_insert_response(gen_random_uuid(), null, '{}'::jsonb)")).toBe(true);
      expect(await rejected(role, "select public.vam_custom_form_event_register(gen_random_uuid(), gen_random_uuid(), null, '{}'::jsonb)")).toBe(true);
      expect(await rejected(role, "select * from custom_form_duplicate_flags")).toBe(true);
    }
  });

  it("máy chủ sửa được answers của câu trả lời nhưng không sửa được cột khác, không xoá được", async () => {
    const form = await newForm("H1");
    const id = (await one<{ id: string }>("insert into custom_form_responses(form_id, answers, consent_at) values ($1, '{}'::jsonb, now()) returning id", [form])).id;
    expect(await rejected("service_role", "update custom_form_responses set answers = '{\"a\":1}'::jsonb, updated_at = now() where id = $1", [id])).toBe(false);
    expect(await rejected("service_role", "update custom_form_responses set dedupe_key = 'x' where id = $1", [id])).toBe(true);
    expect(await rejected("service_role", "delete from custom_form_responses where id = $1", [id])).toBe(true);
  });
});

describe("4. dán lại", () => {
  it("chạy lần hai không lỗi", async () => {
    await db.exec(SQL);
    await db.exec("reset role");
    expect((await one<{ n: number }>("select count(*)::int as n from pg_constraint where conname = 'custom_forms_registration_limit_check'")).n).toBe(1);
  });
});
