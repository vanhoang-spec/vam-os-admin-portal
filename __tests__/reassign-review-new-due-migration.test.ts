/**
 * Migration 20260926140000 — hàm bọc đổi người chấm kèm hạn mới.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration. Hành vi đã chạy thử
 * trên production trong transaction cuộn lại (26/09/2026): không gửi hạn mới khi
 * hạn cũ đã qua → NEW_DUE_REQUIRED và bài cũ còn nguyên; hạn mới đã qua →
 * NEW_DUE_IN_PAST; hạn hợp lệ → bài cũ huỷ, bài mới đúng người, đúng hạn, sổ sự
 * kiện một dòng 'reassigned'.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILE = "20260926140000_reassign_review_new_due.sql";
const raw = readFileSync(join(__dirname, "..", "supabase", "migrations", FILE), "utf8");

/** SQL bỏ chú thích `--` và câu `comment on … is '…';` — để thứ tự khẳng định không khớp nhầm vào lời giải thích. */
const code = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/comment\s+on\s+[\s\S]*?;/gi, "");

const fnBody = (() => {
  const match = code.match(
    /create\s+or\s+replace\s+function\s+public\.vam103_reassign_review_with_due\s*\(([\s\S]*?)\)\s*returns\s+uuid([\s\S]*?)\$function\$([\s\S]*?)\$function\$/i
  );
  if (!match) throw new Error("không thấy vam103_reassign_review_with_due");
  return { args: match[1], header: match[2], body: match[3] };
})();

const SIG = "public.vam103_reassign_review_with_due(uuid, uuid, text, uuid, timestamptz)";

describe("hàm bọc, không định nghĩa lại hàm được bọc", () => {
  /**
   * Bản vam084_change_review_assignment trong repo cũ hơn bản production
   * (migration 20260911120000 đổi lời gọi kiểm quyền bằng cách đọc định nghĩa
   * đang chạy). Định nghĩa lại nó ở đây là đưa lời gọi cũ trở lại và Support
   * team mất quyền trả hồ sơ.
   */
  it("KHÔNG create or replace vam084_change_review_assignment", () => {
    expect(code).not.toMatch(/create\s+or\s+replace\s+function\s+public\.vam084_change_review_assignment/i);
  });

  it("gọi NGUYÊN vam084_change_review_assignment với đủ bốn tham số", () => {
    expect(fnBody.body).toMatch(
      /v_replacement\s*:=\s*public\.vam084_change_review_assignment\(\s*p_review_id\s*,\s*p_actor\s*,\s*p_reason\s*,\s*p_new_reviewer\s*\)/
    );
  });

  it("không tự ghi bài chấm mới hay sổ sự kiện — những việc đó của hàm được bọc", () => {
    expect(fnBody.body).not.toMatch(/insert\s+into/i);
    expect(fnBody.body).not.toMatch(/recruitment_assignment_events/i);
  });
});

describe("chữ ký và cách chạy", () => {
  it("năm tham số, hạn mới mặc định null", () => {
    expect(fnBody.args.replace(/\s+/g, " ").trim()).toBe(
      "p_review_id uuid, p_actor uuid, p_reason text, p_new_reviewer uuid, p_new_due_at timestamptz default null"
    );
  });

  it("security invoker — definer đổi current_user và hàm được bọc sẽ từ chối mọi lời gọi", () => {
    expect(fnBody.header).toMatch(/security\s+invoker/i);
    expect(fnBody.header).not.toMatch(/security\s+definer/i);
  });

  it("search_path rỗng", () => {
    expect(fnBody.header).toMatch(/set\s+search_path\s+to\s+''/i);
  });

  it("chỉ máy chủ gọi được, và chỉ để ĐỔI người (trả hồ sơ đi thẳng vam084)", () => {
    expect(fnBody.body).toMatch(/current_user\s*<>\s*'service_role'\s+or\s+p_new_reviewer\s+is\s+null/i);
  });
});

describe("luật hạn", () => {
  const body = fnBody.body;
  const callAt = body.search(/public\.vam084_change_review_assignment\(/);

  it("hạn mới đã qua bị chặn TRƯỚC khi đổi người", () => {
    const pastAt = body.search(/p_new_due_at\s*<=\s*now\(\)/);
    expect(pastAt).toBeGreaterThan(-1);
    expect(pastAt).toBeLessThan(callAt);
    expect(body).toMatch(/raise\s+exception\s+'NEW_DUE_IN_PAST'/i);
  });

  it("có hạn mới: ghi đúng hạn đó vào ĐÚNG bài chấm vừa tạo", () => {
    expect(body).toMatch(
      /update\s+public\.application_reviews\s+set\s+due_at\s*=\s*p_new_due_at[\s\S]*?where\s+id\s*=\s*v_replacement/i
    );
    expect(body).toMatch(/if\s+not\s+found\s+then\s+raise\s+exception/i);
  });

  it("không có hạn mới mà hạn chép sang đã qua: từ chối — cả lần đổi người cuộn lại", () => {
    expect(body).toMatch(/v_kept_due\s+is\s+not\s+null\s+and\s+v_kept_due\s*<\s*now\(\)[\s\S]*?raise\s+exception\s+'NEW_DUE_REQUIRED'/i);
  });
});

describe("quyền gọi", () => {
  it("thu hồi khỏi public, anon, authenticated; chỉ grant cho service_role", () => {
    expect(code).toContain(`revoke all on function ${SIG} from public;`);
    expect(code).toContain(`revoke all on function ${SIG} from anon, authenticated;`);
    expect(code).toContain(`grant execute on function ${SIG} to service_role;`);
    const grants = code.match(/^\s*grant\s[^;]*;/gim) ?? [];
    expect(grants).toHaveLength(1);
  });

  it("thu hồi đứng TRƯỚC grant", () => {
    expect(code.indexOf(`revoke all on function ${SIG} from anon`)).toBeLessThan(code.indexOf(`grant execute on function ${SIG}`));
  });
});

describe("bọc transaction, dò trước, tự kiểm", () => {
  it("begin … commit, và báo PostgREST nạp lại", () => {
    expect(code.trim().startsWith("begin;")).toBe(true);
    expect(code.trim().endsWith("commit;")).toBe(true);
    expect(code).toMatch(/notify\s+pgrst\s*,\s*'reload schema'/i);
  });

  it("dò hàm được bọc và kiểu cột due_at trước khi tạo", () => {
    const prereq = code.indexOf("$reassign_due_prereq$");
    expect(prereq).toBeGreaterThan(-1);
    expect(prereq).toBeLessThan(code.search(/create\s+or\s+replace\s+function/i));
    expect(code).toContain("to_regprocedure('public.vam084_change_review_assignment(uuid,uuid,text,uuid)') is null");
  });

  it("tự kiểm: invoker, search_path, đi qua hàm cũ, luật hạn, quyền, và hàm cũ còn nguyên phép kiểm Support team", () => {
    const start = code.indexOf("$reassign_due_self_check$");
    const check = code.slice(start, code.lastIndexOf("$reassign_due_self_check$"));
    expect(start).toBeGreaterThan(code.search(/grant\s+execute/i));
    expect(check).toMatch(/prosecdef/);
    expect(check).toMatch(/search_path=""/);
    expect(check).toContain("public.vam084_change_review_assignment(");
    expect(check).toContain("NEW_DUE_REQUIRED");
    expect(check).toMatch(/has_function_privilege\(\s*'anon'/);
    expect(check).toMatch(/has_function_privilege\(\s*'authenticated'/);
    expect(check).toMatch(/not\s+has_function_privilege\(\s*'service_role'/);
    expect(check).toContain("public.vam084_staffing_operator_for_season(");
  });

  it("không đụng dữ liệu: không insert/delete, update duy nhất là trong thân hàm", () => {
    const outside = code.replace(/\$function\$[\s\S]*?\$function\$/, "");
    expect(outside).not.toMatch(/\b(insert\s+into|delete\s+from|update\s+public\.)/i);
  });
});
