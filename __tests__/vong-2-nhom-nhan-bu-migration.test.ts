/**
 * Vòng 2 — "nhóm nhận bù", chạy THẬT trên PostgreSQL (PGlite). BTC 15/10/2026, 00:30.
 *
 * Nhóm 1 Ngân hàng - Bảo hiểm ít mentee; khi danh sách 15 hồ sơ của mentor nhóm 1 còn dưới 15 bạn nhóm
 * 1, trang bù bằng mentee nhóm 3 Tài chính - Đầu tư. Database phải cho phép đúng chiều đó và không hơn:
 *   - migration nạp đúng một dòng cho mùa 12: nhóm 1 ← nhóm 3;
 *   - mentor nhóm 1 chọn được mentee nhóm 3; mentor nhóm 3 KHÔNG chọn được mentee nhóm 1 (một chiều);
 *     mentor nhóm 1 vẫn không chọn được nhóm khác (2, 4);
 *   - vam123_round2_available của mentor nhóm 1 gồm cả bạn nhóm 3 còn trống; của mentor nhóm 3 thì không
 *     có nhóm 1;
 *   - hai hàm chỉ khác bản 20261014190000 đúng khối "cùng cụm" (soát diff thân hàm);
 *   - bảng bù trống thì y hệt luật cũ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const read = (file: string) => readFileSync(path.resolve(file), "utf8").replace(/\r/g, "");
const PREV = "supabase/migrations/20261014190000_vong_2_cum_chon.sql";
const THIS = "supabase/migrations/20261015003000_vong_2_nhom_nhan_bu.sql";
const MIGRATIONS = [
  "supabase/migrations/20261007120000_vong_ghep_cap.sql",
  "supabase/migrations/20261007140000_vong_2_phan_nhom_nganh.sql",
  "supabase/migrations/20261008080000_vong_2_mentor_chon_mentee.sql",
  PREV,
  THIS
];

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const pick = async (token: string, app: string) =>
  (await one<{ r: { ok: boolean; code?: string; matchId?: string } }>("select vam113_round2_pick($1,$2) as r", [token, app])).r;
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
const openWindow = () =>
  asOwner(() =>
    db.exec(`insert into matching_round2_settings(season_id, opens_at, closes_at) values ('${ids.season}', now() - interval '1 hour', now() + interval '2 days')
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

let seq = 2000;
type Mentor = { person: string; token: string };
async function mentor(group: number): Promise<Mentor> {
  const person = uuid(++seq);
  await db.query("insert into people(id, full_name) values ($1, $2)", [person, `Mentor nhóm ${group}`]);
  await db.query("insert into mentor_profiles(person_id, capacity_target) values ($1, 2)", [person]);
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
async function menteeIn(group: number): Promise<Mentee> {
  const person = uuid(++seq);
  const app = uuid(++seq);
  await db.query("insert into people(id, full_name) values ($1, $2)", [person, `Mentee nhóm ${group}`]);
  await db.query("insert into applications(id, season_id, person_id, role_applied, status) values ($1, $2, $3, 'mentee', 'approved_as_mentee')", [app, ids.season, person]);
  await db.query(
    "insert into matching_industry_assignments(season_id, person_id, role, application_id, group_code, confidence, rule_version) values ($1, $2, 'mentee', $3, $4, 'cao', 't')",
    [ids.season, person, app, group]
  );
  return { person, app };
}

const M: Record<string, Mentor> = {};
const E: Record<string, Mentee> = {};
let fillAfterMigration: Array<{ season_id: string; group_code: number; donor_group_code: number }> = [];

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
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
  fillAfterMigration = (await db.query<{ season_id: string; group_code: number; donor_group_code: number }>(
    "select season_id, group_code, donor_group_code from matching_round2_fill order by season_id, group_code"
  )).rows;

  M.g1 = await mentor(1);
  M.g3 = await mentor(3);
  M.g4 = await mentor(4);
  E.g1 = await menteeIn(1);
  E.g2 = await menteeIn(2);
  E.g3a = await menteeIn(3);
  E.g3b = await menteeIn(3);
  E.g4 = await menteeIn(4);
  await db.exec("set role service_role");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("dòng bù của mùa 12", () => {
  it("migration nạp đúng một dòng: mùa 12, nhóm 1 nhận bù từ nhóm 3; mùa khác không có", () => {
    expect(fillAfterMigration).toEqual([{ season_id: ids.season, group_code: 1, donor_group_code: 3 }]);
  });

  it("bảng bật RLS; anon/authenticated không đọc được; máy chủ chỉ đọc, không tự sửa chiều bù", async () => {
    const f = await asOwner(() =>
      one<Record<string, boolean>>(`select
        (select relrowsecurity from pg_class where relname = 'matching_round2_fill') as rls,
        has_table_privilege('anon', 'public.matching_round2_fill', 'select') as anon,
        has_table_privilege('authenticated', 'public.matching_round2_fill', 'select') as auth,
        has_table_privilege('service_role', 'public.matching_round2_fill', 'select') as server_read,
        has_table_privilege('service_role', 'public.matching_round2_fill', 'insert') as server_insert,
        has_table_privilege('service_role', 'public.matching_round2_fill', 'delete') as server_delete`)
    );
    expect(f).toEqual({ rls: true, anon: false, auth: false, server_read: true, server_insert: false, server_delete: false });
  });

  it("một nhóm không tự bù cho chính nó", async () => {
    await asOwner(async () => {
      await expect(db.query("insert into matching_round2_fill(season_id, group_code, donor_group_code) values ($1, 4, 4)", [ids.season])).rejects.toThrow();
    });
  });
});

describe("chọn qua đường bù", () => {
  it("mentor nhóm 1 chọn được mentee nhóm 3 — cặp được ghi đúng hai người, vòng 2", () =>
    isolated(async () => {
      await openWindow();
      const r = await pick(M.g1.token, E.g3a.app);
      expect(r).toMatchObject({ ok: true });
      const m = await asOwner(() =>
        one<{ mentor_person_id: string; mentee_person_id: string; matching_round: number }>(
          "select mentor_person_id, mentee_person_id, matching_round from matches where id = $1",
          [r.matchId]
        )
      );
      expect(m).toEqual({ mentor_person_id: M.g1.person, mentee_person_id: E.g3a.person, matching_round: 2 });
    }));

  it("một chiều: mentor nhóm 3 không chọn được mentee nhóm 1; mentor nhóm 1 không chọn được nhóm 2, 4; nhóm 4 không chọn được nhóm 3", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(M.g3.token, E.g1.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g1.token, E.g2.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g1.token, E.g4.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await pick(M.g4.token, E.g3a.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      const n = await asOwner(() => one<{ n: number }>("select count(*)::int as n from matches where matching_round = 2"));
      expect(n.n).toBe(0);
    }));

  it("danh sách còn trống: mentor nhóm 1 gồm cả nhóm 3; mentor nhóm 3 không có nhóm 1; nhóm 4 chỉ nhóm 4", () =>
    isolated(async () => {
      await openWindow();
      expect(await available(M.g1.token)).toEqual([E.g1.app, E.g3a.app, E.g3b.app].sort());
      expect(await available(M.g3.token)).toEqual([E.g3a.app, E.g3b.app].sort());
      expect(await available(M.g4.token)).toEqual([E.g4.app]);
    }));

  it("bạn nhóm 3 được mentor nhóm 1 chọn biến khỏi danh sách của mentor nhóm 3; mentor nhóm 3 chọn sau thì nhận mentee_taken", () =>
    isolated(async () => {
      await openWindow();
      expect(await pick(M.g1.token, E.g3b.app)).toMatchObject({ ok: true });
      expect(await available(M.g3.token)).toEqual([E.g3a.app]);
      expect(await pick(M.g3.token, E.g3b.app)).toEqual({ ok: false, code: "mentee_taken" });
    }));

  it("bảng bù trống: y hệt luật cũ — mentor nhóm 1 không chọn được nhóm 3, danh sách chỉ nhóm 1", () =>
    isolated(async () => {
      await asOwner(() => db.exec("delete from matching_round2_fill"));
      await openWindow();
      expect(await pick(M.g1.token, E.g3a.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await available(M.g1.token)).toEqual([E.g1.app]);
    }));

  it("dòng bù của mùa khác không mở đường cho mùa 12", () =>
    isolated(async () => {
      await asOwner(() =>
        db.query("insert into matching_round2_fill(season_id, group_code, donor_group_code) values ($1, 4, 3)", [ids.seasonNext])
      );
      await openWindow();
      expect(await pick(M.g4.token, E.g3a.app)).toEqual({ ok: false, code: "mentee_not_in_group" });
      expect(await available(M.g4.token)).toEqual([E.g4.app]);
    }));
});

describe("hai hàm chỉ khác bản 20261014190000 đúng khối cùng cụm", () => {
  const body = (sql: string, name: string) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    const open = sql.indexOf("as $function$", start) + "as $function$".length;
    return sql.slice(open, sql.indexOf("$function$;", open));
  };

  it("vam113_round2_pick", () => {
    const OLD_BLOCK = [
      "    if v_mentee_group is null",
      "       or public.vam123_round2_pool(l.season_id, v_mentee_group) is distinct from public.vam123_round2_pool(l.season_id, v_mentor_group) then",
      "      v_code := 'mentee_not_in_group';",
      "    end if;"
    ].join("\n");
    const NEW_BLOCK = [
      "    -- Hoặc cụm được BÙ cho nhóm của mentor (20261015003000, một chiều — matching_round2_fill).",
      "    if v_mentee_group is null",
      "       or (public.vam123_round2_pool(l.season_id, v_mentee_group) is distinct from public.vam123_round2_pool(l.season_id, v_mentor_group)",
      "           and not exists (select 1 from public.matching_round2_fill f",
      "                            where f.season_id = l.season_id and f.group_code = v_mentor_group",
      "                              and public.vam123_round2_pool(l.season_id, f.donor_group_code) = public.vam123_round2_pool(l.season_id, v_mentee_group))) then",
      "      v_code := 'mentee_not_in_group';",
      "    end if;"
    ].join("\n");
    const before = body(read(PREV), "vam113_round2_pick");
    expect(before.split(OLD_BLOCK)).toHaveLength(2);
    expect(body(read(THIS), "vam113_round2_pick")).toBe(before.replace(OLD_BLOCK, NEW_BLOCK));
  });

  it("vam123_round2_available", () => {
    const OLD_LINE = "     and public.vam123_round2_pool(l.season_id, a.group_code) = v_pool\n";
    const NEW_BLOCK = [
      "     -- Cụm của mentor, hoặc cụm được BÙ cho nhóm của mentor (20261015003000, một chiều).",
      "     and (public.vam123_round2_pool(l.season_id, a.group_code) = v_pool",
      "          or exists (select 1 from public.matching_round2_fill f",
      "                      where f.season_id = l.season_id and f.group_code = v_group",
      "                        and public.vam123_round2_pool(l.season_id, f.donor_group_code) = public.vam123_round2_pool(l.season_id, a.group_code)))",
      ""
    ].join("\n");
    const before = body(read(PREV), "vam123_round2_available");
    expect(before.split(OLD_LINE)).toHaveLength(2);
    expect(body(read(THIS), "vam123_round2_available")).toBe(before.replace(OLD_LINE, NEW_BLOCK));
  });
});

describe("chạy lại migration", () => {
  it("chạy lần hai không lỗi, vẫn đúng một dòng bù của mùa 12", () =>
    isolated(async () => {
      await asOwner(async () => {
        await db.exec(read(THIS));
        const n = await one<{ n: number }>("select count(*)::int as n from matching_round2_fill");
        expect(n.n).toBe(1);
      });
    }));
});
