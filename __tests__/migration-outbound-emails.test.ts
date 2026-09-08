/**
 * Migration outbound_emails — khẳng định cấu trúc, không chạy SQL.
 *
 * Những tính chất dưới đây là thứ một lần sửa vô ý sẽ phá mà không ai thấy:
 * hợp đồng quyền, phạm vi hẹp của index chống trùng, và việc khối nới từ vựng
 * audit phải đọc-rồi-nối chứ không được hard-code danh sách. Bàn giao cho đợt
 * merge sau cũng được khoá ở đây: batch_id CHƯA có khoá ngoại.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE
} from "@/lib/confirmation-backfill-core";
import { MAIN_OUTBOUND_EMAIL_KINDS } from "@/lib/outbound-emails-core";

const ROOT = join(__dirname, "..");
const MIGRATION = join(ROOT, "supabase", "migrations", "20260909090000_outbound_emails.sql");

const raw = readFileSync(MIGRATION, "utf8");

/** SQL đã bỏ chú thích `--`, để khẳng định chạm vào code chứ không phải lời văn. */
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("khung transaction", () => {
  it("bọc trong một transaction và nạp lại schema cho PostgREST", () => {
    expect(code).toMatch(/\bbegin;/);
    expect(code).toMatch(/\bcommit;/);
    expect(code).toMatch(/notify pgrst, 'reload schema'/);
  });
});

describe("bảng", () => {
  it("tạo bảng không phá nếu đã có", () => {
    expect(code).toMatch(/create table if not exists public\.outbound_emails/);
  });

  it("provider mặc định là brevo, vì tầng ứng dụng vốn luôn ghi brevo", () => {
    expect(code).toMatch(/provider\s+text not null default 'brevo'/);
    expect(code).not.toMatch(/default 'resend'/);
  });

  it("có đủ hai constraint đúng tên — 069 sẽ drop theo đúng tên này", () => {
    expect(code).toMatch(/constraint outbound_emails_status_check/);
    expect(code).toMatch(/constraint outbound_emails_kind_check/);
  });

  it("CHECK loại thư chấp nhận đúng những loại main phát ra", () => {
    for (const kind of MAIN_OUTBOUND_EMAIL_KINDS) {
      expect(code).toContain(`'${kind}'`);
    }
  });

  it("bốn trạng thái, kể cả queued mà đường đặt-chỗ-trước dùng", () => {
    expect(code).toMatch(/check \(status in \('queued', 'sent', 'failed', 'skipped'\)\)/);
  });
});

describe("bàn giao cho migration 069", () => {
  it("batch_id có mặt nhưng CHƯA có khoá ngoại", () => {
    expect(code).toMatch(/batch_id\s+uuid null/);
    // 069 dùng `add column if not exists ... references ...`; cột đã tồn tại
    // nên lệnh đó sẽ bị bỏ qua và khoá ngoại âm thầm không bao giờ xuất hiện.
    // Chú thích trong migration nói rõ nghĩa vụ ấy — và ở đây khẳng định hôm
    // nay đúng là chưa có FK nào.
    expect(code).not.toMatch(/batch_id[^,]*references/);
  });

  it("ghi lại nghĩa vụ đó bằng comment trên chính cột", () => {
    expect(raw).toMatch(/comment on column public\.outbound_emails\.batch_id/);
    expect(raw).toContain("069");
  });
});

describe("index", () => {
  it("có index tra ngược Message-ID cho bước nhận thư sau này", () => {
    expect(code).toMatch(/outbound_emails_provider_message_id_idx/);
    expect(raw).toMatch(/comment on column public\.outbound_emails\.provider_message_id/);
  });

  it("index chống trùng là unique và chỉ phủ dòng còn sống", () => {
    expect(code).toMatch(
      /create unique index if not exists outbound_emails_application_confirmation_once_idx/
    );
    expect(code).toMatch(/where status in \('queued', 'sent'\)/);
  });

  it("index chống trùng CHỈ phủ hai loại thư xác nhận", () => {
    // Phủ rộng hơn sẽ làm hỏng các loại thư được phép gửi lại (đổi lịch phỏng
    // vấn, gửi lại thư ghép cặp): lần gửi thứ hai vi phạm index lúc ghi sổ, mà
    // tầng ứng dụng nuốt lỗi ghi sổ — thư vẫn đi còn dòng log biến mất.
    const clause = code.match(
      /create unique index if not exists outbound_emails_application_confirmation_once_idx[\s\S]*?;/
    );
    expect(clause).not.toBeNull();
    for (const kind of MAIN_OUTBOUND_EMAIL_KINDS) {
      expect(clause![0]).toContain(`'${kind}'`);
    }
    expect(clause![0]).not.toContain("'reviewer_invite'");
    expect(clause![0]).not.toContain("'interview_scheduled'");
  });
});

describe("hợp đồng quyền", () => {
  it("bật và ép RLS", () => {
    expect(code).toMatch(/alter table public\.outbound_emails enable row level security/);
    expect(code).toMatch(/alter table public\.outbound_emails force row level security/);
  });

  it("thu hồi mọi quyền của vai trò phía client", () => {
    expect(code).toMatch(
      /revoke all on table public\.outbound_emails from public, anon, authenticated/
    );
  });

  it("thu hồi cả của service_role TRƯỚC khi cấp lại ba quyền", () => {
    // Supabase đặt ALTER DEFAULT PRIVILEGES cho schema public: bảng vừa tạo đã
    // có sẵn ALL cho service_role, kể cả DELETE. Không thu hồi trước thì lệnh
    // grant chỉ chồng thêm và DELETE ở lại — khối tự kiểm 5d đã bắt đúng lỗi
    // này trên Production ngày 08/09/2026.
    const revokeAt = code.indexOf("revoke all on table public.outbound_emails from service_role");
    const grantAt = code.indexOf("grant select, insert, update on table public.outbound_emails");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(grantAt);
  });

  it("service_role được đọc/ghi/sửa nhưng KHÔNG được xoá — đây là sổ ghi", () => {
    expect(code).toMatch(
      /grant select, insert, update on table public\.outbound_emails to service_role/
    );

    // Soi đúng các câu lệnh GRANT, chứ không quét cả file: câu thông báo lỗi
    // trong khối tự kiểm cũng chứa chữ DELETE, và nó nằm ở đó là đúng.
    const grantStatements = code
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /^grant\b/i.test(statement));

    expect(grantStatements.length).toBeGreaterThan(0);
    for (const statement of grantStatements) {
      expect(statement.toLowerCase()).not.toContain("delete");
    }
  });

  it("không tạo policy nào", () => {
    expect(code).not.toMatch(/create policy/i);
  });
});

describe("nới từ vựng audit", () => {
  it("thêm đúng giá trị mà tầng ứng dụng sẽ ghi", () => {
    expect(code).toContain(`'${CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE}'`);
    expect(code).toMatch(/admin_audit_log_action_type_check/);
  });

  it("đọc-rồi-nối chứ không hard-code danh sách hiện có", () => {
    // Production đang có bao nhiêu giá trị thì migration không biết trước, và
    // không được phép làm mất giá trị nào. Nó phải parse constraint đang chạy.
    expect(code).toMatch(/pg_get_constraintdef/);
    expect(code).toMatch(/regexp_matches/);
    // Vài giá trị có thật của các migration trước: nếu chúng xuất hiện ở đây
    // nghĩa là ai đó đã chép cứng danh sách vào file này.
    expect(code).not.toContain("'set_application_form_state'");
    expect(code).not.toContain("'update_admin_user_access'");
  });

  it("dựng lại đúng dạng ANY (ARRAY[...]) để các gói kiểm sau còn đọc được", () => {
    expect(code).toMatch(/action_type = any \(array\[%s\]\)/);
    expect(code).toMatch(/%L::text/);
  });

  it("bỏ qua êm khi constraint không tồn tại, thay vì làm hỏng migration", () => {
    expect(code).toMatch(/raise notice/);
  });
});

describe("tự kiểm", () => {
  it("khẳng định RLS, không policy, không quyền client, và index unique", () => {
    expect(code).toMatch(/RLS_CONTRACT_VIOLATION/);
    expect(code).toMatch(/GRANT_CONTRACT_VIOLATION/);
    expect(code).toMatch(/SCHEMA_CONTRACT_VIOLATION/);
    expect(code).toMatch(/indisunique/);
  });

  it("khẳng định service_role không cầm quyền DELETE", () => {
    expect(code).toMatch(/privilege_type = 'DELETE'/);
  });
});
