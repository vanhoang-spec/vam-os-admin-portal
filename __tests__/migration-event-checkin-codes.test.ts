/**
 * Migration mã điểm danh + lịch sử quét — khẳng định cấu trúc.
 *
 * Khẳng định quan trọng nhất: `revoke all ... from service_role` phải đứng
 * TRƯỚC `grant`. Supabase đặt `alter default privileges` trên schema public
 * nên bảng vừa tạo đã mang sẵn ALL cho service_role, DELETE nằm trong đó — chỉ
 * viết `grant select, insert` là chồng thêm lên một quyền vốn đã bao trọn, và
 * DELETE sống sót trên một bảng chỉ-ghi-thêm mà không gì nói ra điều đó.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTRANCE_STATION } from "@/lib/event-checkin-code";

const ROOT = join(__dirname, "..");
const raw = readFileSync(
  join(ROOT, "supabase", "migrations", "20260910160000_event_checkin_codes.sql"),
  "utf8"
);
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("khung migration", () => {
  it("bọc trong transaction và nạp lại schema", () => {
    expect(code).toMatch(/\bbegin;/);
    expect(code).toMatch(/\bcommit;/);
    expect(code).toMatch(/notify pgrst, 'reload schema'/);
  });

  it("dừng sớm khi thiếu bảng nó dựa vào", () => {
    expect(code).toMatch(/PREREQ_MISSING/);
    expect(code).toMatch(/to_regclass\('public\.event_registrations'\)/);
  });
});

describe("mã điểm danh cá nhân", () => {
  it("là cột riêng, không dùng lại id của dòng đăng ký", () => {
    // id xuất hiện trong đường dẫn quản trị và nhật ký; mã này nằm trên màn
    // hình điện thoại người tham dự và được người khác quét.
    expect(code).toMatch(/add column if not exists checkin_code text/);
  });

  it("duy nhất TOÀN HỆ THỐNG, không chỉ trong một sự kiện", () => {
    // Máy quét đọc được mã trước khi biết nó thuộc sự kiện nào, nên tra ngược
    // từ mã phải cho đúng một kết quả.
    const index = code.match(
      /create unique index if not exists event_registrations_checkin_code_uidx\s+on public\.event_registrations \(([^)]*)\)/
    );
    expect(index).not.toBeNull();
    expect(index?.[1].trim()).toBe("checkin_code");
  });

  it("index bỏ qua các dòng chưa có mã", () => {
    expect(code).toMatch(/where checkin_code is not null/);
  });
});

describe("lịch sử quét", () => {
  it("mỗi người mỗi trạm chỉ một dòng", () => {
    // Quét lại ở cùng trạm là chuyện bình thường và phải vô hại, chứ không
    // phải một dòng đếm thêm.
    expect(code).toMatch(
      /create unique index if not exists event_scans_once_per_station_uidx\s+on public\.event_scans \(registration_id, station\)/
    );
  });

  it("mặc định là cửa vào, khớp với hằng số trong TypeScript", () => {
    expect(code).toMatch(new RegExp(`station text not null default '${ENTRANCE_STATION}'`));
  });

  it("xoá sự kiện hay xoá đăng ký thì lịch sử quét đi theo", () => {
    expect(code).toMatch(/references public\.events\(id\) on delete cascade/);
    expect(code).toMatch(/references public\.event_registrations\(id\) on delete cascade/);
  });

  it("người quét bị xoá thì lượt quét vẫn còn", () => {
    // Một người rời Core Team không được xoá bằng chứng ai đã có mặt.
    expect(code).toMatch(/scanned_by uuid null references public\.admin_users\(id\) on delete set null/);
  });
});

describe("hợp đồng quyền", () => {
  it("bật RLS và không tạo policy nào", () => {
    expect(code).toMatch(/alter table public\.event_scans enable row level security/);
    expect(code).not.toMatch(/create policy/i);
  });

  it("thu hồi của service_role TRƯỚC khi cấp lại", () => {
    // Đây là ca có giá trị nhất trong file. Thiếu dòng revoke này thì DELETE
    // sống sót qua `grant select, insert` và không gì nói ra.
    const revoke = code.indexOf("revoke all on public.event_scans from service_role");
    const grant = code.indexOf("grant select, insert on public.event_scans to service_role");
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
  });

  it("không cấp DELETE trên lịch sử quét", () => {
    expect(code).not.toMatch(/grant[^;]*delete[^;]*on public\.event_scans/i);
    expect(code).toMatch(/event_scans không được phép xoá/);
  });

  it("không cấp gì cho anon hay authenticated", () => {
    const grants = code.match(/grant [^;]+;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).not.toMatch(/\banon\b/);
      expect(grant).not.toMatch(/\bauthenticated\b/);
    }
  });
});

describe("từ vựng thư đi", () => {
  it("nới bằng cách đọc rồi nối, không chép cứng danh sách", () => {
    expect(code).toMatch(/pg_get_constraintdef/);
    expect(code).toMatch(/regexp_replace/);
    expect(code).not.toMatch(/add constraint outbound_emails_kind_check\s+check \(kind in \(/);
  });

  it("tự kiểm cả giá trị mới lẫn một giá trị cũ", () => {
    expect(code).toContain("'event_registration_confirmation'");
    expect(code).toMatch(/nới từ vựng đã làm mất giá trị cũ/);
  });

  it("bỏ qua êm khi bảng sổ thư chưa tồn tại", () => {
    // Migration này không được phụ thuộc vào thứ tự chạy so với migration sổ thư.
    expect(code).toMatch(/if to_regclass\('public\.outbound_emails'\) is null then\s+return;/);
  });
});
