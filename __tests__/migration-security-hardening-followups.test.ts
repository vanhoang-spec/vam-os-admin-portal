/**
 * Migration dọn nốt cảnh báo Advisor — khẳng định cấu trúc.
 *
 * Hai việc nhỏ, nhưng cả hai đều dễ làm hỏng nhiều hơn là sửa:
 *   - ấn định `search_path` cho hàm: đặt sai giá trị là hàm không còn tra được
 *     kiểu `citext` của `people.email_primary`, và mọi phép tra email gãy;
 *   - thu hồi quyền hàm trigger: thu hồi luôn của `service_role` là chặn chính
 *     đường ghi của ứng dụng.
 *
 * Bộ test cũng khoá lại quyết định KHÔNG chuyển extension `citext` khỏi `public`:
 * đó là lựa chọn có lý do, không phải chuyện bỏ sót.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LF = String.fromCharCode(10);
const raw = readFileSync("supabase/migrations/20260916110000_security_hardening_followups.sql", "utf8");
const code = raw
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);
const block = (tag: string) => code.slice(code.indexOf(`do $${tag}$`), code.lastIndexOf(`$${tag}$`));

describe("1. ấn định search_path", () => {
  const set = block("set_search_path");

  it("quét động hàm của mình, bỏ qua hàm của extension và hàm đã đặt", () => {
    expect(set).toContain("ns.nspname = 'public'");
    expect(set).toContain("deptype = 'e'");
    expect(set).toContain("cfg like 'search_path=%'");
  });

  it("đặt đúng giá trị đang dùng trong database, có public ở đầu cho kiểu citext", () => {
    expect(set).toContain("execute format('alter function %s set search_path = public, pg_temp', r.fn)");
    expect(set).not.toContain("search_path = ''");
  });
});

describe("2. hàm trigger", () => {
  const grants = block("trigger_function_grants");

  it("chỉ hàm trigger của mình mà anon hoặc authenticated còn gọi được", () => {
    expect(grants).toContain("p.prorettype = 'pg_catalog.trigger'::regtype");
    expect(grants).toContain("deptype = 'e'");
    expect(grants).toContain("has_function_privilege('anon', p.oid, 'execute')");
    expect(grants).toContain("has_function_privilege('authenticated', p.oid, 'execute')");
  });

  it("thu hồi của public, anon, authenticated — nhưng cấp lại cho service_role", () => {
    expect(grants).toContain("execute format('revoke all on function %s from public', r.fn)");
    expect(grants).toContain("execute format('revoke all on function %s from authenticated', r.fn)");
    expect(grants).toContain("execute format('grant execute on function %s to service_role', r.fn)");
    expect(code).not.toMatch(/revoke[^;]*from\s+service_role/i);
  });
});

describe("3. cố ý KHÔNG chuyển extension citext", () => {
  it("không có lệnh alter extension nào", () => {
    expect(code).not.toMatch(/alter\s+extension/i);
  });

  it("lý do được ghi lại trong chính file, không để người sau tưởng là bỏ sót", () => {
    expect(raw).toContain("KHÔNG LÀM Ở ĐÂY: chuyển extension `citext` khỏi schema `public`");
    expect(raw).toContain("people.email_primary");
  });
});

describe("4. tự kiểm", () => {
  const check = block("self_check");

  it("không còn hàm thiếu search_path, không còn hàm trigger gọi thẳng được", () => {
    expect(check).toContain("còn hàm chưa ấn định search_path");
    expect(check).toContain("hàm trigger vẫn gọi thẳng được");
  });

  it("canh cả bản vá trước và đường của ứng dụng", () => {
    expect(check).toContain("có bảng public chưa bật RLS");
    expect(check).toContain("has_function_privilege('service_role', 'public.vam069_set_application_form_state(uuid,text,text,text,text)', 'execute')");
    expect(check).toContain("has_function_privilege('authenticated', 'public.get_operations_dashboard_data(text)', 'execute')");
  });

  it("thử một phép so sánh citext thật, để search_path mới không lặng lẽ làm hỏng tra email", () => {
    expect(check).toContain("udt_name = 'citext'");
    expect(check).toContain("perform 1 from public.people where email_primary = 'probe@example.invalid' limit 1;");
  });
});

describe("5. transaction", () => {
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
