/**
 * Migration hình thức / giờ kết thúc / địa điểm — khẳng định cấu trúc.
 *
 * Ràng buộc chống trôi lệch quan trọng nhất nằm ở cuối: từ vựng loại sự kiện
 * trong TypeScript và trong database phải là một. Thêm một loại vào danh sách
 * trên màn hình mà quên migration nghĩa là chọn nó rồi bấm lưu sẽ ném ra một
 * lỗi CHECK khó hiểu từ tận Postgres.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPE_OPTIONS } from "@/lib/event-constants";
import { EVENT_FORMATS } from "@/lib/event-location";

const ROOT = join(__dirname, "..");
const raw = readFileSync(
  join(ROOT, "supabase", "migrations", "20260910120000_event_format_time_location.sql"),
  "utf8"
);
const code = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("khung migration", () => {
  it("không bọc trong transaction, vì alter type add value không cho phép", () => {
    // Migration 048 cũng chạy từng khối một, cùng lý do. Bù lại là khối tự
    // kiểm ở cuối.
    expect(code).not.toMatch(/^\s*begin;/m);
    expect(code).toMatch(/notify pgrst, 'reload schema'/);
    expect(code).toMatch(/SCHEMA_CONTRACT_VIOLATION/);
  });

  it("dừng sớm khi bảng chưa tồn tại", () => {
    expect(code).toMatch(/PREREQ_MISSING/);
    expect(code).toMatch(/to_regclass\('public\.events'\)/);
  });

  it("không xoá cột hay bảng nào", () => {
    expect(code).not.toMatch(/drop table/i);
    expect(code).not.toMatch(/drop column/i);
  });
});

describe("hình thức tổ chức", () => {
  it("mặc định offline — mọi sự kiện đã có đều là sự kiện tới tận nơi", () => {
    // Mặc định phải nói ĐÚNG về dữ liệu đang có, thay vì bắt ai đó đi sửa lại
    // từng dòng.
    expect(code).toMatch(/add column if not exists event_format text not null default 'offline'/);
  });

  it("ràng buộc nhận đúng ba giá trị mà TypeScript khai báo", () => {
    const block = code.match(/check \(event_format in \(([\s\S]*?)\)\)/);
    expect(block).not.toBeNull();
    for (const format of EVENT_FORMATS) {
      expect(block?.[1]).toContain(`'${format}'`);
    }
  });
});

describe("giờ kết thúc", () => {
  it("nullable — đoán hộ một giờ nào đó là bịa dữ liệu", () => {
    expect(code).toMatch(/add column if not exists ends_at timestamptz;/);
    expect(code).not.toMatch(/ends_at timestamptz not null/);
  });

  it("chỉ chặn điều thật sự vô lý: kết thúc trước khi bắt đầu", () => {
    expect(code).toMatch(/ends_at is null or starts_at is null or ends_at > starts_at/);
  });
});

describe("địa điểm", () => {
  it("thêm đủ bốn cột, không phá nếu đã có", () => {
    for (const column of [
      "location_name",
      "location_address",
      "location_map_url",
      "online_join_url"
    ]) {
      expect(code).toMatch(new RegExp(`add column if not exists ${column} text`));
    }
  });

  it("ghi lại vì sao có cả địa chỉ lẫn đường dẫn bản đồ", () => {
    // Câu comment này là chỗ duy nhất giải thích thứ tự ưu tiên cho người đọc
    // schema mà không đọc mã ứng dụng.
    expect(raw).toMatch(/Được ưu tiên hơn đường dẫn suy ra từ địa chỉ/);
  });
});

describe("loại sự kiện", () => {
  it("xử lý cả hai hình thái: enum và check constraint", () => {
    // Migration 048 ghi rằng production dùng enum còn staging từng là text
    // trần. Chỉ xử lý một trong hai là chạy được ở một môi trường và im lặng
    // không làm gì ở môi trường kia.
    expect(code).toMatch(/to_regtype\('public\.event_type'\)/);
    expect(code).toMatch(/alter type public\.event_type add value/);
    expect(code).toMatch(/conname = 'events_event_type_check'/);
  });

  it("mọi loại khai báo trong TypeScript đều được database chấp nhận", () => {
    const block = code.match(/or event_type::text in \(([\s\S]*?)\)\s*\)/);
    expect(block).not.toBeNull();
    for (const option of EVENT_TYPE_OPTIONS) {
      expect(block?.[1], option.value).toContain(`'${option.value}'`);
    }
  });

  it("giữ nguyên mọi giá trị cũ, kể cả những giá trị màn hình không còn chào", () => {
    // `workshop`, `community`, `matching` không có trong danh sách chọn nữa
    // nhưng các sự kiện cũ đang mang chúng; bỏ khỏi CHECK là biến những dòng
    // đó thành dữ liệu không hợp lệ.
    //
    // Khẳng định trên CHÍNH khối CHECK, không phải trên cả file: ba giá trị này
    // cũng xuất hiện trong khối tự kiểm ở cuối, nên `expect(code).toContain`
    // vẫn xanh sau khi ai đó đã xoá chúng khỏi ràng buộc thật.
    const block = code.match(/or event_type::text in \(([\s\S]*?)\)\s*\)/)?.[1] ?? "";
    expect(block).not.toBe("");
    for (const legacy of ["workshop", "community", "matching"]) {
      expect(block, legacy).toContain(`'${legacy}'`);
    }
  });

  it("tự kiểm khẳng định từ vựng nới ra chứ không thay thế", () => {
    expect(code).toMatch(/events_event_type_check không nhận/);
  });
});
