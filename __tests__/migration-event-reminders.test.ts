/**
 * Migration "Gửi remind" — khẳng định cấu trúc.
 *
 * Ba điều quan trọng nhất: một buổi chỉ một lượt đang chạy (chống hai danh sách
 * chồng nhau), mỗi người một dòng trong một lượt, và hai danh sách đóng được nới
 * theo lối cộng thêm — viết đè là làm mất loại thư hay loại nhật ký của người khác.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REMINDER_RECIPIENT_STATES, REMINDER_RUN_STATES } from "@/lib/event-reminder-core";

const raw = readFileSync("supabase/migrations/20260914090000_event_reminders.sql", "utf8");
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("1. khung", () => {
  it("một transaction, nạp lại schema, kiểm điều kiện trước", () => {
    expect(code).toMatch(/^begin;$/m);
    expect(code).toMatch(/^commit;\s*$/m);
    expect(code).toContain("notify pgrst, 'reload schema'");
    expect(code).toContain("PREREQ_MISSING");
  });

  it("không xoá dữ liệu nào", () => {
    expect(code).not.toMatch(/delete\s+from|drop\s+table|truncate/i);
  });
});

describe("2. lượt gửi", () => {
  it("một buổi chỉ một lượt đang chạy", () => {
    expect(code).toMatch(
      /create unique index if not exists event_reminder_runs_one_running_uidx\s+on public\.event_reminder_runs \(event_id\)\s+where status = 'running'/
    );
  });

  it("trạng thái lượt khớp đúng từ vựng TypeScript", () => {
    const match = code.match(/event_reminder_runs_status_check\s+check \(status in \(([^)]*)\)\)/);
    expect(match).not.toBeNull();
    const values = match![1].split(",").map((value) => value.trim().replace(/'/g, ""));
    expect(values).toEqual([...REMINDER_RUN_STATES]);
  });

  it("đang chạy thì chưa có giờ kết thúc, đã kết thúc thì phải có", () => {
    expect(code).toContain("check ((status = 'running') = (finished_at is null))");
  });

  it("người bấm rời ban tổ chức thì lượt vẫn còn; buổi bị xoá thì lượt đi theo", () => {
    expect(code).toContain("created_by uuid null references public.admin_users(id) on delete set null");
    expect(code).toContain("event_id uuid not null references public.events(id) on delete cascade");
  });
});

describe("3. người nhận", () => {
  it("mỗi người một dòng trong một lượt", () => {
    expect(code).toContain("constraint event_reminder_recipients_once unique (run_id, registration_id)");
  });

  it("trạng thái người nhận khớp đúng từ vựng TypeScript", () => {
    const match = code.match(/event_reminder_recipients_status_check\s+check \(status in \(([^)]*)\)\)/);
    expect(match).not.toBeNull();
    const values = match![1].split(",").map((value) => value.trim().replace(/'/g, ""));
    expect(values).toEqual([...REMINDER_RECIPIENT_STATES]);
  });
});

describe("4. quyền", () => {
  it("bật RLS cho cả hai bảng", () => {
    expect(code).toContain("alter table public.event_reminder_runs enable row level security;");
    expect(code).toContain("alter table public.event_reminder_recipients enable row level security;");
  });

  it("thu hồi của service_role TRƯỚC khi cấp lại, và không cấp DELETE", () => {
    for (const table of ["event_reminder_runs", "event_reminder_recipients"]) {
      const revoke = code.indexOf(`revoke all on public.${table} from service_role;`);
      const grant = code.indexOf(`grant select, insert, update on public.${table} to service_role;`);
      expect(revoke, table).toBeGreaterThan(-1);
      expect(grant, table).toBeGreaterThan(revoke);
    }
    // Chỉ soi câu lệnh `grant` thật, đứng đầu dòng: khối tự kiểm có chữ
    // `role_table_grants` và `privilege_type = 'DELETE'`, một phép tìm trần sẽ
    // khớp nhầm vào đó.
    expect(code).not.toMatch(/^\s*grant\b[^;]*\bdelete\b[^;]*event_reminder/im);
  });

  it("không cấp gì cho anon / authenticated", () => {
    expect(code).not.toMatch(/^\s*grant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/im);
  });
});

describe("5. nới hai danh sách đóng theo lối cộng thêm", () => {
  it("đọc định nghĩa đang chạy, nối vào đuôi bằng mẫu một-hoặc-nhiều, không viết đè", () => {
    expect(code).toContain("pg_get_constraintdef");
    expect(raw.split("'(\\]\\)+)$'").length - 1).toBe(2);
    expect(code).not.toMatch(/add\s+constraint\s+outbound_emails_kind_check\s+check\s*\(/i);
    expect(code).not.toMatch(/add\s+constraint\s+admin_audit_log_action_type_check\s+check\s*\(/i);
  });

  it("nhận loại thư event_reminder, và loại thư này có trong TypeScript", () => {
    expect(code).toContain("'event_reminder'");
    expect(readFileSync("lib/email-core.ts", "utf8")).toContain('| "event_reminder"');
  });

  it("nhận ba loại nhật ký của remind, so trước/sau không mất giá trị cũ", () => {
    for (const value of ["send_event_reminder", "retry_event_reminder", "cancel_event_reminder"]) {
      expect(code).toContain(`'${value}'`);
    }
    expect(code).toContain("v_expected is distinct from v_after_values");
    expect(code).toContain("v_quotes <> cardinality(v_before_values) * 2");
  });

  it("khối tự kiểm canh giá trị mới lẫn giá trị cũ", () => {
    const check = raw.slice(raw.indexOf("$event_reminders_self_check$"), raw.lastIndexOf("$event_reminders_self_check$"));
    expect(check).toContain("SCHEMA_CONTRACT_VIOLATION");
    for (const value of ["event_reminder", "event_schedule_change", "send_event_reminder", "add_event_series_session"]) {
      expect(check).toContain(`'${value}'`);
    }
    expect(check).toContain("privilege_type = 'DELETE'");
  });
});
