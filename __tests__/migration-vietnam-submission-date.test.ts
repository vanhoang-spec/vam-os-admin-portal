/**
 * Migration ngày nộp theo lịch Việt Nam — khẳng định cấu trúc.
 *
 * Dán tay vào Supabase. Hai việc nguy hiểm nếu viết sai: vá một hàm SECURITY DEFINER
 * công khai (chép lại cả hàm là ghi đè lặng lẽ mọi khác biệt với bản đang chạy), và
 * UPDATE hàng loạt dữ liệu đơn (chạm nhầm đơn S11 nhập tay là đổi ngày của 888 người).
 * Canh: vá đúng một dòng và tự chứng minh điều đó; chỉ chỉnh đơn mang đúng dấu vết lỗi.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LF = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const raw = readFileSync("supabase/migrations/20260916190000_vietnam_submission_date.sql", "utf8");
const code = raw
  .split(LF)
  .map((line) => line.replace(/--.*$/, ""))
  .join(LF);
const block = (tag: string) => code.slice(code.indexOf(`do $${tag}$`), code.lastIndexOf(`$${tag}$`));

describe("1. vá hàm gia hạn mentor", () => {
  const patch = block("patch_renewal");

  it("nhắm đúng chữ ký hàm, và dừng nếu cột không còn là DATE", () => {
    expect(patch).toContain("'public.vam071_submit_renewal_accepted(text, jsonb, boolean)'::regprocedure");
    expect(block("preflight")).toContain("column_name = 'submitted_at' and data_type = 'date'");
  });

  it("đọc định nghĩa đang chạy và thay đúng một dòng — không chép lại cả hàm", () => {
    expect(patch).toContain("pg_get_functiondef(p.oid)");
    expect(patch).toContain("v_new_def := replace(v_def, v_old_tail, v_new_tail);");
    expect(patch).toContain("execute v_new_def;");
    expect(code).not.toMatch(/create\s+or\s+replace\s+function/i);
  });

  it("chuỗi cũ khớp đúng bản đã đọc trên Production ngày 16/09/2026, chuỗi mới ghi ngày Việt Nam", () => {
    expect(patch).toContain(
      "v_old_tail constant text := '    v_now' || chr(10) || '  )' || chr(10) || '  returning id into v_app_id;';"
    );
    expect(patch).toContain(
      "v_new_tail constant text := '    (v_now at time zone ''Asia/Ho_Chi_Minh'')::date' || chr(10) || '  )' || chr(10) || '  returning id into v_app_id;';"
    );
  });

  it("khớp khác đúng một lần thì dừng; đảo phép thay phải ra đúng md5 bản cũ", () => {
    expect(patch).toContain("if v_matches <> 1 then");
    expect(patch).toContain("if md5(replace(v_new_def, v_new_tail, v_old_tail)) <> md5(v_def) then");
    expect(patch.indexOf("md5(")).toBeLessThan(patch.indexOf("execute v_new_def;"));
  });

  it("so quyền thực thi, SECURITY DEFINER và search_path trước/sau", () => {
    for (const column of ["p.proacl", "p.prosecdef", "p.proconfig"]) {
      expect(patch.split(column).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it("chạy lại vô hại: hàm đã vá thì bỏ qua", () => {
    const skip = patch.indexOf("if position(v_new_tail in v_def) > 0 then");
    expect(skip).toBeGreaterThan(-1);
    expect(patch.slice(skip, skip + 200)).toContain("return;");
    expect(skip).toBeLessThan(patch.indexOf("execute v_new_def;"));
  });
});

describe("2. chỉnh dữ liệu", () => {
  const fix = block("fix_rows");
  const update = fix.slice(fix.indexOf("update public.applications"), fix.indexOf("get diagnostics"));

  it("chỉ hai nguồn đã ghi sai, mang dấu vết ngày UTC, và khác ngày Việt Nam", () => {
    expect(update).toContain("set submitted_at = (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date");
    expect(update).toContain("where a.source in ('vam_os_form', 's12_mentor_renewal')");
    expect(update).toContain("and a.submitted_at = (a.created_at at time zone 'UTC')::date");
    expect(update).toContain("and a.submitted_at <> (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date;");
  });

  it("không chạm đơn nhập tay, không chạm cột nào khác", () => {
    expect(update).not.toContain("manual");
    expect(update).not.toMatch(/updated_at|status|full_name|email/);
    expect(code.match(/update\s+public[.]/gi)).toHaveLength(1);
  });

  it("số dòng chỉnh phải bằng số dòng đếm được trước đó", () => {
    expect(fix).toContain("get diagnostics v_fixed = row_count;");
    expect(fix).toContain("if v_fixed <> v_before then");
  });
});

describe("3. tự kiểm và hình thức", () => {
  const check = block("self_check");

  it("không còn đơn mang dấu vết lỗi, và hàm đã ghi ngày Việt Nam", () => {
    expect(check).toContain("raise exception 'DATA_CONTRACT_VIOLATION: còn % đơn ghi ngày UTC'");
    expect(check).toContain("'(v_now at time zone ''Asia/Ho_Chi_Minh'')::date'");
  });

  it("một transaction, có lock_timeout", () => {
    expect(code.trim().startsWith("begin;")).toBe(true);
    expect(code.trim().endsWith("commit;")).toBe(true);
    expect(code).toContain("set local lock_timeout = '10s';");
  });

  it("không có dấu gạch chéo ngược nào (heredoc trên máy này nuốt nó)", () => {
    expect(raw.includes(BACKSLASH)).toBe(false);
  });
});
