/**
 * Migration lời mời tài khoản — khẳng định cấu trúc, không chạy SQL.
 *
 * Ba thứ một lần sửa vô ý sẽ phá mà không ai thấy cho tới lần gửi thật:
 *   * viết đè danh sách loại thư, làm mất một loại đang dùng;
 *   * index giữ chỗ phủ luôn `sent`, khiến không bao giờ gửi lại được;
 *   * dấu gạch chéo ngược trong regex bị nuốt, khiến phép nới không khớp gì.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTICIPANT_INVITE_AUDIT_ACTION, PARTICIPANT_INVITE_EMAIL_KIND } from "@/lib/participant-invite-core";

const ROOT = join(__dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FILE = "20260911140000_participant_account_invites.sql";
const raw = readFileSync(join(MIGRATIONS, FILE), "utf8");

/** SQL đã bỏ chú thích `--`, để khẳng định chạm vào LỆNH chứ không phải lời văn. */
const code = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function block(tag: string): string {
  const start = code.indexOf(tag);
  const end = code.lastIndexOf(tag);
  if (start < 0 || end <= start) throw new Error(`không thấy khối ${tag}`);
  return code.slice(start, end);
}

describe("tên và vỏ", () => {
  it("đúng quy ước tên, và chạy sau hai migration tạo ra thứ nó nới", () => {
    // Không đòi "mới nhất trong thư mục": điều đó sai ngay khi có migration sau.
    // Điều cần giữ là bảng thư và bảng mối nối phải có trước.
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    const present = readdirSync(MIGRATIONS);
    for (const dependency of ["20260909090000_outbound_emails.sql", "20260910260000_participant_identity.sql"]) {
      expect(present, dependency).toContain(dependency);
      expect(FILE > dependency, dependency).toBe(true);
    }
  });

  it("chạy trong một transaction", () => {
    expect(code).toMatch(/^\s*begin;/m);
    expect(code).toMatch(/^\s*commit;/m);
  });

  it("không bảng mới, không hàm mới, không policy, không quyền cho client", () => {
    expect(code).not.toMatch(/create\s+table/i);
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(code).not.toMatch(/create\s+policy/i);
    expect(code).not.toMatch(/grant\s+[\s\S]*?\s+to\s+(anon|authenticated|public)\b/i);
    expect(code).not.toMatch(/delete\s+from/i);
  });
});

describe("dò trước", () => {
  it("chạy trước mọi lệnh đổi cấu trúc, và chỉ đọc", () => {
    const preflightAt = code.indexOf("$preflight$");
    expect(preflightAt).toBeGreaterThan(-1);
    for (const statement of [/alter\s+table/i, /create\s+unique\s+index/i]) {
      expect(code.search(statement), String(statement)).toBeGreaterThan(preflightAt);
    }
    expect(block("$preflight$")).not.toMatch(/\b(create|alter|drop|insert|update|delete|grant|revoke)\s/i);
  });

  it("gom đủ danh sách thiếu vào một lần raise", () => {
    const preflight = block("$preflight$");
    expect(preflight).toMatch(/string_agg/);
    expect(preflight).toMatch(/raise\s+exception\s*'PREFLIGHT_MISSING_DEPENDENCY/i);
    expect(preflight).toContain("('account_person_auth_links', 'activated_at')");
    expect(preflight).toContain("('outbound_emails',           'related_id')");
  });
});

describe("nới loại thư", () => {
  const kind = () => block("$participant_invite_kind$");

  it("đọc rồi nối, không chép cứng danh sách", () => {
    expect(kind()).toMatch(/pg_get_constraintdef/);
    expect(kind()).toMatch(/regexp_replace/);
    expect(code).not.toMatch(/check\s*\(\s*kind\s+in\s*\(/i);
  });

  it("regex giữ nguyên dấu gạch chéo ngược", () => {
    expect(raw).toContain(String.raw`'\]\)\)\)$'`);
  });

  it("so lại: tập giá trị sau phải chứa trọn tập trước", () => {
    expect(kind()).toMatch(/after_vals\s*@>\s*before_vals/);
    expect(kind()).toMatch(/raise\s+exception/i);
  });

  it("chạy lại lần hai thì không làm gì", () => {
    expect(kind()).toMatch(/position\('''participant_invite''' in existing\) > 0 then\s+return;/);
  });

  it("thêm đúng loại thư mà mã gửi", () => {
    expect(kind()).toContain(`''${PARTICIPANT_INVITE_EMAIL_KIND}''::text`);
  });
});

describe("nới từ vựng nhật ký", () => {
  const audit = () => block("$participant_invite_audit_vocab$");

  it("thêm đúng giá trị mà mã ghi", () => {
    expect(audit()).toContain(`v_new_value constant text := '${PARTICIPANT_INVITE_AUDIT_ACTION}'`);
  });

  it("đếm dấu nháy trước khi dựng lại, và so lại sau", () => {
    expect(audit()).toMatch(/v_quotes/);
    expect(audit()).toMatch(/AUDIT_VOCAB_POST/);
  });
});

describe("index giữ chỗ", () => {
  const statement = () => {
    const match = code.match(/create\s+unique\s+index\s+if\s+not\s+exists\s+outbound_emails_participant_invite_inflight_idx[\s\S]*?;/i);
    if (!match) throw new Error("không thấy index giữ chỗ");
    return match[0];
  };

  it("là unique, chỉ trên thư mời, chỉ trên dòng queued", () => {
    expect(statement()).toMatch(/kind\s*=\s*'participant_invite'/);
    expect(statement()).toMatch(/status\s*=\s*'queued'/);
  });

  it("KHÔNG phủ dòng sent — phủ thì không bao giờ gửi lại được", () => {
    expect(statement()).not.toContain("'sent'");
  });

  it("tự kiểm cả tính unique lẫn điều kiện của index", () => {
    const selfCheck = block("$self_check$");
    expect(selfCheck).toMatch(/indisunique/);
    expect(selfCheck).toMatch(/position\('''sent''' in predicate\) > 0/);
    expect(selfCheck).toMatch(/SCHEMA_CONTRACT_VIOLATION/);
  });

  it("tự kiểm vẫn thấy một loại thư cũ còn nguyên", () => {
    expect(block("$self_check$")).toContain("'''mentee_application_confirmation'''");
  });
});
