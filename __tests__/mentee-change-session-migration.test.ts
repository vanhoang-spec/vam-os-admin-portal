/**
 * Migration đổi ca phỏng vấn mentee — hợp đồng đọc thẳng trên văn bản SQL.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DUY NHẤT KHÔNG ĐƯỢC SAI Ở ĐÂY
 * ---------------------------------------------------------------------------
 * Phép đếm ghế của ca MỚI phải đứng TRƯỚC câu nhả chỗ cũ. Đảo hai câu đó là
 * ứng viên mất cả hai chỗ khi ca mới vừa đầy — vì một cú bấm mà họ tưởng chỉ là
 * đổi giờ cho tiện.
 *
 * Lỗi ấy không hiện ra ở bất cứ cổng nào: mã vẫn biên dịch, hàm vẫn chạy, và nó
 * chỉ cắn đúng lúc hai người tranh nhau chỗ cuối của một ca. Nên nó được canh ở
 * hai tầng — khối tự kiểm trong chính migration, và describe 2 dưới đây.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "20260924210000_mentee_change_session.sql"),
  "utf8"
);

const body = (() => {
  const start = sql.indexOf("create or replace function public.vam102_change_mentee_session");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
})();

/**
 * Thân hàm đã bỏ chú thích — bắt buộc cho mọi phép so THỨ TỰ. File này giải
 * thích vì sao phải đếm trước khi nhả, và lời giải thích đó nhắc lại chính các
 * chuỗi đem ra so; quét văn bản thô sẽ tìm thấy chú thích rồi kết luận ngược.
 */
const code = body
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("1. cổng và vỏ", () => {
  it("một transaction, chạy lại vô hại", () => {
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it("dừng sớm nếu chưa dán migration của trang đặt ca", () => {
    expect(sql).toContain("PREREQ_MISSING: chưa có bảng interview_sessions");
    expect(sql).toContain("PREREQ_MISSING: chưa có vam101_book_mentee_session");
  });

  it("đòi ngữ cảnh máy chủ, KHÔNG gọi hàm cấm, security definer, search_path rỗng", () => {
    expect(body).toContain("public.vam063_trusted_api_role()");
    expect(body).toContain("<> 'service_role'");
    expect(body).not.toContain("vam084_operator_for_season(");
    const header = body.slice(0, body.indexOf("as $function$"));
    expect(header).toContain("security definer");
    expect(header).toContain("set search_path to ''");
  });

  it("chỉ service_role gọi được", () => {
    expect(sql).toContain(
      "revoke all on function public.vam102_change_mentee_session(uuid, uuid) from anon, authenticated;"
    );
    expect(sql).toContain(
      "grant execute on function public.vam102_change_mentee_session(uuid, uuid) to service_role;"
    );
  });
});

describe("2. KHÔNG BAO GIỜ mất chỗ cũ", () => {
  it("đếm ghế ca mới TRƯỚC khi nhả chỗ cũ", () => {
    const demGhe = code.indexOf("if v_taken >= v_moi.seat_limit");
    const nhaChoCu = code.indexOf("set status = 'cancelled'");
    expect(demGhe).toBeGreaterThan(-1);
    expect(nhaChoCu).toBeGreaterThan(-1);
    expect(demGhe).toBeLessThan(nhaChoCu);
  });

  it("mọi lối trả lỗi đều đứng trước câu nhả chỗ cũ", () => {
    const nhaChoCu = code.indexOf("set status = 'cancelled'");
    for (const code_loi of [
      "invalid_token",
      "no_booking",
      "same_session",
      "session_not_found",
      "deadline_passed",
      "session_not_open",
      "session_in_past",
      "session_full"
    ]) {
      const viTri = code.indexOf(`'${code_loi}'`);
      expect(viTri, `mã lỗi ${code_loi} không có trong thân hàm`).toBeGreaterThan(-1);
      expect(viTri, `lối thoát ${code_loi} nằm SAU câu nhả chỗ cũ`).toBeLessThan(nhaChoCu);
    }
  });

  /**
   * Khối tự kiểm trong chính migration cũng canh điều này, nên người dán SQL
   * được bảo vệ kể cả khi bài test này chưa chạy.
   */
  it("khối tự kiểm của migration cũng canh đúng thứ tự đó", () => {
    expect(sql).toContain("hàm đổi ca nhả chỗ cũ TRƯỚC khi biết ca mới còn chỗ");
    expect(sql).toContain("if v_huy > v_ghi then");
  });
});

describe("3. cùng luật với hàm giữ chỗ", () => {
  it("ghế chưa cấu hình vẫn là ĐÓNG", () => {
    expect(body).toContain("v_moi.seat_limit is null");
    expect(body).toContain("'session_not_open'");
  });

  it("hạn đăng ký đọc từ cột, không viết cứng ngày", () => {
    expect(body).toContain("v_moi.booking_closes_at");
    expect(body).not.toContain("2026-09-28");
  });

  it("khoá dòng đơn trước, rồi khoá ca mới", () => {
    const khoaDon = code.indexOf("from public.applications a where a.id = v_app_id for update");
    const khoaCa = code.indexOf("from public.interview_sessions se");
    expect(khoaDon).toBeGreaterThan(-1);
    expect(khoaCa).toBeGreaterThan(khoaDon);
  });

  /**
   * Ca CŨ cố ý không khoá: hàm chỉ đổi dòng booking của chính ứng viên này, và
   * số chỗ của ca cũ là một phép đếm suy ra. Khoá thêm nó chỉ mở ra một chiều
   * chờ mới giữa hai người đổi chéo ca của nhau.
   */
  it("chỉ khoá MỘT ca — ca mới", () => {
    const soLanKhoaCa = code.split("for update").length - 1;
    // Một cho dòng đơn, một cho ca mới. Không hơn.
    expect(soLanKhoaCa).toBe(2);
  });

  it("đổi sang đúng ca đang giữ thì từ chối, không ghi gì", () => {
    expect(body).toContain("v_cu.session_id = p_session_id");
    expect(body).toContain("'same_session'");
  });
});

describe("4. để lại dấu vết", () => {
  it("ghi một dòng quyết định, nêu cả ca cũ lẫn ca mới", () => {
    expect(body).toContain("insert into public.application_decisions");
    expect(body).toContain("Ứng viên tự đổi ca qua link cá nhân");
    expect(body).toContain("v_ca_cu.starts_at");
    expect(body).toContain("v_moi.starts_at");
  });

  it("chỗ cũ chuyển trạng thái chứ không bị xoá", () => {
    expect(code).toContain("set status = 'cancelled', cancelled_at = now()");
    expect(code).not.toContain("delete from public.mentee_interview_bookings");
  });
});
