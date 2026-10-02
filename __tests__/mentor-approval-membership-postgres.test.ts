/**
 * Duyệt chính thức mentor → tư cách mentor của mùa (migration 20261003010000),
 * chạy thật trên PGlite.
 *
 * BTC 03/10/2026: mentor mới đã "Đã duyệt — Mentor" mà không hiện ở Mentor (Mùa
 * 12) và không cấp được quyền phỏng vấn — hai trang đó đọc person_season_memberships,
 * còn hai hàm duyệt chưa bao giờ tạo dòng đó. 16 người phải chờ BTC thêm tay.
 */
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { ids, offlineDb } from "./support/offline-postgres";

const MIGRATION = readFileSync("supabase/migrations/20261003010000_mentor_duyet_tu_tao_tu_cach_mua.sql", "utf8");
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";

let n = 700;
const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function person(db: PGlite) {
  const id = nextId();
  await db.query("insert into people(id, full_name, email_primary) values ($1, 'Người thử', $2)", [id, `${id}@example.test`]);
  return id;
}
async function application(db: PGlite, opts: { role: string; status: string; personId: string | null; season?: string }) {
  const id = nextId();
  await db.query(
    "insert into applications(id, season_id, person_id, role_applied, status, source, full_name) values ($1, $2, $3, $4, $5, 'vam_os_form', 'Người thử')",
    [id, opts.season ?? S12, opts.personId, opts.role, opts.status]
  );
  return id;
}
const memberships = async (db: PGlite, personId: string, season = S12) =>
  (await db.query<{ role: string; status: string; source: string }>(
    "select role, status, source from person_season_memberships where person_id = $1 and season_id = $2 order by role",
    [personId, season]
  )).rows;

describe("duyệt mentor tự tạo tư cách mùa", () => {
  let db: PGlite;
  const p: Record<string, string> = {};

  beforeAll(async () => {
    db = await offlineDb();
    await db.exec("reset role;");
    await db.query("insert into seasons values ($1, $2, 'UEHM-S12-THAT')", [S12, ids.program]);
    // Trước migration: đúng tình trạng production 03/10.
    p.thieu = await person(db);
    await application(db, { role: "mentor", status: "approved_as_mentor", personId: p.thieu });
    p.daRut = await person(db);
    await application(db, { role: "mentor", status: "approved_as_mentor", personId: p.daRut });
    await db.query(
      "insert into person_season_memberships(person_id, program_id, season_id, role, status, source) values ($1, $2, $3, 'mentor', 'withdrawn', 'manual')",
      [p.daRut, ids.program, S12]
    );
    p.menteeDuyet = await person(db);
    await application(db, { role: "mentee", status: "approved_as_mentee", personId: p.menteeDuyet });
    p.chuaDuyet = await person(db);
    await application(db, { role: "mentor", status: "interview_passed", personId: p.chuaDuyet });
    await db.exec(MIGRATION);
    await db.exec("set role service_role;");
  }, 60000);

  it("bổ sung: mentor Mùa 12 đã duyệt mà thiếu → có tư cách mentor active (nguồn application)", async () => {
    expect(await memberships(db, p.thieu)).toEqual([{ role: "mentor", status: "active", source: "application" }]);
  });

  it("bổ sung không đụng người đã có tư cách (kể cả đã rút), mentee, hay đơn chưa duyệt", async () => {
    expect(await memberships(db, p.daRut)).toEqual([{ role: "mentor", status: "withdrawn", source: "manual" }]);
    expect(await memberships(db, p.menteeDuyet)).toEqual([]);
    expect(await memberships(db, p.chuaDuyet)).toEqual([]);
  });

  it("trigger: đơn mentor chuyển sang approved_as_mentor → tạo tư cách mentor của đúng mùa", async () => {
    const who = await person(db);
    const app = await application(db, { role: "mentor", status: "interview_passed", personId: who, season: ids.season });
    expect(await memberships(db, who, ids.season)).toEqual([]);
    await db.query("update applications set status = 'approved_as_mentor' where id = $1", [app]);
    expect(await memberships(db, who, ids.season)).toEqual([{ role: "mentor", status: "active", source: "application" }]);
  });

  it("trigger: duyệt trước khi có person thì chờ; gắn person sau (như vam090) thì tạo", async () => {
    const app = await application(db, { role: "mentor", status: "interview_passed", personId: null });
    await db.query("update applications set status = 'approved_as_mentor' where id = $1", [app]);
    const who = await person(db);
    await db.query("update applications set person_id = $2 where id = $1", [app, who]);
    expect(await memberships(db, who)).toEqual([{ role: "mentor", status: "active", source: "application" }]);
  });

  it("trigger: duyệt cùng lúc gắn person trong MỘT câu update (đúng cách vam090 ghi)", async () => {
    const app = await application(db, { role: "mentor", status: "interview_passed", personId: null });
    const who = await person(db);
    await db.query("update applications set status = 'approved_as_mentor', person_id = $2 where id = $1", [app, who]);
    expect(await memberships(db, who)).toEqual([{ role: "mentor", status: "active", source: "application" }]);
  });

  it("trigger không đụng: mentee được duyệt, trạng thái khác, tư cách đã có, sửa cột khác", async () => {
    const mentee = await person(db);
    const menteeApp = await application(db, { role: "mentee", status: "interview_scheduled", personId: mentee });
    await db.query("update applications set status = 'approved_as_mentee' where id = $1", [menteeApp]);
    expect(await memberships(db, mentee)).toEqual([]);

    const pending = await person(db);
    const pendingApp = await application(db, { role: "mentor", status: "invited_to_interview", personId: pending });
    await db.query("update applications set status = 'interview_passed' where id = $1", [pendingApp]);
    expect(await memberships(db, pending)).toEqual([]);

    // Gia hạn: tư cách đã có sẵn (active, thêm tay) — giữ nguyên, không lỗi.
    const renewal = await person(db);
    await db.query(
      "insert into person_season_memberships(person_id, program_id, season_id, role, status, source) values ($1, $2, $3, 'mentor', 'active', 'manual')",
      [renewal, ids.program, S12]
    );
    const renewalApp = await application(db, { role: "mentor", status: "interview_passed", personId: renewal });
    await db.query("update applications set status = 'approved_as_mentor' where id = $1", [renewalApp]);
    expect(await memberships(db, renewal)).toEqual([{ role: "mentor", status: "active", source: "manual" }]);
    await db.query("update applications set full_name = 'Đổi tên' where id = $1", [renewalApp]);
    expect(await memberships(db, renewal)).toHaveLength(1);
  });
});
