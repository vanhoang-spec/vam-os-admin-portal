/**
 * Migration một-link-cho-cả-chuỗi — khẳng định cấu trúc.
 *
 * Khẳng định quan trọng nhất: ràng buộc "một email một chuỗi" là một UNIQUE
 * INDEX thật, không phải một phép kiểm ở tầng ứng dụng. Kiểm bằng ứng dụng thì
 * hai lần bấm gần nhau vẫn lọt cả hai, và người đó chiếm hai chỗ trong khi mỗi
 * buổi chỉ có một trăm.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const raw = readFileSync(
  join(ROOT, "supabase", "migrations", "20260910200000_series_registration_link.sql"),
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

  it("đòi migration chuỗi sự kiện phải chạy trước", () => {
    expect(code).toMatch(/PREREQ_MISSING: cần events\.series_id/);
  });
});

describe("link nhận cả chuỗi", () => {
  it("mặc định false — mọi link đang có vẫn chỉ nhận cho đúng buổi của nó", () => {
    expect(code).toMatch(/add column if not exists covers_series boolean not null default false/);
  });

  it("nhận cả chuỗi thì phải biết chuỗi nào", () => {
    // Một link hứa nhận cho "cả chuỗi" mà không ghi chuỗi nào là một link hứa
    // điều nó không làm được.
    expect(code).toMatch(/check \(covers_series = false or series_id is not null\)/);
  });

  it("KHÔNG bỏ NOT NULL trên event_links.event_id", () => {
    // Cách "đúng sách vở" là để link trỏ tới chuỗi thay vì tới buổi. Đó là một
    // thao tác nới lỏng trên bảng đang chạy thật, đổi lấy một cách mô hình hoá
    // gọn hơn trên giấy. Link vẫn neo vào buổi đầu và mang thêm một cờ.
    expect(code).not.toMatch(/alter column event_id drop not null/i);
    expect(code).not.toMatch(/drop constraint event_links_event_id_link_type_key/);
  });
});

describe("một người một buổi trong mỗi chuỗi", () => {
  it("là UNIQUE INDEX thật, không phải phép kiểm ở tầng ứng dụng", () => {
    expect(code).toMatch(
      /create unique index if not exists event_registrations_series_lower_email_active_uidx\s+on public\.event_registrations \(series_id, lower\(email\)\)/
    );
  });

  it("cùng hình dạng với ràng buộc chống trùng theo buổi đã có", () => {
    // So email không phân biệt hoa thường, và dòng đã huỷ thì không tính — nếu
    // khác đi thì hai ràng buộc cho cùng một ý sẽ trả lời khác nhau.
    expect(code).toMatch(/where series_id is not null and registration_status <> 'cancelled'/);
  });

  it("chỉ áp cho dòng có chuỗi, nên đăng ký cũ không bị ảnh hưởng", () => {
    expect(code).toMatch(/where series_id is not null/);
  });

  it("ràng buộc chống trùng THEO BUỔI vẫn phải còn", () => {
    // Ràng buộc mới đứng CẠNH nó, không thay nó: một sự kiện đơn lẻ không có
    // series_id, và khi đó chỉ ràng buộc cũ giữ chỗ.
    expect(code).toMatch(/ràng buộc chống trùng theo buổi đã biến mất/);
    expect(code).toContain("event_registrations_event_lower_email_active_uidx");
    expect(code).not.toMatch(/drop index[^;]*event_registrations_event_lower_email_active_uidx/i);
  });
});

describe("series_id trên dòng đăng ký", () => {
  it("ghi rõ vì sao dữ liệu bị lặp", () => {
    // Lặp dữ liệu mà không nói lý do là chỗ người sau sẽ "dọn dẹp" đi.
    expect(raw).toMatch(/một ràng buộc duy nhất không bắc qua được phép nối bảng/);
  });

  it("nullable — mọi đăng ký đã có đều không thuộc chuỗi nào", () => {
    expect(code).toMatch(/add column if not exists series_id uuid;/);
    expect(code).not.toMatch(/add column if not exists series_id uuid not null/);
  });
});

describe("tự kiểm", () => {
  it("kiểm cả dữ liệu đang có, không chỉ kiểm schema", () => {
    expect(code).toMatch(/from public\.event_links where covers_series and series_id is null/);
  });

  it("dùng SCHEMA_CONTRACT_VIOLATION như các migration khác", () => {
    expect(code).toMatch(/SCHEMA_CONTRACT_VIOLATION/);
  });
});
