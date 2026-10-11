/**
 * Mentee đặc cách (Support team) — migration 20261011150000 chạy THẬT trên PostgreSQL (PGlite).
 *
 * Đường ghi quan trọng nhất ở đây do người NGOÀI hệ thống bấm (bạn Support team không có
 * tài khoản, chỉ có link trong thư), và nó biến một người thành mentee của mùa mà không qua
 * phỏng vấn. Nên mọi luật phải nằm trong hàm và phải được soi ở đây:
 *   - chỉ BTC vận hành mùa mới thêm/gỡ được người;
 *   - người có đơn đã bị từ chối / đã rút, tư cách đã ngừng, hồ sơ nhập nhằng: không thêm
 *     được, và nếu tình trạng đổi sau khi thêm thì bấm xác nhận cũng KHÔNG ghi gì;
 *   - bấm xác nhận: có đơn đã duyệt (duyệt đơn sẵn có hoặc tạo đơn tối thiểu), có mentee
 *     profile, có tư cách mentee đang hoạt động — đúng người đó, không ai khác;
 *   - bấm lần hai không ghi thêm; máy chủ không tự đặt được dấu "đã xác nhận".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { ids, offlineDb, uuid } from "./support/offline-postgres";

const THIS = "supabase/migrations/20261011150000_mentee_dac_cach_support_team.sql";
const SQL = readFileSync(path.resolve(THIS), "utf8");
const OTHER_SEASON = ids.seasonNext;
const OTHER_BTC = uuid(31);

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

type AddResult = { ok: boolean; results: Array<{ personId: string; code: string }> };
type ConfirmResult = { ok: boolean; code: string; reason?: string };
type Exemption = {
  id: string; season_id: string; person_id: string; reason: string; token: string; added_by: string | null;
  confirmed_at: string | null; application_id: string | null; revoked_at: string | null; revoked_by: string | null;
  claimed_at: string | null; send_count: number;
};

const add = async (people: string[], actor = ids.btc, season = ids.season) =>
  (await one<{ r: AddResult }>("select vam117_add_mentee_exemptions($1, $2, $3::text::uuid[]) as r", [actor, season, `{${people.join(",")}}`])).r;
const codes = (result: AddResult) => Object.fromEntries(result.results.map((r) => [r.personId, r.code]));
const revoke = async (id: string, actor = ids.btc, season = ids.season) =>
  (await one<{ r: { ok: boolean } }>("select vam117_revoke_mentee_exemption($1, $2, $3) as r", [actor, season, id])).r;
const confirm = async (token: string) =>
  (await one<{ r: ConfirmResult }>("select vam117_confirm_mentee_exemption($1) as r", [token])).r;
const blocker = async (personId: string, season = ids.season) =>
  (await one<{ r: string | null }>("select vam117_mentee_exemption_blocker($1, $2) as r", [season, personId])).r;
const exemption = (personId: string, season = ids.season) =>
  one<Exemption>("select * from mentee_exemptions where person_id = $1 and season_id = $2", [personId, season]);

let seq = 1000;
async function person(name: string, email: string | null = `${name.replace(/\s+/g, ".").toLowerCase()}@example.test`) {
  const id = uuid(++seq);
  await db.query("insert into people(id, full_name, email_primary, phone_primary) values ($1, $2, $3, '0900000000')", [id, name, email]);
  return { id, email };
}
async function menteeApp(input: { person?: string | null; email: string | null; status: string; season?: string; role?: string }) {
  const id = uuid(++seq);
  await db.query(
    "insert into applications(id, season_id, person_id, role_applied, status, source, full_name, email_primary, raw_payload) values ($1, $2, $3, $4, $5, 'vam_os_form', 'Đơn', $6, '{}'::jsonb)",
    [id, input.season ?? ids.season, input.person ?? null, input.role ?? "mentee", input.status, input.email]
  );
  return id;
}
async function membership(personId: string, status = "active", over: { season?: string; role?: string } = {}) {
  const id = uuid(++seq);
  await db.query(
    "insert into person_season_memberships(id, person_id, program_id, season_id, role, status, source) values ($1, $2, $3, $4, $5, $6, 'manual')",
    [id, personId, ids.program, over.season ?? ids.season, over.role ?? "mentee", status]
  );
  return id;
}
const profile = (personId: string) => db.query("insert into mentee_profiles(person_id) values ($1)", [personId]);

const apps = (personId: string, email: string | null) =>
  all<{ id: string; person_id: string | null; status: string; source: string | null; season_id: string; role_applied: string; email_primary: string | null; consent_data_storage: boolean; submitted_at: string | null; raw_payload: Record<string, any> }>(
    "select id, person_id, status, source, season_id, role_applied, email_primary, consent_data_storage, submitted_at::text as submitted_at, raw_payload from applications where person_id = $1 or lower(btrim(email_primary)) = lower(btrim($2)) order by season_id, role_applied",
    [personId, email]
  );
const decisionsOf = (applicationId: string) =>
  all<{ decided_by: string | null; decided_by_name: string | null; decision: string; previous_status: string | null; new_status: string; decision_note: string | null }>(
    "select decided_by, decided_by_name, decision, previous_status, new_status, decision_note from application_decisions where application_id = $1 order by created_at, id",
    [applicationId]
  );
const membershipsOf = (personId: string) =>
  all<{ id: string; season_id: string; role: string; status: string; source: string }>(
    "select id, season_id, role, status, source from person_season_memberships where person_id = $1 order by season_id, role",
    [personId]
  );
const membershipLog = (personId: string) =>
  all<{ old_status: string | null; new_status: string; transition_type: string; changed_by: string | null }>(
    "select old_status, new_status, transition_type, changed_by from person_season_membership_log where person_id = $1 order by changed_at, id",
    [personId]
  );
const profilesOf = async (personId: string) => (await all("select id from mentee_profiles where person_id = $1", [personId])).length;

/** Đếm mọi dòng của các bảng hàm xác nhận có thể ghi — để khẳng định "không ghi gì". */
async function footprint() {
  const count = async (table: string) => Number((await one<{ n: number }>(`select count(*)::int as n from ${table}`)).n);
  return {
    applications: await count("applications"),
    decisions: await count("application_decisions"),
    memberships: await count("person_season_memberships"),
    membershipLog: await count("person_season_membership_log"),
    profiles: await count("mentee_profiles"),
    confirmed: Number((await one<{ n: number }>("select count(*)::int as n from mentee_exemptions where confirmed_at is not null")).n),
    approved: Number((await one<{ n: number }>("select count(*)::int as n from applications where status = 'approved_as_mentee'")).n)
  };
}

async function isolated(run: () => Promise<void>) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
    await db.exec("set role service_role");
  }
}
const asOwner = async (run: () => Promise<void>) => {
  await db.exec("reset role");
  try {
    await run();
  } finally {
    await db.exec("set role service_role");
  }
};

beforeAll(async () => {
  db = await offlineDb();
  await db.exec("reset role");
  // Thứ production có mà bộ dựng chung không có: hàm vai trò API tin cậy, bảng thư với
  // ràng buộc loại thư, hai cột của đơn mà hàm xác nhận ghi, và hai chỉ mục duy nhất của
  // đơn (chép từ pg_indexes production 11/10/2026) — chúng quyết định đơn nào tạo được.
  await db.exec(`
    create table vam063_trusted_api_role_result(api_role text);
    insert into vam063_trusted_api_role_result values ('service_role');
    create function vam063_trusted_api_role() returns table(api_role text) language sql stable as
      'select api_role from public.vam063_trusted_api_role_result limit 1';
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['mentee_session_invite'::text, 'matching_round2_invite'::text])));
    alter table applications add column consent_data_storage boolean not null default false, add column submitted_at date;
    create unique index applications_season_role_canonical_email_key on applications (season_id, role_applied, lower(btrim(email_primary)))
      where season_id is not null and role_applied is not null and nullif(btrim(email_primary), '') is not null;
    create unique index applications_s12_role_person_key on applications (season_id, role_applied, person_id)
      where person_id is not null and role_applied is not null;
    grant all on vam063_trusted_api_role_result, outbound_emails to service_role;
  `);
  await db.exec(SQL);
  await db.exec("set role service_role");
}, 90000);
afterAll(async () => {
  await db?.close();
});

describe("cấu trúc và quyền", () => {
  it("bảng bật RLS; anon và authenticated không đọc được, không gọi được hàm nào", async () => {
    const flags = await one<Record<string, boolean>>(`select
      (select relrowsecurity from pg_class where relname = 'mentee_exemptions') as rls,
      has_table_privilege('anon', 'public.mentee_exemptions', 'select') as anon_read,
      has_table_privilege('authenticated', 'public.mentee_exemptions', 'select') as auth_read,
      has_function_privilege('anon', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute') as anon_confirm,
      has_function_privilege('authenticated', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute') as auth_confirm,
      has_function_privilege('anon', 'public.vam117_add_mentee_exemptions(uuid, uuid, uuid[])', 'execute') as anon_add,
      has_function_privilege('authenticated', 'public.vam117_revoke_mentee_exemption(uuid, uuid, uuid)', 'execute') as auth_revoke,
      has_function_privilege('service_role', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute') as server_confirm`);
    expect(flags).toEqual({
      rls: true, anon_read: false, auth_read: false, anon_confirm: false, auth_confirm: false,
      anon_add: false, auth_revoke: false, server_confirm: true
    });
  });

  it("máy chủ không tự đặt được dấu xác nhận, không đổi được link hay chủ link, không xoá được dòng", () =>
    isolated(async () => {
      const a = await person("Quyen A");
      await add([a.id]);
      for (const sql of [
        "update mentee_exemptions set confirmed_at = now()",
        "update mentee_exemptions set application_id = gen_random_uuid()",
        "update mentee_exemptions set token = gen_random_uuid()",
        `update mentee_exemptions set person_id = '${ids.person}'`,
        "delete from mentee_exemptions"
      ]) {
        await db.exec("savepoint sp");
        await expect(db.exec(sql)).rejects.toThrow(/permission denied/);
        await db.exec("rollback to savepoint sp");
      }
      // Các cột theo dõi gửi thư thì ghi được — bộ gửi thư cần chúng.
      await db.exec("update mentee_exemptions set send_count = send_count + 1, last_sent_at = now(), claimed_at = null, last_error = null");
      expect((await exemption(a.id)).send_count).toBe(1);
    }));

  it("hàm xác nhận chạy bằng quyền chủ hàm; hàm thêm/gỡ của BTC chạy bằng quyền người gọi", async () => {
    const rows = await all<{ proname: string; prosecdef: boolean }>(
      "select proname, prosecdef from pg_proc where proname like 'vam117_%' order by proname"
    );
    expect(Object.fromEntries(rows.map((r) => [r.proname, r.prosecdef]))).toEqual({
      vam117_add_mentee_exemptions: false,
      vam117_confirm_mentee_exemption: true,
      vam117_mentee_application_ids: false,
      vam117_mentee_exemption_blocker: false,
      vam117_revoke_mentee_exemption: false
    });
  });

  it("loại thư mới được thêm vào ràng buộc, các loại cũ còn nguyên", async () => {
    const def = (await one<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'outbound_emails_kind_check'"
    )).def;
    for (const kind of ["mentee_session_invite", "matching_round2_invite", "mentee_exemption_confirm"]) expect(def).toContain(`'${kind}'`);
    await isolated(async () => {
      await db.exec("insert into outbound_emails(kind) values ('mentee_exemption_confirm'), ('matching_round2_invite')");
      await db.exec("savepoint sp");
      await expect(db.exec("insert into outbound_emails(kind) values ('loai_bia')")).rejects.toThrow(/outbound_emails_kind_check/);
      await db.exec("rollback to savepoint sp");
    });
  });

  it("dán lại migration lần hai: không lỗi, không mất người đã thêm, không nhân đôi loại thư", async () => {
    const a = await person("Dan Lai");
    await add([a.id]);
    const before = await exemption(a.id);
    await asOwner(async () => {
      await db.exec(SQL);
    });
    expect(await exemption(a.id)).toEqual(before);
    const def = (await one<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'outbound_emails_kind_check'"
    )).def;
    expect(def.split("'mentee_exemption_confirm'").length - 1).toBe(1);
  });
});

describe("BTC thêm người vào danh sách đặc cách", () => {
  it("chỉ BTC vận hành mùa thêm được; tài khoản Support team và mentor thì không", () =>
    isolated(async () => {
      const a = await person("Them A");
      for (const actor of [ids.support, ids.mentor, uuid(999999)]) {
        await db.exec("savepoint sp");
        await expect(add([a.id], actor)).rejects.toThrow(/ACCESS_DENIED/);
        await db.exec("rollback to savepoint sp");
      }
      expect(await exemption(a.id)).toBeUndefined();
      // BTC của mùa này không thêm được vào mùa mình không vận hành.
      await db.exec("savepoint sp");
      await expect(add([a.id], ids.btc, uuid(424242))).rejects.toThrow(/ACCESS_DENIED/);
      await db.exec("rollback to savepoint sp");
    }));

  it("thêm được người chưa có đơn mùa này: một dòng, có link riêng, ghi người thêm", () =>
    isolated(async () => {
      const a = await person("Them B");
      expect(codes(await add([a.id]))).toEqual({ [a.id]: "added" });
      const row = await exemption(a.id);
      expect(row).toMatchObject({
        season_id: ids.season, person_id: a.id, reason: "support_team", added_by: ids.btc,
        confirmed_at: null, application_id: null, revoked_at: null, send_count: 0
      });
      expect(row.token).toMatch(/^[0-9a-f-]{36}$/);
      // Thêm chưa phải là xác nhận: chưa có đơn, chưa có tư cách nào được tạo.
      expect(await apps(a.id, a.email)).toEqual([]);
      expect(await membershipsOf(a.id)).toEqual([]);
    }));

  it("thêm lần hai không tạo dòng thứ hai và không đổi link", () =>
    isolated(async () => {
      const a = await person("Them C");
      await add([a.id]);
      const first = await exemption(a.id);
      expect(codes(await add([a.id, a.id]))).toEqual({ [a.id]: "exists" });
      expect(await all("select id from mentee_exemptions where person_id = $1", [a.id])).toHaveLength(1);
      expect((await exemption(a.id)).token).toBe(first.token);
    }));

  it("mỗi người một kết quả riêng: người không hợp lệ không chặn người hợp lệ", () =>
    isolated(async () => {
      const ok = await person("Hop Le");
      const approved = await person("Da Duyet");
      await menteeApp({ person: approved.id, email: approved.email, status: "approved_as_mentee" });
      const pending = await person("Dang Cho");
      await menteeApp({ email: pending.email, status: "interview_scheduled" });
      const rejected = await person("Bi Tu Choi");
      await menteeApp({ email: rejected.email, status: "rejected_or_not_fit" });
      const ghost = uuid(777777);

      const result = codes(await add([ok.id, approved.id, pending.id, rejected.id, ghost]));

      expect(result).toEqual({
        [ok.id]: "added", [approved.id]: "added", [pending.id]: "added",
        [rejected.id]: "application_closed", [ghost]: "person_not_found"
      });
      expect(await exemption(rejected.id)).toBeUndefined();
      // Đúng ba người hợp lệ có dòng — đếm trong năm người của ca này, không đếm cả bảng.
      const listed = await all<{ person_id: string }>("select person_id from mentee_exemptions where person_id = any($1::text::uuid[])", [`{${[ok.id, approved.id, pending.id, rejected.id, ghost].join(",")}}`]);
      expect(listed.map((r) => r.person_id).sort()).toEqual([ok.id, approved.id, pending.id].sort());
    }));

  it.each([
    ["đơn mentee mùa này đã rút", "application_closed", async (p: { id: string; email: string | null }) => {
      await menteeApp({ person: p.id, email: p.email, status: "withdrawn" });
    }],
    ["có hai đơn mentee mùa này (một theo hồ sơ, một theo email)", "application_ambiguous", async (p: { id: string; email: string | null }) => {
      await menteeApp({ person: p.id, email: "khac@example.test", status: "submitted" });
      await menteeApp({ email: p.email, status: "submitted" });
    }],
    ["đơn cùng email nhưng đã nối sang hồ sơ người khác", "application_other_person", async (p: { id: string; email: string | null }) => {
      await menteeApp({ person: ids.person, email: p.email, status: "submitted" });
    }],
    ["tư cách mentee mùa này đã rút", "membership_inactive", async (p: { id: string; email: string | null }) => {
      await membership(p.id, "withdrawn");
    }],
    ["tư cách mentee mùa này đang tạm dừng", "membership_inactive", async (p: { id: string; email: string | null }) => {
      await membership(p.id, "paused");
    }],
    ["có hai mentee profile", "profile_ambiguous", async (p: { id: string; email: string | null }) => {
      await profile(p.id);
      await profile(p.id);
    }]
  ])("không thêm được khi %s", (_label, code, arrange) =>
    isolated(async () => {
      const a = await person("Chan");
      await arrange(a);
      expect(await blocker(a.id)).toBe(code);
      expect(codes(await add([a.id]))).toEqual({ [a.id]: code });
      expect(await exemption(a.id)).toBeUndefined();
    }));

  it("không thêm được người thiếu email hoặc thiếu tên; hai hồ sơ trùng email thì để BTC xem", () =>
    isolated(async () => {
      const noEmail = await person("Khong Email", null);
      const blankEmail = await person("Email Trong", "   ");
      const first = await person("Trung Mot", "trung@example.test");
      const second = await person("Trung Hai", " TRUNG@example.test ");
      expect(codes(await add([noEmail.id, blankEmail.id, first.id, second.id]))).toEqual({
        [noEmail.id]: "no_email", [blankEmail.id]: "no_email", [first.id]: "email_ambiguous", [second.id]: "email_ambiguous"
      });
    }));

  it("đơn và tư cách của MÙA KHÁC hay VAI KHÁC không cản", () =>
    isolated(async () => {
      const a = await person("Mua Khac");
      await menteeApp({ person: a.id, email: a.email, status: "rejected_or_not_fit", season: OTHER_SEASON });
      await menteeApp({ email: "mentor-khac@example.test", person: a.id, status: "rejected_or_not_fit", role: "mentor" });
      await membership(a.id, "withdrawn", { season: OTHER_SEASON });
      await membership(a.id, "cancelled", { role: "interviewer" });
      expect(await blocker(a.id)).toBeNull();
      expect(codes(await add([a.id]))).toEqual({ [a.id]: "added" });
    }));

  it("danh sách rỗng hoặc quá dài bị từ chối cả lượt", () =>
    isolated(async () => {
      await db.exec("savepoint sp");
      await expect(add([])).rejects.toThrow(/PEOPLE_REQUIRED/);
      await db.exec("rollback to savepoint sp");
      await db.exec("savepoint sp");
      await expect(add(Array.from({ length: 201 }, (_, i) => uuid(900000 + i)))).rejects.toThrow(/TOO_MANY_PEOPLE/);
      await db.exec("rollback to savepoint sp");
    }));
});

describe("BTC gỡ người khỏi danh sách", () => {
  it("gỡ được người chưa xác nhận; link của họ ngừng dùng được; gỡ lần hai không đổi gì", () =>
    isolated(async () => {
      const a = await person("Go A");
      await add([a.id]);
      const row = await exemption(a.id);

      expect(await revoke(row.id)).toEqual({ ok: true });
      const revoked = await exemption(a.id);
      expect(revoked.revoked_at).not.toBeNull();
      expect(revoked.revoked_by).toBe(ids.btc);
      expect(await confirm(row.token)).toEqual({ ok: false, code: "revoked" });
      expect(await apps(a.id, a.email)).toEqual([]);

      // Người vận hành KHÁC gỡ lại lần hai: dấu gỡ ban đầu (ai gỡ) phải còn nguyên. So tên người
      // gỡ chứ không so mốc giờ — trong một giao dịch now() không đổi nên mốc giờ luôn trùng.
      await asOwner(async () => {
        await db.query("insert into admin_users values ($1, $1, 'btc2@example.test', 'BTC 2', 'active', 'core_team')", [OTHER_BTC]);
        await db.query("insert into admin_scope_access values ($1, 'active', $2, 'operations')", [OTHER_BTC, ids.season]);
      });
      expect(await revoke(row.id, OTHER_BTC)).toEqual({ ok: true });
      expect((await exemption(a.id)).revoked_by).toBe(ids.btc);
    }));

  it("thêm lại người đã gỡ: cùng một link, không tạo dòng mới", () =>
    isolated(async () => {
      const a = await person("Go B");
      await add([a.id]);
      const row = await exemption(a.id);
      await revoke(row.id);

      expect(codes(await add([a.id]))).toEqual({ [a.id]: "restored" });
      const restored = await exemption(a.id);
      expect(restored).toMatchObject({ id: row.id, token: row.token, revoked_at: null, revoked_by: null });
      expect((await confirm(row.token)).code).toBe("confirmed");
    }));

  it("người đã bị gỡ mà nay không còn hợp lệ thì không thêm lại được", () =>
    isolated(async () => {
      const a = await person("Go C");
      await add([a.id]);
      await revoke((await exemption(a.id)).id);
      await membership(a.id, "withdrawn");
      expect(codes(await add([a.id]))).toEqual({ [a.id]: "membership_inactive" });
      expect((await exemption(a.id)).revoked_at).not.toBeNull();
    }));

  it("không gỡ được người đã xác nhận; không gỡ được dòng của mùa khác; chỉ BTC vận hành mới gỡ được", () =>
    isolated(async () => {
      const a = await person("Go D");
      const b = await person("Go E");
      await add([a.id, b.id]);
      const rowA = await exemption(a.id);
      const rowB = await exemption(b.id);
      await confirm(rowA.token);

      for (const [call, error] of [
        [() => revoke(rowA.id), /ALREADY_CONFIRMED/],
        [() => revoke(rowB.id, ids.btc, OTHER_SEASON), /EXEMPTION_NOT_FOUND/],
        [() => revoke(rowB.id, ids.support), /ACCESS_DENIED/],
        [() => revoke(uuid(555555)), /EXEMPTION_NOT_FOUND/]
      ] as const) {
        await db.exec("savepoint sp");
        await expect(call()).rejects.toThrow(error);
        await db.exec("rollback to savepoint sp");
      }
      expect((await exemption(b.id)).revoked_at).toBeNull();
      expect((await exemption(a.id)).confirmed_at).not.toBeNull();
    }));
});

describe("người nhận bấm Xác nhận", () => {
  it("chỉ máy chủ VAM OS gọi được", () =>
    isolated(async () => {
      const a = await person("May Chu");
      await add([a.id]);
      const { token } = await exemption(a.id);
      await asOwner(async () => {
        await db.exec("update vam063_trusted_api_role_result set api_role = 'anon'");
      });
      await db.exec("savepoint sp");
      await expect(confirm(token)).rejects.toThrow(/Trusted server context required/);
      await db.exec("rollback to savepoint sp");
      expect((await exemption(a.id)).confirmed_at).toBeNull();
    }));

  it("link không tồn tại: báo sai link, không ghi gì", () =>
    isolated(async () => {
      const before = await footprint();
      expect(await confirm(uuid(123456))).toEqual({ ok: false, code: "invalid_token" });
      expect(await footprint()).toEqual(before);
    }));

  it("mentee mùa trước đã được gắn tư cách, CHƯA có đơn mùa này: tạo đúng một đơn đã duyệt ghi rõ nguồn đặc cách", () =>
    isolated(async () => {
      const a = await person("Mua Truoc", " Mua.Truoc@Example.test ");
      const memberId = await membership(a.id, "active");
      await profile(a.id);
      await add([a.id]);
      const row = await exemption(a.id);

      expect(await confirm(row.token)).toEqual({ ok: true, code: "confirmed" });

      const created = await apps(a.id, a.email);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        person_id: a.id, status: "approved_as_mentee", source: "s12_mentee_exemption", season_id: ids.season,
        role_applied: "mentee", email_primary: "Mua.Truoc@Example.test", consent_data_storage: true
      });
      expect(created[0].submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(created[0].raw_payload).toMatchObject({ source: "s12_mentee_exemption", exemption_reason: "support_team", exemption_id: row.id });
      // Không bịa câu trả lời: payload chỉ mang đúng bốn khoá nói về việc đặc cách.
      expect(Object.keys(created[0].raw_payload).sort()).toEqual(["exemption_confirmed_at", "exemption_id", "exemption_reason", "source"]);

      expect(await decisionsOf(created[0].id)).toEqual([{
        decided_by: null, decided_by_name: "Mentee tự xác nhận (đặc cách Support team)", decision: "approved_as_mentee",
        previous_status: null, new_status: "approved_as_mentee",
        decision_note: "Đặc cách Support team: không qua phỏng vấn. Mentee tự xác nhận tham gia qua link riêng."
      }]);
      // Tư cách và profile có sẵn giữ nguyên: không dòng thứ hai, không ghi log thừa.
      expect(await membershipsOf(a.id)).toEqual([{ id: memberId, season_id: ids.season, role: "mentee", status: "active", source: "manual" }]);
      expect(await membershipLog(a.id)).toEqual([]);
      expect(await profilesOf(a.id)).toBe(1);

      const after = await exemption(a.id);
      expect(after.confirmed_at).not.toBeNull();
      expect(after.application_id).toBe(created[0].id);
    }));

  it("đơn đã được BTC duyệt tay từ trước: không tạo đơn, không thêm quyết định, chỉ ghi nhận xác nhận", () =>
    isolated(async () => {
      const a = await person("Duyet Tay");
      const appId = await menteeApp({ person: a.id, email: a.email, status: "approved_as_mentee" });
      await membership(a.id, "active");
      await profile(a.id);
      await add([a.id]);
      const before = await footprint();

      expect((await confirm((await exemption(a.id)).token)).code).toBe("confirmed");

      expect(await footprint()).toEqual({ ...before, confirmed: before.confirmed + 1 });
      expect(await decisionsOf(appId)).toEqual([]);
      expect((await exemption(a.id)).application_id).toBe(appId);
    }));

  it("đơn đang chờ (chưa nối hồ sơ người), chưa có tư cách, chưa có profile: duyệt đơn đó và dựng đủ ba thứ", () =>
    isolated(async () => {
      const a = await person("Dang Cho PV");
      const appId = await menteeApp({ email: a.email, status: "interview_scheduled" });
      await add([a.id]);

      expect((await confirm((await exemption(a.id)).token)).code).toBe("confirmed");

      const rows = await apps(a.id, a.email);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: appId, person_id: a.id, status: "approved_as_mentee", source: "vam_os_form" });
      expect(await decisionsOf(appId)).toEqual([{
        decided_by: null, decided_by_name: "Mentee tự xác nhận (đặc cách Support team)", decision: "approved_as_mentee",
        previous_status: "interview_scheduled", new_status: "approved_as_mentee",
        decision_note: "Đặc cách Support team: không qua phỏng vấn. Mentee tự xác nhận tham gia qua link riêng."
      }]);
      const members = await membershipsOf(a.id);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ season_id: ids.season, role: "mentee", status: "active", source: "application" });
      expect(await membershipLog(a.id)).toEqual([{ old_status: null, new_status: "active", transition_type: "created", changed_by: null }]);
      expect(await profilesOf(a.id)).toBe(1);
      expect((await exemption(a.id)).application_id).toBe(appId);
    }));

  it("tư cách đang ở 'invited' thì được bật thành đang hoạt động, có ghi log", () =>
    isolated(async () => {
      const a = await person("Duoc Moi");
      const memberId = await membership(a.id, "invited");
      await add([a.id]);
      await confirm((await exemption(a.id)).token);
      expect(await membershipsOf(a.id)).toEqual([{ id: memberId, season_id: ids.season, role: "mentee", status: "active", source: "manual" }]);
      expect(await membershipLog(a.id)).toEqual([{ old_status: "invited", new_status: "active", transition_type: "status_change", changed_by: null }]);
    }));

  it("bấm lần hai: báo đã xác nhận, không thêm đơn, quyết định, tư cách hay log nào", () =>
    isolated(async () => {
      const a = await person("Bam Hai Lan");
      await add([a.id]);
      const { token } = await exemption(a.id);
      await confirm(token);
      const before = await footprint();

      expect(await confirm(token)).toEqual({ ok: true, code: "already_confirmed" });

      expect(await footprint()).toEqual(before);
    }));

  it("chỉ chạm đúng người bấm: người khác trong danh sách và đơn của người khác giữ nguyên", () =>
    isolated(async () => {
      const a = await person("Nguoi Bam");
      const b = await person("Nguoi Khac");
      const appB = await menteeApp({ email: b.email, status: "interview_scheduled" });
      await add([a.id, b.id]);

      await confirm((await exemption(a.id)).token);

      expect((await exemption(b.id)).confirmed_at).toBeNull();
      expect((await apps(b.id, b.email))[0]).toMatchObject({ id: appB, status: "interview_scheduled", person_id: null });
      expect(await membershipsOf(b.id)).toEqual([]);
      expect(await decisionsOf(appB)).toEqual([]);
    }));

  it.each([
    ["BTC vừa từ chối đơn", "application_closed", async (p: { id: string; email: string | null }, appId: string) => {
      await db.query("update applications set status = 'rejected_or_not_fit' where id = $1", [appId]);
    }],
    ["ứng viên vừa rút đơn", "application_closed", async (p: { id: string; email: string | null }, appId: string) => {
      await db.query("update applications set status = 'withdrawn' where id = $1", [appId]);
    }],
    ["tư cách mentee vừa bị rút", "membership_inactive", async (p: { id: string; email: string | null }) => {
      await membership(p.id, "withdrawn");
    }],
    ["xuất hiện đơn mentee thứ hai", "application_ambiguous", async (p: { id: string; email: string | null }) => {
      await menteeApp({ person: p.id, email: "them@example.test", status: "submitted" });
    }]
  ])("tình trạng đổi SAU khi được thêm (%s): bấm xác nhận không ghi gì, trả về cần BTC xem", (_label, reason, change) =>
    isolated(async () => {
      const a = await person("Doi Sau");
      const appId = await menteeApp({ email: a.email, status: "interview_scheduled" });
      await add([a.id]);
      await change(a, appId);
      const before = await footprint();

      expect(await confirm((await exemption(a.id)).token)).toEqual({ ok: false, code: "needs_btc", reason });

      expect(await footprint()).toEqual(before);
      expect((await exemption(a.id)).confirmed_at).toBeNull();
    }));

  it("đơn tạo ra chiếm đúng chỗ của người đó trong mùa: không thể có đơn mentee thứ hai cùng email", () =>
    isolated(async () => {
      const a = await person("Mot Don");
      await add([a.id]);
      await confirm((await exemption(a.id)).token);
      await db.exec("savepoint sp");
      await expect(menteeApp({ email: a.email, status: "submitted" })).rejects.toThrow(/applications_season_role_canonical_email_key/);
      await db.exec("rollback to savepoint sp");
    }));

  it("ngày nộp của đơn tạo ra là ngày Việt Nam, không phải ngày UTC", () =>
    isolated(async () => {
      const a = await person("Ngay VN");
      await add([a.id]);
      await confirm((await exemption(a.id)).token);
      const row = await one<{ submitted: string; vn: string }>(
        "select submitted_at::text as submitted, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as vn from applications where person_id = $1",
        [a.id]
      );
      expect(row.submitted).toBe(row.vn);
      // Phép so trên chỉ phân biệt được ngày VN với ngày UTC khi test chạy trong khoảng
      // 00:00–07:00 giờ Việt Nam. Ngoài khoảng đó hai ngày trùng nhau, nên ghim thêm chính
      // phép tính trong thân hàm: đổi sang ngày UTC (v_now::date) là đỏ ở mọi giờ.
      const src = (await one<{ src: string }>("select prosrc as src from pg_proc where proname = 'vam117_confirm_mentee_exemption'")).src;
      expect(src).toContain("(v_now at time zone 'Asia/Ho_Chi_Minh')::date");
      expect(src).not.toContain("v_now::date");
    }));
});
