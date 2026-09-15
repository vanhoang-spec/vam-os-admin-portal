/**
 * Migration chữ trên form nộp đơn — khẳng định cấu trúc.
 *
 * Dán tay vào Supabase trước khi merge. Nó phải khớp mã: khoá khối mà mã dùng phải
 * qua được CHECK, khối tuỳ chọn để trống phải lưu được, upsert phải có chỉ số duy
 * nhất để bám vào, và loại nhật ký mà mã ghi phải được ràng buộc nhận — thiếu cái
 * cuối thì mỗi lần lưu vẫn báo thành công còn nhật ký mất lặng lẽ.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPLICATION_FORM_TEXT_KEYS, FORM_TEXT_LINE_MAX, FORM_TEXT_RICH_MAX } from "@/lib/application-form-text-core";

const LF = String.fromCharCode(10);
const raw = readFileSync("supabase/migrations/20260915100000_application_form_texts.sql", "utf8");
const code = raw
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);
const block = (tag: string) => code.slice(code.indexOf(`do $${tag}$`), code.lastIndexOf(`$${tag}$`));

describe("1. bảng", () => {
  it("gắn theo đợt tuyển, có người sửa", () => {
    expect(code).toContain("create table if not exists public.application_form_texts");
    expect(code).toContain("intake_batch_id uuid not null references public.intake_batches(id)");
    expect(code).toContain("updated_by      uuid references public.admin_users(id)");
  });

  it("CHECK hình dạng khoá nhận mọi khoá mà mã dùng — và không chép cứng danh sách khoá", () => {
    expect(code).toContain("check (text_key ~ '^[a-z][a-z0-9_.]{2,79}$')");
    for (const key of APPLICATION_FORM_TEXT_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_.]{2,79}$/);
    expect(code).not.toContain("mentor.header.title");
  });

  it("khối tuỳ chọn để trống lưu được; trần độ dài database không thấp hơn trần màn hình", () => {
    expect(code).toContain("check (char_length(body) <= 20000)");
    expect(code).not.toMatch(/char_length[(]body[)] between 1/);
    expect(Math.max(FORM_TEXT_LINE_MAX, FORM_TEXT_RICH_MAX)).toBeLessThanOrEqual(20000);
  });

  it("chỉ số duy nhất đúng cặp cột mà lệnh upsert bám vào", () => {
    expect(code).toContain("create unique index if not exists application_form_texts_batch_key_key");
    expect(code).toContain("on public.application_form_texts (intake_batch_id, text_key)");
    const write = readFileSync("lib/application-form-text-write.ts", "utf8");
    expect(write).toContain('{ onConflict: "intake_batch_id,text_key" }');
  });

  it("không chép nội dung nào vào bảng", () => {
    expect(code).not.toMatch(/insert +into +public[.]application_form_texts/i);
  });
});

describe("2. khoá bảng", () => {
  it("RLS bật, không policy, thu hồi quyền của public / anon / authenticated", () => {
    expect(code).toContain("alter table public.application_form_texts enable row level security;");
    for (const role of ["public", "anon", "authenticated"]) {
      expect(code).toContain(`revoke all on public.application_form_texts from ${role};`);
    }
    expect(code).not.toMatch(/create +policy|grant +/i);
  });
});

describe("3. loại nhật ký", () => {
  const widen = block("audit_form_text_widen");

  it("loại mà mã ghi đúng là loại migration nới", () => {
    const write = readFileSync("lib/application-form-text-write.ts", "utf8");
    expect(write).toContain('actionType: "update_application_form_text"');
    expect(widen).toContain("v_new constant text := 'update_application_form_text';");
  });

  it("cộng thêm, không viết đè: đọc định nghĩa đang chạy, không chép cứng giá trị cũ", () => {
    expect(widen).toContain("pg_get_constraintdef");
    expect(widen).toContain("position(quote_literal(v_new) in v_existing) > 0");
    expect(widen).not.toContain("'accept_registration_proof'");
    expect(widen).not.toMatch(/add\s+constraint\s+admin_audit_log_action_type_check\s+check\s*[(]/i);
  });

  it("đuôi mảng tìm bằng mẫu một-hoặc-nhiều, không đếm cứng số dấu đóng ngoặc", () => {
    expect(widen).toContain("substring(v_existing from '[]][)]+$')");
    expect(widen).not.toContain("[)][)][)]");
  });

  it("so trước/sau ngay trong khối: không mất giá trị cũ, không thừa giá trị lạ, tập trước đọc đủ", () => {
    expect(widen).toContain("v_quotes <> cardinality(v_before_values) * 2");
    expect(widen).toContain("đã MẤT giá trị cũ");
    expect(widen).toContain("v_expected is distinct from v_after_values");
  });

  it("file không chứa dấu gạch chéo ngược nào — thứ đã từng mất lặng lẽ qua heredoc", () => {
    expect(raw.includes(String.fromCharCode(92))).toBe(false);
  });
});

describe("4. tự kiểm", () => {
  const check = block("self_check");

  it("canh RLS, chỉ số duy nhất, quyền đọc của anon / authenticated", () => {
    expect(check).toContain("relrowsecurity");
    expect(check).toContain("indisunique");
    expect(check).toContain("has_table_privilege('anon', 'public.application_form_texts', 'select')");
    expect(check).toContain("has_table_privilege('authenticated', 'public.application_form_texts', 'select')");
  });

  it("canh loại nhật ký mới lẫn các giá trị cũ", () => {
    expect(check).toContain("quote_literal('update_application_form_text')");
    for (const value of ["update_event", "set_application_form_state"]) expect(check).toContain(`'${value}'`);
    expect(check).toMatch(/raise exception 'SCHEMA_CONTRACT_VIOLATION/);
  });
});

describe("5. transaction", () => {
  it("một transaction, nạp lại schema, không đụng dòng dữ liệu nào", () => {
    expect(code).toMatch(/^begin;$/m);
    expect(code).toMatch(/^commit;\s*$/m);
    expect(code).toContain("notify pgrst, 'reload schema';");
    expect(code).not.toMatch(/update +public[.]|delete +from|drop +table|truncate/i);
  });
});
