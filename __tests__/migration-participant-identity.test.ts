/**
 * Migration nền tảng danh tính — khẳng định cấu trúc, không chạy SQL.
 *
 * Bảng `account_person_auth_links` là thứ quyết định ai thấy dữ liệu của ai.
 * Những tính chất dưới đây là thứ một lần sửa vô ý sẽ phá mà không ai thấy —
 * cho tới khi có người mở ra và đọc hồ sơ của người khác.
 *
 * Bản đầu của migration này ALTER một bảng tưởng là có sẵn từ gói 062, và vỡ
 * trên production vì gói ấy chưa từng được chạy. Nhóm "dò trước" bên dưới tồn
 * tại vì lần đó: nó đọc chính mã `lib/participant-*.ts` và bắt migration phải
 * kiểm mọi bảng, mọi cột mà mã ấy chạm tới.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const MIGRATION = join(
  ROOT,
  "supabase",
  "migrations",
  "20260910260000_participant_identity.sql"
);

const raw = readFileSync(MIGRATION, "utf8");

/**
 * SQL đã bỏ mọi thứ chỉ là lời văn, để khẳng định chạm vào LỆNH.
 *
 * Bỏ hai thứ: chú thích `--`, và các câu `comment on … is '…'`. Câu thứ hai tuy
 * là SQL thật nhưng nó chỉ ghi tài liệu vào database. Để nó lại thì một tên
 * bảng nhắc trong lời giải thích sẽ bị đọc thành "migration này có đụng vào
 * bảng đó".
 */
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

const TABLE = /create\s+table\s+if\s+not\s+exists\s+public\.account_person_auth_links\s*\(([\s\S]*?)\n\);/i;

function tableBody(): string {
  const match = code.match(TABLE);
  if (!match) throw new Error("không thấy câu create table if not exists public.account_person_auth_links");
  return match[1];
}

/** Phần định nghĩa của một cột, trên đúng dòng của cột đó. */
function columnDef(name: string): string {
  const match = tableBody().match(new RegExp(`^\\s*${name}\\s+([^\\n]*)$`, "m"));
  if (!match) throw new Error(`bảng không có cột ${name}`);
  return match[1];
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mọi cặp bảng.cột mà mã `lib/participant-*.ts` chạm tới qua Supabase.
 *
 * Đọc từ mã chứ không chép tay, để danh sách không cũ đi khi mã đổi. Mỗi
 * `.from("bảng")` lấy tới `from(` kế tiếp hoặc dấu `;`, rồi gom cột trong
 * `.select("…")` và cột đầu tiên của các phép lọc.
 */
function columnsReadByParticipantCode(): Array<{ file: string; table: string; column: string }> {
  const libDir = join(ROOT, "lib");
  const files = readdirSync(libDir).filter(
    (name) => name.startsWith("participant-") && name.endsWith(".ts")
  );

  const found: Array<{ file: string; table: string; column: string }> = [];
  for (const file of files) {
    const source = readFileSync(join(libDir, file), "utf8");
    const chains = source.split(/(?=\.from\(")/);
    for (const chain of chains) {
      const head = chain.match(/^\.from\("([a-z_]+)"\)/);
      if (!head) continue;
      const table = head[1];
      const body = chain.split(";")[0];

      const columns = new Set<string>();
      for (const select of Array.from(body.matchAll(/\.select\("([^"]*)"\)/g))) {
        for (const column of select[1].split(",")) {
          const name = column.trim();
          if (name) columns.add(name);
        }
      }
      for (const filter of Array.from(body.matchAll(/\.(?:eq|neq|in|ilike|is|order|gt|gte|lt|lte)\("([a-z_]+)"/g))) {
        columns.add(filter[1]);
      }
      for (const column of Array.from(columns)) found.push({ file, table, column });
    }
  }
  return found;
}

describe("dò trước: thiếu gì thì báo một lần, trước khi tạo gì", () => {
  it("khối dò trước chạy TRƯỚC mọi câu lệnh ghi", () => {
    const preflightAt = code.indexOf("$preflight$");
    expect(preflightAt).toBeGreaterThanOrEqual(0);
    for (const statement of [/create\s+table/i, /create\s+index/i, /create\s+trigger/i, /^\s*grant\s/im, /^\s*revoke\s/im, /^\s*alter\s+table/im]) {
      const at = code.search(statement);
      expect(at, String(statement)).toBeGreaterThan(preflightAt);
    }
  });

  it("dò đủ mọi bảng.cột mà mã participant đọc tới", () => {
    const preflight = block("$preflight$");
    const read = columnsReadByParticipantCode().filter(
      // Bảng này do chính migration tạo ra, không phải thứ phải có sẵn.
      (entry) => entry.table !== "account_person_auth_links"
    );

    // Bộ đọc mã mà hỏng thì mọi khẳng định bên dưới xanh vô nghĩa.
    expect(read.some((entry) => entry.table === "people" && entry.column === "email_primary")).toBe(true);

    for (const { file, table, column } of read) {
      expect(preflight, `${file} đọc ${table}.${column}`).toMatch(
        new RegExp(`\\(\\s*'${escape(table)}'\\s*,\\s*'${escape(column)}'\\s*\\)`)
      );
    }
  });

  it("dò cả những thứ migration dựa vào: auth.users và hàm set_updated_at", () => {
    const preflight = block("$preflight$");
    expect(preflight).toMatch(/to_regclass\(\s*'auth\.users'\s*\)/i);
    expect(preflight).toMatch(/to_regprocedure\(\s*'public\.set_updated_at\(\)'\s*\)/i);
  });

  it("thiếu thì raise với mã tìm lại được, gom đủ danh sách", () => {
    const preflight = block("$preflight$");
    expect(preflight).toMatch(/string_agg/i);
    expect(preflight).toMatch(/raise\s+exception\s*'PREFLIGHT_MISSING_DEPENDENCY/i);
  });

  it("khối dò trước chỉ đọc", () => {
    const preflight = block("$preflight$");
    expect(preflight).not.toMatch(/\b(create|alter|drop|insert|update|delete|grant|revoke|truncate)\s/i);
  });
});

describe("bảng là một sổ danh tính", () => {
  it("tạo đúng một bảng, bằng if not exists", () => {
    tableBody();
    expect(code.match(/create\s+table/gi) ?? []).toHaveLength(1);
  });

  it("KHÔNG mang cột thành viên program_id / season_id / role", () => {
    // Câu hỏi "người này tham gia gì" đã có person_season_memberships trả lời.
    // Chép vào đây là có hai nguồn sự thật, và bản chép cũ đi ngay lần đổi mùa.
    expect(tableBody()).not.toMatch(/^\s*(program_id|season_id|role)\s/im);
  });

  it("KHÔNG ghi vào person_season_memberships", () => {
    const outsidePreflight = code.replace(block("$preflight$"), "");
    expect(outsidePreflight).not.toMatch(/person_season_memberships/i);
  });
});

describe("hai ràng buộc duy nhất", () => {
  it("auth_user_id bắt buộc và duy nhất", () => {
    expect(columnDef("auth_user_id")).toMatch(/\bnot\s+null\b/i);
    expect(columnDef("auth_user_id")).toMatch(/\bunique\b/i);
  });

  it("person_id bắt buộc và duy nhất", () => {
    expect(columnDef("person_id")).toMatch(/\bnot\s+null\b/i);
    expect(columnDef("person_id")).toMatch(/\bunique\b/i);
  });

  it("KHÔNG gỡ ràng buộc duy nhất nào", () => {
    expect(code).not.toMatch(/drop\s+constraint/i);
    expect(code).not.toMatch(/drop\s+index/i);
  });

  it("khối tự kiểm khẳng định cả hai ràng buộc", () => {
    const selfCheck = block("$self_check$");
    expect(selfCheck).toMatch(/contype\s*=\s*'u'/);
    expect(selfCheck).toMatch(/attname\s*=\s*'person_id'/);
    expect(selfCheck).toMatch(/attname\s*=\s*'auth_user_id'/);
  });
});

describe("khoá ngoại", () => {
  it("auth_user_id trỏ về auth.users và đi theo khi tài khoản bị xoá", () => {
    expect(columnDef("auth_user_id")).toMatch(
      /references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i
    );
  });

  it("person_id trỏ về people và KHÔNG xoá dây chuyền", () => {
    // Xoá tay một người đang có tài khoản phải dừng lại để ai đó quyết định.
    expect(columnDef("person_id")).toMatch(/references\s+public\.people\s*\(\s*id\s*\)/i);
    expect(columnDef("person_id")).not.toMatch(/on\s+delete/i);
  });

  it("created_by trỏ về admin_users", () => {
    expect(columnDef("created_by")).toMatch(
      /references\s+public\.admin_users\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i
    );
  });

  it("khối tự kiểm khẳng định khoá ngoại về auth.users", () => {
    const selfCheck = block("$self_check$");
    expect(selfCheck).toMatch(/confrelid\s*=\s*'auth\.users'::regclass/i);
    expect(selfCheck).toMatch(/confdeltype\s*=\s*'c'/i);
  });
});

describe("ghi lại mối nối từ đâu ra", () => {
  it("có đủ bốn cột truy vết", () => {
    for (const column of ["link_source", "invited_at", "activated_at", "created_by"]) {
      expect(() => columnDef(column), column).not.toThrow();
    }
  });

  it("link_source BẮT BUỘC — bảng mới, không có dòng cũ phải chừa chỗ", () => {
    expect(columnDef("link_source")).toMatch(/\bnot\s+null\b/i);
  });

  it("link_source có bảng từ vựng đóng", () => {
    expect(tableBody()).toMatch(
      /check\s*\(\s*link_source\s+in\s*\(\s*'self_register'\s*,\s*'invite'\s*,\s*'admin'\s*\)\s*\)/i
    );
  });

  it("status có bảng từ vựng đóng", () => {
    expect(columnDef("status")).toMatch(/\bnot\s+null\b/i);
    expect(tableBody()).toMatch(/check\s*\(\s*status\s+in\s*\(\s*'active'\s*,\s*'inactive'\s*\)\s*\)/i);
  });
});

describe("quyền", () => {
  it("bật RLS", () => {
    expect(code).toMatch(/alter\s+table\s+public\.account_person_auth_links\s+enable\s+row\s+level\s+security/i);
    expect(code).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("thu hồi khỏi public, anon, authenticated", () => {
    expect(code).toMatch(
      /revoke\s+all\s+on\s+public\.account_person_auth_links\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i
    );
  });

  it("thu hồi cả service_role, và TRƯỚC khi cấp", () => {
    // Quyền mặc định của Supabase đã cho service_role ALL. Chỉ grant chồng lên
    // thì DELETE vẫn còn nguyên.
    const revokeAt = code.search(/revoke\s+all\s+on\s+public\.account_person_auth_links\s+from\s+service_role\s*;/i);
    const grantAt = code.search(/^\s*grant\s/im);
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThan(revokeAt);
  });

  it("service_role đọc, thêm, sửa — KHÔNG xoá", () => {
    // Ngắt mối nối là đổi status. Xoá dòng là xoá dấu vết ai từng đăng nhập
    // được với tư cách ai.
    const grants = code.match(/^\s*grant\s[^;]*;/gim) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(
      /grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+public\.account_person_auth_links\s+to\s+service_role\s*;/i
    );
  });

  it("KHÔNG thêm policy nào", () => {
    expect(code).not.toMatch(/create\s+policy/i);
  });

  it("khối tự kiểm soi quyền thật trong database, không chỉ tin câu lệnh", () => {
    const selfCheck = block("$self_check$");
    expect(selfCheck).toMatch(/relrowsecurity/i);
    expect(selfCheck).toMatch(/role_table_grants/i);
    expect(selfCheck).toContain("'INSERT, SELECT, UPDATE'");
    expect(selfCheck).toMatch(/pg_policies/i);
  });
});

describe("updated_at", () => {
  it("có trigger dùng hàm set_updated_at sẵn có", () => {
    expect(code).toMatch(
      /create\s+trigger\s+account_person_auth_links_set_updated_at\s+before\s+update\s+on\s+public\.account_person_auth_links\s+for\s+each\s+row\s+execute\s+function\s+public\.set_updated_at\(\)/i
    );
  });

  it("khối tự kiểm khẳng định trigger có mặt", () => {
    expect(block("$self_check$")).toContain("account_person_auth_links_set_updated_at");
  });
});

describe("chỉ số tra email", () => {
  it("có chỉ số theo email đã chuẩn hoá", () => {
    expect(code).toMatch(/create\s+index\s+if\s+not\s+exists\s+people_email_primary_lower_idx/i);
    expect(code).toMatch(/lower\s*\(\s*btrim\s*\(\s*email_primary\s*\)\s*\)/i);
  });

  it("chỉ số bỏ qua các dòng thiếu email", () => {
    expect(code).toMatch(/where\s+coalesce\s*\(\s*btrim\s*\(\s*email_primary\s*\)/i);
  });
});

describe("tự kiểm phải chặn được migration nửa vời", () => {
  it("có khối tự kiểm và nó raise được", () => {
    expect(block("$self_check$")).toMatch(/raise\s+exception/i);
  });

  it("kiểm đủ mười cột, và bắt cả cột thừa", () => {
    // Cột thừa = bảng đã có sẵn với hình dạng khác, mà create table if not
    // exists thì bỏ qua im lặng.
    const selfCheck = block("$self_check$");
    for (const column of [
      "id", "auth_user_id", "person_id", "status", "link_source",
      "invited_at", "activated_at", "created_by", "created_at", "updated_at"
    ]) {
      expect(selfCheck, column).toContain(`'${column}'`);
    }
    expect(selfCheck).toMatch(/column_name\s+not\s+in\s*\(/i);
  });

  it("mọi lời raise đều mang mã để tìm lại được", () => {
    const raises = Array.from(code.matchAll(/raise\s+exception\s*'([^']*)'/gi)).map((match) => match[1]);
    expect(raises.length).toBeGreaterThanOrEqual(10);
    for (const message of raises) {
      expect(message, message).toMatch(/^(SCHEMA_CONTRACT_VIOLATION|PREFLIGHT_MISSING_DEPENDENCY):/);
    }
  });
});

describe("tên file theo quy ước hiện hành", () => {
  it("nằm trong supabase/migrations với dấu thời gian", () => {
    expect(MIGRATION).toMatch(/supabase[\\/]migrations[\\/]\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("KHÔNG mang số của thư mục cũ", () => {
    expect(MIGRATION).not.toMatch(/supabase_migrations/);
    expect(MIGRATION).not.toMatch(/[\\/]0\d\d_/);
  });
});
