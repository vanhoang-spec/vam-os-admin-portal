/**
 * Migration khoá API công khai — khẳng định cấu trúc.
 *
 * 16/09/2026: với khoá công khai lấy ngay trong mã trang web, vai trò `anon` đọc
 * được 27 bảng (có cả họ tên, email, SĐT, MSSV của người đăng ký sự kiện) và còn
 * ghi được. Nguyên nhân: bảng nằm trong schema `public` mà chưa bật RLS, trong
 * khi Supabase mặc định cấp quyền bảng cho `anon`.
 *
 * Bộ test này canh bốn cách bản vá trông như đã xong mà thật ra chưa, hoặc tệ hơn
 * là làm gãy sản phẩm:
 *   - vá theo danh sách tên bảng, nên bảng thêm sau vẫn hở;
 *   - quên đường vòng: view chạy bằng quyền chủ view đi qua mặt RLS;
 *   - thu hồi EXECUTE trên MỌI hàm — lần chạy đầu đã dừng ở đây: EXECUTE mặc
 *     định thuộc về PUBLIC, và gỡ nó khỏi các hàm của extension `citext` là làm
 *     gãy chính truy vấn của ứng dụng;
 *   - vá trúng luôn đường của ứng dụng (service_role, hoặc RPC app gọi bằng JWT).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LF = String.fromCharCode(10);
const raw = readFileSync("supabase/migrations/20260916090000_lock_down_public_api.sql", "utf8");
const code = raw
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);
const block = (tag: string) => code.slice(code.indexOf(`do $${tag}$`), code.lastIndexOf(`$${tag}$`));

describe("1. bật RLS cho mọi bảng", () => {
  const enable = block("enable_rls");

  it("quét động theo pg_class, không liệt kê tên bảng", () => {
    expect(enable).toContain("from pg_class c");
    expect(enable).toContain("and not c.relrowsecurity");
    expect(enable).toContain("execute format('alter table %s enable row level security', r.tbl)");
    for (const name of ["event_registrations", "staging_people_import", "mentoring_recaps"]) {
      expect(enable, name).not.toContain(name);
    }
  });

  it("chỉ bảng thường trong schema public", () => {
    expect(enable).toContain("ns.nspname = 'public'");
    expect(enable).toContain("c.relkind = 'r'");
  });
});

describe("2. quyền bảng của anon", () => {
  it("thu hồi bảng và sequence, cả hiện có lẫn tạo về sau", () => {
    for (const line of [
      "revoke all on all tables in schema public from anon;",
      "revoke all on all sequences in schema public from anon;",
      "alter default privileges in schema public revoke all on tables from anon;",
      "alter default privileges in schema public revoke all on sequences from anon;"
    ]) {
      expect(code).toContain(line);
    }
  });

  it("KHÔNG đụng tới service_role và authenticated — đó là đường của ứng dụng", () => {
    expect(code).not.toMatch(/revoke[^;]*from\s+service_role/i);
    expect(code).not.toMatch(/revoke[^;]*from\s+authenticated/i);
  });
});

describe("3. view không còn là đường vòng qua mặt RLS", () => {
  const views = block("views_invoker");

  it("chuyển mọi view public sang security_invoker, bỏ qua view đã chuyển", () => {
    expect(views).toContain("c.relkind = 'v'");
    expect(views).toContain("security_invoker=on");
    expect(views).toContain("execute format('alter view %s set (security_invoker = on)', r.v)");
  });
});

describe("4. hàm SECURITY DEFINER", () => {
  const fns = block("definer_functions");

  it("chỉ động vào hàm security definer CỦA MÌNH mà anon còn gọi được", () => {
    expect(fns).toContain("p.prosecdef");
    expect(fns).toContain("not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')");
    expect(fns).toContain("has_function_privilege('anon', p.oid, 'execute')");
  });

  it("không có lệnh thu hồi EXECUTE trên toàn bộ hàm — hàm citext phải giữ quyền của PUBLIC", () => {
    expect(code).not.toMatch(/revoke\s+all\s+on\s+all\s+(functions|routines)\s+in\s+schema\s+public/i);
    expect(code).not.toMatch(/alter\s+default\s+privileges[^;]*on\s+functions[^;]*from\s+public/i);
  });

  it("thu hồi của PUBLIC rồi cấp lại: service_role luôn, authenticated trừ hàm trigger", () => {
    expect(fns).toContain("execute format('revoke all on function %s from public', r.fn)");
    expect(fns).toContain("execute format('grant execute on function %s to service_role', r.fn)");
    expect(fns).toContain("if not r.is_trigger then");
    expect(fns).toContain("execute format('grant execute on function %s to authenticated', r.fn)");
  });
});

describe("5. tự kiểm", () => {
  const check = block("self_check");

  it("không còn bảng hở, không còn quyền bảng của anon, không còn view chạy bằng quyền chủ", () => {
    expect(check).toContain("not c.relrowsecurity");
    expect(check).toContain("has_table_privilege('anon', c.oid, 'select')");
    expect(check).toContain("has_table_privilege('anon', c.oid, 'insert')");
    expect(check).toContain("security_invoker=on");
    expect(check.match(/raise exception 'SECURITY_CONTRACT_VIOLATION/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("phép kiểm hàm chỉ soi hàm security definer của mình, không soi hàm extension", () => {
    const funcCheck = check.slice(check.indexOf("into v_anon_funcs"), check.indexOf("if cardinality(v_anon_funcs)"));
    expect(funcCheck).toContain("p.prosecdef");
    expect(funcCheck).toContain("deptype = 'e'");
  });

  it("canh luôn đường của ứng dụng: service_role đọc và gọi RPC được, authenticated gọi được hàm app cần", () => {
    expect(check).toContain("has_table_privilege('service_role', 'public.people', 'select')");
    expect(check).toContain("has_table_privilege('service_role', 'public.event_registrations', 'select')");
    expect(check).toContain("has_function_privilege('service_role', 'public.get_operations_dashboard_data(text)', 'execute')");
    expect(check).toContain("has_function_privilege('authenticated', 'public.get_operations_dashboard_data(text)', 'execute')");
    expect(check).toContain("has_function_privilege('authenticated', 'public.is_admin_role(text[])', 'execute')");
  });

  it("RPC đó thật sự được gọi bằng client theo cookie, không phải service role", () => {
    const data = readFileSync("lib/data.ts", "utf8");
    const at = data.indexOf("getOperationsDataFromRpc");
    expect(at).toBeGreaterThan(-1);
    const body = data.slice(at, at + 600);
    expect(body).toContain("getSupabaseServerClient()");
    expect(body).toContain('rpc("get_operations_dashboard_data"');
  });
});

describe("6. transaction", () => {
  it("một transaction, nạp lại schema, không đụng dòng dữ liệu nào", () => {
    expect(code).toMatch(/^begin;$/m);
    expect(code).toMatch(/^commit;\s*$/m);
    expect(code).toContain("notify pgrst, 'reload schema';");
    expect(code).not.toMatch(/insert +into|update +public[.]|delete +from|drop +table|truncate/i);
  });

  it("không có dấu gạch chéo ngược", () => {
    expect(raw.includes(String.fromCharCode(92))).toBe(false);
  });
});
