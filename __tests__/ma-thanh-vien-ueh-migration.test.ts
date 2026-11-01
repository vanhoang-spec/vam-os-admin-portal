/**
 * Migration 20261101200000 chạy THẬT trên PostgreSQL (PGlite). Điều phải đúng: chưa mở nhóm thì không ai tự nhận
 * mã, mã đã cấp không đổi, số không trùng dù chạy đồng thời hay có số đặt tay, cấp mã hỏng không chặn việc duyệt,
 * và anon/authenticated không chạm được bộ đếm lẫn nhật ký.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const SQL = readFileSync(path.resolve("supabase/migrations/20261101200000_ma_thanh_vien_ueh.sql"), "utf8").replace(/\r/g, "");
const ADMIN = uuid(90);
const SEASON_11 = uuid(91);

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const newPerson = async (name = "Người mới") => (await one<{ id: string }>("insert into people(full_name) values ($1) returning id", [name])).id;
const codeOf = async (id: string) => (await one<{ member_code: string | null }>("select member_code from people where id = $1", [id])).member_code;
const assign = async (id: string, group: string, source = "initial") => (await one<{ c: string }>("select vam124_assign_member_code($1, $2, $3) as c", [id, group, source])).c;
const open = (group: string) => db.query("update member_code_counters set opened_at = now() where group_code = $1", [group]);

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

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  await db.query("insert into seasons values ($1, $2, 'UEHM-S11')", [SEASON_11, ids.program]);
  // Supabase mặc định cấp quyền trên bảng và hàm mới; thiếu dòng này thì các ca quyền xanh mà không kiểm gì.
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  await db.exec(SQL);
  await db.exec("reset role");
}, 120_000);

beforeEach(async () => {
  await db.exec("update people set member_code = null; delete from member_code_log; update member_code_counters set last_number = 0, opened_at = null;");
});

afterAll(async () => {
  await db?.close();
});

describe("dữ liệu sẵn có", () => {
  it("migration không cấp mã cho ai, kể cả người đã có hồ sơ mentor", async () => {
    expect(await one("select count(*)::int as n from people where member_code is not null")).toEqual({ n: 0 });
    expect(await one("select count(*)::int as n from member_code_counters where last_number <> 0 or opened_at is not null")).toEqual({ n: 0 });
  });
});

describe("cấp mã", () => {
  it("đúng dạng, mỗi nhóm một dãy, có nhật ký", async () => {
    expect(await assign(await newPerson(), "R")).toBe("UEHR0001");
    expect(await assign(await newPerson(), "R")).toBe("UEHR0002");
    expect(await assign(await newPerson(), "E")).toBe("UEHE0001");
    expect(await one("select count(*)::int as n from member_code_log where source = 'initial' and old_code is null")).toEqual({ n: 3 });
  });

  it("đã có mã thì trả lại đúng mã đó, không tốn số, không đổi nhóm", async () => {
    const id = await newPerson();
    await assign(id, "C");
    expect(await assign(id, "R")).toBe("UEHC0001");
    expect(await one("select last_number from member_code_counters where group_code = 'R'")).toEqual({ last_number: 0 });
    expect(await one("select count(*)::int as n from member_code_log")).toEqual({ n: 1 });
  });

  it("chưa mở nhóm thì chỉ đợt khởi tạo được cấp", async () => {
    const id = await newPerson();
    await expect(assign(id, "S", "admin_assign")).rejects.toThrow("MEMBER_CODE_GROUP_NOT_OPEN");
    expect(await codeOf(id)).toBeNull();
    await open("S");
    expect(await assign(id, "S", "admin_assign")).toBe("UEHS0001");
  });

  it("bỏ qua số đang có người giữ do admin đặt tay", async () => {
    await db.query("select vam124_set_member_code($1, 'UEHR0002', $2)", [await newPerson(), ADMIN]);
    expect(await assign(await newPerson(), "R")).toBe("UEHR0001");
    expect(await assign(await newPerson(), "R")).toBe("UEHR0003");
  });

  it("hết dãy thì báo lỗi, không tràn sang 5 số", async () => {
    await db.exec("update member_code_counters set last_number = 9999 where group_code = 'R'");
    await expect(assign(await newPerson(), "R")).rejects.toThrow("MEMBER_CODE_RANGE_EXHAUSTED");
  });

  it("nhóm lạ và người không tồn tại bị chặn", async () => {
    await expect(assign(await newPerson(), "X")).rejects.toThrow("MEMBER_CODE_BAD_GROUP");
    await expect(assign(uuid(999), "R")).rejects.toThrow("MEMBER_CODE_PERSON_NOT_FOUND");
  });

  it("database chặn mã sai dạng và mã trùng ngay cả khi ghi thẳng", async () => {
    const a = await newPerson();
    const b = await newPerson();
    expect(await rejected("postgres", "update people set member_code = 'UEHRF0800' where id = $1", [a])).toBe(true);
    await db.query("update people set member_code = 'UEHR0005' where id = $1", [a]);
    expect(await rejected("postgres", "update people set member_code = 'UEHR0005' where id = $1", [b])).toBe(true);
  });
});

describe("admin sửa tay", () => {
  const set = (id: string, code: string) => db.query("select vam124_set_member_code($1, $2, $3)", [id, code, ADMIN]);

  it("đổi được và ghi cả mã cũ lẫn người đổi", async () => {
    const id = await newPerson();
    await assign(id, "R");
    await set(id, "UEHC0007");
    expect(await codeOf(id)).toBe("UEHC0007");
    expect(await one("select old_code, new_code, source, actor_admin_user_id from member_code_log where source = 'admin_edit'")).toEqual({
      old_code: "UEHR0001", new_code: "UEHC0007", source: "admin_edit", actor_admin_user_id: ADMIN
    });
  });

  it("chặn sai dạng, số 0000, mã đã có người, và thiếu người thao tác", async () => {
    const a = await newPerson();
    const b = await newPerson();
    await assign(a, "R");
    await expect(set(b, "UEHRF0800")).rejects.toThrow("MEMBER_CODE_BAD_FORMAT");
    await expect(set(b, "UEHR0000")).rejects.toThrow("MEMBER_CODE_BAD_FORMAT");
    await expect(set(b, "UEHR0001")).rejects.toThrow("MEMBER_CODE_TAKEN");
    await expect(db.query("select vam124_set_member_code($1, 'UEHR0002', null)", [b])).rejects.toThrow("MEMBER_CODE_ACTOR_REQUIRED");
    expect(await codeOf(b)).toBeNull();
  });

  it("đặt lại đúng mã đang có thì không ghi thêm nhật ký", async () => {
    const id = await newPerson();
    await set(id, "UEHS0003");
    await set(id, "UEHS0003");
    expect(await one("select count(*)::int as n from member_code_log")).toEqual({ n: 1 });
  });
});

describe("tự cấp cho người mới", () => {
  const addMembership = (person: string, role: string, season: string) =>
    db.query("insert into person_season_memberships(person_id, program_id, season_id, role, status) values ($1, $2, $3, $4, 'active')", [person, ids.program, season, role]);
  const addMentorProfile = (person: string) => db.query("insert into mentor_profiles(person_id) values ($1)", [person]);

  it("chưa mở nhóm: mentor mới và mentee mới KHÔNG nhận mã, và việc tạo vẫn thành công", async () => {
    const mentor = await newPerson();
    const mentee = await newPerson();
    await addMentorProfile(mentor);
    await addMembership(mentee, "mentee", ids.season);
    expect(await codeOf(mentor)).toBeNull();
    expect(await codeOf(mentee)).toBeNull();
    expect(await one("select count(*)::int as n from member_code_counters where last_number <> 0")).toEqual({ n: 0 });
  });

  it("đã mở nhóm: mentor mới nhận R, mentee mùa 12 nhận E, số nối tiếp đợt khởi tạo", async () => {
    await assign(await newPerson(), "R");
    await open("R");
    await open("E");
    const mentor = await newPerson();
    const mentee = await newPerson();
    await addMentorProfile(mentor);
    await addMembership(mentee, "mentee", ids.season);
    expect(await codeOf(mentor)).toBe("UEHR0002");
    expect(await codeOf(mentee)).toBe("UEHE0001");
    expect(await one("select source from member_code_log where person_id = $1", [mentor])).toEqual({ source: "auto" });
  });

  it("mentee mùa trước và vai trò khác không nhận mã E", async () => {
    await open("E");
    const old = await newPerson();
    const other = await newPerson();
    await addMembership(old, "mentee", SEASON_11);
    await addMembership(other, "interviewer", ids.season);
    expect(await codeOf(old)).toBeNull();
    expect(await codeOf(other)).toBeNull();
  });

  it("người đã có mã C thêm tư cách mentee vẫn giữ mã C", async () => {
    const id = await newPerson();
    await assign(id, "C");
    await open("E");
    await addMembership(id, "mentee", ids.season);
    expect(await codeOf(id)).toBe("UEHC0001");
  });

  it("cấp mã lỗi không chặn tạo hồ sơ, và không đốt số", async () => {
    await open("R");
    await db.exec("update member_code_counters set last_number = 9999 where group_code = 'R'");
    const mentor = await newPerson();
    await addMentorProfile(mentor);
    expect(await codeOf(mentor)).toBeNull();
    expect(await one("select count(*)::int as n from mentor_profiles where person_id = $1", [mentor])).toEqual({ n: 1 });
    expect(await one("select last_number from member_code_counters where group_code = 'R'")).toEqual({ last_number: 9999 });
  });
});

describe("quyền", () => {
  it("anon/authenticated không đọc, ghi được bộ đếm, nhật ký, cũng không gọi được hàm", async () => {
    const id = await newPerson();
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select * from member_code_counters")).toBe(true);
      expect(await rejected(role, "select * from member_code_log")).toBe(true);
      expect(await rejected(role, "update member_code_counters set last_number = 5")).toBe(true);
      expect(await rejected(role, "select vam124_assign_member_code($1, 'R', 'initial')", [id])).toBe(true);
      expect(await rejected(role, "select vam124_set_member_code($1, 'UEHR0001', $2)", [id, ADMIN])).toBe(true);
    }
  });

  it("service_role gọi được hàm cấp, nhưng không sửa thẳng bộ đếm, không xoá nhật ký, không gọi hàm tự cấp", async () => {
    const id = await newPerson();
    expect(await rejected("service_role", "select vam124_assign_member_code($1, 'R', 'initial')", [id])).toBe(false);
    expect(await rejected("service_role", "select * from member_code_log")).toBe(false);
    expect(await rejected("service_role", "update member_code_counters set last_number = 5")).toBe(true);
    expect(await rejected("service_role", "delete from member_code_log")).toBe(true);
    expect(await rejected("service_role", "select vam124_auto_member_code($1, 'R')", [id])).toBe(true);
  });

  it("hai bảng đã bật RLS", async () => {
    expect(await one("select count(*)::int as n from pg_class where relname in ('member_code_counters', 'member_code_log') and relrowsecurity")).toEqual({ n: 2 });
  });
});

describe("chạy lại", () => {
  it("dán lần hai vẫn chạy và giữ nguyên bộ đếm, mã đã cấp", async () => {
    const id = await newPerson();
    await assign(id, "R");
    await open("R");
    await db.exec(SQL);
    await db.exec("reset role");
    expect(await codeOf(id)).toBe("UEHR0001");
    expect(await one<{ last_number: number; opened: boolean }>("select last_number, opened_at is not null as opened from member_code_counters where group_code = 'R'")).toEqual({ last_number: 1, opened: true });
    expect(await one("select count(*)::int as n from pg_trigger where tgname like 'vam124_%' and not tgisinternal")).toEqual({ n: 2 });
  });

  it("thiếu bảng nền thì báo ngay, trước khi tạo gì", () => {
    expect(SQL.indexOf("PREREQ_MISSING")).toBeLessThan(SQL.indexOf("alter table public.people"));
  });
});
