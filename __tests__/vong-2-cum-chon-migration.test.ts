/**
 * Vòng 2 — "cụm chọn" (BTC 14/10/2026: gộp nhóm 1+2+3 và 6+9 cho mùa 12), chạy THẬT trên PostgreSQL (PGlite).
 *
 * Mentor không có tài khoản bấm chọn qua link riêng, nên luật cụm phải nằm trong hàm chọn:
 *   - mentor nhóm nào trong cụm cũng chọn được mentee mọi nhóm trong cụm; ngoài cụm vẫn bị từ chối;
 *   - nhóm không gộp giữ nguyên luật "cùng nhóm"; mùa khác không bị cách gộp của mùa 12 ảnh hưởng;
 *   - vam113_round2_pick chỉ khác bản cũ đúng bước so nhóm (soát diff thân hàm);
 *   - vam123_round2_available chỉ trả mã đơn còn trống trong cụm của chính mentor đó, và trả rỗng
 *     cho mọi trường hợp không được xem (token lạ, thu hồi, vòng chưa mở / đã đóng, mentor đã rút).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8").replace(/\r/g, "");
const OLD = "supabase/migrations/20261008080000_vong_2_mentor_chon_mentee.sql";
const THIS = "supabase/migrations/20261014190000_vong_2_cum_chon.sql";
const MIGRATIONS = [
  "supabase/migrations/20261007120000_vong_ghep_cap.sql",
  "supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql",
  OLD,
  THIS
];

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const pick = async (token: string, app: string) =>
  (await one<{ r: { ok: boolean; code?: string; matchId?: string } }>("select vam113_round2_pick($1,$2) as r", [token, app])).r;
const unpick = async (token: string, match: string) =>
  (await one<{ r: { ok: boolean; code?: string } }>("select vam113_round2_unpick($1,$2) as r", [token, match])).r;
const available = async (token: string) =>
  ((await one<{ r: string[] }>("select vam123_round2_available($1) as r", [token])).r ?? []).slice().sort();

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  try {
    return await run();
  } finally {
    await db.exec("set role service_role");
  }
}
const openWindow = (opens = "now() - interval '1 hour'", closes = "now() + interval '2 days'") =>
  asOwner(() =>
    db.exec(`insert into matching_round2_settings(season_id, opens_at, closes_at) values ('${ids.season}', ${opens}, ${closes})
             on conflict (season_id) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at`)
  );

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
    await db.exec("set role service_role");
  }
}

let seq = 1000;
type Mentor = { person: string; token: string };
async function mentor(group: number, capacity = 2): Promise<Mentor> {
  const person = uuid(++seq);
  await db.query("insert into people(id, full_name) values ($1, $2)", [person, `Mentor nhóm ${group}`]);
  await db.query("insert into mentor_profiles(person_id, capacity_target) values ($1, $2)", [person, capacity]);
  const app = await one<{ id: string }>(
    "insert into applications(season_id, person_id, role_applied, status) values ($1, $2, 'mentor', 'approved_as_mentor') returning id",
    [ids.season, person]
  );
  await db.query(
    "insert into matching_industry_assignments(season_id, person_id, role, application_id, group_code, confidence, rule_version) values ($1, $2, 'mentor', $3, $4, 'cao', 't')",
    [ids.season, person, app.id, group]
  );
  const link = await one<{ token: string }>("insert into matching_round2_links(season_id, mentor_person_id) values ($1, $2) returning token", [ids.season, person]);
  return { person, token: link.token };
}
type Mentee = { person: string; app: string };
async function menteeIn(group: number | null, status = "approved_as_mentee"): Promise<Mentee> {
  const person = uuid(++seq);
  const app = uuid(++seq);
  await db.query("insert into people(id, full_name) values ($1, $2)", [person, `Mentee nhóm ${group}`]);
  await db.query("insert into applications(id, season_id, person_id, role_applied, status) values ($1, $2, $3, 'mentee', $4)", [app, ids.season, person, status]);
  if (group !== null) {
    await db.query(
      "insert into matching_industry_assignments(season_id, person_id, role, application_id, group_code, confidence, rule_version) values ($1, $2, 'mentee', $3, $4, 'cao', 't')",
      [ids.season, person, app, group]
    );
  }
  return { person, app };
}

const M: Record<string, Mentor> = {};
const E: Record<string, Mentee> = {};

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Supabase cấp sẵn quyền thực thi hàm mới cho anon/authenticated (default privileges); PGlite thì
  // không — thiếu dòng này thì các dòng revoke trong migration không có gì để thu hồi, test quyền xanh vô nghĩa.
  await db.exec("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
  await db.exec(`
    create table vam063_trusted_api_role_result(api_role text);
    insert into vam063_trusted_api_role_result values ('service_role');
    create function vam063_trusted_api_role() returns table(api_role text) language sql stable as
      'select api_role from public.vam063_trusted_api_role_result limit 1';
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'general_announcement'::text])));
    alter table matches add column ended_at timestamptz, add column end_reason text;
    grant all on vam063_trusted_api_role_result, outbound_emails to service_role;
  `);
  for (const file of MIGRATIONS) await db.exec(read(file));

  M.g1 = await mentor(1);
  M.g3 = await mentor(3);
  M.g4 = await mentor(4);
  M.g6 = await mentor(6);
  M.g9 = await mentor(9);
  E.g1 = await menteeIn(1);
  E.g2 = await menteeIn(2);
  E.g3 = await menteeIn(3);
  E.g4 = await menteeIn(4);
  E.g5 = await menteeIn(5);
  E.g6 = await menteeIn(6);
  E.g9 = await menteeIn(9);
  E.noGroup = await menteeIn(null);
  E.notApproved = await menteeIn(2, "interview_passed");
  E.withdrawn = await menteeIn(3);
  E.matchedR1 = await menteeIn(1);
  await db.query(
    "insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, 'mentee', 'withdrawn')",
    [E.withdrawn.person, ids.program, ids.season]
  );
  await db.query("insert into matches(season_id, mentor_person_id, mentee_person_id, status, matching_round) values ($1, $2, $3, 'active', 1)", [
    ids.season,
    M.g4.person,
    E.matchedR1.person
  ]);
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("bảng cụm và hàm vam123_round2_pool", () => {
  it("mùa 12 gộp 1+2+3 và 6+9; nhóm không có dòng là cụm của chính nó; mùa khác không bị ảnh hưởng", async () => {
    const rows = await asOwner(async () =>
      (await db.query<{ group_code: number; pool_code: number }>(
        "select group_code, pool_code from matching_round2_pools where season_id = $1 order by group_code",
        [ids.season]
      )).rows
    );
    expect(rows).toEqual([
      { group_code: 1, pool_code: 1 },
      { group_code: 2, pool_code: 1 },
      { group_code: 3, pool_code: 1 },
      { group_code: 6, pool_code: 6 },
      { group_code: 9, pool_code: 6 }
    ]);
    const pool = async (season: string, group: number) =>
      (await one<{ p: number }>("select vam123_round2_pool($1, $2::smallint) as p", [season, group])).p;
    expect(await pool(ids.season, 2)).toBe(1);
    expect(await pool(ids.season, 9)).toBe(6);
    expect(await pool(ids.season, 4)).toBe(4);
    expect(await pool(ids.season, 8)).toBe(8);
    expect(await pool(ids.seasonNext, 2)).toBe(2);
    expect(await pool(ids.seasonNext, 9)).toBe(9);
  });

  it("bảng bật RLS; anon/authenticated không đọc được; máy chủ chỉ đọc, không tự sửa cách gộp", async () => {
    const f = await asOwner(() =>
      one<Record<string, boolean>>(`select
        (select relrowsecurity from pg_class where relname = 'matching_round2_pools') as rls,
        has_table_privilege('anon', 'public.matching_round2_pools', 'select') as anon,
        has_table_privilege('authenticated', 'public.matching_round2_pools', 'select') as auth,
        has_table_privilege('service_role', 'public.matching_round2_pools', 'select') as server_read,
        has_table_privilege('service_role', 'public.matching_round2_pools', 'insert') as server_insert,
        has_table_privilege('service_role', 'public.matching_round2_pools', 'update') as server_update`)
    );
    expect(f).toEqual({ rls: true, anon: false, auth: false, server_read: true, server_insert: false, server_update: false });
  });
});

describe("vam113_round2_pick theo cụm", () => {
  it("chỉ khác bản cũ đúng bước so nhóm: mọi dòng khác giữ nguyên văn", () => {
    const body = (sql: string) => {
      const start = sql.indexOf("create or replace function public.vam113_round2_pick(");
      const open = sql.indexOf("as $function$", start) + "as $function$".length;
      return sql.slice(open, sql.indexOf("$function$;", open));
    };
    const before = body(read(OLD));
    const after = body(read(THIS));
    const OLD_LINE = "    if v_mentee_group is distinct from v_mentor_group then v_code := 'mentee_not_in_group'; end if;\n";
    const NEW_BLOCK = [
      "    -- Cùng CỤM chọn (20261014190000): nhóm không gộp thì cụm là chính nó, như luật cũ.",
      "    if v_mentee_group is null",
      "       or public.vam123_round2_pool(l.season_id, v_mentee_group) is distinct from public.vam123_round2_pool(l.season_id, v_mentor_group) then",
      "      v_code := 'mentee_not_in_group';",
      "    end if;",
      ""
    ].join("\n");
    expect(before.split(OLD_LINE)).toHaveLength(2);
    expect(after).toBe(before.replace(OLD_LINE, NEW_BLOCK));
  });

  it("trong cụm Tài chính: mentor nhóm 1 chọn được mentee nhóm 3, mentor nhóm 3 chọn được mentee nhóm 2", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(M.g1.token, E.g3.app)).toMatchObject({ ok: true });
      expect(await pick(M.g3.token, E.g2.app)).toMatchObject({ ok: true });
      const rows = await db.query<{ mentor_person_id: string; mentee_person_id: string; matching_round: number }>(
        "select mentor_person_id, mentee_person_id, matching_round from matches where matching_round = 2 order by mentor_person_id"
      );
      expect(rows.rows).toEqual(
        expect.arrayContaining([
          { mentor_person_id: M.g1.person, mentee_person_id: E.g3.person, matching_round: 2 },
          { mentor_person_id: M.g3.person, mentee_person_id: E.g2.person, matching_round: 2 }
        ])
      );
    }));

  it("trong cụm Nhân sự + Khác: mentor nhóm 6 chọn mentee nhóm 9 và ngược lại", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(M.g6.token, E.g9.app)).toMatchObject({ ok: true });
      expect(await pick(M.g9.token, E.g6.app)).toMatchObject({ ok: true });
    }));

  it("ngoài cụm vẫn bị từ chối; nhóm không gộp giữ luật cùng nhóm; mentee chưa phân nhóm bị từ chối; không ghi cặp nào", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(M.g1.token, E.g4.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g6.token, E.g1.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g4.token, E.g5.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g9.token, E.g3.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g1.token, E.noGroup.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect((await one<{ n: number }>("select count(*)::int as n from matches where matching_round = 2")).n).toBe(0);
      expect(await pick(M.g4.token, E.g4.app)).toMatchObject({ ok: true });
    }));

  it("hai mentor khác nhóm cùng cụm chọn một bạn: người trước được, người sau nhận mentee_taken", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(M.g1.token, E.g2.app)).toMatchObject({ ok: true });
      expect(await pick(M.g3.token, E.g2.app)).toEqual({ ok: false, code: "mentee_taken" });
    }));

  it("các luật cũ vẫn chạy sau khi thay hàm: chưa mở, đã đóng, hết chỗ, bỏ chọn trong 30 phút", () =>
    isolated(async () => {
      await openWindow("now() + interval '1 hour'", "null");
      expect(await pick(M.g1.token, E.g1.app)).toEqual({ ok: false, code: "window_not_open" });
      await openWindow("now() - interval '2 days'", "now() - interval '1 hour'");
      expect(await pick(M.g1.token, E.g1.app)).toEqual({ ok: false, code: "window_closed" });
      await openWindow();
      const first = await pick(M.g1.token, E.g1.app);
      expect(first).toMatchObject({ ok: true });
      expect(await pick(M.g1.token, E.g2.app)).toMatchObject({ ok: true });
      expect(await pick(M.g1.token, E.g3.app)).toEqual({ ok: false, code: "mentor_full" });
      expect(await unpick(M.g1.token, first.matchId!)).toEqual({ ok: true });
      expect(await pick(M.g1.token, E.g3.app)).toMatchObject({ ok: true });
    }));
});

describe("vam123_round2_available", () => {
  it("trả đúng mã đơn còn trống trong cụm: bỏ người đã có cặp (kể cả vòng 1), đã rút, đơn chưa duyệt, ngoài cụm", () =>
    isolated(async () => {
      await openWindow();
      expect(await available(M.g1.token)).toEqual([E.g1.app, E.g2.app, E.g3.app].sort());
      expect(await available(M.g9.token)).toEqual([E.g6.app, E.g9.app].sort());
      expect(await available(M.g4.token)).toEqual([E.g4.app]);
    }));

  it("bạn vừa được chọn biến khỏi danh sách của mọi mentor trong cụm; bỏ chọn thì quay lại", () =>
    isolated(async () => {
      await openWindow();
      const r = await pick(M.g3.token, E.g1.app);
      expect(r).toMatchObject({ ok: true });
      expect(await available(M.g1.token)).toEqual([E.g2.app, E.g3.app].sort());
      expect(await available(M.g3.token)).toEqual([E.g2.app, E.g3.app].sort());
      expect(await unpick(M.g3.token, r.matchId!)).toEqual({ ok: true });
      expect(await available(M.g1.token)).toEqual([E.g1.app, E.g2.app, E.g3.app].sort());
    }));

  it("không được xem thì trả rỗng: token lạ, link thu hồi, vòng chưa mở, vòng đã đóng, mentor đã rút", () =>
    isolated(async () => {
      expect(await available(M.g1.token)).toEqual([]);
      await openWindow("now() + interval '1 hour'", "null");
      expect(await available(M.g1.token)).toEqual([]);
      await openWindow("now() - interval '2 days'", "now() - interval '1 hour'");
      expect(await available(M.g1.token)).toEqual([]);
      await openWindow();
      expect(await available(uuid(424242))).toEqual([]);
      await asOwner(async () => {
        await db.query("update matching_round2_links set revoked_at = now() where token = $1", [M.g3.token]);
        await db.query(
          "insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, 'mentor', 'opted_out')",
          [M.g9.person, ids.program, ids.season]
        );
      });
      expect(await available(M.g3.token)).toEqual([]);
      expect(await available(M.g9.token)).toEqual([]);
      expect(await available(M.g1.token)).toHaveLength(3);
    }));

  it("chỉ máy chủ tin cậy gọi được: ngoài ngữ cảnh service_role thì báo lỗi, anon/authenticated không có quyền gọi", () =>
    isolated(async () => {
      await openWindow();
      const f = await asOwner(() =>
        one<Record<string, boolean>>(`select
          (select prosecdef from pg_proc where proname = 'vam123_round2_available') as definer,
          has_function_privilege('anon', 'public.vam123_round2_available(uuid)', 'execute') as anon,
          has_function_privilege('authenticated', 'public.vam123_round2_available(uuid)', 'execute') as auth,
          has_function_privilege('anon', 'public.vam113_round2_pick(uuid, uuid)', 'execute') as anon_pick,
          has_function_privilege('anon', 'public.vam123_round2_pool(uuid, smallint)', 'execute') as anon_pool,
          has_function_privilege('service_role', 'public.vam123_round2_available(uuid)', 'execute') as server`)
      );
      expect(f).toEqual({ definer: true, anon: false, auth: false, anon_pick: false, anon_pool: false, server: true });
      await asOwner(() => db.exec("update vam063_trusted_api_role_result set api_role = 'anon'"));
      await expect(available(M.g1.token)).rejects.toThrow("Trusted server context required");
    }));
});

describe("chạy lại migration", () => {
  it("chạy lần hai không lỗi và không nhân đôi dòng cụm", () =>
    isolated(async () => {
      await asOwner(async () => {
        await db.exec(read(THIS));
        const n = await one<{ n: number }>("select count(*)::int as n from matching_round2_pools");
        expect(n.n).toBe(5);
      });
    }));
});
