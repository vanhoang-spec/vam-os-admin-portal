/**
 * Cổng quyền bên trong một hàm SECURITY DEFINER.
 *
 * 18/09/2026: `vam084_clear_stale_recruitment_auth_link` (migration 20260918100000)
 * là SECURITY DEFINER — bắt buộc, vì service_role không đọc được `auth.users` — nhưng
 * bên trong nó gọi `vam084_staffing_operator_for_season`, mà phép kiểm đó đòi
 * `current_user = 'service_role'`. Trong hàm definer thuộc sở hữu postgres,
 * `current_user` là postgres, nên phép kiểm LUÔN sai và hàm luôn raise.
 *
 * Trên Production: người bấm "Cấp quyền đánh giá" vẫn gặp lỗi cũ, nhật ký có 0 dòng
 * 'clear_stale_auth_link', liên kết chết vẫn còn. Đo read-only cùng ngày cho thấy cả
 * ba phép kiểm (`staffing_operator`, `operator_for_season`) đều trả về false khi phiên
 * không phải service_role — kể cả với tài khoản core_team.
 *
 * Bốn cổng không bắt được: không cổng nào chạy Postgres thật. Nên phép canh ở đây là
 * một luật đọc được từ mã nguồn: hàm SECURITY DEFINER không được dựa vào phép kiểm
 * phụ thuộc `current_user`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LF = String.fromCharCode(10);
const MIGRATION_DIR = "supabase/migrations";
const FIX = join(MIGRATION_DIR, "20260918190000_fix_stale_auth_link_gate.sql");
const sql = readFileSync(FIX, "utf8");
const sqlCode = sql
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);

/** Thân từng hàm khai trong một file migration, cắt theo mốc create-or-replace. */
function functionBodies(text: string): Array<{ header: string; body: string }> {
  const marker = /create or replace function\s+public\.([a-z0-9_]+)/gi;
  const found: Array<{ header: string; body: string }> = [];
  const starts: Array<{ index: number; name: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) starts.push({ index: match.index, name: match[1] });
  starts.forEach((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : text.length;
    found.push({ header: start.name, body: text.slice(start.index, end) });
  });
  return found;
}

describe("1. bản vá", () => {
  it("kiểm ngữ cảnh gọi bằng claim của request, không bằng current_user", () => {
    expect(sqlCode).toContain("public.vam063_trusted_api_role()");
    expect(sqlCode).toContain("coalesce(v_api_role, '') <> 'service_role'");
    expect(sqlCode).toContain("raise exception 'Trusted server context required'");
  });

  it("không còn gọi phép kiểm phụ thuộc current_user", () => {
    expect(sqlCode).not.toContain("vam084_staffing_operator_for_season(");
    expect(sqlCode.match(/vam084_operator_for_season\(/g)).toBeNull();
  });

  it("giữ nguyên tập vai trò cũ: super admin, hoặc admin/core team/support team có quyền vận hành mùa", () => {
    const gate = sqlCode.slice(sqlCode.indexOf("if not exists ("), sqlCode.indexOf("raise exception 'Stale auth link clear rejected'"));
    expect(gate).toContain("au.status = 'active'");
    expect(gate).toContain("au.role = 'super_admin'");
    expect(gate).toContain("au.role in ('admin', 'core_team', 'support_team')");
    expect(gate).toContain("asa.season_id = p_season_id::text");
    expect(gate).toContain("asa.role in ('operations', 'full_access')");
    expect(gate).toContain("asa.status = 'active'");
  });

  it("vẫn chỉ gỡ liên kết đã chết, vẫn ghi nhật ký, vẫn chỉ service_role chạy được", () => {
    expect(sqlCode).toContain("if exists (select 1 from auth.users u where u.id = v_auth_user_id) then");
    expect(sqlCode).toContain("and auth_user_id = v_auth_user_id");
    expect(sqlCode).toContain("'operation', 'clear_stale_auth_link'");
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sqlCode).toContain(`vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) from ${role};`);
    }
    expect(sqlCode).toContain("security definer");
  });

  it("tự kiểm bắt được đúng lỗi đã xảy ra", () => {
    const check = sqlCode.slice(sqlCode.indexOf("do $self_check$"));
    expect(check).toContain("hàm vẫn gọi phép kiểm phụ thuộc current_user");
    expect(check).toContain("hàm chưa kiểm ngữ cảnh gọi bằng claim của request");
  });

  it("một transaction, có lock_timeout, không có dấu gạch chéo ngược", () => {
    expect(sqlCode.trim().startsWith("begin;")).toBe(true);
    expect(sqlCode.trim().endsWith("commit;")).toBe(true);
    expect(sqlCode).toContain("set local lock_timeout = '10s';");
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
  });
});

describe("2. luật chung cho mọi migration về sau", () => {
  const CURRENT_USER_PREDICATES = ["vam084_operator_for_season", "vam084_staffing_operator_for_season"];

  it("không hàm SECURITY DEFINER nào dựa vào phép kiểm phụ thuộc current_user", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(MIGRATION_DIR).filter((name) => name.endsWith(".sql"))) {
      const text = readFileSync(join(MIGRATION_DIR, file), "utf8");
      for (const fn of functionBodies(text)) {
        const body = fn.body.toLowerCase();
        if (!body.includes("security definer")) continue;
        for (const predicate of CURRENT_USER_PREDICATES) {
          if (body.includes(`${predicate}(`)) offenders.push(`${file}: ${fn.header} gọi ${predicate}`);
        }
      }
    }
    // File 20260918100000 là bản hỏng đã lên Production và được bản vá này thay thế;
    // nó ở lại như lịch sử, nên phép quét bỏ qua đúng một file đó.
    expect(offenders.filter((entry) => !entry.startsWith("20260918100000_"))).toEqual([]);
  });

  it("bản hỏng cũ vẫn nằm trong repo, để lịch sử đọc được", () => {
    const broken = readFileSync(join(MIGRATION_DIR, "20260918100000_reviewer_stale_auth_link.sql"), "utf8");
    expect(broken).toContain("vam084_staffing_operator_for_season(p_actor, p_season_id)");
    expect(broken).toContain("security definer");
  });
});
