/**
 * Migration mở cho support_team đúng bốn hàm ghi — khẳng định cấu trúc.
 *
 * Migration này không chép thân bốn hàm; nó đọc định nghĩa đang chạy trên
 * database và đổi một lời gọi. Vì vậy hai thứ phải ĐÚNG trước khi dán vào
 * production, và test ở đây đối chiếu cả hai với lịch sử migration trong repo:
 *
 * - Chữ ký của từng hàm (kiểu tham số) khớp với chữ ký hàm đang có. Sai một kiểu
 *   là `to_regprocedure` không tìm thấy hàm, và khối dò trước dừng lại.
 * - Bản mới nhất của từng hàm thật sự gọi `vam084_operator_for_season`. Không gọi
 *   thì khối đổi sẽ dừng giữa chừng trên production.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FILE = "20260911120000_support_team_recruitment_staffing.sql";
const raw = readFileSync(join(MIGRATIONS, FILE), "utf8");

/** SQL without `--` comments and without `comment on … is '…';` statements. */
const code = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/comment\s+on\s+[\s\S]*?;/gi, "");

function block(tag: string): string {
  const start = code.indexOf(tag);
  const end = code.lastIndexOf(tag);
  if (start < 0 || end <= start) throw new Error(`không thấy khối ${tag}`);
  return code.slice(start, end);
}

const EXPECTED_TARGETS = [
  "public.vam084_grant_recruitment_participation(uuid,uuid,uuid,text,uuid,text)",
  "public.vam084_revoke_recruitment_participation(uuid,uuid,uuid,text)",
  "public.vam094_assign_selected_application_reviews(uuid[],uuid,text,timestamptz,text,uuid)",
  "public.vam084_change_review_assignment(uuid,uuid,text,uuid)"
];

/** Every quoted function signature in one block, in order. */
function signaturesIn(text: string): string[] {
  return Array.from(text.matchAll(/'(public\.[a-z0-9_]+\([^']*\))'/g)).map((match) => match[1]);
}

const staffingFunction = (() => {
  const match = code.match(
    /create\s+or\s+replace\s+function\s+public\.vam084_staffing_operator_for_season\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/i
  );
  if (!match) throw new Error("không thấy thân vam084_staffing_operator_for_season");
  return match[1];
})();

// ── Lịch sử migration trong repo ────────────────────────────────────────────

const migrationFiles = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name !== FILE)
  .sort();

/** The latest migration that defines `name`, and that definition's text. */
function latestDefinition(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i");
  for (const file of migrationFiles) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    const at = text.search(head);
    if (at < 0) continue;
    const rest = text.slice(at + 10);
    const next = rest.search(/\n\s*(create\s+or\s+replace\s+function|revoke\s|grant\s)/i);
    found = { file, body: text.slice(at, next < 0 ? undefined : at + 10 + next) };
  }
  if (!found) throw new Error(`không migration nào định nghĩa ${name}`);
  return found;
}

/** `grant execute on function public.name(<args>) to service_role` → normalised arg types. */
function grantedSignature(file: string, name: string): string {
  const text = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = text.match(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)\\s+to\\s+service_role`, "i"));
  if (!match) throw new Error(`${file} không grant ${name} cho service_role`);
  const types = match[1]
    .toLowerCase()
    .replace(/timestamp\s+with\s+time\s+zone/g, "timestamptz")
    .split(",")
    .map((arg) => arg.trim().split(/\s+/).pop() ?? "")
    .filter(Boolean);
  return `public.${name}(${types.join(",")})`;
}

describe("chữ ký và lời gọi khớp với database mà repo mô tả", () => {
  for (const signature of EXPECTED_TARGETS) {
    const name = signature.slice("public.".length, signature.indexOf("("));

    it(`${name}: chữ ký khớp bản mới nhất trong repo`, () => {
      const latest = latestDefinition(name);
      expect(grantedSignature(latest.file, name)).toBe(signature);
    });

    it(`${name}: bản mới nhất thật sự gọi vam084_operator_for_season`, () => {
      expect(latestDefinition(name).body).toContain("public.vam084_operator_for_season(");
    });
  }
});

describe("dò trước", () => {
  it("chạy trước mọi câu lệnh tạo hay đổi", () => {
    const preflightAt = code.indexOf("$preflight$");
    expect(preflightAt).toBeGreaterThanOrEqual(0);
    expect(code.search(/create\s+or\s+replace\s+function/i)).toBeGreaterThan(preflightAt);
    expect(code.indexOf("$swap$")).toBeGreaterThan(preflightAt);
  });

  it("dò đủ phép kiểm cũ và bốn hàm sẽ đổi", () => {
    expect(new Set(signaturesIn(block("$preflight$")))).toEqual(
      new Set(["public.vam084_operator_for_season(uuid,uuid)", ...EXPECTED_TARGETS])
    );
  });

  it("dò các cột mà phép kiểm mới đọc", () => {
    const preflight = block("$preflight$");
    for (const [table, column] of [
      ["admin_users", "id"], ["admin_users", "status"], ["admin_users", "role"], ["admin_users", "auth_user_id"],
      ["admin_scope_access", "user_id"], ["admin_scope_access", "status"],
      ["admin_scope_access", "season_id"], ["admin_scope_access", "role"]
    ]) {
      expect(preflight, `${table}.${column}`).toMatch(new RegExp(`\\(\\s*'${table}'\\s*,\\s*'${column}'\\s*\\)`));
    }
  });

  it("thiếu thì raise với mã tìm lại được", () => {
    expect(block("$preflight$")).toMatch(/raise\s+exception\s*'PREFLIGHT_MISSING_DEPENDENCY/i);
  });
});

describe("phép kiểm dùng chung KHÔNG bị đụng tới", () => {
  it("không định nghĩa lại vam084_operator_for_season", () => {
    expect(code).not.toMatch(/create\s+or\s+replace\s+function\s+public\.vam084_operator_for_season\b/i);
  });

  it("tự kiểm rằng nó vẫn không nhắc tới support_team", () => {
    expect(block("$self_check$")).toMatch(
      /position\(\s*'support_team'\s+in\s+pg_get_functiondef\(\s*'public\.vam084_operator_for_season\(uuid,uuid\)'::regprocedure\s*\)\s*\)\s*>\s*0/i
    );
  });
});

describe("phép kiểm mới chỉ thêm support_team, với đủ điều kiện", () => {
  it("dùng lại phép kiểm cũ cho ban điều hành, không viết lại điều kiện của nó", () => {
    expect(staffingFunction).toMatch(/public\.vam084_operator_for_season\(\s*p_actor\s*,\s*p_season_id\s*\)/);
  });

  it("vai trò duy nhất được thêm là support_team", () => {
    expect(staffingFunction).toMatch(/au\.role\s*=\s*'support_team'/);
    expect(staffingFunction).not.toMatch(/'(super_admin|admin|core_team|reviewer|viewer)'/);
  });

  it("chỉ gọi từ máy chủ", () => {
    expect(staffingFunction).toMatch(/current_user\s*=\s*'service_role'/);
  });

  it("tài khoản và phạm vi đều phải đang hoạt động", () => {
    expect(staffingFunction).toMatch(/au\.status\s*=\s*'active'/);
    expect(staffingFunction).toMatch(/asa\.status\s*=\s*'active'/);
  });

  it("quyền VẬN HÀNH trên ĐÚNG mùa — quyền đọc hay quyền chấm không đủ", () => {
    expect(staffingFunction).toMatch(/asa\.season_id\s*=\s*p_season_id::text/);
    expect(staffingFunction).toMatch(/asa\.role\s+in\s*\(\s*'operations'\s*,\s*'full_access'\s*\)/);
    expect(staffingFunction).not.toMatch(/'review'|'read'/);
  });

  it("thu hồi khỏi public, anon, authenticated; chỉ service_role gọi được", () => {
    expect(code).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.vam084_staffing_operator_for_season\(uuid,\s*uuid\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i
    );
    expect(code).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.vam084_staffing_operator_for_season\(uuid,\s*uuid\)\s+to\s+service_role\s*;/i
    );
    const grants = code.match(/^\s*grant\s[^;]*;/gim) ?? [];
    expect(grants).toHaveLength(1);
  });
});

describe("đổi phép kiểm trong đúng bốn hàm", () => {
  it("danh sách hàm sẽ đổi đúng bốn hàm của hai việc, không hơn", () => {
    expect(signaturesIn(block("$swap$"))).toEqual(EXPECTED_TARGETS);
  });

  it("tự kiểm soi đúng bốn hàm đó", () => {
    const checked = signaturesIn(block("$self_check$")).filter((sig) => EXPECTED_TARGETS.includes(sig));
    expect(new Set(checked)).toEqual(new Set(EXPECTED_TARGETS));
  });

  it("đọc định nghĩa đang chạy trên database, không chép tay", () => {
    const swap = block("$swap$");
    expect(swap).toMatch(/pg_get_functiondef\(\s*target::regprocedure\s*\)/);
    expect(swap).toMatch(/execute\s+replace\(\s*definition\s*,\s*old_call\s*,\s*new_call\s*\)/);
  });

  it("đổi đúng lời gọi, có tiền tố schema", () => {
    const swap = block("$swap$");
    expect(swap).toMatch(/old_call\s+constant\s+text\s*:=\s*'public\.vam084_operator_for_season\('/);
    expect(swap).toMatch(/new_call\s+constant\s+text\s*:=\s*'public\.vam084_staffing_operator_for_season\('/);
  });

  it("chạy lại được: hàm đã đổi thì bỏ qua, hàm lạ thì dừng", () => {
    const swap = block("$swap$");
    expect(swap).toMatch(/if\s+position\(\s*old_call\s+in\s+definition\s*\)\s*>\s*0\s+then/i);
    expect(swap).toMatch(/elsif\s+position\(\s*new_call\s+in\s+definition\s*\)\s*=\s*0\s+then\s+raise\s+exception/i);
  });

  it("phép kiểm mới được tạo TRƯỚC khi bốn hàm chuyển sang gọi nó", () => {
    expect(code.search(/create\s+or\s+replace\s+function\s+public\.vam084_staffing_operator_for_season/i)).toBeLessThan(
      code.indexOf("$swap$")
    );
  });
});

describe("tự kiểm", () => {
  it("không còn lời gọi cũ, đã có lời gọi mới", () => {
    const selfCheck = block("$self_check$");
    expect(selfCheck).toMatch(/position\(\s*'public\.vam084_operator_for_season\('\s+in\s+definition\s*\)\s*>\s*0/);
    expect(selfCheck).toMatch(/position\(\s*'public\.vam084_staffing_operator_for_season\('\s+in\s+definition\s*\)\s*=\s*0/);
  });

  it("dựng lại hàm không làm rơi quyền: trình duyệt không gọi được, máy chủ gọi được", () => {
    const selfCheck = block("$self_check$");
    expect(selfCheck).toMatch(/has_function_privilege\(\s*'anon'\s*,\s*target\s*,\s*'execute'\s*\)/);
    expect(selfCheck).toMatch(/has_function_privilege\(\s*'authenticated'\s*,\s*target\s*,\s*'execute'\s*\)/);
    expect(selfCheck).toMatch(/not\s+has_function_privilege\(\s*'service_role'\s*,\s*target\s*,\s*'execute'\s*\)/);
  });

  it("mọi lời raise đều mang mã", () => {
    const raises = Array.from(code.matchAll(/raise\s+exception\s*'([^']*)'/gi)).map((match) => match[1]);
    expect(raises.length).toBeGreaterThanOrEqual(8);
    for (const message of raises) {
      expect(message, message).toMatch(/^(SCHEMA_CONTRACT_VIOLATION|PREFLIGHT_MISSING_DEPENDENCY):/);
    }
  });
});

describe("tên file theo quy ước hiện hành", () => {
  it("nằm trong supabase/migrations với dấu thời gian", () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("chạy sau mọi migration định nghĩa bốn hàm nó sửa", () => {
    // Điều cần giữ là: không migration nào SAU nó định nghĩa lại một trong bốn
    // hàm — làm vậy là đưa lời gọi cũ trở lại, và support_team mất quyền mà
    // không ai biết. Bản cũ của ca này đòi migration này mới nhất trong cả thư
    // mục, nên đỏ với mọi migration thêm sau dù không đụng tới bốn hàm ấy.
    for (const signature of EXPECTED_TARGETS) {
      const name = signature.slice("public.".length, signature.indexOf("("));
      expect(latestDefinition(name).file < FILE, name).toBe(true);
    }
  });
});
