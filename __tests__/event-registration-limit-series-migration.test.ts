/**
 * VAM00028 — giới hạn đăng ký theo email là của CẢ CHUỖI. Migration 20261103230000 (VAM00015) rồi
 * 20261109120000 chạy THẬT trên PostgreSQL (PGlite), theo đúng thứ tự áp trên production.
 *
 * Lỗi: trigger cũ đọc giới hạn trên chính buổi đang được đăng ký. Chuỗi mà các buổi lệch cấu hình (sửa
 * một buổi quên tick "áp cho mọi buổi", hay buổi thêm sau chép cấu hình "một sự kiện") thì:
 *   - đăng ký buổi CÓ giới hạn sau buổi KHÔNG có: bị chặn (đúng);
 *   - đảo lại: lọt (sai), vì buổi không có giới hạn không đếm gì và không xin khoá.
 *
 * Điều phải đúng sau khi sửa:
 *   - mỗi email tối đa N lượt còn hiệu lực trên toàn chuỗi, bất kể thứ tự đăng ký hay buổi nào mang cấu hình;
 *   - buổi thêm sau (không tự mang cấu hình) theo giới hạn chung của chuỗi;
 *   - huỷ hoàn lượt; ràng buộc một-email-một-buổi còn nguyên; phạm vi "một sự kiện" không đổi;
 *   - đăng ký đồng thời: mọi buổi của chuỗi xin CÙNG một khoá (chuỗi, email) TRƯỚC khi đếm, kể cả buổi
 *     không tự mang cấu hình. PGlite chỉ có một kết nối nên không dựng được hai giao dịch chạy song song
 *     thật; ca 6 đo khoá thay cho đo cuộc đua (cùng cách test của VAM00015);
 *   - dữ liệu đang có không bị đụng: người đã vượt giới hạn từ trước vẫn giữ và sửa được đăng ký.
 *
 * Mỗi ca dùng chuỗi và email riêng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { seriesRegistrationLimit } from "@/lib/event-registration-limit-core";

const read = (file: string) => readFileSync(path.resolve("supabase/migrations", file), "utf8").replace(/\r/g, "");
const BASE_SQL = read("20261103230000_gioi_han_dang_ky_theo_email.sql");
const FIX_SQL = read("20261109120000_gioi_han_dang_ky_toan_chuoi.sql");
const LIMIT_ERROR = "EVENT_REGISTRATION_LIMIT_REACHED";
const TIMEOUT = 30_000;

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params)).n);

async function errorOf(run: () => Promise<unknown>): Promise<{ message: string; code?: string; detail?: string } | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const shape = error as { message?: string; code?: string; detail?: string };
    return { message: String(shape.message ?? error), code: shape.code, detail: shape.detail };
  }
}

type Config = { limit: number | null; scope: "event" | "series" };
const SERIES_1: Config = { limit: 1, scope: "series" };
const NONE: Config = { limit: null, scope: "event" };

let emailSeq = 0;
const freshEmail = () => `nguoi-${(emailSeq += 1)}@x.vn`;

/** Chuỗi với cấu hình riêng cho từng buổi, theo thứ tự buổi 1, 2, 3… */
const newSeries = async (configs: Config[]) => {
  const seriesId = (await one<{ id: string }>("select gen_random_uuid() as id")).id;
  const events: string[] = [];
  for (let index = 0; index < configs.length; index += 1) {
    events.push(await addSession(seriesId, index + 1, configs[index]));
  }
  return { seriesId, events };
};
const addSession = async (seriesId: string, index: number, config: Config) =>
  (
    await one<{ id: string }>(
      `insert into events(series_id, series_index, registration_limit_per_email, registration_limit_scope)
       values ($1, $2, $3, $4) returning id`,
      [seriesId, index, config.limit, config.scope]
    )
  ).id;

const register = (eventId: string, email: string, options: { status?: string; source?: string; walkIn?: boolean; name?: string } = {}) =>
  one<{ id: string }>(
    `insert into event_registrations(event_id, full_name, email, registration_status, registration_source, is_walk_in)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [eventId, options.name ?? "Bạn A", email, options.status ?? "registered", options.source ?? "public_form", options.walkIn ?? false]
  );
/** true khi đăng ký được, false khi bị chặn đúng lỗi giới hạn; lỗi khác thì ném. */
const tryRegister = async (eventId: string, email: string) => {
  const error = await errorOf(() => register(eventId, email));
  if (!error) return true;
  if (error.message.includes(LIMIT_ERROR)) return false;
  throw new Error(`lỗi lạ: ${error.message}`);
};
const activeOf = (email: string) =>
  count("select count(*)::int as n from event_registrations where lower(email) = lower($1) and registration_status <> 'cancelled'", [email]);

const permutations = <T>(items: T[]): T[][] =>
  items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));

// Dữ liệu có từ trước: một chuỗi đã bị đặt giới hạn 1 theo chuỗi ở buổi 2 (BTC quên tick "áp cho mọi buổi"),
// trong đó một email đã có hai đăng ký còn hiệu lực — vượt giới hạn trên dữ liệu thật.
const before = { seriesId: "", events: [] as string[], regs: [] as string[] };

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
  await db.exec(BASE_SQL);

  // Dựng dữ liệu "đang chạy" bằng mã CŨ: buổi 1 (không giới hạn) trước, buổi 2 (giới hạn 1) sau thì bị
  // chặn; nhưng buổi 2 trước, buổi 1 sau thì lọt — đúng lỗi của phiếu, và để lại một email vượt giới hạn.
  const old = await newSeries([NONE, SERIES_1, NONE]);
  before.seriesId = old.seriesId;
  before.events = old.events;
  before.regs.push((await register(old.events[1], "da-vuot@x.vn")).id);
  before.regs.push((await register(old.events[0], "da-vuot@x.vn")).id);

  await db.exec(FIX_SQL);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("0. dữ liệu đang có không bị đụng", () => {
  it("migration không đổi đăng ký nào, không đổi cấu hình sự kiện nào", async () => {
    expect(await activeOf("da-vuot@x.vn")).toBe(2);
    const rows = (
      await db.query<{ limit: number | null; scope: string }>(
        "select registration_limit_per_email as limit, registration_limit_scope as scope from events where series_id = $1 order by series_index",
        [before.seriesId]
      )
    ).rows;
    expect(rows).toEqual([
      { limit: null, scope: "event" },
      { limit: 1, scope: "series" },
      { limit: null, scope: "event" }
    ]);
  }, TIMEOUT);

  it("người đã vượt giới hạn từ trước vẫn sửa được tên ở cả hai đăng ký; không bị huỷ hay chặn ngược", async () => {
    for (const id of before.regs) {
      await db.query("update event_registrations set full_name = 'Đã sửa tên', email = 'DA-VUOT@x.vn' where id = $1", [id]);
    }
    expect(await count("select count(*)::int as n from event_registrations where full_name = 'Đã sửa tên'")).toBe(2);
    expect(await activeOf("da-vuot@x.vn")).toBe(2);
  }, TIMEOUT);

  it("nhưng họ không đăng ký thêm được buổi thứ ba của chuỗi", async () => {
    expect(await tryRegister(before.events[2], "da-vuot@x.vn")).toBe(false);
  }, TIMEOUT);
});

describe("1. phiếu mục 2: chuỗi mới 3 buổi, giới hạn 1, mọi thứ tự", () => {
  it("A: buổi 1 được, buổi 2 chặn · B: buổi 2 được, buổi 1 chặn · C: buổi 3 được, buổi 1 và 2 chặn", async () => {
    const { events } = await newSeries([SERIES_1, SERIES_1, SERIES_1]);
    expect(await tryRegister(events[0], "a@x.vn")).toBe(true);
    expect(await tryRegister(events[1], "a@x.vn")).toBe(false);
    expect(await tryRegister(events[1], "b@x.vn")).toBe(true);
    expect(await tryRegister(events[0], "b@x.vn")).toBe(false);
    expect(await tryRegister(events[2], "c@x.vn")).toBe(true);
    expect(await tryRegister(events[0], "c@x.vn")).toBe(false);
    expect(await tryRegister(events[1], "c@x.vn")).toBe(false);
    for (const email of ["a@x.vn", "b@x.vn", "c@x.vn"]) expect(await activeOf(email), email).toBe(1);
  }, TIMEOUT);

  it("cả 6 thứ tự đăng ký 3 buổi: giới hạn 1 thì đúng buổi đầu tiên được; giới hạn 2 thì đúng hai buổi đầu", async () => {
    for (const limit of [1, 2]) {
      const config: Config = { limit, scope: "series" };
      const { events } = await newSeries([config, config, config]);
      for (const order of permutations([0, 1, 2])) {
        const email = freshEmail();
        const results: boolean[] = [];
        for (const index of order) results.push(await tryRegister(events[index], email));
        expect(results, `giới hạn ${limit}, thứ tự ${order.map((i) => i + 1).join("-")}`).toEqual([0, 1, 2].map((i) => i < limit));
      }
    }
  }, TIMEOUT);
});

describe("2. lỗi thứ tự: chỉ một buổi mang giới hạn (sửa một buổi quên tick 'áp cho mọi buổi')", () => {
  it("buổi 2 (mang giới hạn) trước, buổi 1 (không mang) sau: buổi 1 bị chặn", async () => {
    const { events } = await newSeries([NONE, SERIES_1, NONE]);
    expect(await tryRegister(events[1], "b2-truoc@x.vn")).toBe(true);
    expect(await tryRegister(events[0], "b2-truoc@x.vn")).toBe(false);
    expect(await activeOf("b2-truoc@x.vn")).toBe(1);
  }, TIMEOUT);

  it("buổi 1 trước, buổi 3 sau — hai buổi đều không tự mang giới hạn — cũng bị chặn", async () => {
    const { events } = await newSeries([NONE, SERIES_1, NONE]);
    expect(await tryRegister(events[0], "b1-b3@x.vn")).toBe(true);
    expect(await tryRegister(events[2], "b1-b3@x.vn")).toBe(false);
  }, TIMEOUT);

  it("mọi thứ tự, mọi buổi mang giới hạn: luôn đúng một buổi được", async () => {
    for (const carrier of [0, 1, 2]) {
      const configs = [NONE, NONE, NONE].map((c, i) => (i === carrier ? SERIES_1 : c));
      const { events } = await newSeries(configs);
      for (const order of permutations([0, 1, 2])) {
        const email = freshEmail();
        const results: boolean[] = [];
        for (const index of order) results.push(await tryRegister(events[index], email));
        expect(results, `buổi ${carrier + 1} mang giới hạn, thứ tự ${order.map((i) => i + 1).join("-")}`).toEqual([true, false, false]);
      }
    }
  }, TIMEOUT);

  it("các buổi lệch số: lấy số nhỏ nhất (2 và 3 → 2), và khớp seriesRegistrationLimit của TypeScript", async () => {
    const cases: Config[][] = [
      [{ limit: 3, scope: "series" }, { limit: 2, scope: "series" }, NONE, NONE],
      // Dòng cũ phạm vi 'event' mang số 1 cũng góp vào giới hạn chung (BTC chốt 11/11: chỉ có giới hạn toàn chuỗi).
      [{ limit: 2, scope: "series" }, { limit: 1, scope: "event" }, NONE, NONE],
      [{ limit: 2, scope: "event" }, NONE, NONE, NONE],
      [NONE, NONE, { limit: 3, scope: "series" }, NONE]
    ];
    for (const configs of cases) {
      const expected = seriesRegistrationLimit(configs.map((c) => ({ registration_limit_per_email: c.limit, registration_limit_scope: c.scope })));
      const { events } = await newSeries(configs);
      const email = freshEmail();
      const results: boolean[] = [];
      for (const event of events) results.push(await tryRegister(event, email));
      expect(results.filter(Boolean).length, JSON.stringify(configs)).toBe(expected?.limit);
    }
  }, TIMEOUT);

  it("lỗi mang đúng giới hạn của chuỗi trong detail, để câu báo nói đúng số", async () => {
    const { events } = await newSeries([NONE, { limit: 2, scope: "series" }, NONE]);
    await register(events[1], "detail@x.vn");
    await register(events[2], "detail@x.vn");
    const error = await errorOf(() => register(events[0], "detail@x.vn"));
    expect(error?.message).toContain(LIMIT_ERROR);
    expect(error?.detail).toContain("scope=series; limit=2; count=2");
  }, TIMEOUT);
});

describe("3. buổi thêm sau vào chuỗi đã có giới hạn", () => {
  it("buổi mới không tự mang cấu hình (chép từ buổi 'một sự kiện') vẫn theo giới hạn chung, cả hai chiều", async () => {
    const { seriesId, events } = await newSeries([SERIES_1, SERIES_1]);
    await register(events[0], "da-co@x.vn");
    const added = await addSession(seriesId, 3, { limit: 1, scope: "event" });
    expect(await tryRegister(added, "da-co@x.vn")).toBe(false);
    expect(await tryRegister(added, "moi@x.vn")).toBe(true);
    expect(await tryRegister(events[0], "moi@x.vn")).toBe(false);
    expect(await tryRegister(events[1], "moi@x.vn")).toBe(false);
  }, TIMEOUT);

  it("sự kiện lẻ mang phạm vi 'series' được thêm buổi: từ lúc đó mọi buổi cùng chịu giới hạn", async () => {
    const lone = await one<{ id: string }>(
      "insert into events(registration_limit_per_email, registration_limit_scope) values (1, 'series') returning id"
    );
    // Còn lẻ: không có chuỗi để đếm, chỉ còn ràng buộc một-email-một-buổi.
    expect(await tryRegister(lone.id, "le@x.vn")).toBe(true);
    const seriesId = (await one<{ id: string }>("select gen_random_uuid() as id")).id;
    await db.query("update events set series_id = $1, series_index = 1 where id = $2", [seriesId, lone.id]);
    const added = await addSession(seriesId, 2, NONE);
    expect(await tryRegister(added, "le@x.vn")).toBe(false);
    expect(await tryRegister(added, "le-2@x.vn")).toBe(true);
    expect(await tryRegister(lone.id, "le-2@x.vn")).toBe(false);
  }, TIMEOUT);
});

describe("4. huỷ hoàn lượt", () => {
  it("huỷ buổi 2 rồi đăng ký buổi 1 được; khôi phục buổi 2 lúc đó thì bị chặn", async () => {
    const { events } = await newSeries([NONE, SERIES_1, NONE]);
    const first = await register(events[1], "huy@x.vn");
    await db.query("update event_registrations set registration_status = 'cancelled' where id = $1", [first.id]);
    expect(await tryRegister(events[0], "huy@x.vn")).toBe(true);
    const restore = await errorOf(() => db.query("update event_registrations set registration_status = 'registered' where id = $1", [first.id]));
    expect(restore?.message).toContain(LIMIT_ERROR);
    expect(await activeOf("huy@x.vn")).toBe(1);
  }, TIMEOUT);

  it("bị từ chối cũng hoàn lượt; chờ duyệt và danh sách chờ vẫn tính", async () => {
    const { events } = await newSeries([SERIES_1, NONE, NONE]);
    await register(events[2], "tu-choi@x.vn", { status: "rejected" });
    expect(await tryRegister(events[1], "tu-choi@x.vn")).toBe(true);
    await register(events[2], "cho@x.vn", { status: "waitlisted" });
    expect(await tryRegister(events[0], "cho@x.vn")).toBe(false);
  }, TIMEOUT);
});

describe("5. những thứ không đổi", () => {
  it("ràng buộc một-email-một-buổi: hai lần cùng buổi của chuỗi có giới hạn là lỗi trùng khoá 23505 (đường ghi đè), không phải 'đủ lượt'", async () => {
    const { events } = await newSeries([SERIES_1, SERIES_1]);
    await register(events[0], "trung@x.vn");
    const error = await errorOf(() => register(events[0], "trung@x.vn"));
    expect(error?.code).toBe("23505");
  }, TIMEOUT);

  it("sự kiện lẻ (chuỗi một buổi) giới hạn 1: vẫn chỉ là ràng buộc trùng khoá, không phải lỗi giới hạn", async () => {
    const lone = await one<{ id: string }>("insert into events(registration_limit_per_email, registration_limit_scope) values (1, 'event') returning id");
    await register(lone.id, "le-event@x.vn");
    const error = await errorOf(() => register(lone.id, "le-event@x.vn"));
    expect(error?.code).toBe("23505");
    expect(error?.message).not.toContain(LIMIT_ERROR);
  }, TIMEOUT);

  it("VAM00028 (BTC chốt 11/11): cột phạm vi không còn được đọc — chuỗi mà mọi buổi ghi 'một sự kiện' giới hạn 1 vẫn là 1 buổi cho cả chuỗi, mọi thứ tự", async () => {
    const event1: Config = { limit: 1, scope: "event" };
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
      const { events } = await newSeries([event1, event1, event1]);
      const email = freshEmail();
      const results: boolean[] = [];
      for (const index of order) results.push(await tryRegister(events[index], email));
      expect(results, order.join("-")).toEqual([true, false, false]);
    }
  }, TIMEOUT);

  it("VAM00028: dữ liệu cũ lệch như trên production (vài buổi 'một sự kiện' 1, vài buổi 'toàn chuỗi' 1, một buổi trống) → 1 buổi cả chuỗi, mọi thứ tự", async () => {
    const event1: Config = { limit: 1, scope: "event" };
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
      const { events } = await newSeries([event1, NONE, SERIES_1, event1]);
      const email = freshEmail();
      const results: boolean[] = [];
      for (const index of order) results.push(await tryRegister(events[index], email));
      expect(results, order.join("-")).toEqual([true, false, false, false]);
    }
  }, TIMEOUT);

  it("VAM00028: buổi thêm sau chép dòng cũ 'một sự kiện' số 1 vào chuỗi đang trống: từ lúc đó cả chuỗi giới hạn 1", async () => {
    const { seriesId, events } = await newSeries([NONE, NONE]);
    expect(await tryRegister(events[0], "them-sau@x.vn")).toBe(true);
    const added = await addSession(seriesId, 3, { limit: 1, scope: "event" });
    expect(await tryRegister(added, "them-sau@x.vn")).toBe(false);
    expect(await tryRegister(events[1], "them-sau@x.vn")).toBe(false);
  }, TIMEOUT);

  it("chuỗi không giới hạn: đăng ký mọi buổi như trước nay", async () => {
    const { events } = await newSeries([NONE, NONE, NONE]);
    for (const event of events) expect(await tryRegister(event, "tu-do@x.vn")).toBe(true);
  }, TIMEOUT);

  it("vãng lai, BTC nhập tay không bị chặn; vãng lai không bị tính", async () => {
    const { events } = await newSeries([NONE, SERIES_1, NONE]);
    await register(events[0], "tay@x.vn");
    expect(await errorOf(() => register(events[1], "tay@x.vn", { source: "admin_manual" }))).toBeNull();
    expect(await errorOf(() => register(events[2], "tay@x.vn", { walkIn: true }))).toBeNull();
    await register(events[0], "vang-lai@x.vn", { walkIn: true });
    expect(await tryRegister(events[1], "vang-lai@x.vn")).toBe(true);
  }, TIMEOUT);

  it("so email không phân biệt hoa thường và khoảng trắng", async () => {
    const { events } = await newSeries([NONE, SERIES_1]);
    await register(events[1], "Hoa@X.vn");
    expect(await tryRegister(events[0], "  hoa@x.VN ")).toBe(false);
  }, TIMEOUT);
});

describe("6. đồng thời: mọi buổi của chuỗi xin cùng một khoá (chuỗi, email) trước khi đếm", () => {
  const lockKey = async (seriesId: string, email: string) =>
    (await one<{ k: string }>("select hashtextextended('event_registration_limit:' || $1 || ':' || $2, 0)::text as k", [seriesId, email])).k;
  const heldKeys = async () =>
    (
      await db.query<{ k: string }>(
        "select ((classid::bigint << 32) | objid::bigint)::text as k from pg_locks where locktype = 'advisory' and objsubid = 1 and pid = pg_backend_pid()"
      )
    ).rows.map((row) => row.k);

  it("buổi KHÔNG tự mang cấu hình vẫn xin khoá của chuỗi (mã cũ không xin, nên hai lần bấm gần nhau lọt cả hai)", async () => {
    const { seriesId, events } = await newSeries([NONE, SERIES_1, NONE]);
    await db.exec("begin");
    try {
      await register(events[0], "khoa@x.vn");
      expect(await heldKeys()).toEqual([await lockKey(seriesId, "khoa@x.vn")]);
    } finally {
      await db.exec("rollback");
    }
  }, TIMEOUT);

  it("buổi 1 và buổi 2, theo thứ tự nào, cùng một khoá; email khác khoá khác", async () => {
    const { seriesId, events } = await newSeries([NONE, SERIES_1, NONE]);
    const expected = await lockKey(seriesId, "khoa2@x.vn");
    for (const order of [[1, 0], [0, 1]]) {
      await db.exec("begin");
      try {
        await register(events[order[0]], "khoa2@x.vn");
        await db.exec("savepoint second");
        await errorOf(() => register(events[order[1]], "khoa2@x.vn"));
        await db.exec("rollback to savepoint second");
        expect(await heldKeys(), `thứ tự ${order.map((i) => i + 1).join("-")}`).toEqual([expected]);
        await register(events[2], "khac@x.vn");
        expect((await heldKeys()).sort()).toEqual([expected, await lockKey(seriesId, "khac@x.vn")].sort());
      } finally {
        await db.exec("rollback");
      }
    }
  }, TIMEOUT);

  it("hai yêu cầu gửi cùng lúc ở hai buổi: đúng một lượt được ghi", async () => {
    const { events } = await newSeries([NONE, SERIES_1, NONE]);
    const results = await Promise.all([tryRegister(events[0], "cung-luc@x.vn"), tryRegister(events[2], "cung-luc@x.vn")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await activeOf("cung-luc@x.vn")).toBe(1);
  }, TIMEOUT);

  it("chuỗi không giới hạn thì không xin khoá nào (không làm chậm sự kiện hiện có)", async () => {
    const { events } = await newSeries([NONE, NONE]);
    await db.exec("begin");
    try {
      await register(events[0], "khong-khoa@x.vn");
      expect(await heldKeys()).toEqual([]);
    } finally {
      await db.exec("rollback");
    }
  }, TIMEOUT);
});

describe("7. quyền và chạy lại", () => {
  it("anon, authenticated không gọi được hàm trigger", async () => {
    for (const role of ["anon", "authenticated"]) {
      const row = await one<{ a: boolean }>("select has_function_privilege($1, 'public.vam_enforce_event_registration_limit()', 'execute') as a", [role]);
      expect(row.a, role).toBe(false);
    }
  }, TIMEOUT);

  it("dán lại lần hai vẫn chạy và vẫn chặn theo chuỗi", async () => {
    await db.exec(FIX_SQL);
    const { events } = await newSeries([NONE, SERIES_1]);
    await register(events[1], "dan-lai@x.vn");
    expect(await tryRegister(events[0], "dan-lai@x.vn")).toBe(false);
  }, TIMEOUT);

  it("dán lại migration CŨ (VAM00015) sau bản sửa sẽ đưa lỗi thứ tự trở lại — ghi trong PR: đừng dán lại file cũ", async () => {
    // Ca này khoá thứ tự áp: nếu ai đó dán lại 20261103230000 thì hàm cũ đè hàm mới.
    await db.exec(BASE_SQL);
    const { events } = await newSeries([NONE, SERIES_1]);
    await register(events[1], "cu-de@x.vn");
    expect(await tryRegister(events[0], "cu-de@x.vn")).toBe(true);
    await db.exec(FIX_SQL);
  }, TIMEOUT);
});
