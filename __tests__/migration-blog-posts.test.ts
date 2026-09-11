/**
 * Migration blog_posts — khẳng định cấu trúc, không chạy SQL.
 *
 * Hai tính chất đáng khoá lại nhất:
 *
 * 1. MẶC ĐỊNH LÀ NỘI BỘ. Quên chọn thì thành nội bộ, chứ không phải quên chọn
 *    thì thành công khai. Một bài nội bộ ra ngoài là không thu hồi được.
 *
 * 2. HỢP ĐỒNG QUYỀN. Supabase đặt `ALTER DEFAULT PRIVILEGES` trên schema public,
 *    nên một bảng vừa tạo ĐÃ mang sẵn ALL cho service_role. Chỉ `grant` lên trên
 *    là chồng thêm vào một quyền vốn đã bao trùm — và không dòng nào nói ra điều
 *    đó. Phải revoke trước.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST_STATUSES, POST_VISIBILITIES } from "@/lib/blog-core";

const ROOT = join(__dirname, "..");
const MIGRATION = join(ROOT, "supabase", "migrations", "20260910280000_blog_posts.sql");

const raw = readFileSync(MIGRATION, "utf8");

const code = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/comment\s+on\s+[\s\S]*?;/gi, "");

describe("mặc định là nội bộ và bản nháp", () => {
  it("visibility mặc định internal", () => {
    expect(code).toMatch(/visibility\s+text\s+not\s+null\s+default\s+'internal'/i);
  });

  it("KHÔNG mặc định public", () => {
    expect(code).not.toMatch(/visibility[^;]*default\s+'public'/i);
  });

  it("status mặc định draft", () => {
    expect(code).toMatch(/status\s+text\s+not\s+null\s+default\s+'draft'/i);
  });

  it("khối tự kiểm chặn được migration đặt sai mặc định", () => {
    const selfCheck = code.slice(code.indexOf("$self_check$"));
    expect(selfCheck).toContain("internal");
    expect(selfCheck).toContain("draft");
    expect(selfCheck).toMatch(/column_default/);
  });
});

describe("bảng từ vựng khớp với mã", () => {
  it("visibility nhận đúng các giá trị lib/blog-core biết", () => {
    for (const value of POST_VISIBILITIES) {
      expect(code, value).toContain(`'${value}'`);
    }
  });

  it("status nhận đúng các giá trị lib/blog-core biết", () => {
    for (const value of POST_STATUSES) {
      expect(code, value).toContain(`'${value}'`);
    }
  });

  it("có ràng buộc đóng cho cả hai cột", () => {
    expect(code).toMatch(/blog_posts_visibility_check[\s\S]*?check\s*\(\s*visibility\s+in\s*\(/i);
    expect(code).toMatch(/blog_posts_status_check[\s\S]*?check\s*\(\s*status\s+in\s*\(/i);
  });
});

describe("hợp đồng quyền", () => {
  it("REVOKE khỏi service_role TRƯỚC khi grant", () => {
    // Đây là cái bẫy đã có thật trong một migration của chồng S12: grant chồng
    // lên một quyền mặc định vốn đã bao trùm tất cả, nên DELETE sống sót trên
    // một bảng chỉ-thêm mà không ai thấy.
    const revokeAt = code.indexOf("revoke all on public.blog_posts from service_role");
    const grantAt = code.indexOf("grant select, insert, update, delete on public.blog_posts");

    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(grantAt);
  });

  it("thu hồi khỏi public, anon và authenticated", () => {
    expect(code).toMatch(/revoke\s+all\s+on\s+public\.blog_posts\s+from\s+public,\s*anon,\s*authenticated/i);
  });

  it("KHÔNG cấp quyền cho anon hay authenticated", () => {
    // Cấp `select` cho anon nghĩa là bài nội bộ đọc được thẳng qua API dữ liệu,
    // vòng qua toàn bộ phép quyết định trong lib/blog-core.ts.
    // Soi phần SAU chữ `to` — tức danh sách vai trò. Soi cả câu lệnh sẽ khớp
    // nhầm chữ `public` trong tên bảng `public.blog_posts`, và câu kiểm đỏ vì
    // một lý do không liên quan gì tới quyền.
    const grants = code.match(/^\s*grant[^;]*;/gim) ?? [];
    expect(grants.length).toBeGreaterThan(0);

    for (const line of grants) {
      const grantees = line.slice(line.toLowerCase().lastIndexOf(" to ") + 4);
      expect(grantees, line).not.toMatch(/\banon\b|\bauthenticated\b/);
      expect(grantees, line).not.toMatch(/(^|[\s,])public([\s,;]|$)/);
    }
  });

  it("bật RLS và KHÔNG tạo policy nào", () => {
    expect(code).toMatch(/enable\s+row\s+level\s+security/i);
    expect(code).not.toMatch(/create\s+policy/i);
  });

  it("tự kiểm khẳng định không vai trò lạ nào có quyền", () => {
    const selfCheck = code.slice(code.indexOf("$self_check$"));
    expect(selfCheck).toMatch(/role_table_grants/);
    expect(selfCheck).toMatch(/pg_policies/);
  });
});

describe("hình dạng bảng", () => {
  it("đường dẫn bài là duy nhất", () => {
    // Hai bài cùng đường dẫn nghĩa là một trong hai không mở được.
    expect(code).toMatch(/slug\s+text\s+not\s+null\s+unique/i);
  });

  it("bài đã đăng bắt buộc có mốc thời gian đăng", () => {
    // Thiếu nó thì bài rơi xuống cuối mọi phép sắp theo thời gian và biến mất
    // khỏi tầm mắt người đọc.
    expect(code).toMatch(/status\s*<>\s*'published'\s+or\s+published_at\s+is\s+not\s+null/i);
  });

  it("tên tác giả được chụp lại, không chỉ trỏ về danh bạ", () => {
    expect(code).toMatch(/author_display_name/);
    expect(code).toMatch(/author_person_id[\s\S]*?on\s+delete\s+set\s+null/i);
  });

  it("tạo bảng bằng if not exists, chạy lại được", () => {
    expect(code).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.blog_posts/i);
  });

  it("có chỉ số cho phép đọc nóng nhất", () => {
    expect(code).toMatch(/create\s+index\s+if\s+not\s+exists\s+blog_posts_published_idx/i);
    expect(code).toMatch(/where\s+status\s*=\s*'published'/i);
  });
});

describe("tên file theo quy ước hiện hành", () => {
  it("nằm trong supabase/migrations với dấu thời gian", () => {
    expect(MIGRATION).toMatch(/supabase[\\/]migrations[\\/]\d{14}_[a-z0-9_]+\.sql$/);
  });
});
