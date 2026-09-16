/**
 * Migration điểm cộng theo ngày nộp — khẳng định cấu trúc.
 *
 * Dán tay vào Supabase trước khi merge. Nó phải khớp mã: trần điểm và độ dài tên của
 * database không được hẹp hơn màn hình (không thì lưu báo lỗi chung chung), bảng phải
 * khoá khỏi anon, và loại nhật ký mà mã ghi phải được ràng buộc nhận — thiếu cái cuối
 * thì mỗi lần đặt mốc vẫn báo thành công còn nhật ký mất lặng lẽ.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BONUS_LABEL_MAX, BONUS_POINTS_MAX, BONUS_POINTS_MIN } from "@/lib/submission-bonus-core";

const LF = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const raw = readFileSync("supabase/migrations/20260916170000_submission_bonus_rules.sql", "utf8");
const code = raw
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);
const block = (tag: string) => code.slice(code.indexOf(`do $${tag}$`), code.lastIndexOf(`$${tag}$`));

describe("1. bảng", () => {
  it("gắn theo đợt tuyển + vai trò, có người đặt", () => {
    expect(code).toContain("create table if not exists public.submission_bonus_rules");
    expect(code).toContain("intake_batch_id uuid references public.intake_batches(id)");
    expect(code).toContain("created_by      uuid references public.admin_users(id)");
    expect(code).toContain(
      "check (form_kind <> 'application' or (intake_batch_id is not null and role_applied in ('mentor', 'mentee')))"
    );
  });

  it("ngày là DATE, không được trống cả hai đầu, đầu không sau cuối", () => {
    expect(code).toContain("starts_on       date,");
    expect(code).toContain("ends_on         date,");
    expect(code).toContain("check (starts_on is not null or ends_on is not null)");
    expect(code).toContain("check (starts_on is null or ends_on is null or starts_on <= ends_on)");
  });

  it("trần điểm và độ dài tên khớp đúng trần của màn hình", () => {
    expect(code).toContain(`check (points between ${BONUS_POINTS_MIN} and ${BONUS_POINTS_MAX})`);
    expect(code).toContain(`check (label is null or char_length(label) <= ${BONUS_LABEL_MAX})`);
  });

  it("form_kind là danh sách đóng — form sự kiện về sau là một giá trị cộng thêm", () => {
    expect(code).toContain("check (form_kind in ('application'))");
    const write = readFileSync("lib/submission-bonus-write.ts", "utf8");
    expect(write).toContain('form_kind: "application"');
  });

  it("không đụng một dòng đơn nào, không chép mốc nào vào", () => {
    expect(code).not.toMatch(/insert +into/i);
    expect(code).not.toMatch(/update +public[.]applications/i);
    expect(code).not.toMatch(/alter +table +public[.]applications/i);
  });
});

describe("2. khoá bảng", () => {
  it("RLS bật, không policy, thu hồi quyền của public / anon / authenticated", () => {
    expect(code).toContain("alter table public.submission_bonus_rules enable row level security;");
    for (const role of ["public", "anon", "authenticated"]) {
      expect(code).toContain(`revoke all on public.submission_bonus_rules from ${role};`);
    }
    expect(code).not.toMatch(/create +policy|grant +/i);
  });
});

describe("3. loại nhật ký", () => {
  const widen = block("audit_bonus_widen");

  it("loại mà mã ghi đúng là loại migration nới", () => {
    const write = readFileSync("lib/submission-bonus-write.ts", "utf8");
    expect(write).toContain('actionType: "update_submission_bonus_rules"');
    expect(widen).toContain("v_new constant text := 'update_submission_bonus_rules';");
  });

  it("cộng thêm, không viết đè: đọc định nghĩa đang chạy, không chép cứng giá trị cũ", () => {
    expect(widen).toContain("pg_get_constraintdef");
    expect(widen).toContain("position(quote_literal(v_new) in v_existing) > 0");
    expect(widen).not.toContain("'accept_registration_proof'");
    expect(widen).not.toMatch(/add\s+constraint\s+admin_audit_log_action_type_check\s+check\s*[(]/i);
  });

  it("so tập trước/sau: không mất giá trị cũ, và thêm đúng một", () => {
    expect(widen).toContain("đã MẤT giá trị cũ");
    expect(widen).toContain("v_expected is distinct from v_after_values");
    expect(widen).toContain("substring(v_existing from '[]][)]+$')");
  });
});

describe("4. tự kiểm và hình thức", () => {
  const check = block("self_check");

  it("tự kiểm RLS, đủ sáu ràng buộc, anon không đọc/ghi được, nhật ký nhận loại mới và còn loại cũ", () => {
    expect(check).toContain("relrowsecurity");
    for (const name of [
      "submission_bonus_rules_form_kind_check",
      "submission_bonus_rules_application_target_check",
      "submission_bonus_rules_window_check",
      "submission_bonus_rules_window_order_check",
      "submission_bonus_rules_points_check",
      "submission_bonus_rules_label_length_check"
    ]) {
      expect(check).toContain(`'${name}'`);
      expect(code).toContain(`constraint ${name}`);
    }
    expect(check).toContain("has_table_privilege('anon', 'public.submission_bonus_rules', 'select')");
    expect(check).toContain("has_table_privilege('anon', 'public.submission_bonus_rules', 'insert')");
    expect(check).toContain("quote_literal('update_submission_bonus_rules')");
    expect(check).toContain("'update_application_form_text'");
  });

  it("một transaction, có lock_timeout, nạp lại schema", () => {
    expect(code.trim().startsWith("begin;")).toBe(true);
    expect(code.trim().endsWith("commit;")).toBe(true);
    expect(code).toContain("set local lock_timeout = '10s';");
    expect(code).toContain("notify pgrst, 'reload schema';");
  });

  it("không có dấu gạch chéo ngược nào (heredoc trên máy này nuốt nó)", () => {
    expect(raw.includes(BACKSLASH)).toBe(false);
  });
});
