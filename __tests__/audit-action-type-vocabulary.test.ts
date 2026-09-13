/**
 * Mọi action_type mà mã ghi vào admin_audit_log phải được ràng buộc CHECK nhận.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * 13/09/2026, truy vấn chỉ đọc trên production: bốn loại nhật ký của chuỗi sự
 * kiện — thêm buổi, xoá buổi, dời giờ buổi, gửi thư báo đổi lịch — có 0 dòng,
 * dù đã có buổi thật được thêm vào chuỗi. `admin_audit_log_action_type_check`
 * là một danh sách đóng; mã thêm bốn giá trị mới mà không migration nào nới
 * danh sách, nên mỗi lần ghi bị từ chối 23514. Hàm ghi nhật ký bắt lỗi rồi chỉ
 * log, nên thao tác vẫn báo thành công và không ai biết dấu vết đã mất.
 *
 * Lỗi ấy qua được cả bốn cổng: mã biên dịch sạch, test giả database không thi
 * hành CHECK, và màn hình không có chỗ nào đọc lại nhật ký của chuỗi.
 *
 * Bộ test này canh hai điều:
 *   1. Migration sửa lỗi nới đúng cách: cộng thêm, không viết đè, có tự kiểm.
 *   2. Mọi action_type trong mã đều có mặt trong một migration nới ràng buộc
 *      đã chạy — lần sau thêm một loại nhật ký mà quên migration thì đỏ ở đây,
 *      chứ không phải im lặng trên production.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260913230000_admin_audit_event_series_actions.sql";

const SERIES_ACTIONS = [
  "add_event_series_session",
  "remove_event_series_session",
  "update_event_session_time",
  "notify_event_schedule_change"
];

/**
 * Chuỗi template trong lệnh ghi audit: tiền tố → mọi hậu tố có thể có.
 * Gặp một template chưa khai ở đây thì test đỏ, không đoán.
 */
const TEMPLATE_EXPANSIONS: Record<string, string[]> = {
  approve_application_as_: ["mentee", "mentor"]
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** Mọi action_type mà mã ghi vào admin_audit_log, kèm file đầu tiên ghi nó. */
function codeActionTypes() {
  const files = [...sourceFiles("lib"), ...sourceFiles("app")];
  const values = new Map<string, string>();
  const unresolved: string[] = [];

  // Hằng số dạng `export const X = "giá_trị"`, để giải các lệnh ghi dùng tên hằng.
  const constants = new Map<string, string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of Array.from(src.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*"([a-z0-9_]+)"/g))) {
      constants.set(m[1], m[2]);
    }
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    // Qua các hàm ghi nhật ký: writeAdminAudit / writeAuditLog({ actionType: "..." })
    for (const m of Array.from(src.matchAll(/actionType:\s*"([a-z0-9_]+)"/g))) {
      if (!values.has(m[1])) values.set(m[1], file);
    }

    // Lệnh chèn thẳng vào bảng
    let at = src.indexOf('.from("admin_audit_log")');
    while (at >= 0) {
      const after = src.slice(at, at + 800);
      if (/^\.from\("admin_audit_log"\)\s*\.insert\(/.test(after)) {
        const keyAt = after.indexOf("action_type:");
        if (keyAt >= 0) {
          const end = after.indexOf("\n", keyAt);
          const line = after.slice(keyAt, end < 0 ? undefined : end);
          const literals = Array.from(line.matchAll(/"([a-z0-9_]+)"/g)).map((m) => m[1]);
          const template = line.match(/`([a-z0-9_]+)\$\{/);
          const constant = line.match(/action_type:\s*([A-Z][A-Z0-9_]*)\b/);
          const passThrough = /action_type:\s*input\.actionType\b/.test(line);

          for (const value of literals) if (!values.has(value)) values.set(value, file);
          if (template) {
            const suffixes = TEMPLATE_EXPANSIONS[template[1]];
            if (suffixes) for (const suffix of suffixes) values.set(template[1] + suffix, file);
            else unresolved.push(`${file}: template ${template[1]}\${…} chưa khai trong TEMPLATE_EXPANSIONS`);
          }
          if (constant) {
            const value = constants.get(constant[1]);
            if (value) values.set(value, file);
            else unresolved.push(`${file}: hằng ${constant[1]} không tìm thấy giá trị`);
          }
          if (!literals.length && !template && !constant && !passThrough) {
            unresolved.push(`${file}: không đọc được action_type — ${line.trim()}`);
          }
        }
      }
      at = src.indexOf('.from("admin_audit_log")', at + 1);
    }
  }

  return { values, unresolved };
}

/**
 * Các migration nới ràng buộc ĐÃ CHẠY. File `review_only` bị loại có chủ ý: có
 * trong repo chưa chắc có trên production, và một giá trị chỉ nằm trong file
 * chưa từng chạy thì trên production vẫn bị từ chối.
 */
function wideningMigrations() {
  const out: Array<{ name: string; sql: string }> = [];
  for (const dir of ["supabase/migrations", "supabase_migrations"]) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".sql") || name.includes("review_only")) continue;
      const sql = readFileSync(join(dir, name), "utf8");
      if (sql.includes("admin_audit_log_action_type_check")) out.push({ name, sql });
    }
  }
  return out;
}

describe("1. migration nới ràng buộc cho chuỗi sự kiện", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("nhận đủ bốn action_type của chuỗi sự kiện", () => {
    for (const value of SERIES_ACTIONS) {
      expect(sql, `migration thiếu '${value}'`).toContain(`'${value}'`);
    }
  });

  it("nới theo lối cộng thêm: đọc định nghĩa đang chạy rồi nối vào đuôi, không viết đè danh sách", () => {
    expect(sql).toContain("pg_get_constraintdef");
    expect(sql).toContain("regexp_replace");
    // Đuôi tìm bằng mẫu một-hoặc-nhiều, không đếm cứng số dấu đóng ngoặc.
    expect(sql).toContain("'(\\]\\)+)$'");
    expect(sql).not.toContain("\\]\\)\\)\\)$");
    expect(sql).not.toMatch(/add\s+constraint\s+admin_audit_log_action_type_check\s+check\s*\(/i);
  });

  it("chạy lại lần hai không nhân đôi: chỉ nối giá trị còn thiếu", () => {
    const widen = sql.slice(sql.indexOf("$audit_series_widen$"), sql.lastIndexOf("$audit_series_widen$"));
    expect(widen).toContain("position(quote_literal(v) in v_existing) = 0");
    expect(widen).toContain("cardinality(v_missing) = 0");
    expect(widen).toContain("unnest(v_missing)");
  });

  it("so trước/sau ngay trong khối nới: không mất giá trị cũ, không thừa giá trị lạ", () => {
    const widen = sql.slice(sql.indexOf("$audit_series_widen$"), sql.lastIndexOf("$audit_series_widen$"));
    expect(widen).toContain("v_before_values");
    expect(widen).toContain("v_after_values");
    expect(widen).toContain("đã MẤT giá trị cũ");
    expect(widen).toContain("v_expected is distinct from v_after_values");
    // Tập "trước" phải đọc đủ — kiểm bằng số dấu nháy — thì phép so mới có nghĩa.
    expect(widen).toContain("v_quotes <> cardinality(v_before_values) * 2");
  });

  it("khối tự kiểm cuối migration canh cả bốn giá trị mới lẫn giá trị cũ", () => {
    const check = sql.slice(sql.indexOf("$audit_series_self_check$"), sql.lastIndexOf("$audit_series_self_check$"));
    expect(check).toContain("SCHEMA_CONTRACT_VIOLATION");
    for (const value of SERIES_ACTIONS) expect(check).toContain(`'${value}'`);
    for (const value of ["create_event", "update_admin_user", "participant_account_invite"]) {
      expect(check).toContain(`'${value}'`);
    }
  });

  it("một transaction, không đụng tới dòng dữ liệu nào", () => {
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;\s*$/m);
    expect(sql).not.toMatch(/delete\s+from|drop\s+table|truncate|update\s+public\.admin_audit_log/i);
  });
});

describe("2. mọi action_type trong mã đều có migration nới ràng buộc", () => {
  const { values, unresolved } = codeActionTypes();
  const migrations = wideningMigrations();

  it("bộ quét tìm được giá trị thật — không xanh vô nghĩa", () => {
    expect(values.size).toBeGreaterThanOrEqual(30);
    for (const value of [
      ...SERIES_ACTIONS,
      "create_event",
      "update_admin_user",
      // qua hằng số
      "participant_account_invite",
      "send_application_confirmation_backfill",
      // qua chuỗi template
      "approve_application_as_mentor",
      // qua lệnh chèn thẳng
      "create_mentor_profile"
    ]) {
      expect(values.has(value), `bộ quét không thấy '${value}'`).toBe(true);
    }
  });

  it("không có lệnh ghi nhật ký nào bộ quét không đọc được", () => {
    expect(unresolved).toEqual([]);
  });

  it("chỉ tính migration đã chạy, không tính file review_only — và có migration sửa lỗi này", () => {
    const names = migrations.map((m) => m.name);
    expect(names.some((name) => name.includes("review_only"))).toBe(false);
    expect(names).toContain("20260913230000_admin_audit_event_series_actions.sql");
  });

  it("mọi action_type mà mã ghi đều có mặt trong một migration nới ràng buộc", () => {
    const union = migrations.map((m) => m.sql).join("\n");
    const missing = Array.from(values.entries())
      .filter(([value]) => !union.includes(`'${value}'`))
      .map(([value, file]) => `${value} (ghi ở ${file})`);
    expect(missing, "thêm action_type mới thì phải có migration nới admin_audit_log_action_type_check").toEqual([]);
  });
});
