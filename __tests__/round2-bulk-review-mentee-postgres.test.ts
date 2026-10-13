/**
 * Duyệt nhóm hàng loạt cho MENTEE (BTC 13/10/2026) — vam122_confirm_mentee_groups chạy THẬT trên
 * PostgreSQL (PGlite), cùng bộ migration Vòng 2 như bản mentor.
 *
 * Việc này ghi "BTC đã duyệt" cho cả trăm người một lần nên mọi luật phải nằm trong hàm:
 *   - đúng người có quyền sửa nhóm (BTC vận hành mùa, Support team có quyền operations);
 *   - cả lô là một giao dịch: một dòng sai thì KHÔNG dòng nào được ghi;
 *   - chỉ nhận dòng của MENTEE (dòng mentor bị coi như không tồn tại), đúng mùa, còn do máy gán,
 *     đúng nhóm và đúng dữ liệu gợi ý lúc người duyệt nhìn;
 *   - người phải có đơn mentee đã duyệt (kể cả đơn đặc cách) và tư cách mentee chưa rút.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

let db: PGlite;
type Row = { assignmentId: string; expectedGroup: number; expectedDrift: number | null };
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

const confirm = async (actor: string, rows: unknown, season: string = ids.season) =>
  (await one<{ r: { ok: boolean; approved: number } }>("select public.vam122_confirm_mentee_groups($1, $2, $3::jsonb) as r", [actor, season, JSON.stringify(rows)])).r;

let seq = 9000;
async function mentee(
  name: string,
  opts: { group?: number; flags?: string[]; app?: string | null; appSeason?: string; member?: string | null; memberSeason?: string; source?: string; drift?: number | null; season?: string; role?: string } = {}
): Promise<{ person: string; assignment: string; row: Row }> {
  const person = uuid(++seq);
  const group = opts.group ?? 3;
  await db.query("insert into people(id, full_name) values ($1, $2)", [person, name]);
  const app = opts.app === undefined ? "approved_as_mentee" : opts.app;
  if (app) await db.query("insert into applications(person_id, season_id, role_applied, status) values ($1, $2, $3, $4)", [person, opts.appSeason ?? ids.season, opts.role === "mentor" ? "mentor" : "mentee", app]);
  if (opts.member) await db.query("insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, 'mentee', $4)", [person, ids.program, opts.memberSeason ?? ids.season, opts.member]);
  const { id } = await one<{ id: string }>(
    `insert into matching_industry_assignments(person_id, season_id, role, group_code, confidence, rule_version, flags, source, drift_group)
     values ($1, $2, $3, $4, 'thap', 'test', $5::text[], $6, $7) returning id`,
    [person, opts.season ?? ids.season, opts.role ?? "mentee", group, `{${(opts.flags ?? ["CAN_BTC_XEM"]).join(",")}}`, opts.source ?? "auto", opts.drift ?? null]
  );
  return { person, assignment: id, row: { assignmentId: id, expectedGroup: group, expectedDrift: opts.drift ?? null } };
}

const logCount = async () => Number((await one<{ n: number }>("select count(*)::int as n from matching_industry_assignment_log")).n);
const sources = async (ids_: string[]) =>
  (await all<{ id: string; source: string }>("select id, source from matching_industry_assignments where id = any($1::uuid[]) order by id", [ids_])).map((r) => r.source);

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
    await db.exec("set role service_role");
  }
}
async function refused(run: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("savepoint refused");
  await expect(run()).rejects.toThrow(pattern);
  await db.exec("rollback to savepoint refused");
}

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Supabase cấp sẵn quyền thực thi hàm mới cho anon/authenticated/service_role (default privileges); PGlite thì không.
  // Không bắt chước thì dòng revoke trong migration không có gì để thu hồi và test quyền xanh vô nghĩa.
  await db.exec("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
  for (const file of [
    "20261007140000_vong_2_phan_nhom_nganh.sql",
    "20261008190000_support_team_doi_nhom_vong_2.sql",
    "20261009235000_round2_bulk_confirm_mentors.sql",
    "20261013230000_round2_duyet_nhom_mentee_hang_loat.sql"
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("quyền gọi và cấu trúc", () => {
  it("chạy bằng quyền người gọi, chỉ máy chủ gọi được, anon/authenticated không", async () => {
    const f = await one<Record<string, boolean>>(`select
      (select prosecdef from pg_proc where proname = 'vam122_confirm_mentee_groups') as definer,
      has_function_privilege('anon', 'public.vam122_confirm_mentee_groups(uuid, uuid, jsonb)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.vam122_confirm_mentee_groups(uuid, uuid, jsonb)', 'execute') as auth,
      has_function_privilege('service_role', 'public.vam122_confirm_mentee_groups(uuid, uuid, jsonb)', 'execute') as server`);
    expect(f).toEqual({ definer: false, anon: false, auth: false, server: true });
    // search_path rỗng: hàm chỉ dùng tên đầy đủ, không tin schema nào do người gọi đặt.
    const config = await one<{ proconfig: string[] | null }>("select proconfig from pg_proc where proname = 'vam122_confirm_mentee_groups'");
    expect(config.proconfig).toContain('search_path=""');
  });

  it("người không có quyền sửa nhóm bị từ chối, không ghi gì: Reviewer có quyền review, Reviewer không phạm vi, người không tồn tại", () =>
    isolated(async () => {
      const m = await mentee("Mentee A");
      for (const actor of [ids.mentor, ids.other, uuid(424242)]) {
        await refused(() => confirm(actor, [m.row]), /ACCESS_DENIED/);
      }
      expect(await logCount()).toBe(0);
      expect(await sources([m.assignment])).toEqual(["auto"]);
    }));

  it("đúng mùa: Support có quyền mùa 12 nhưng không có quyền mùa khác", () =>
    isolated(async () => {
      const m = await mentee("Mentee B");
      await refused(() => confirm(ids.support, [m.row], ids.seasonNext), /ACCESS_DENIED/);
      expect(await logCount()).toBe(0);
    }));
});

describe("duyệt đúng", () => {
  it("Support duyệt cả lô: nguồn thành 'btc', gỡ cờ, ghi người duyệt và nhật ký btc_confirm cho từng người", () =>
    isolated(async () => {
      const a = await mentee("Mentee C1", { group: 3 });
      const b = await mentee("Mentee C2", { group: 5, flags: [] });
      const c = await mentee("Mentee C3", { group: 9 });

      expect(await confirm(ids.support, [a.row, b.row, c.row])).toEqual({ ok: true, approved: 3 });

      const saved = await all<Record<string, unknown>>(
        "select group_code, source, reviewed_by, flags from matching_industry_assignments where id = any($1::uuid[]) order by group_code",
        [[a.assignment, b.assignment, c.assignment]]
      );
      expect(saved).toEqual([
        { group_code: 3, source: "btc", reviewed_by: ids.support, flags: [] },
        { group_code: 5, source: "btc", reviewed_by: ids.support, flags: [] },
        { group_code: 9, source: "btc", reviewed_by: ids.support, flags: [] }
      ]);
      const log = await all<Record<string, unknown>>("select action, actor_id, old_group, new_group from matching_industry_assignment_log order by new_group");
      expect(log).toEqual([
        { action: "btc_confirm", actor_id: ids.support, old_group: 3, new_group: 3 },
        { action: "btc_confirm", actor_id: ids.support, old_group: 5, new_group: 5 },
        { action: "btc_confirm", actor_id: ids.support, old_group: 9, new_group: 9 }
      ]);
    }));

  it("Core team (BTC vận hành mùa) cũng duyệt được; nhóm KHÔNG đổi, chỉ được xác nhận", () =>
    isolated(async () => {
      const a = await mentee("Mentee D", { group: 4 });
      expect(await confirm(ids.btc, [a.row])).toEqual({ ok: true, approved: 1 });
      expect((await one<{ group_code: number; reviewed_by: string }>("select group_code, reviewed_by from matching_industry_assignments where id = $1", [a.assignment]))).toEqual({ group_code: 4, reviewed_by: ids.btc });
    }));

  it("duyệt lại lô đã duyệt thì STALE_GROUP, không ghi thêm nhật ký", () =>
    isolated(async () => {
      const a = await mentee("Mentee E");
      await confirm(ids.support, [a.row]);
      const before = await logCount();
      await refused(() => confirm(ids.support, [a.row]), /STALE_GROUP/);
      expect(await logCount()).toBe(before);
    }));

  it("mentee vào mùa bằng đơn đặc cách của Support team (nguồn s12_mentee_exemption) vẫn duyệt được: điều kiện là đơn đã duyệt, không phải nguồn đơn", () =>
    isolated(async () => {
      const a = await mentee("Mentee F", { app: null });
      await db.query("insert into applications(person_id, season_id, role_applied, status, source) values ($1, $2, 'mentee', 'approved_as_mentee', 's12_mentee_exemption')", [a.person, ids.season]);
      expect(await confirm(ids.support, [a.row])).toEqual({ ok: true, approved: 1 });
    }));
});

describe("cả lô là một giao dịch: một dòng sai thì không dòng nào được ghi", () => {
  it("nhóm của một người đã đổi (STALE_GROUP)", () =>
    isolated(async () => {
      const a = await mentee("Mentee G1", { group: 3 });
      const b = await mentee("Mentee G2", { group: 3 });
      await refused(() => confirm(ids.support, [a.row, { ...b.row, expectedGroup: 4 }]), /STALE_GROUP/);
      expect(await sources([a.assignment, b.assignment])).toEqual(["auto", "auto"]);
      expect(await logCount()).toBe(0);
    }));

  it("dữ liệu gợi ý của một người đã khác lúc người duyệt nhìn (drift)", () =>
    isolated(async () => {
      const a = await mentee("Mentee H1", { group: 3 });
      const b = await mentee("Mentee H2", { group: 3, drift: 5 });
      // Người duyệt thấy H2 không có gợi ý mới (null) nhưng database đã có drift 5 → từ chối cả lô.
      await refused(() => confirm(ids.support, [a.row, { ...b.row, expectedDrift: null }]), /STALE_GROUP/);
      expect(await sources([a.assignment, b.assignment])).toEqual(["auto", "auto"]);
      // Thấy đúng drift thì duyệt được.
      expect(await confirm(ids.support, [a.row, b.row])).toEqual({ ok: true, approved: 2 });
    }));

  it("một người đã được BTC duyệt từ trước (nguồn 'btc')", () =>
    isolated(async () => {
      const a = await mentee("Mentee I1");
      const b = await mentee("Mentee I2", { source: "btc", flags: [] });
      await refused(() => confirm(ids.support, [a.row, b.row]), /STALE_GROUP/);
      expect(await sources([a.assignment])).toEqual(["auto"]);
    }));

  it.each([
    ["đơn mentee chưa được duyệt", { app: "ready_for_final_decision" }],
    ["đơn mentee bị từ chối", { app: "rejected_or_not_fit" }],
    ["không có đơn mentee nào", { app: null }],
    ["chỉ có đơn MENTOR đã duyệt (không phải đơn mentee)", { app: "approved_as_mentor" }],
    ["đơn mentee đã duyệt nhưng của MÙA KHÁC", { appSeason: ids.seasonNext }],
    ["tư cách mentee đã rút", { member: "withdrawn" }],
    ["tư cách mentee không tham dự", { member: "opted_out" }]
  ])("%s: NOT_APPROVED và người còn lại trong lô cũng không được ghi", (_label, opts) =>
    isolated(async () => {
      const good = await mentee("Mentee J-tốt");
      const bad = await mentee("Mentee J-xấu", opts);
      await refused(() => confirm(ids.support, [good.row, bad.row]), /NOT_APPROVED/);
      expect(await sources([good.assignment, bad.assignment])).toEqual(["auto", "auto"]);
      expect(await logCount()).toBe(0);
    }));

  it("tư cách đã rút ở MÙA KHÁC không chặn mentee của mùa này", () =>
    isolated(async () => {
      const a = await mentee("Mentee K3", { member: "withdrawn", memberSeason: ids.seasonNext });
      expect(await confirm(ids.support, [a.row])).toEqual({ ok: true, approved: 1 });
    }));

  it("tư cách đang hoạt động / tạm dừng không chặn (chỉ rút và không tham dự mới chặn)", () =>
    isolated(async () => {
      const a = await mentee("Mentee K1", { member: "active" });
      const b = await mentee("Mentee K2", { member: "paused" });
      expect(await confirm(ids.support, [a.row, b.row])).toEqual({ ok: true, approved: 2 });
    }));
});

describe("đúng vai trò, đúng mùa", () => {
  it("dòng của MENTOR đưa vào hàm mentee bị coi như không tồn tại (NOT_FOUND), cả lô không ghi", () =>
    isolated(async () => {
      const m = await mentee("Mentee L");
      const mentor = await mentee("Mentor L", { role: "mentor", app: "approved_as_mentor" });
      await refused(() => confirm(ids.support, [m.row, mentor.row]), /NOT_FOUND/);
      expect(await sources([m.assignment, mentor.assignment])).toEqual(["auto", "auto"]);
    }));

  it("và ngược lại: dòng của MENTEE đưa vào hàm mentor cũ vẫn bị từ chối (hai hàm không lẫn vai trò)", () =>
    isolated(async () => {
      const m = await mentee("Mentee M");
      await refused(() => one("select public.vam115_confirm_mentor_groups($1, $2, $3::jsonb)", [ids.support, ids.season, JSON.stringify([m.row])]), /NOT_FOUND/);
      expect(await sources([m.assignment])).toEqual(["auto"]);
    }));

  it("dòng của mùa khác hoặc không tồn tại: NOT_FOUND", () =>
    isolated(async () => {
      const m = await mentee("Mentee N", { season: ids.seasonNext });
      await refused(() => confirm(ids.support, [m.row]), /NOT_FOUND/);
      await refused(() => confirm(ids.support, [{ assignmentId: uuid(777001), expectedGroup: 3, expectedDrift: null }]), /NOT_FOUND/);
    }));
});

describe("hình dạng danh sách", () => {
  it("rỗng, không phải mảng, trùng mã, nhóm ngoài 1..9, thiếu expectedDrift, quá 500 dòng: INVALID_ROWS", () =>
    isolated(async () => {
      const a = await mentee("Mentee O");
      const bad: unknown[] = [
        [],
        { not: "array" },
        [a.row, a.row],
        [{ ...a.row, expectedGroup: 10 }],
        [{ ...a.row, expectedGroup: 0 }],
        [{ ...a.row, expectedGroup: 2.5 }],
        [{ ...a.row, expectedGroup: "3" }],
        [{ ...a.row, expectedDrift: 12 }],
        [{ assignmentId: a.assignment, expectedGroup: 3 }],
        Array.from({ length: 501 }, (_, i) => ({ assignmentId: uuid(800000 + i), expectedGroup: 3, expectedDrift: null }))
      ];
      for (const rows of bad) await refused(() => confirm(ids.support, rows), /INVALID_ROWS/);
      expect(await sources([a.assignment])).toEqual(["auto"]);
      expect(await logCount()).toBe(0);
    }));

  it("đúng 500 dòng vẫn nhận (cận trên), mã trùng chỉ khác hoa thường vẫn là trùng", () =>
    isolated(async () => {
      const a = await mentee("Mentee P");
      await refused(() => confirm(ids.support, [a.row, { ...a.row, assignmentId: a.row.assignmentId.toUpperCase() }]), /INVALID_ROWS/);
      const rows = [a.row];
      for (let i = 1; i < 500; i++) rows.push({ assignmentId: uuid(850000 + i), expectedGroup: 3, expectedDrift: null });
      // 499 mã không tồn tại → qua kiểm hình dạng rồi mới NOT_FOUND (chứng tỏ 500 dòng không bị chặn ở INVALID_ROWS).
      await refused(() => confirm(ids.support, rows), /NOT_FOUND/);
    }));
});
