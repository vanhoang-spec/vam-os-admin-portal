/**
 * Đường ghi của /admin/users phải có mặt trên database.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO BỘ TEST NÀY TỒN TẠI
 * ---------------------------------------------------------------------------
 * 13/09/2026: tạo tài khoản nhân sự đầu tiên qua giao diện thất bại ngay bước
 * đầu. Truy ra thì production KHÔNG CÓ hàm vam062 nào — 10 hàm vam063, 13 hàm
 * vam084, và 0 hàm vam062. Cả module /admin/users chưa từng ghi được gì: Tạo,
 * Sửa, Kích hoạt, Gỡ quyền đều đi qua `vam062_admin_mutation_atomic`.
 *
 * Trang vẫn hiện danh sách vì đọc là truy vấn thường, nên nhìn bên ngoài không
 * có gì bất thường. Cả bốn cổng cũng xanh — mã gọi đúng tên hàm, chỉ là hàm
 * không tồn tại ở đầu kia. "Có trong repo" không có nghĩa là "có trên database".
 *
 * Bộ test này khoá hai điều: migration có mặt và mang đủ những gì mã gọi tới,
 * và nó không lặng lẽ kéo theo phần bật RLS của 062.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const MIGRATION = "supabase/migrations/20260913150000_admin_user_provisioning_rpcs.sql";
const sql = readFileSync(MIGRATION, "utf8");

/** Đúng những RPC mà lib/admin-users.ts gọi tới. */
const RPCS_USED_BY_ADMIN_USERS = [
  "vam062_begin_auth_operation",
  "vam062_record_auth_operation_stage",
  "vam062_admin_mutation_atomic",
  "vam062_record_auth_reconciliation"
];

describe("1. migration mang đủ những gì mã gọi tới", () => {
  it.each(RPCS_USED_BY_ADMIN_USERS)("tạo %s", (fn) => {
    expect(sql).toContain(`create or replace function public.${fn}`);
  });

  it("tạo cả hai helper nội bộ mà các hàm trên dựa vào", () => {
    expect(sql).toContain("create or replace function public.vam062_current_admin_id");
    expect(sql).toContain("create or replace function public.vam062_upsert_scope_atomic");
  });

  it("tạo hai bảng nhật ký mà các hàm ghi vào", () => {
    expect(sql).toContain("create table if not exists public.account_auth_operations");
    expect(sql).toContain("create table if not exists public.account_auth_reconciliation");
  });

  it("mọi RPC lib/admin-users.ts gọi đều nằm trong migration này", () => {
    // Quét chính mã nguồn: thêm một lời gọi vam062 mới mà quên thêm hàm vào
    // migration là đúng cái lỗi đã xảy ra, chỉ chậm hơn vài tháng.
    const source = readFileSync("lib/admin-users.ts", "utf8");
    const called = Array.from(source.matchAll(/rpc\(\s*"(vam062_[a-z_]+)"/g)).map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const fn of Array.from(new Set(called))) {
      expect(sql, `${fn} được gọi trong mã nhưng không có trong migration`).toContain(`function public.${fn}`);
    }
  });
});

describe("2. phép kiểm ngữ cảnh tin cậy đọc được cả ba nguồn", () => {
  it("không hàm nào chỉ đọc biến claim cũ", () => {
    // Bản 062 gốc chỉ đọc `request.jwt.claim.role`. Trên Supabase mới biến này
    // có thể rỗng, và khi ấy mọi lời gọi bị từ chối — hàm có mặt, quyền đủ, mà
    // vẫn không ghi được gì. Đúng lớp lỗi migration này sinh ra để sửa.
    const bodies = sql.slice(sql.indexOf("create or replace function"));
    expect(bodies).not.toContain("current_setting('request.jwt.claim.role'");
  });

  it("dùng vam063_trusted_api_role, và preflight đòi hàm đó có sẵn", () => {
    expect(sql).toContain("vam063_trusted_api_role");
    const preflight = sql.slice(sql.indexOf("$preflight$"), sql.indexOf("$preflight$;"));
    expect(preflight).toContain("vam063_trusted_api_role");
  });

  it("vẫn đòi đúng service_role, không nới lỏng", () => {
    expect(sql).toContain("<>'service_role'");
  });
});

describe("3. KHÔNG kéo theo phần RLS của 062", () => {
  it("không bật RLS lên bảng lõi nào", () => {
    // 062 bật RLS lên bảy bảng lõi. Bật RLS lên `people` nghĩa là mọi đường đọc
    // không dùng khoá service-role sẽ lặng lẽ trả về 0 dòng thay vì báo lỗi —
    // một quyết định riêng, phải rà từng màn hình, không đi kèm bản vá này.
    for (const table of [
      "public.people", "public.person_season_memberships", "public.admin_users",
      "public.admin_scope_access", "public.admin_audit_log", "public.intake_batches",
      "public.person_season_membership_log"
    ]) {
      expect(sql, `không được bật RLS lên ${table}`).not.toContain(`alter table ${table} enable row level security`);
    }
  });

  it("không tạo policy nào", () => {
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it("hai bảng mới thì CÓ bật RLS và chỉ service_role chạm được", () => {
    for (const table of ["account_auth_operations", "account_auth_reconciliation"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated, service_role`);
      expect(sql).toContain(`grant select, insert, update on public.${table} to service_role`);
    }
  });
});

describe("4. an toàn chung", () => {
  it("chạy lại được: bảng dùng if not exists, hàm dùng or replace", () => {
    expect(sql).not.toMatch(/create\s+table\s+public\./);
    expect(sql).not.toMatch(/create\s+function\s+public\./);
  });

  it("có preflight và tự kiểm", () => {
    expect(sql).toContain("PREFLIGHT_FAILED");
    expect(sql).toContain("SCHEMA_CONTRACT_VIOLATION");
  });

  it("không xoá dữ liệu", () => {
    expect(sql).not.toMatch(/delete\s+from|drop\s+table|truncate/i);
  });

  it("hai helper nội bộ không được cấp cho ai", () => {
    // Chúng ghi thẳng vào admin_users/admin_scope_access mà không tự kiểm quyền;
    // chỉ các hàm SECURITY DEFINER cùng chủ sở hữu được gọi.
    expect(sql).toContain("revoke all on function public.vam062_current_admin_id() from public, anon, authenticated, service_role");
    expect(sql).toContain("revoke all on function public.vam062_upsert_scope_atomic(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/grant execute on function public\.vam062_(current_admin_id|upsert_scope_atomic)/);
  });
});
