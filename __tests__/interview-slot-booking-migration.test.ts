/**
 * __tests__/interview-slot-booking-migration.test.ts
 *
 * Hợp đồng tĩnh của migration 20260922100000_interview_slot_booking.sql.
 *
 * Migration được dán tay vào Supabase SQL Editor, nên bài kiểm này đọc thẳng
 * file .sql và khẳng định những lời hứa mà phần TypeScript sẽ dựa vào: bốn
 * bảng khoá kín quyền, năm chỉ số duy nhất làm trọng tài tranh chấp, hàm giữ
 * chỗ chọn FIFO không chặn nhau, mốc 24 giờ của mentor tự huỷ, và tấm chắn
 * chống vỡ transaction khi reviewer hồ sơ nộp phiếu cho đơn đã đặt lịch.
 * Ai sửa file SQL mà làm rơi một lời hứa sẽ thấy đỏ ở đây trước khi thấy
 * hỏng trên Production.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260922100000_interview_slot_booking.sql", "utf8");

/** Cắt thân một hàm từ `create or replace function <tên>` tới `$function$;` kế tiếp. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `thiếu hàm ${name}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$function$;", start);
  expect(end, `hàm ${name} không đóng bằng $function$;`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const TABLES = [
  "interviewer_profiles",
  "interview_slots",
  "interview_bookings",
  "interview_slot_invites"
] as const;

describe("1. bốn bảng và quyền", () => {
  it("tạo đủ bốn bảng", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`create table if not exists public.${table} (`);
    }
  });

  it("bật RLS và thu quyền của public/anon/authenticated trên cả bốn", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
  });

  it("thu hồi service_role TRƯỚC khi cấp lại, và không cấp DELETE", () => {
    for (const table of TABLES) {
      // Supabase đặt default privileges nên bảng mới sinh ra đã mang ALL cho
      // service_role — không thu hồi trước thì grant hẹp bên dưới là vô nghĩa.
      expect(sql).toContain(`revoke all on public.${table} from service_role`);
      expect(sql).toContain(`grant select, insert, update on public.${table} to service_role`);
      expect(sql).not.toContain(`grant select, insert, update, delete on public.${table}`);
      expect(sql).not.toContain(`grant all on public.${table}`);
    }
  });

  it("năm chỉ số duy nhất làm trọng tài tranh chấp đều có mặt", () => {
    // Một (interviewer, giờ) một dòng — đăng lại không nhân đôi giờ rảnh.
    expect(sql).toContain("constraint interview_slots_one_per_hour unique (admin_user_id, slot_starts_at)");
    // Một mentor một lịch hiệu lực; một slot một người giữ.
    expect(sql).toMatch(/interview_bookings_active_app_uidx\s+on public\.interview_bookings \(application_id\)\s+where status = 'booked'/);
    expect(sql).toMatch(/interview_bookings_active_slot_uidx\s+on public\.interview_bookings \(slot_id\)\s+where status = 'booked'/);
    // Một đơn một mã link; mã không trùng nhau.
    expect(sql).toContain("constraint interview_slot_invites_application_key unique (application_id)");
    expect(sql).toContain("constraint interview_slot_invites_token_key unique (token)");
  });

  it("giờ slot bị ràng tròn giờ 07..21 theo giờ Việt Nam ngay tại database", () => {
    expect(sql).toContain("extract(hour from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) between 7 and 21");
    expect(sql).toContain("extract(minute from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) = 0");
  });

  it("sổ giữ chỗ nhớ trạng thái đơn trước khi đặt — để huỷ trả về đúng chỗ", () => {
    expect(sql).toContain("previous_application_status text not null");
    expect(functionBody("vam098_cancel_interview_booking_mentor")).toContain(
      "set status = v_booking.previous_application_status"
    );
  });
});

describe("2. nới loại thư theo lối cộng thêm", () => {
  it("hai loại thư mới đi qua khuôn nối-đuôi-mảng, không viết đè danh sách", () => {
    for (const kind of ["interview_slot_invite", "interview_slot_cancelled"]) {
      expect(sql).toContain(`'(\\]\\)+)$', ', ''${kind}''::text\\1'`);
    }
    expect(sql).not.toMatch(/add constraint outbound_emails_kind_check\s+check\s*\(\s*kind\s+in/i);
  });

  it("tự kiểm khẳng định loại cũ không mất", () => {
    // Khối tự kiểm phải rà lại ba loại thư cũ đại diện: một của chính vùng
    // phỏng vấn, một của thư xác nhận đơn, một của mảng sự kiện.
    expect(sql).toContain("'interview_scheduled', 'mentor_application_confirmation', 'event_survey'");
    expect(sql).toContain("đã MẤT loại thư cũ");
  });
});

describe("3. hàm giữ chỗ", () => {
  const body = functionBody("vam098_book_interview_slot");

  it("đọc vai trò API từ claim của request, không hỏi current_user", () => {
    expect(body).toContain("from public.vam063_trusted_api_role() r");
    // Tìm theo DẠNG GỌI có mở ngoặc: tên trần nằm trong chú thích thì vô hại.
    expect(body).not.toContain("vam084_operator_for_season(");
    expect(body).not.toContain("vam084_staffing_operator_for_season(");
  });

  it("khoá dòng đơn trước mọi phép kiểm — hai tab của một mentor nối đuôi nhau", () => {
    const lockAt = body.indexOf("for update;");
    const eligibilityAt = body.indexOf("'application_not_eligible'");
    expect(lockAt).toBeGreaterThan(0);
    expect(eligibilityAt).toBeGreaterThan(lockAt);
  });

  it("chọn slot theo FIFO available_since và KHÔNG chặn nhau", () => {
    expect(body).toContain("order by s.available_since asc, s.id asc");
    expect(body).toContain("for update skip locked");
  });

  it("luật đối tượng nằm ngay trong hàm: mentor, form, chưa có phiếu phỏng vấn sống", () => {
    expect(body).toContain("<> 'mentor'");
    expect(body).toContain("<> 'vam_os_form'");
    expect(body).toContain("ar.review_round = 'interview'");
    expect(body).toContain("ar.status <> 'cancelled'");
  });

  it("giao phiếu cho đúng interviewer của slot, hẹn nộp là giờ kết thúc buổi", () => {
    expect(body).toContain("v_slot.admin_user_id");
    expect(body).toContain("p_slot_starts_at + interval '1 hour'");
    expect(body).toContain("'assigned'");
  });

  it("ghi audit application_decisions rồi mới đổi trạng thái đơn", () => {
    const decisionAt = body.indexOf("insert into public.application_decisions");
    const statusAt = body.indexOf("set status = 'interview_scheduled'");
    expect(decisionAt).toBeGreaterThan(0);
    expect(statusAt).toBeGreaterThan(decisionAt);
  });

  it("lỗi nghiệp vụ trả mã jsonb, không raise", () => {
    for (const code of ["invalid_token", "already_booked", "application_not_eligible", "slot_in_past", "slot_full"]) {
      expect(body).toContain(`'code', '${code}'`);
    }
  });
});

describe("4. hai hàm huỷ", () => {
  const mentor = functionBody("vam098_cancel_interview_booking_mentor");
  const btc = functionBody("vam098_cancel_interview_booking_btc");

  it("mentor tự huỷ bị chặn trong vòng 24 giờ; ban tổ chức thì không", () => {
    expect(mentor).toContain("interval '24 hours'");
    expect(mentor).toContain("'inside_24h'");
    expect(btc).not.toContain("interval '24 hours'");
  });

  it("ban tổ chức: kiểm vai trò viết thẳng trong hàm, ba vai trò được huỷ", () => {
    expect(btc).toContain("not in ('super_admin', 'admin', 'core_team')");
    expect(btc).not.toContain("vam084_operator_for_season(");
  });

  it("phiếu đã nộp thì không huỷ được — kết quả phỏng vấn không bị xoá ngầm", () => {
    for (const body of [mentor, btc]) {
      expect(body).toContain("'already_completed'");
      expect(body).toContain("= 'submitted'");
    }
  });

  it("mở lại chỗ mà KHÔNG reset available_since — interviewer giữ thứ tự FIFO", () => {
    for (const body of [mentor, btc]) {
      expect(body).toContain("set status = 'open'");
      expect(body).not.toContain("available_since = now()");
    }
  });

  it("chỉ trả trạng thái đơn về chỗ cũ khi không còn phiếu phỏng vấn sống nào khác", () => {
    for (const body of [mentor, btc]) {
      expect(body).toContain("ar.status <> 'cancelled'");
      expect(body).toContain("in ('interview_scheduled', 'interview_in_progress')");
    }
  });

  it("về lại giữa vòng hồ sơ thì gọi máy tính-lại vòng hồ sơ, có rào cấu hình", () => {
    for (const body of [mentor, btc]) {
      expect(body).toContain("perform public.vam084_recompute_application_review_status(v_app_id, 'profile_screening')");
      // Hàm tính lại raise khi mùa chưa cấu hình yêu cầu chấm — phải rào trước.
      expect(body).toContain("recruitment_stage_requirements");
    }
  });
});

describe("5. tấm chắn trong vam084_recompute_application_review_status", () => {
  const body = functionBody("vam084_recompute_application_review_status");

  it("đơn đã sang vòng phỏng vấn thì nhánh hồ sơ trả nguyên trạng, không raise", () => {
    expect(body).toContain("p_review_stage = 'profile_screening'");
    expect(body).toContain("return v_current_status;");
    for (const status of [
      "invited_to_interview",
      "interview_scheduled",
      "interview_in_progress",
      "interview_completed",
      "ready_for_final_decision"
    ]) {
      expect(body).toContain(`'${status}'`);
    }
  });

  it("hai whitelist cũ còn nguyên — bản vá là cộng thêm, không viết lại", () => {
    // Nhánh hồ sơ.
    expect(body).toContain(
      "'submitted','under_data_check','ready_for_screening','screening_assigned'"
    );
    // Nhánh phỏng vấn.
    expect(body).toContain(
      "'interview_in_progress','interview_completed','ready_for_final_decision','needs_more_review'"
    );
    // Lời nhắc gốc vẫn phải raise cho ca thật sự bất thường.
    expect(body).toContain("Application state cannot be recomputed from current status");
  });

  it("giữ đúng tính invoker của bản gốc — KHÔNG security definer", () => {
    const header = body.slice(0, body.indexOf("as $function$"));
    expect(header).not.toContain("security definer");
  });
});

describe("6. vỏ transaction và ACL", () => {
  it("một transaction, có prereq, tự kiểm, và reload schema", () => {
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toContain("begin;");
    expect(sql).toContain("PREREQ_MISSING");
    expect(sql).toContain("SCHEMA_CONTRACT_VIOLATION");
    expect(sql).toContain("notify pgrst, 'reload schema';");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("prereq hỏi to về interview_scheduled trong applications_status_check", () => {
    // Migration 20260905140800 đưa giá trị này vào, nhưng chưa có bằng chứng
    // nó đã lên Production — hỏi lúc dán rẻ hơn lỗi 23514 lúc mentor bấm.
    expect(sql).toContain("applications_status_check");
    expect(sql).toContain("quote_literal('interview_scheduled')");
  });

  it("ba hàm mới: owner postgres, thu public/anon/authenticated, cấp service_role", () => {
    for (const fn of [
      "vam098_book_interview_slot(uuid, timestamptz)",
      "vam098_cancel_interview_booking_mentor(uuid)",
      "vam098_cancel_interview_booking_btc(uuid, uuid, text)"
    ]) {
      expect(sql).toContain(`alter function public.${fn} owner to postgres`);
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`revoke all on function public.${fn} from anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`);
    }
  });

  it("không đụng ACL của hàm tính lại — create or replace giữ ACL Production", () => {
    expect(sql).not.toContain("alter function public.vam084_recompute_application_review_status");
    expect(sql).not.toMatch(/grant execute on function public\.vam084_recompute/);
  });
});
