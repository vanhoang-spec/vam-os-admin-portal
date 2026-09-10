/**
 * Migration nền tảng danh tính — khẳng định cấu trúc, không chạy SQL.
 *
 * Bảng `account_person_auth_links` sắp bắt đầu giữ dữ liệu thật, và nó là thứ
 * quyết định ai thấy dữ liệu của ai. Những tính chất dưới đây là thứ một lần
 * sửa vô ý sẽ phá mà không ai thấy — cho tới khi có người mở ra và đọc hồ sơ
 * của người khác.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readFileSync } from "node:fs";
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
 * là SQL thật nhưng nó chỉ ghi tài liệu vào database — nó không tạo, không sửa,
 * không cấp quyền cho gì cả. Để nó lại thì một tên bảng nhắc trong lời giải
 * thích sẽ bị đọc thành "migration này có đụng vào bảng đó".
 */
const code = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/comment\s+on\s+[\s\S]*?;/gi, "");

describe("bảng thu về đúng vai trò sổ danh tính", () => {
  it("ba cột thành viên được nới cho phép rỗng", () => {
    for (const column of ["program_id", "season_id", "role"]) {
      expect(code, column).toMatch(
        new RegExp(`alter\\s+column\\s+${column}\\s+drop\\s+not\\s+null`, "i")
      );
    }
  });

  it("KHÔNG xoá hẳn ba cột đó", () => {
    // Migration 062 và các gói kiểm tra của nó có khẳng định về hình dạng bảng.
    // Xoá cột làm hỏng những khẳng định đó mà chẳng được gì thêm.
    expect(code).not.toMatch(/drop\s+column\s+(program_id|season_id|role)/i);
  });

  it("KHÔNG tạo bảng mới nào", () => {
    // Thêm một bảng thứ hai cùng ánh xạ auth_user_id → person_id là tạo ra hai
    // nguồn sự thật cho một câu hỏi, và hai nguồn thì sẽ có ngày lệch nhau.
    expect(code).not.toMatch(/create\s+table/i);
  });

  it("KHÔNG đụng vào person_season_memberships", () => {
    // Câu hỏi "người này tham gia gì" đã có chỗ ở. Migration này không được
    // chép lại nó.
    expect(code).not.toMatch(/person_season_memberships/i);
  });
});

describe("hai ràng buộc duy nhất phải còn nguyên", () => {
  it("KHÔNG gỡ ràng buộc duy nhất nào", () => {
    // person_id duy nhất = một người, một lối đăng nhập.
    // auth_user_id duy nhất = một tài khoản không trỏ về hai người.
    // Mất cái nào cũng là mất phần chống nhầm danh tính.
    expect(code).not.toMatch(/drop\s+constraint\s+\S*(person_id|auth_user_id)\S*_key/i);
    expect(code).not.toMatch(/drop\s+index\s+\S*(person_id|auth_user_id)/i);
  });

  it("khối tự kiểm khẳng định cả hai ràng buộc còn sống", () => {
    const selfCheck = code.slice(code.indexOf("$self_check$"));
    expect(selfCheck).toContain("person_id");
    expect(selfCheck).toContain("auth_user_id");
    expect(selfCheck).toMatch(/contype\s*=\s*'u'/);
  });
});

describe("ghi lại mối nối từ đâu ra", () => {
  it("thêm bốn cột truy vết", () => {
    for (const column of ["link_source", "invited_at", "activated_at", "created_by"]) {
      expect(code, column).toMatch(
        new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}`, "i")
      );
    }
  });

  it("link_source có bảng từ vựng đóng", () => {
    expect(code).toMatch(/link_source\s+in\s*\(\s*'self_register'\s*,\s*'invite'\s*,\s*'admin'\s*\)/i);
  });

  it("link_source cho phép rỗng, vì dòng cũ không có giá trị nào đúng", () => {
    expect(code).toMatch(/link_source\s+is\s+null\s+or/i);
  });

  it("thêm cột bằng if not exists, chạy lại được", () => {
    const addColumns = code.match(/add\s+column(\s+if\s+not\s+exists)?/gi) ?? [];
    expect(addColumns.length).toBeGreaterThan(0);
    for (const clause of addColumns) {
      expect(clause.toLowerCase(), clause).toContain("if not exists");
    }
  });
});

describe("không đụng vào hợp đồng quyền của 062", () => {
  it("KHÔNG cấp lại quyền cho ai", () => {
    // 062 đã bật RLS, thu hồi khỏi public/anon/authenticated, chỉ service_role
    // ghi được. Viết lại phần đó ở đây là mở đường cho một lần sửa vô ý nới
    // quyền trên chính bảng quyết định ai thấy dữ liệu của ai.
    expect(code).not.toMatch(/^\s*grant\s/im);
  });

  it("KHÔNG tắt RLS", () => {
    expect(code).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("KHÔNG thêm policy nào", () => {
    // Bảng này chỉ đọc qua service_role. Một policy là một đường vào khác.
    expect(code).not.toMatch(/create\s+policy/i);
  });

  it("tự kiểm lại rằng RLS vẫn bật", () => {
    expect(code).toMatch(/relrowsecurity/i);
  });
});

describe("chỉ số tra email", () => {
  it("có chỉ số theo email đã chuẩn hoá", () => {
    // Phép dò lần đầu đăng nhập không được đọc cả bảng people.
    expect(code).toMatch(/create\s+index\s+if\s+not\s+exists\s+people_email_primary_lower_idx/i);
    expect(code).toMatch(/lower\s*\(\s*btrim\s*\(\s*email_primary\s*\)\s*\)/i);
  });

  it("chỉ số bỏ qua các dòng thiếu email", () => {
    // Vài trăm dòng email rỗng nằm trong chỉ số là vài trăm dòng không bao giờ
    // được tra tới.
    expect(code).toMatch(/where\s+coalesce\s*\(\s*btrim\s*\(\s*email_primary\s*\)/i);
  });
});

describe("tự kiểm phải chặn được migration nửa vời", () => {
  it("có khối tự kiểm và nó raise được", () => {
    expect(code).toContain("$self_check$");
    expect(code).toMatch(/raise\s+exception/i);
  });

  it("mọi lời raise đều mang mã hợp đồng để tìm lại được", () => {
    const raises = code.match(/raise\s+exception\s*\n?\s*'([^']+)'/gi) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(4);
    for (const line of raises) {
      expect(line, line).toContain("SCHEMA_CONTRACT_VIOLATION");
    }
  });

  it("kiểm cả bốn cột mới, không chỉ một cột", () => {
    const selfCheck = code.slice(code.indexOf("$self_check$"));
    for (const column of ["link_source", "invited_at", "activated_at", "created_by"]) {
      expect(selfCheck, column).toContain(column);
    }
  });
});

describe("tên file theo quy ước hiện hành", () => {
  it("nằm trong supabase/migrations với dấu thời gian", () => {
    expect(MIGRATION).toMatch(/supabase[\\/]migrations[\\/]\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("KHÔNG mang số của thư mục cũ", () => {
    // Chồng S12 đặt tên 071_participant_accounts...; main đã có một 071 khác
    // (071_renewal_trusted_runtime). Trùng số là hai migration cùng tên.
    expect(MIGRATION).not.toMatch(/supabase_migrations/);
    expect(MIGRATION).not.toMatch(/[\\/]0\d\d_/);
  });
});
