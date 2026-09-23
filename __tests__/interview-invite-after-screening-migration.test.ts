/**
 * Cửa "đã qua vòng hồ sơ" — hợp đồng giữa TypeScript và hai hàm SQL.
 *
 * Có BA nơi nói ai được mời trao đổi với core team: hằng
 * BOOKING_ELIGIBLE_STATUSES, hàm vam098_book_interview_slot (mentor tự giữ
 * chỗ), và hàm vam099_match_mentor_at_hour (interviewer ghép vào giờ mentor
 * khai rảnh). Ba nơi lệch nhau thì người không được mời vẫn đi vòng qua cửa
 * còn hở, và không cổng nào trong bốn cổng bắt được — mã vẫn biên dịch sạch.
 *
 * Trước 23/09/2026 chú thích trong mã CLAIM rằng có một bài test canh điều
 * này. Không có. File này làm cho câu đó thành thật, và đối chiếu theo HAI
 * chiều: mọi trạng thái trong hằng phải có trong cả hai thân hàm, và hai thân
 * hàm không được chứa trạng thái nào ngoài hằng.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKING_ELIGIBLE_STATUSES, PROFILE_ROUND_STATUSES } from "@/lib/interview-schedule-core";

const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "20260923120000_interview_invite_after_screening.sql"),
  "utf8"
);

/**
 * Thân một hàm, không kèm khối tự kiểm. Khối tự kiểm CỐ Ý chứa đúng những
 * chuỗi mà nó đi canh ('submitted', 'vam084_operator_for_season(' …), nên quét
 * cả file sẽ đỏ vì chính cái lưới an toàn — một phép kiểm nói dối theo chiều
 * ngược lại.
 */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const BOOK = functionBody("vam098_book_interview_slot");
const MATCH = functionBody("vam099_match_mentor_at_hour");
const BODIES: Array<[string, string]> = [
  ["vam098_book_interview_slot", BOOK],
  ["vam099_match_mentor_at_hour", MATCH]
];

/** Mọi trạng thái đơn mà một thân hàm nhắc tới, đọc từ đúng danh sách in/not in. */
function statusListIn(body: string): string[] {
  const match = body.match(/status (?:not )?in \(([^)]*)\)/);
  expect(match).not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((piece) => piece.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
    .sort();
}

describe("1. ba nơi cùng một luật", () => {
  const expected = Array.from(BOOKING_ELIGIBLE_STATUSES).sort();

  it("hằng TypeScript đúng là ba trạng thái sau vòng hồ sơ", () => {
    expect(expected).toEqual(["interview_scheduled", "invited_to_interview", "screening_passed"]);
  });

  it.each(BODIES)("%s mang đúng danh sách của hằng, không thừa không thiếu", (_name, body) => {
    expect(statusListIn(body)).toEqual(expected);
  });

  it.each(BODIES)("%s không còn nhận trạng thái nào của vòng hồ sơ", (_name, body) => {
    for (const status of Array.from(PROFILE_ROUND_STATUSES)) {
      expect(body).not.toContain(`'${status}'`);
    }
  });
});

describe("2. những gì bản cũ bảo vệ vẫn còn nguyên", () => {
  // Thân hàm được chép máy từ migration đã tạo ra chúng. Chép là cơ hội đánh
  // rơi, nên mỗi dòng từng đứng giữa dữ liệu thật và một lỗi im lặng đều được
  // gọi tên lại ở đây.
  it.each(BODIES)("%s vẫn đòi ngữ cảnh máy chủ", (_name, body) => {
    expect(body).toContain("public.vam063_trusted_api_role()");
    expect(body).toContain("<> 'service_role'");
  });

  it.each(BODIES)("%s KHÔNG gọi vam084_operator_for_season bên trong security definer", (_name, body) => {
    expect(body).not.toContain("vam084_operator_for_season(");
  });

  it.each(BODIES)("%s giữ phép chọn không nghẽn và thứ tự ai-trước-được-trước", (_name, body) => {
    expect(body).toContain("skip locked");
    expect(body).toContain("available_since asc");
  });

  it.each(BODIES)("%s vẫn là security definer, search_path rỗng", (_name, body) => {
    const header = body.slice(0, body.indexOf("as $function$"));
    expect(header).toContain("security definer");
    expect(header).toContain("set search_path to ''");
  });

  it.each(BODIES)("%s vẫn lọc đơn mentor nộp qua form và chưa có phiếu phỏng vấn", (_name, body) => {
    expect(body).toContain("'vam_os_form'");
    expect(body).toContain("review_round = 'interview'");
  });

  it("hàm giữ chỗ vẫn trả đủ mã lỗi nghiệp vụ cho tầng ứng dụng dịch", () => {
    for (const code of ["invalid_token", "already_booked", "application_not_eligible", "slot_in_past", "slot_full"]) {
      expect(BOOK).toContain(`'${code}'`);
    }
  });

  it("hàm ghép vẫn trả đủ mã lỗi nghiệp vụ", () => {
    for (const code of ["missing_phone", "slot_in_past", "no_mentor_waiting", "mentor_already_booked", "interviewer_busy"]) {
      expect(MATCH).toContain(`'${code}'`);
    }
  });
});

describe("3. vỏ migration", () => {
  it("một transaction, chạy lại vô hại", () => {
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it("khối tiên quyết dừng sớm nếu chưa dán hai migration trước", () => {
    expect(sql).toContain("PREREQ_MISSING: chưa có vam098_book_interview_slot");
    expect(sql).toContain("PREREQ_MISSING: chưa có vam099_match_mentor_at_hour");
  });

  /**
   * Gõ sai một tên trạng thái biến cái cửa này thành bức tường: không ai đủ
   * điều kiện, thư ngừng đi, và không có lỗi nào hiện ra. Ràng buộc status của
   * bảng applications là chỗ duy nhất nói được ba tên kia có thật hay không.
   */
  it("khối tiên quyết đối chiếu ba trạng thái với applications_status_check", () => {
    expect(sql).toContain("applications_status_check");
    expect(sql).toContain("PREREQ_MISSING: applications_status_check không có trạng thái %");
  });

  it("khối tự kiểm canh cả hai chiều của danh sách trên catalog thật", () => {
    expect(sql).toContain("còn nhận trạng thái chưa qua vòng hồ sơ");
    expect(sql).toContain("SCHEMA_CONTRACT_VIOLATION: % mất trạng thái %");
  });

  it("ACL nói lại cho cả hai hàm: thu hồi anon/authenticated, chỉ service_role gọi được", () => {
    for (const fn of ["vam098_book_interview_slot", "vam099_match_mentor_at_hour"]) {
      expect(sql).toContain(`revoke all on function public.${fn}(uuid, timestamptz) from anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn}(uuid, timestamptz) to service_role;`);
    }
    expect(sql).toContain("còn cấp quyền gọi cho anon/authenticated");
  });

  /**
   * Soi phần NGOÀI hai thân hàm. Bên trong thân, `update public.applications`
   * là việc đúng của hàm giữ chỗ; tìm chuỗi đó trên cả file sẽ đỏ vì chính
   * dòng cần có. Cái phải không tồn tại là một lệnh ghi dữ liệu ở mức
   * migration — thứ sẽ chạy một lần lên đơn của người thật.
   */
  it("không đụng vào dữ liệu — ngoài hai thân hàm không có lệnh ghi nào", () => {
    const outside = [BOOK, MATCH].reduce((rest, body) => rest.split(body).join(""), sql);
    for (const statement of ["update public.", "insert into public.", "delete from", "truncate"]) {
      expect(outside).not.toContain(statement);
    }
  });
});
