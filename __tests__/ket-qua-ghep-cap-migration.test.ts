/**
 * Thư kết quả ghép cặp — migration 20261022120000 chạy THẬT trên PostgreSQL (PGlite). BTC 22/10/2026.
 *
 * Điều phải đúng:
 *   - nới outbound_emails_kind_check theo lối cộng thêm: hai loại mới ghi được, MỌI loại cũ vẫn ghi
 *     được, loại lạ vẫn bị chặn; dán lại lần hai không nối trùng;
 *   - bốn bảng mới: anon/authenticated không đọc không ghi được; máy chủ đọc/ghi được nhưng KHÔNG
 *     xoá được (gỡ là ghi mốc);
 *   - ràng buộc chặn dữ liệu hỏng: hash token sai định dạng, hai link cho cùng một chiều của một cặp,
 *     người xem trùng người được xem, link Handbook không phải https, giữ lại một mentor hai lần;
 *   - thiếu ràng buộc loại thư thì dừng ồn ào, không báo thành công giả.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const SQL = readFileSync(path.resolve("supabase/migrations/20261022120000_ket_qua_ghep_cap.sql"), "utf8").replace(/\r/g, "");
// Danh sách loại thư trên production sau migration 20261016220000 (22 loại).
const PRODUCTION_KINDS = [
  "mentor_confirmation_link", "mentee_application_confirmation", "mentor_application_confirmation", "review_batch_assigned",
  "interview_scheduled", "reviewer_invite", "interview_round_invite", "general_announcement", "event_registration_confirmation",
  "event_schedule_change", "participant_invite", "staff_invite", "event_reminder", "event_survey", "interview_slot_invite",
  "interview_slot_cancelled", "mentee_session_invite", "mentee_session_confirmed", "matching_round2_invite",
  "mentee_exemption_confirm", "custom_form_receipt", "matching_round2_reminder"
];
const NEW_KINDS = ["mentee_mentor_intro", "mentor_mentee_package"];
const TABLES = ["match_profile_links", "match_result_notices", "match_result_holds", "match_result_settings"];
const HASH = "a".repeat(64);
const MENTEE = uuid(501);

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const kindDef = async () =>
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
  // Một cặp đang hoạt động để thử ràng buộc của bảng link.
  await db.query("insert into people(id, full_name, email_primary) values ($1, 'Mentee', 'mentee@example.test')", [MENTEE]);
}

let matchId = "";

beforeAll(async () => {
  await freshDb();
  const m = await one<{ id: string }>(
    "insert into matches(season_id, mentor_person_id, mentee_person_id, status) values ($1, $2, $3, 'active') returning id",
    [ids.season, ids.person, MENTEE]
  );
  matchId = m!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 20261022120000 — thư kết quả ghép cặp", () => {
  it("trước khi dán: hai loại thư mới bị chặn; sau khi dán: ghi được, mọi loại cũ vẫn ghi được, loại lạ vẫn bị chặn", async () => {
    for (const kind of NEW_KINDS) {
      expect(await rejected("insert into outbound_emails(kind) values ($1)", [kind]), kind).toBe(true);
    }
    await db.exec(SQL);
    await db.exec("reset role");
    for (const kind of [...PRODUCTION_KINDS, ...NEW_KINDS]) {
      expect(await rejected("insert into outbound_emails(kind) values ($1)", [kind]), kind).toBe(false);
    }
    expect(await rejected("insert into outbound_emails(kind) values ('loai_la')")).toBe(true);
  });

  it("bốn bảng mới: anon/authenticated không đọc không ghi; máy chủ đọc/ghi được nhưng không xoá được", async () => {
    for (const t of TABLES) {
      const p = await one<{ a_sel: boolean; u_sel: boolean; a_ins: boolean; s_sel: boolean; s_ins: boolean; s_upd: boolean; s_del: boolean; rls: boolean }>(
        `select has_table_privilege('anon', $1, 'select') a_sel, has_table_privilege('authenticated', $1, 'select') u_sel,
                has_table_privilege('anon', $1, 'insert') a_ins,
                has_table_privilege('service_role', $1, 'select') s_sel, has_table_privilege('service_role', $1, 'insert') s_ins,
                has_table_privilege('service_role', $1, 'update') s_upd, has_table_privilege('service_role', $1, 'delete') s_del,
                (select relrowsecurity from pg_class where oid = $1::regclass) rls`,
        [`public.${t}`]
      );
      expect(p, t).toEqual({ a_sel: false, u_sel: false, a_ins: false, s_sel: true, s_ins: true, s_upd: true, s_del: false, rls: true });
    }
  });

  it("bảng link: chỉ nhận hash sha256 hex, một link cho mỗi chiều của một cặp, không cho tự xem chính mình", async () => {
    const insert = "insert into match_profile_links(season_id, match_id, viewer_person_id, subject_person_id, subject_role, token_hash) values ($1, $2, $3, $4, $5, $6)";
    // Token gốc (43 ký tự base64url) không bao giờ lọt vào cột hash.
    expect(await rejected(insert, [ids.season, matchId, MENTEE, ids.person, "mentor", "A".repeat(43)])).toBe(true);
    expect(await rejected(insert, [ids.season, matchId, MENTEE, ids.person, "mentor", HASH.toUpperCase()])).toBe(true);
    expect(await rejected(insert, [ids.season, matchId, MENTEE, MENTEE, "mentor", HASH])).toBe(true);
    expect(await rejected(insert, [ids.season, matchId, MENTEE, ids.person, "ai_do", HASH])).toBe(true);
    await db.query(insert, [ids.season, matchId, MENTEE, ids.person, "mentor", HASH]);
    // Cùng chiều của cùng cặp lần nữa → bị chặn; chiều ngược lại → được.
    expect(await rejected(insert, [ids.season, matchId, MENTEE, ids.person, "mentor", "b".repeat(64)])).toBe(true);
    expect(await rejected(insert, [ids.season, matchId, ids.person, MENTEE, "mentee", "c".repeat(64)])).toBe(false);
    // Hai link không được trùng hash.
    expect(await rejected(insert, [ids.season, matchId, ids.person, MENTEE, "mentee", HASH])).toBe(true);
  });

  it("cài đặt: link Handbook/Kick-off chỉ nhận https, không khoảng trắng, không quá 500 ký tự", async () => {
    const upsert = "insert into match_result_settings(season_id, mentee_handbook_url) values ($1, $2)";
    expect(await rejected(upsert, [ids.season, "http://example.test/a"])).toBe(true);
    expect(await rejected(upsert, [ids.season, "https://example.test/a b"])).toBe(true);
    expect(await rejected(upsert, [ids.season, "https://example.test/a\nb"])).toBe(true);
    expect(await rejected(upsert, [ids.season, "javascript:alert(1)"])).toBe(true);
    expect(await rejected(upsert, [ids.season, `https://example.test/${"x".repeat(500)}`])).toBe(true);
    expect(await rejected(upsert, [ids.season, "https://drive.google.com/file/d/abc/view"])).toBe(false);
  });

  it("giữ lại: mỗi mentor một dòng cho mỗi mùa; thông báo: mỗi người một dòng cho mỗi vai", async () => {
    await db.query("insert into match_result_holds(season_id, mentor_person_id, input_email) values ($1, $2, 'mentor@example.test')", [ids.season, ids.person]);
    expect(await rejected("insert into match_result_holds(season_id, mentor_person_id) values ($1, $2)", [ids.season, ids.person])).toBe(true);
    await db.query("insert into match_result_notices(season_id, person_id, role) values ($1, $2, 'mentor')", [ids.season, ids.person]);
    expect(await rejected("insert into match_result_notices(season_id, person_id, role) values ($1, $2, 'mentor')", [ids.season, ids.person])).toBe(true);
    expect(await rejected("insert into match_result_notices(season_id, person_id, role, variant) values ($1, $2, 'mentee', 'la')", [ids.season, MENTEE])).toBe(true);
  });

  it("dán lại lần hai: vẫn chạy, không nối loại thư hai lần, dữ liệu còn nguyên", async () => {
    const before = await one<{ n: number }>("select count(*)::int n from match_profile_links");
    await db.exec(SQL);
    await db.exec("reset role");
    const def = await kindDef();
    for (const kind of NEW_KINDS) expect(def.split(`'${kind}'`).length - 1, kind).toBe(1);
    expect(await one<{ n: number }>("select count(*)::int n from match_profile_links")).toEqual(before);
  });
});

describe("thiếu ràng buộc loại thư", () => {
  it("dừng ồn ào, không tạo bảng nào", async () => {
    await db.close();
    await freshDb(false);
    await expect(db.exec(SQL)).rejects.toThrow(/PREREQ_MISSING/);
    await db.exec("reset role");
    expect(await one<{ t: string | null }>("select to_regclass('public.match_profile_links')::text t")).toEqual({ t: null });
  }, 120_000);
});
