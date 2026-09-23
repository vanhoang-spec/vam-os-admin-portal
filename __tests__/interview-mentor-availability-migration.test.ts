/**
 * Migration chiều ngược — hợp đồng đọc thẳng trên văn bản SQL.
 *
 * File này sẽ được dán tay vào Supabase SQL Editor Production, nên nó phải
 * đúng TRƯỚC khi ai bấm chạy: không có bước nào bắt được lỗi giữa chừng. Mỗi
 * khẳng định ở đây là một thứ mà bỏ quên sẽ chỉ lộ ra trên dữ liệu thật —
 * bảng mở cho anon, hàm ghép mất phép chọn không nghẽn, hàm ghép gọi nhầm hàm
 * đọc current_user bên trong security definer (bài học PR #144).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "20260923040000_interview_mentor_availability.sql"),
  "utf8"
);

/**
 * CHỈ thân hàm ghép, không kèm chú thích quanh nó và không kèm khối tự kiểm.
 *
 * Quét cả file thì không phân biệt được một lời gọi thật với một chuỗi mà khối
 * tự kiểm dùng để CANH lời gọi đó — và một phép kiểm không phân biệt được hai
 * thứ đó là một phép kiểm nói dối.
 */
const matchFunctionBody = (() => {
  const start = sql.indexOf("create or replace function public.vam099_match_mentor_at_hour");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
})();

describe("1. bảng giờ rảnh do mentor khai", () => {
  it("được tạo, và chạy lại vô hại", () => {
    expect(sql).toContain("create table if not exists public.interview_mentor_availability");
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("một dòng cho một (mentor, giờ) ở mọi trạng thái", () => {
    expect(sql).toContain("unique (application_id, slot_starts_at)");
  });

  it("một mentor chỉ giữ MỘT lời ngỏ đang mở — luật canh ở database, không ở tầng ứng dụng", () => {
    expect(sql).toMatch(
      /create unique index if not exists interview_mentor_availability_active_uidx\s+on public\.interview_mentor_availability \(application_id\)\s+where status = 'open'/
    );
    // Và khối tự kiểm phải canh chính chỉ số đó ở mỗi lần chạy lại.
    expect(sql).toContain("thiếu chỉ số một-mentor-một-lời-ngỏ");
  });

  it("chỉ nhận ô đúng lưới: tròn giờ, 07..21 giờ Việt Nam", () => {
    expect(sql).toContain("at time zone 'Asia/Ho_Chi_Minh'");
    expect(sql).toContain("between 7 and 21");
  });

  it("dòng đã ghép buộc phải trỏ về buổi hẹn, và chỉ dòng đã ghép mới được trỏ", () => {
    expect(sql).toContain("check ((status = 'matched') = (matched_booking_id is not null))");
  });

  it("có khoá FIFO để ai khai trước được ghép trước", () => {
    expect(sql).toContain("available_since timestamptz not null default now()");
  });
});

describe("2. quyền — bật RLS, thu hồi rồi mới cấp, không cấp DELETE", () => {
  it("RLS bật", () => {
    expect(sql).toContain("alter table public.interview_mentor_availability enable row level security");
  });

  it("thu hồi của public/anon/authenticated", () => {
    expect(sql).toContain("revoke all on public.interview_mentor_availability from public, anon, authenticated");
  });

  it("thu hồi của service_role TRƯỚC khi cấp lại — nếu không, DELETE mặc định vẫn còn", () => {
    const revokeAt = sql.indexOf("revoke all on public.interview_mentor_availability from service_role");
    const grantAt = sql.indexOf("grant select, insert, update on public.interview_mentor_availability to service_role");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
  });

  it("không có dòng nào cấp DELETE trên bảng này", () => {
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*interview_mentor_availability/i);
  });
});

describe("3. hàm ghép", () => {
  it("là security definer và đóng search_path", () => {
    expect(sql).toContain("create or replace function public.vam099_match_mentor_at_hour");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path to ''");
  });

  it("đòi đúng ngữ cảnh máy chủ", () => {
    expect(matchFunctionBody).toContain("public.vam063_trusted_api_role()");
    expect(matchFunctionBody).toContain("<> 'service_role'");
  });

  it("KHÔNG gọi vam084_operator_for_season — bên trong definer nó đọc sai current_user", () => {
    expect(matchFunctionBody).not.toContain("vam084_operator_for_season(");
    // Và khối tự kiểm phải CANH đúng điều đó ở lần chạy sau, trên thân hàm thật.
    expect(sql).toContain("if position('vam084_operator_for_season(' in v_fn) > 0 then");
  });

  it("chọn người khai sớm nhất và không bắt ai xếp hàng", () => {
    expect(matchFunctionBody).toContain("order by av.available_since asc, av.id asc");
    expect(matchFunctionBody).toContain("for update of av skip locked");
  });

  it("khoá dòng đơn rồi mới ghi — chống mentor vừa tự giữ chỗ ở tab khác", () => {
    expect(matchFunctionBody).toMatch(/from public\.applications a\s+where a\.id = v_avail\.application_id\s+for update/);
  });

  it("lặp lại đúng luật đối tượng của chiều kia, không nới lỏng cho ai", () => {
    expect(matchFunctionBody).toContain("coalesce(a.source, '') = 'vam_os_form'");
    expect(matchFunctionBody).toContain("= 'mentor'");
    expect(matchFunctionBody).toContain("'interview_scheduled'");
  });

  it("chặn ghép khi interviewer chưa có số điện thoại", () => {
    expect(matchFunctionBody).toContain("'missing_phone'");
    expect(matchFunctionBody).toContain("from public.interviewer_profiles ip");
  });

  it("lỗi nghiệp vụ trả mã, không raise", () => {
    for (const code of ["no_mentor_waiting", "mentor_already_booked", "interviewer_busy", "slot_in_past"]) {
      expect(matchFunctionBody).toContain(`jsonb_build_object('ok', false, 'code', '${code}')`);
    }
  });

  it("tạo phiếu phỏng vấn và chốt trạng thái đơn trong cùng transaction", () => {
    expect(matchFunctionBody).toContain("insert into public.application_reviews");
    expect(matchFunctionBody).toContain("insert into public.interview_bookings");
    expect(matchFunctionBody).toContain("insert into public.application_decisions");
    expect(matchFunctionBody).toContain("set status = 'interview_scheduled'");
  });

  it("trả đủ liên hệ hai bên để tầng ứng dụng gửi ba lá thư mà không đọc lại", () => {
    expect(matchFunctionBody).toContain("'interviewer', jsonb_build_object");
    expect(matchFunctionBody).toContain("'candidate', jsonb_build_object");
  });
});

describe("4. ACL và tự kiểm", () => {
  it("chỉ service_role gọi được hàm", () => {
    expect(sql).toContain(
      "revoke all on function public.vam099_match_mentor_at_hour(uuid, timestamptz) from anon, authenticated"
    );
    expect(sql).toContain(
      "grant execute on function public.vam099_match_mentor_at_hour(uuid, timestamptz) to service_role"
    );
  });

  it("có khối tiên quyết chặn chạy trước migration lịch phỏng vấn", () => {
    expect(sql).toContain("PREREQ_MISSING: chưa chạy 20260922100000_interview_slot_booking.sql");
  });

  it("có khối tự kiểm huỷ cả transaction khi hợp đồng vỡ", () => {
    expect(sql).toContain("SCHEMA_CONTRACT_VIOLATION");
    expect(sql).toContain("quyền service_role phải đúng INSERT,SELECT,UPDATE");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });
});
