/**
 * Migration kho mẫu thư — khẳng định cấu trúc, không chạy SQL.
 *
 * Những tính chất dưới đây là thứ một lần sửa vô ý sẽ phá mà không ai thấy:
 * hợp đồng quyền của ba bảng server-only, nhật ký duyệt không sửa được, món nợ
 * khoá ngoại mà migration trước ghi lại, và việc nới từ vựng `kind` phải
 * đọc-rồi-nối chứ không được chép cứng danh sách.
 *
 * Ràng buộc chống trôi lệch quan trọng nhất nằm ở cuối file: từ vựng loại thư
 * trong TypeScript và trong database phải là một.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên văn bản migration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TEMPLATE_KINDS,
  TEMPLATE_STATUS_LABELS
} from "@/lib/email-templates-core";

const ROOT = join(__dirname, "..");
const MIGRATION = join(
  ROOT,
  "supabase",
  "migrations",
  "20260909150000_email_templates_and_batches.sql"
);

const raw = readFileSync(MIGRATION, "utf8");

/** SQL đã bỏ chú thích `--`, để khẳng định chạm vào code chứ không phải lời văn. */
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const SERVER_ONLY_TABLES = ["email_templates", "email_template_log", "email_batches"] as const;

describe("khung transaction", () => {
  it("bọc trong một transaction và nạp lại schema cho PostgREST", () => {
    expect(code).toMatch(/\bbegin;/);
    expect(code).toMatch(/\bcommit;/);
    expect(code).toMatch(/notify pgrst, 'reload schema'/);
  });

  it("dừng sớm khi thiếu thứ nó dựa vào", () => {
    for (const prereq of ["public.seasons", "public.admin_users", "public.outbound_emails"]) {
      expect(code).toContain(prereq);
    }
    expect(code).toMatch(/PREREQ_MISSING/);
    expect(code).toMatch(/to_regproc\('public\.set_updated_at'\)/);
  });

  it("không xoá bảng nào", () => {
    expect(code).not.toMatch(/drop table/i);
  });
});

describe("bảng", () => {
  it("tạo cả ba bảng, không phá nếu đã có", () => {
    for (const table of SERVER_ONLY_TABLES) {
      expect(code).toMatch(new RegExp(`create table if not exists public\\.${table}`));
    }
  });

  it("mẫu thư đã duyệt buộc phải biết duyệt lúc nào", () => {
    expect(code).toMatch(/constraint email_templates_approved_shape_check/);
    expect(code).toMatch(/status = 'approved' and approved_at is not null/);
  });

  it("lô đã kết thúc buộc phải biết kết thúc lúc nào", () => {
    expect(code).toMatch(/constraint email_batches_completed_shape_check/);
    expect(code).toMatch(/status = 'running' and completed_at is null/);
  });

  it("tên mẫu thư không được để trống", () => {
    expect(code).toMatch(/constraint email_templates_name_check/);
    expect(code).toMatch(/btrim\(name\) <> ''/);
  });

  it("các con số đếm của một lô không âm", () => {
    expect(code).toMatch(/constraint email_batches_counts_check/);
  });
});

describe("nhật ký duyệt là bằng chứng, nên không sửa được", () => {
  it("chặn cả UPDATE lẫn DELETE bằng trigger ở tầng database", () => {
    // Chặn bằng quyền thôi là chưa đủ: `service_role` đi vòng qua RLS, nên thứ
    // duy nhất đứng giữa một lệnh update nhầm và cuốn nhật ký là trigger này.
    expect(code).toMatch(/create trigger email_template_log_no_update/);
    expect(code).toMatch(/create trigger email_template_log_no_delete/);
    expect(code).toMatch(/function public\.prevent_email_template_log_mutation/);
  });

  it("quyền cấp cho service_role phản ánh đúng điều trigger đã chặn", () => {
    expect(code).toMatch(
      /grant select, insert\s+on public\.email_template_log\s+to service_role/
    );
    expect(code).not.toMatch(/grant[^;]*delete[^;]*on public\.email_template_log/);
  });

  it("ghi lại đủ các bước một mẫu thư đi qua", () => {
    for (const action of ["created", "ai_drafted", "edited", "approved", "archived"]) {
      expect(code).toContain(`'${action}'`);
    }
  });
});

describe("hợp đồng quyền — ba bảng chỉ máy chủ chạm tới", () => {
  it("bật RLS trên cả ba", () => {
    for (const table of SERVER_ONLY_TABLES) {
      expect(code).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
    }
  });

  it("không tạo policy nào — bảng có policy là bảng đọc được từ trình duyệt", () => {
    expect(code).not.toMatch(/create policy/i);
  });

  it("thu hồi mọi quyền của các vai trò phía trình duyệt", () => {
    for (const table of SERVER_ONLY_TABLES) {
      expect(code).toMatch(
        new RegExp(`revoke all on public\\.${table}\\s+from public, anon, authenticated`)
      );
    }
  });

  it("không cấp gì cho anon hay authenticated", () => {
    const grants = code.match(/grant [^;]+;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).not.toMatch(/\banon\b/);
      expect(grant).not.toMatch(/\bauthenticated\b/);
    }
  });

  it("một lô gửi đã chạy thì không xoá đi được", () => {
    // Lô là bản ghi có bao nhiêu người đã thật sự nhận thư. Xoá nó là xoá câu
    // trả lời cho "hôm đó mình đã gửi cho những ai".
    expect(code).not.toMatch(/grant[^;]*delete[^;]*on public\.email_batches/);
  });

  it("tự kiểm ngay trong transaction, sai thì cuộn ngược tất cả", () => {
    expect(code).toMatch(/SCHEMA_CONTRACT_VIOLATION/);
    expect(code).toMatch(/from pg_policies/);
    expect(code).toMatch(/from information_schema\.role_table_grants/);
  });
});

describe("nối vào outbound_emails", () => {
  it("gắn khoá ngoại bằng add constraint tường minh", () => {
    // `add column if not exists` bị Postgres bỏ qua khi cột đã có — và cùng
    // với nó là cả mệnh đề `references`. Cột batch_id đã tồn tại từ migration
    // 20260909090000, nên khoá ngoại phải được thêm riêng, đúng như comment ở
    // migration đó đã dặn lại.
    expect(code).toMatch(/add constraint outbound_emails_batch_id_fkey/);
    expect(code).toMatch(/foreign key \(batch_id\) references public\.email_batches\(id\)/);
    expect(code).not.toMatch(
      /add column if not exists batch_id uuid references/
    );
  });

  it("kiểm khoá ngoại đã gắn thật trước khi commit", () => {
    expect(code).toMatch(/outbound_emails\.batch_id vẫn chưa có khoá ngoại/);
  });

  it("nới từ vựng kind bằng cách đọc rồi nối, không chép cứng danh sách", () => {
    // Chép cứng nghĩa là mọi giá trị một migration khác thêm vào giữa hai lần
    // deploy sẽ lặng lẽ biến mất, và mọi dòng đang mang giá trị đó làm CHECK
    // gãy ngay lúc `add constraint`.
    expect(code).toMatch(/pg_get_constraintdef/);
    expect(code).toMatch(/regexp_replace/);

    // Dấu hiệu của việc chép cứng: liệt kê lại các giá trị cũ trong một khối
    // `check (kind in (...))` mới cho outbound_emails.
    expect(code).not.toMatch(/add constraint outbound_emails_kind_check\s+check \(kind in \(/);
  });

  it("dừng lại thay vì đoán khi ràng buộc có dạng lạ", () => {
    expect(code).toMatch(/có dạng lạ, không nới được/);
  });

  it("chạy lại vô hại: đã có giá trị mới thì thôi", () => {
    expect(code).toMatch(/if position\('''general_announcement'''/);
  });

  it("kiểm cả các giá trị cũ vẫn còn, không chỉ giá trị mới", () => {
    for (const kind of [
      "mentor_confirmation_link",
      "mentee_application_confirmation",
      "mentor_application_confirmation",
      "review_batch_assigned",
      "interview_scheduled",
      "reviewer_invite",
      "interview_round_invite"
    ]) {
      expect(code).toContain(`'${kind}'`);
    }
  });
});

describe("kỷ luật lát mỏng", () => {
  it("không kéo theo phần hồ sơ và tài liệu của giai đoạn sau ghép cặp", () => {
    // Chúng thuộc một lát khác; các ô điền của chúng chưa có gì để điền.
    for (const table of [
      "program_documents",
      "program_document_revisions",
      "mentee_dossier_links"
    ]) {
      expect(code).not.toContain(table);
    }
  });

  it("không đụng vào bảng nào có trước Mùa 12", () => {
    expect(code).not.toMatch(/alter table public\.mentor_season_confirmations/);
    expect(code).not.toMatch(/alter table public\.applications/);
    expect(code).not.toMatch(/alter table public\.people/);
  });

  it("cố ý không có index 'mỗi mùa mỗi loại chỉ một bản duyệt'", () => {
    // Cả mùa chỉ được phép có đúng một thông báo chung đã duyệt là vô lý.
    expect(code).not.toMatch(/create unique index[^;]*email_templates/);
  });
});

describe("TypeScript và database nói cùng một thứ tiếng", () => {
  it("mọi loại thư khai báo trong TS đều được database chấp nhận", () => {
    // Đây là chỗ trôi lệch dễ xảy ra nhất: thêm một loại thư vào TEMPLATE_KINDS
    // mà quên migration, rồi mỗi lần lưu mẫu thư mới là một lỗi CHECK khó hiểu
    // ném ra từ tận Postgres.
    const block = code.match(
      /constraint email_templates_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/
    );
    expect(block).not.toBeNull();
    for (const kind of TEMPLATE_KINDS) {
      expect(block?.[1]).toContain(`'${kind}'`);
    }
  });

  it("từ vựng của lô gửi khớp với từ vựng của mẫu thư", () => {
    const block = code.match(
      /constraint email_batches_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/
    );
    expect(block).not.toBeNull();
    for (const kind of TEMPLATE_KINDS) {
      expect(block?.[1]).toContain(`'${kind}'`);
    }
  });

  it("mọi loại thư soạn được cũng ghi được vào sổ gửi", () => {
    for (const kind of TEMPLATE_KINDS) {
      expect(code).toContain(`'${kind}'`);
    }
  });

  it("ba trạng thái trong TS khớp với ràng buộc trạng thái trong database", () => {
    const block = code.match(
      /constraint email_templates_status_check\s+check \(status in \(([\s\S]*?)\)\)/
    );
    expect(block).not.toBeNull();
    for (const status of Object.keys(TEMPLATE_STATUS_LABELS)) {
      expect(block?.[1]).toContain(`'${status}'`);
    }
  });
});
