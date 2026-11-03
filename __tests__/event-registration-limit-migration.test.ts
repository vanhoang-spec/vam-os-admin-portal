/**
 * Giới hạn số lần một email được đăng ký sự kiện (VAM00015) — migration 20261103230000 chạy THẬT trên
 * PostgreSQL (PGlite).
 *
 * Điều phải đúng:
 *   - chưa ai đặt giới hạn thì không có gì đổi: migration chạy lên dữ liệu có sẵn mà không đụng một dòng;
 *   - phạm vi "series": email đã đủ lượt ở các buổi khác của chuỗi thì buổi mới bị từ chối bằng đúng lỗi
 *     EVENT_REGISTRATION_LIMIT_REACHED, và không ghi gì;
 *   - nộp lại để sửa đăng ký đã có KHÔNG phải lượt mới, dù email đang ở đúng giới hạn;
 *   - huỷ hoàn lượt ngay (không có bộ đếm nào phải trả lại); bị từ chối không tính; chờ duyệt, đã xác nhận
 *     và danh sách chờ đều tính — và luật đếm của SQL trùng luật của TypeScript, từng trạng thái một;
 *   - khôi phục một đăng ký đã huỷ, hay đổi email của một đăng ký, cũng không lách được giới hạn;
 *   - vãng lai và BTC nhập tay không bị chặn, và vãng lai không bị tính;
 *   - phạm vi "event" KHÔNG can thiệp: hai lần bấm cùng buổi vẫn rơi vào ràng buộc trùng khoá 23505 mà ứng
 *     dụng xử lý bằng cách ghi đè;
 *   - chống đua: mọi yêu cầu của cùng một email trong cùng một chuỗi xin CÙNG MỘT khoá tư vấn (PGlite chỉ
 *     có một kết nối nên không dựng được hai giao dịch chạy song song; ca này đo khoá thay cho đo cuộc đua);
 *   - anon/authenticated không gọi được hàm; dán lại lần hai vẫn chạy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { countsTowardRegistrationLimit } from "@/lib/event-registration-limit-core";

const SQL = readFileSync(path.resolve("supabase/migrations/20261103230000_gioi_han_dang_ky_theo_email.sql"), "utf8").replace(/\r/g, "");
const LIMIT_ERROR = "EVENT_REGISTRATION_LIMIT_REACHED";
const STATUSES = ["registered", "cancelled", "pending_review", "confirmed", "waitlisted", "rejected"];
const TIMEOUT = 30_000;

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params)).n);

async function errorOf(run: () => Promise<unknown>): Promise<{ message: string; code?: string } | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const shape = error as { message?: string; code?: string };
    return { message: String(shape.message ?? error), code: shape.code };
  }
}

const newSeries = async (limit: number | null, scope: "event" | "series" = "series", sessions = 3) => {
  const seriesId = (await one<{ id: string }>("select gen_random_uuid() as id")).id;
  const events: string[] = [];
  for (let index = 1; index <= sessions; index += 1) {
    events.push(
      (
        await one<{ id: string }>(
          `insert into events(series_id, series_index, registration_limit_per_email, registration_limit_scope)
           values ($1, $2, $3, $4) returning id`,
          [seriesId, index, limit, scope]
        )
      ).id
    );
  }
  return { seriesId, events };
};
const newSingleEvent = async (limit: number | null, scope: "event" | "series") =>
  (await one<{ id: string }>("insert into events(registration_limit_per_email, registration_limit_scope) values ($1, $2) returning id", [limit, scope])).id;

const register = (
  eventId: string,
  email: string,
  options: { status?: string; source?: string; walkIn?: boolean; name?: string } = {}
) =>
  one<{ id: string }>(
    `insert into event_registrations(event_id, full_name, email, registration_status, registration_source, is_walk_in)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [eventId, options.name ?? "Bạn A", email, options.status ?? "registered", options.source ?? "public_form", options.walkIn ?? false]
  );
const active = (eventIds: string[]) =>
  count("select count(*)::int as n from event_registrations where event_id = any($1::uuid[])", [eventIds]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table events(id uuid primary key default gen_random_uuid(), series_id uuid, series_index integer, series_total integer);
    create table event_registrations(
      id uuid primary key default gen_random_uuid(),
      event_id uuid not null references events(id) on delete cascade,
      full_name text not null,
      email text not null,
      registration_status text not null default 'registered'
        check (registration_status in ('registered', 'cancelled', 'pending_review', 'confirmed', 'waitlisted', 'rejected')),
      registration_source text not null default 'public_form',
      is_walk_in boolean not null default false);
    create unique index event_registrations_event_lower_email_active_uidx
      on event_registrations(event_id, lower(email)) where registration_status <> 'cancelled';
    grant select, insert, update on events, event_registrations to service_role;
  `);

  // Dữ liệu có từ trước migration: một chuỗi hai buổi, một người đăng ký cả hai buổi. Migration không được đụng.
  const series = (await one<{ id: string }>("select gen_random_uuid() as id")).id;
  const a = (await one<{ id: string }>("insert into events(series_id, series_index, series_total) values ($1, 1, 2) returning id", [series])).id;
  const b = (await one<{ id: string }>("insert into events(series_id, series_index, series_total) values ($1, 2, 2) returning id", [series])).id;
  await db.query("insert into event_registrations(event_id, full_name, email) values ($1, 'Có từ trước', 'cu@x.vn'), ($2, 'Có từ trước', 'cu@x.vn')", [a, b]);

  await db.exec(SQL);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("1. migration không đổi gì cho tới khi có người đặt giới hạn", () => {
  it("dữ liệu có sẵn còn nguyên; sự kiện cũ mặc định không giới hạn, phạm vi event", async () => {
    expect(await count("select count(*)::int as n from event_registrations where email = 'cu@x.vn'")).toBe(2);
    expect(await count("select count(*)::int as n from events where registration_limit_per_email is not null")).toBe(0);
    expect(await count("select count(*)::int as n from events where registration_limit_scope = 'event'")).toBe(
      await count("select count(*)::int as n from events")
    );
  }, TIMEOUT);

  it("không giới hạn: một email đăng ký mọi buổi của chuỗi như hôm nay", async () => {
    const { events } = await newSeries(null);
    for (const event of events) await register(event, "tuy-y@x.vn");
    expect(await active(events)).toBe(3);
  }, TIMEOUT);

  it("ràng buộc cột: giới hạn 0 hoặc âm, phạm vi lạ đều bị từ chối", async () => {
    for (const bad of [0, -1]) {
      const error = await errorOf(() => db.query("insert into events(registration_limit_per_email) values ($1)", [bad]));
      expect(error?.message, `giới hạn ${bad}`).toContain("events_registration_limit_check");
    }
    const scope = await errorOf(() => db.query("insert into events(registration_limit_scope) values ('mọi nơi')"));
    expect(scope?.message).toContain("events_registration_limit_scope_check");
  }, TIMEOUT);
});

describe("2. giới hạn theo chuỗi", () => {
  it("giới hạn 1: buổi thứ hai bị chặn bằng đúng lỗi, và không ghi gì", async () => {
    const { events } = await newSeries(1);
    await register(events[0], "an@x.vn");
    const error = await errorOf(() => register(events[1], "an@x.vn"));
    expect(error?.message).toContain(LIMIT_ERROR);
    expect(await active(events)).toBe(1);
  }, TIMEOUT);

  it("giới hạn 2: được hai buổi, buổi thứ ba bị chặn", async () => {
    const { events } = await newSeries(2);
    await register(events[0], "an@x.vn");
    await register(events[1], "an@x.vn");
    expect((await errorOf(() => register(events[2], "an@x.vn")))?.message).toContain(LIMIT_ERROR);
    expect(await active(events)).toBe(2);
  }, TIMEOUT);

  it("nộp lại để sửa đăng ký đã có không phải lượt mới, dù đang ở đúng giới hạn", async () => {
    const { events } = await newSeries(1);
    const first = await register(events[0], "an@x.vn", { name: "Tên gõ sai" });
    await db.query("update event_registrations set full_name = 'Tên đúng', email = 'an@x.vn' where id = $1", [first.id]);
    expect(await count("select count(*)::int as n from event_registrations where full_name = 'Tên đúng' and event_id = $1", [events[0]])).toBe(1);
  }, TIMEOUT);

  it("hạ giới hạn SAU khi đã có người đăng ký nhiều buổi: họ vẫn sửa được tên, số điện thoại ở các đăng ký đang có", async () => {
    const { seriesId, events } = await newSeries(2);
    const first = await register(events[0], "an@x.vn", { name: "Tên gõ sai" });
    await register(events[1], "an@x.vn");
    await db.query("update events set registration_limit_per_email = 1 where series_id = $1", [seriesId]);

    // Đã vượt giới hạn mới (2 > 1), nhưng đây là đăng ký có từ trước: sửa chữ trên nó không phải lượt mới.
    await db.query("update event_registrations set full_name = 'Tên đúng', email = 'an@x.vn' where id = $1", [first.id]);
    expect(await count("select count(*)::int as n from event_registrations where full_name = 'Tên đúng'")).toBeGreaterThanOrEqual(1);

    // Còn lượt MỚI thì bị chặn ngay.
    expect((await errorOf(() => register(events[2], "an@x.vn")))?.message).toContain(LIMIT_ERROR);
  }, TIMEOUT);

  it("email khác, chuỗi khác đều không bị ảnh hưởng; so email không phân biệt hoa thường và khoảng trắng", async () => {
    const one1 = await newSeries(1);
    const other = await newSeries(1);
    await register(one1.events[0], "an@x.vn");
    await register(one1.events[1], "binh@x.vn"); // người khác
    await register(other.events[0], "an@x.vn"); // chuỗi khác
    expect((await errorOf(() => register(one1.events[2], "  AN@X.vn ")))?.message).toContain(LIMIT_ERROR);
  }, TIMEOUT);
});

describe("3. luật đếm và hoàn lượt", () => {
  it("huỷ đăng ký hoàn lượt ngay, đăng ký buổi khác được", async () => {
    const { events } = await newSeries(1);
    const first = await register(events[0], "an@x.vn");
    expect((await errorOf(() => register(events[1], "an@x.vn")))?.message).toContain(LIMIT_ERROR);
    await db.query("update event_registrations set registration_status = 'cancelled' where id = $1", [first.id]);
    await register(events[1], "an@x.vn");
    expect(await active(events)).toBe(2); // một dòng đã huỷ + một dòng đang có hiệu lực
  }, TIMEOUT);

  it("khôi phục một đăng ký đã huỷ khi email đã đủ lượt ở buổi khác thì bị chặn", async () => {
    const { events } = await newSeries(1);
    const first = await register(events[0], "an@x.vn");
    await db.query("update event_registrations set registration_status = 'cancelled' where id = $1", [first.id]);
    await register(events[1], "an@x.vn");
    const error = await errorOf(() => db.query("update event_registrations set registration_status = 'registered' where id = $1", [first.id]));
    expect(error?.message).toContain(LIMIT_ERROR);
  }, TIMEOUT);

  it("đổi email của một đăng ký sang email đã đủ lượt ở buổi khác thì bị chặn", async () => {
    const { events } = await newSeries(1);
    await register(events[0], "an@x.vn");
    const second = await register(events[1], "binh@x.vn");
    const error = await errorOf(() => db.query("update event_registrations set email = 'an@x.vn' where id = $1", [second.id]));
    expect(error?.message).toContain(LIMIT_ERROR);
  }, TIMEOUT);

  it("đổi giữa các trạng thái còn hiệu lực (chờ duyệt, xác nhận) không phải lượt mới", async () => {
    const { events } = await newSeries(1);
    const first = await register(events[0], "an@x.vn", { status: "pending_review" });
    await db.query("update event_registrations set registration_status = 'confirmed' where id = $1", [first.id]);
    await db.query("update event_registrations set registration_status = 'waitlisted' where id = $1", [first.id]);
    expect(await count("select count(*)::int as n from event_registrations where id = $1 and registration_status = 'waitlisted'", [first.id])).toBe(1);
  }, TIMEOUT);

  it.each(STATUSES)("luật đếm của SQL và của TypeScript trùng nhau với trạng thái %s", async (status) => {
    const sql = (await one<{ ok: boolean }>("select public.vam_registration_counts_toward_limit($1) as ok", [status])).ok;
    expect(sql).toBe(countsTowardRegistrationLimit(status));
  }, TIMEOUT);

  it("bị từ chối không tính; chờ duyệt, đã xác nhận, danh sách chờ đều tính", async () => {
    const { events } = await newSeries(1);
    await register(events[0], "tu-choi@x.vn", { status: "rejected" });
    await register(events[1], "tu-choi@x.vn"); // dòng bị từ chối không chiếm lượt
    // Vòng lặp theo chỉ số: dự án biên dịch xuống ES5, duyệt thẳng một iterator cần downlevelIteration.
    const counting = ["pending_review", "confirmed", "waitlisted"];
    for (let index = 0; index < counting.length; index += 1) {
      const status = counting[index];
      const fresh = await newSeries(1);
      await register(fresh.events[0], `tinh-${index}@x.vn`, { status });
      expect((await errorOf(() => register(fresh.events[1], `tinh-${index}@x.vn`)))?.message, status).toContain(LIMIT_ERROR);
    }
  }, TIMEOUT);
});

describe("4. chỉ đăng ký công khai bị giới hạn", () => {
  it("vãng lai và BTC nhập tay đăng ký vượt giới hạn vẫn được", async () => {
    const { events } = await newSeries(1);
    await register(events[0], "an@x.vn");
    await register(events[1], "an@x.vn", { walkIn: true, source: "walk_in" });
    await register(events[2], "an@x.vn", { source: "admin_input" });
    expect(await active(events)).toBe(3);
  }, TIMEOUT);

  it("dòng vãng lai không bị tính vào giới hạn của đăng ký công khai", async () => {
    const { events } = await newSeries(1);
    await register(events[0], "an@x.vn", { walkIn: true, source: "walk_in" });
    await register(events[1], "an@x.vn"); // lượt công khai đầu tiên của email này
    expect(await active(events)).toBe(2);
  }, TIMEOUT);
});

describe("5. phạm vi một sự kiện không can thiệp, để đường ghi đè còn chạy", () => {
  it("event + giới hạn 1: hai lần bấm cùng buổi vẫn là lỗi trùng khoá 23505, không phải lỗi giới hạn", async () => {
    const event = await newSingleEvent(1, "event");
    await register(event, "an@x.vn");
    const error = await errorOf(() => register(event, "an@x.vn"));
    expect(error?.code).toBe("23505");
    expect(error?.message).not.toContain(LIMIT_ERROR);
  }, TIMEOUT);

  it("buổi của chuỗi nhưng phạm vi event: không đếm sang các buổi khác, mỗi buổi tính riêng", async () => {
    const { events } = await newSeries(1, "event");
    for (const event of events) await register(event, "an@x.vn");
    expect(await active(events)).toBe(3);
  }, TIMEOUT);

  it("sự kiện lẻ (không có chuỗi) mà phạm vi ghi là series: coi như không giới hạn thêm", async () => {
    const event = await newSingleEvent(1, "series");
    await register(event, "an@x.vn");
    expect(await active([event])).toBe(1);
  }, TIMEOUT);
});

describe("6. chống đua: cùng một email, cùng một chuỗi, cùng một khoá", () => {
  const advisoryLocks = () => count("select count(*)::int as n from pg_locks where locktype = 'advisory'");

  it("hai buổi khác nhau của cùng chuỗi xin cùng một khoá; email khác xin khoá khác", async () => {
    const { events } = await newSeries(3);
    await db.exec("begin");
    try {
      expect(await advisoryLocks()).toBe(0);
      await register(events[0], "an@x.vn");
      expect(await advisoryLocks()).toBe(1);
      await register(events[1], "an@x.vn"); // buổi khác, cùng email: cùng khoá
      expect(await advisoryLocks()).toBe(1);
      await register(events[0], "binh@x.vn"); // email khác: khoá khác
      expect(await advisoryLocks()).toBe(2);
    } finally {
      await db.exec("rollback");
    }
  }, TIMEOUT);

  it("chuỗi khác xin khoá khác dù cùng email", async () => {
    const first = await newSeries(3);
    const second = await newSeries(3);
    await db.exec("begin");
    try {
      await register(first.events[0], "an@x.vn");
      await register(second.events[0], "an@x.vn");
      expect(await advisoryLocks()).toBe(2);
    } finally {
      await db.exec("rollback");
    }
  }, TIMEOUT);

  it("không giới hạn thì không xin khoá nào (không làm chậm sự kiện hiện có)", async () => {
    const { events } = await newSeries(null);
    await db.exec("begin");
    try {
      await register(events[0], "an@x.vn");
      expect(await advisoryLocks()).toBe(0);
    } finally {
      await db.exec("rollback");
    }
  }, TIMEOUT);
});

describe("7. quyền và chạy lại", () => {
  it("anon, authenticated không gọi được hàm; service_role gọi được hàm đếm", async () => {
    for (const role of ["anon", "authenticated"]) {
      const row = await one<{ a: boolean; b: boolean }>(
        `select has_function_privilege($1, 'public.vam_enforce_event_registration_limit()', 'execute') as a,
                has_function_privilege($1, 'public.vam_registration_counts_toward_limit(text)', 'execute') as b`,
        [role]
      );
      expect(row, role).toEqual({ a: false, b: false });
    }
    expect((await one<{ ok: boolean }>("select has_function_privilege('service_role', 'public.vam_registration_counts_toward_limit(text)', 'execute') as ok")).ok).toBe(true);
  }, TIMEOUT);

  it("dán lại lần hai vẫn chạy, giới hạn đã đặt còn nguyên và vẫn chặn", async () => {
    const { events } = await newSeries(1);
    await register(events[0], "an@x.vn");
    await db.exec(SQL);
    expect(await count("select count(*)::int as n from events where id = $1 and registration_limit_per_email = 1", [events[0]])).toBe(1);
    expect((await errorOf(() => register(events[1], "an@x.vn")))?.message).toContain(LIMIT_ERROR);
  }, TIMEOUT);
});
