/**
 * Migration 12 ca phỏng vấn mentee — hợp đồng đọc thẳng trên văn bản SQL.
 *
 * ---------------------------------------------------------------------------
 * MỘT LỖI THẬT ĐÃ LỌT QUA, VÀ BỊ BẮT Ở BƯỚC CHẠY THỬ
 * ---------------------------------------------------------------------------
 * Bản đầu của migration này có `revoke all ... from public` và `from anon,
 * authenticated`, nhưng QUÊN `from service_role`. Bảng vừa tạo trên Supabase đã
 * mang sẵn ALL cho service_role theo default privileges — trong đó có DELETE —
 * nên câu `grant select, insert, update` phía sau không thu hẹp gì cả.
 *
 * Lần chạy thử trên production (trong giao dịch cuộn lại) bắt được. Bài test
 * này để lần sau không phải đợi tới đó.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKING_ELIGIBLE_STATUSES } from "@/lib/interview-schedule-core";

const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "20260924190000_mentee_interview_sessions.sql"),
  "utf8"
);

const BANG = ["interview_sessions", "mentee_interview_bookings", "mentee_interview_invites"];

/**
 * CHỈ thân hàm giữ chỗ. Khối tự kiểm cố ý chứa đúng những chuỗi mà nó đi canh
 * ('vam084_operator_for_season(' chẳng hạn), nên quét cả file sẽ đỏ vì chính
 * cái lưới an toàn.
 */
const bodyGiuCho = (() => {
  const start = sql.indexOf("create or replace function public.vam101_book_mentee_session");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
})();

/**
 * Thân hàm, đã bỏ mọi dòng chú thích.
 *
 * Cần thiết cho các phép so THỨ TỰ. File này giải thích vì sao phải khoá dòng
 * đơn trước, và lời giải thích đó nhắc tên mã lỗi `already_booked` — nên một
 * phép `indexOf` trên văn bản thô sẽ tìm thấy chú thích chứ không tìm thấy
 * đoạn mã, rồi kết luận ngược. Lọc theo dòng chứ không bằng biểu thức chính
 * quy: biểu thức ở đây cần dấu gạch chéo ngược, thứ đã bị nuốt một lớp khi đi
 * qua shell trên máy này.
 */
const codeGiuCho = bodyGiuCho
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("1. quyền trên ba bảng mới", () => {
  it.each(BANG)("%s: bật RLS và thu hồi của public, anon, authenticated", (bang) => {
    expect(sql).toContain(`alter table public.${bang} enable row level security;`);
    expect(sql).toContain(`revoke all on table public.${bang} from public;`);
    expect(sql).toContain(`revoke all on table public.${bang} from anon, authenticated;`);
  });

  /**
   * Đây là ca đã bắt được lỗi thật. Thiếu dòng revoke này thì service_role giữ
   * nguyên `arwdDxtm` — có cả DELETE lẫn TRUNCATE — và câu grant bên dưới trở
   * thành trang trí.
   */
  it.each(BANG)("%s: THU HỒI của service_role trước khi cấp lại", (bang) => {
    const revoke = `revoke all on table public.${bang} from service_role;`;
    const grant = `grant select, insert, update on table public.${bang} to service_role;`;
    expect(sql).toContain(revoke);
    expect(sql).toContain(grant);
    // Thứ tự quan trọng: cấp trước rồi thu hồi là thu hồi luôn cả thứ vừa cấp.
    expect(sql.indexOf(revoke)).toBeLessThan(sql.indexOf(grant));
  });

  it("không bảng nào được cấp DELETE", () => {
    for (const bang of BANG) {
      expect(sql).not.toContain(`grant delete on table public.${bang}`);
      expect(sql).not.toContain(`grant all on table public.${bang}`);
    }
  });

  it("khối tự kiểm khẳng định ĐÚNG bộ quyền arw, không dò từng chữ cái", () => {
    expect(sql).toContain("<> 'arw'");
    expect(sql).toContain("phải là đúng \"arw\"");
  });
});

describe("2. ghế chưa cấu hình là ĐÓNG", () => {
  it("cột seat_limit cho phép NULL và không có giá trị mặc định", () => {
    expect(sql).toMatch(/seat_limit\s+integer,/);
    expect(sql).not.toMatch(/seat_limit\s+integer\s+not null/);
    expect(sql).not.toMatch(/seat_limit\s+integer\s+default/);
  });

  it("hàm giữ chỗ coi seat_limit NULL là ca chưa mở", () => {
    expect(bodyGiuCho).toContain("v_session.seat_limit is null");
    expect(bodyGiuCho).toContain("'session_not_open'");
  });

  it("số ghế phải dương nếu có", () => {
    expect(sql).toContain("check (seat_limit is null or seat_limit > 0)");
  });
});

describe("3. sức chứa được cưỡng chế dưới khoá hàng", () => {
  it("khoá dòng ca RỒI mới đếm — không phải ngược lại", () => {
    const khoa = codeGiuCho.indexOf("from public.interview_sessions se");
    const dem = codeGiuCho.indexOf("select count(*) into v_taken");
    expect(khoa).toBeGreaterThan(-1);
    expect(dem).toBeGreaterThan(khoa);
    expect(codeGiuCho).toContain("for update");
  });

  it("một ứng viên giữ nhiều nhất một chỗ — canh ở database", () => {
    expect(sql).toMatch(
      /create unique index if not exists mentee_interview_bookings_active_uidx\s+on public\.mentee_interview_bookings \(application_id\)\s+where status = 'booked'/
    );
    expect(sql).toContain("thiếu chỉ số một-ứng-viên-một-chỗ");
  });

  it("khoá dòng đơn trước khi kiểm bất cứ điều gì", () => {
    const khoaDon = codeGiuCho.indexOf("from public.applications a where a.id = v_app_id for update");
    const kiemTrung = codeGiuCho.indexOf("'already_booked'");
    expect(khoaDon).toBeGreaterThan(-1);
    expect(kiemTrung).toBeGreaterThan(khoaDon);
  });
});

describe("4. cùng một luật đối tượng với vòng mentor", () => {
  it("ba trạng thái trong hàm khớp từng chữ với BOOKING_ELIGIBLE_STATUSES", () => {
    const match = bodyGiuCho.match(/status not in \(([^)]*)\)/);
    expect(match).not.toBeNull();
    const trongSql = (match?.[1] ?? "")
      .split(",")
      .map((x) => x.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
    expect(trongSql).toEqual(Array.from(BOOKING_ELIGIBLE_STATUSES).sort());
  });

  it("chỉ nhận đơn mentee nộp qua form", () => {
    expect(bodyGiuCho).toContain("'mentee'");
    expect(bodyGiuCho).toContain("'vam_os_form'");
  });
});

describe("5. hạn đăng ký là dữ liệu, không phải hằng trong hàm", () => {
  it("hàm đọc cột booking_closes_at chứ không so với một ngày viết cứng", () => {
    expect(bodyGiuCho).toContain("v_session.booking_closes_at");
    expect(bodyGiuCho).toContain("'deadline_passed'");
    expect(bodyGiuCho).not.toContain("2026-09-28");
  });

  it("12 ca sinh ra với hạn 28/09/2026 23:59 giờ Việt Nam", () => {
    expect(sql).toContain("'2026-09-28 23:59:59+07:00'::timestamptz");
  });
});

describe("6. seed 12 ca", () => {
  it("hai ngày × sáu giờ, dựng bằng chuỗi có +07:00 tường minh", () => {
    expect(sql).toContain("('2026-10-03'), ('2026-10-04')");
    expect(sql).toContain("('08'), ('09'), ('10'), ('14'), ('15'), ('16')");
    // Database chạy UTC: dựng giờ theo múi giờ phiên sẽ lệch bảy tiếng.
    expect(sql).toContain("':00:00+07:00')::timestamptz");
  });

  it("chạy lại không sinh trùng, và không ghi đè cấu hình đã điền", () => {
    expect(sql).toContain("on conflict (season_id, starts_at) do nothing");
    expect(sql).toContain("constraint interview_sessions_unique_slot unique (season_id, starts_at)");
  });

  it("khối tự kiểm đếm đúng 12", () => {
    expect(sql).toContain("phải có đúng 12 ca cho UEHM-S12");
  });
});

describe("7. vỏ migration và cổng của hàm", () => {
  it("một transaction, chạy lại vô hại", () => {
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it("khối tiên quyết dừng sớm nếu thiếu mùa hoặc thiếu trạng thái", () => {
    expect(sql).toContain("PREREQ_MISSING: chưa có mùa UEHM-S12");
    expect(sql).toContain("PREREQ_MISSING: applications_status_check không có trạng thái %");
  });

  it("hàm giữ chỗ đòi ngữ cảnh máy chủ và KHÔNG gọi hàm cấm", () => {
    expect(bodyGiuCho).toContain("public.vam063_trusted_api_role()");
    expect(bodyGiuCho).toContain("<> 'service_role'");
    expect(bodyGiuCho).not.toContain("vam084_operator_for_season(");
  });

  it("security definer, search_path rỗng, chỉ service_role gọi được", () => {
    const header = bodyGiuCho.slice(0, bodyGiuCho.indexOf("as $function$"));
    expect(header).toContain("security definer");
    expect(header).toContain("set search_path to ''");
    expect(sql).toContain(
      "revoke all on function public.vam101_book_mentee_session(uuid, uuid) from anon, authenticated;"
    );
    expect(sql).toContain(
      "grant execute on function public.vam101_book_mentee_session(uuid, uuid) to service_role;"
    );
  });

  it("lỗi nghiệp vụ trả jsonb, không raise — để tầng ứng dụng dịch thành tiếng Việt", () => {
    for (const code of [
      "invalid_token",
      "application_not_eligible",
      "already_booked",
      "session_not_found",
      "deadline_passed",
      "session_not_open",
      "session_in_past",
      "session_full"
    ]) {
      expect(bodyGiuCho).toContain(`'${code}'`);
    }
  });
});
