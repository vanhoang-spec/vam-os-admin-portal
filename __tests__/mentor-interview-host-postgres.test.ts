/**
 * Quyền "tạo lịch phỏng vấn mentor" tách khỏi quyền chấm mentee (migration 20261004120000).
 *
 * BTC 04/10/2026: hai mentor chỉ được cấp quyền chấm mentee (02/10) lại tick giờ rảnh
 * phỏng vấn mentor mới — vì cả hai việc cùng đọc tư cách mùa role='interviewer'.
 * Chạy migration thật trên Postgres (PGlite) và soi chính các dòng nó ghi.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const MIGRATION = readFileSync("supabase/migrations/20261004120000_lich_pv_mentor_tach_quyen.sql", "utf8");
const SLOTS_DDL = (() => {
  const text = readFileSync("supabase/migrations/20260922100000_interview_slot_booking.sql", "utf8");
  const m = /create table if not exists public\.interview_slots \([\s\S]*?\n\);/i.exec(text);
  if (!m) throw new Error("thiếu DDL interview_slots");
  return m[0];
})();

// ids.mentor: reviewer, tư cách 'interviewer' tạo LÚC CHẠY TEST (sau 01/10) — nhóm chấm mentee.
const OLD = uuid(60); // reviewer được bật 22/09 — nhóm phỏng vấn mentor
const OLD_PERSON = uuid(61);
const CT = uuid(62); // core team
const GONE = uuid(63); // reviewer bật 22/09 nhưng tư cách đã huỷ
const GONE_PERSON = uuid(64);
const APP = uuid(65);
const FUTURE = "2026-10-08T03:00:00Z"; // 10:00 giờ Việt Nam
const FUTURE2 = "2026-10-08T04:00:00Z";

let db: PGlite;
async function host(admin: string) {
  const { rows } = await db.query<{ ok: boolean }>("select public.vam109_mentor_interview_host($1, $2) as ok", [admin, ids.season]);
  return rows[0].ok;
}
async function slot(admin: string, startsAt: string, status = "open", app: string | null = null) {
  return db.query(
    "insert into interview_slots(season_id, admin_user_id, slot_starts_at, status, booked_application_id) values($1,$2,$3,$4,$5) returning id",
    [ids.season, admin, startsAt, status, app]
  );
}

beforeEach(async () => {
  db = await offlineDb();
  await db.exec("reset role;");
  await db.exec(SLOTS_DDL);
  await db.exec(`
    insert into admin_users values
      ('${OLD}','${OLD}','old@example.test','Mentor 22/09','active','reviewer'),
      ('${CT}','${CT}','ct@example.test','Core Team','active','core_team'),
      ('${GONE}','${GONE}','gone@example.test','Mentor đã huỷ','active','reviewer');
    insert into admin_scope_access values ('${OLD}','active','${ids.season}','review'),('${GONE}','active','${ids.season}','review');
    insert into people(id, full_name, email_primary) values ('${OLD_PERSON}','Mentor 22/09','old@example.test'),('${GONE_PERSON}','Mentor đã huỷ','gone@example.test');
    insert into person_season_memberships(person_id, program_id, season_id, role, status, created_at) values
      ('${OLD_PERSON}','${ids.program}','${ids.season}','interviewer','active','2026-09-22T16:33:00Z'),
      ('${GONE_PERSON}','${ids.program}','${ids.season}','interviewer','cancelled','2026-09-22T16:33:00Z');
    insert into applications(id, season_id, role_applied, status) values ('${APP}','${ids.season}','mentor','screening_passed');
  `);
  // Supabase cấp sẵn mọi bảng / hàm mới cho anon và authenticated — PGlite thì không.
  // Mô phỏng đúng điều đó, để một migration quên thu quyền phải đỏ ở đây.
  await db.exec("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;");
  // Giờ trống sắp tới của người chấm mentee (có từ trước khi tách quyền) — migration phải gỡ.
  await slot(ids.mentor, FUTURE);
  await db.exec(MIGRATION);
}, 60000);

describe("cấp sẵn và cổng quyền", () => {
  it("chỉ cấp sẵn reviewer có tư cách 'interviewer' ĐANG hiệu lực từ trước 01/10", async () => {
    const { rows } = await db.query<{ admin_user_id: string }>("select admin_user_id from mentor_interview_hosts");
    expect(rows.map((r) => r.admin_user_id)).toEqual([OLD]);
  });

  it("core team: có; reviewer 22/09: có; reviewer chỉ chấm mentee: KHÔNG; tư cách đã huỷ: KHÔNG", async () => {
    expect(await host(CT)).toBe(true);
    expect(await host(OLD)).toBe(true);
    expect(await host(ids.mentor)).toBe(false);
    expect(await host(GONE)).toBe(false);
    // Quyền chấm mentee không đổi.
    const { rows } = await db.query<{ ok: boolean }>("select public.vam084_participant_for_stage($1,$2,'interview') as ok", [ids.mentor, ids.season]);
    expect(rows[0].ok).toBe(true);
  });

  it("có dòng cấp nhưng tư cách 'interviewer' bị huỷ thì mất quyền", async () => {
    await db.exec(`update person_season_memberships set status='cancelled' where person_id='${OLD_PERSON}'`);
    expect(await host(OLD)).toBe(false);
  });

  it("tài khoản ngưng hoạt động thì mất quyền — kể cả core team", async () => {
    await db.exec(`update admin_users set status='inactive' where id in ('${OLD}','${CT}')`);
    expect(await host(OLD)).toBe(false);
    expect(await host(CT)).toBe(false);
  });

  it("bảng khoá kín: RLS bật, anon / authenticated không đọc được, không gọi được hàm", async () => {
    const { rows } = await db.query<{ rls: boolean; anon_t: boolean; auth_t: boolean; anon_f: boolean }>(`
      select (select relrowsecurity from pg_class where oid='public.mentor_interview_hosts'::regclass) as rls,
        has_table_privilege('anon','public.mentor_interview_hosts','select') as anon_t,
        has_table_privilege('authenticated','public.mentor_interview_hosts','select') as auth_t,
        has_function_privilege('anon','public.vam109_mentor_interview_host(uuid, uuid)','execute') as anon_f`);
    expect(rows[0]).toEqual({ rls: true, anon_t: false, auth_t: false, anon_f: false });
  });
});

describe("chốt ở database trên interview_slots", () => {
  it("giờ trống sắp tới của người không có quyền đã bị gỡ", async () => {
    const { rows } = await db.query<{ status: string; removed_at: string | null }>(
      "select status, removed_at from interview_slots where admin_user_id=$1", [ids.mentor]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("removed");
    expect(rows[0].removed_at).not.toBeNull();
  });

  it("người chỉ chấm mentee: không mở giờ mới, không mở lại giờ đã gỡ, không được ghép thẳng", async () => {
    await expect(slot(ids.mentor, FUTURE2)).rejects.toThrow(/NOT_MENTOR_INTERVIEW_HOST/);
    await expect(db.query("update interview_slots set status='open', removed_at=null where admin_user_id=$1", [ids.mentor]))
      .rejects.toThrow(/NOT_MENTOR_INTERVIEW_HOST/);
    // vam099 (ghép mentor đang chờ) chèn thẳng ô 'booked'.
    await expect(slot(ids.mentor, FUTURE2, "booked", APP)).rejects.toThrow(/NOT_MENTOR_INTERVIEW_HOST/);
  });

  it("mentor 22/09 và core team vẫn mở giờ và được đặt bình thường", async () => {
    const { rows: [o] } = await slot(OLD, FUTURE2) as { rows: Array<{ id: string }> };
    await db.query("update interview_slots set status='booked', booked_application_id=$2 where id=$1", [o.id, APP]);
    await slot(CT, FUTURE2);
    const { rows } = await db.query<{ status: string }>("select status from interview_slots where admin_user_id in ($1,$2) order by status", [OLD, CT]);
    expect(rows.map((r) => r.status)).toEqual(["booked", "open"]);
  });

  it("huỷ buổi đã đặt với người mất quyền: không chặn việc huỷ, ô giờ đóng lại thay vì mở cho người khác", async () => {
    const { rows: [o] } = await slot(OLD, FUTURE2, "booked", APP) as { rows: Array<{ id: string }> };
    await db.exec(`delete from mentor_interview_hosts where admin_user_id='${OLD}'`);
    await db.query("update interview_slots set status='open', booked_application_id=null where id=$1", [o.id]);
    const { rows } = await db.query<{ status: string; removed_at: string | null }>("select status, removed_at from interview_slots where id=$1", [o.id]);
    expect(rows[0].status).toBe("removed");
    expect(rows[0].removed_at).not.toBeNull();
  });

  it("người mất quyền vẫn tự gỡ được giờ của mình", async () => {
    const { rows: [o] } = await slot(OLD, FUTURE2) as { rows: Array<{ id: string }> };
    await db.exec(`delete from mentor_interview_hosts where admin_user_id='${OLD}'`);
    await db.query("update interview_slots set status='removed', removed_at=now() where id=$1", [o.id]);
    const { rows } = await db.query<{ status: string }>("select status from interview_slots where id=$1", [o.id]);
    expect(rows[0].status).toBe("removed");
  });
});

describe("tự kiểm của migration", () => {
  it("báo lỗi khi danh sách cấp sẵn lọt người chỉ chấm mentee", async () => {
    await db.query("insert into mentor_interview_hosts(season_id, admin_user_id) values($1,$2)", [ids.season, ids.mentor]);
    const check = MIGRATION.slice(MIGRATION.indexOf("do $tach_quyen_self_check$"), MIGRATION.lastIndexOf("commit;"));
    await expect(db.exec(check)).rejects.toThrow(/không thuộc đợt trước 01\/10/);
  });
});
