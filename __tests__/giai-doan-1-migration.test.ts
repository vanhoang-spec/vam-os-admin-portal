/**
 * __tests__/giai-doan-1-migration.test.ts
 *
 * Migration giai đoạn 1: 24 ca 30 phút, 25 ghế, hạn đặt mới, hai loại thư mới.
 *
 * Migration được dán tay vào Supabase — không có CI nào chạy nó trước. Bài này
 * là thứ duy nhất đọc nó trước khi một người thật bấm Run trên production.
 *
 * Mọi phép so thứ tự chạy trên văn bản ĐÃ BỎ CHÚ THÍCH: chú thích giải thích
 * một câu lệnh thường nhắc lại đúng chữ của câu lệnh đó, và một phép tìm chạy
 * trên cả chú thích sẽ xanh vì câu giải thích chứ không vì mã.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAW = readFileSync(
  join(__dirname, "..", "supabase/migrations/20260926100000_giai_doan_1_pv_mentee.sql"),
  "utf8"
);

/** Bỏ chú thích `--` theo từng dòng. Không dùng regex: xem CLAUDE.md về dấu gạch chéo ngược. */
const CODE = RAW.split("\n")
  .map((line) => {
    const at = line.indexOf("--");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("1. khung transaction", () => {
  it("mở bằng begin và đóng bằng commit — chạy hết hoặc không chạy gì", () => {
    expect(CODE.trim().startsWith("begin;")).toBe(true);
    expect(CODE.trim().endsWith("commit;")).toBe(true);
  });
});

describe("2. lưới 24 ca", () => {
  const TIMES = [
    "08:00:00", "08:30:00", "09:00:00", "09:30:00", "10:00:00", "10:30:00",
    "14:00:00", "14:30:00", "15:00:00", "15:30:00", "16:00:00", "16:30:00"
  ];

  it("đủ 12 mốc giờ, mỗi mốc đúng một lần", () => {
    for (const time of TIMES) {
      expect(count(CODE, `('${time}')`), time).toBe(1);
    }
  });

  it("KHÔNG có ca 11:00 hay 17:00 — giờ nghỉ trưa và sau 17:00 không phỏng vấn", () => {
    expect(CODE).not.toContain("('11:00:00')");
    expect(CODE).not.toContain("('11:30:00')");
    expect(CODE).not.toContain("('17:00:00')");
  });

  it("đúng hai ngày 03 và 04/10", () => {
    expect(CODE).toContain("('2026-10-03')");
    expect(CODE).toContain("('2026-10-04')");
  });

  it("mỗi ca dài 30 phút và có 25 ghế", () => {
    expect(CODE).toContain("interval '30 minutes'");
    expect(CODE).toMatch(/\+ interval '30 minutes',\s*25,/);
  });

  /**
   * Giờ dựng không có '+07:00' sẽ theo múi giờ phiên database — UTC — và ca
   * "08:00" thành 15:00 giờ Việt Nam. Không cổng nào bắt được lỗi đó.
   */
  it("giờ dựng bằng chuỗi có +07:00 tường minh", () => {
    expect(CODE).toContain("|| '+07:00')::timestamptz");
  });
});

describe("3. hạn đặt ca là MỘT giá trị, nói giống nhau ở mọi chỗ", () => {
  const HAN = "'2026-09-30 23:59:59+07:00'::timestamptz";

  it("câu insert và khối tự kiểm dùng cùng một hạn", () => {
    // Một chỗ ghi, một chỗ kiểm. Người đổi hạn trước khi dán mà chỉ sửa một
    // chỗ thì khối tự kiểm nổ ngay — đó là điều mong muốn.
    expect(count(CODE, HAN)).toBe(2);
  });

  it("không còn sót hạn cũ 28/09", () => {
    expect(CODE).not.toContain("2026-09-28");
  });
});

describe("4. không định hình lại ca đã có người giữ chỗ", () => {
  it("có chặn cứng khi đã có chỗ được giữ", () => {
    expect(CODE).toContain("DA_CO_NGUOI_DAT");
    expect(CODE).toContain("b.status = 'booked'");
  });

  it("chặn chạy TRƯỚC câu insert, không phải sau", () => {
    const guard = CODE.indexOf("DA_CO_NGUOI_DAT");
    const insert = CODE.indexOf("insert into public.interview_sessions");
    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(insert);
  });

  it("chỉ upsert theo (season_id, starts_at) — không có câu delete nào", () => {
    expect(CODE).toContain("on conflict (season_id, starts_at) do update");
    expect(CODE.toLowerCase()).not.toContain("delete from");
  });
});

describe("5. nới loại thư theo lối cộng thêm", () => {
  it("thêm đúng hai loại thư mới", () => {
    expect(CODE).toContain("mentee_session_invite");
    expect(CODE).toContain("mentee_session_confirmed");
  });

  it("đọc lại định nghĩa hiện có rồi nối vào đuôi, không viết đè cả danh sách", () => {
    expect(count(CODE, "pg_get_constraintdef(c.oid)")).toBeGreaterThanOrEqual(2);
    expect(count(CODE, "regexp_replace(v_existing")).toBe(2);
    // Một danh sách viết tay đầy đủ sẽ có dạng "check (kind in (" hoặc "= any (array[".
    expect(CODE).not.toMatch(/check \(kind in \(/i);
    expect(CODE).not.toMatch(/any \(array\[/i);
  });

  /**
   * Dấu gạch chéo ngược trong biểu thức nối đuôi là thứ CLAUDE.md đã ghi: mất
   * một cái thì biểu thức vẫn hợp lệ, vẫn qua cả bốn cổng — và không bao giờ
   * khớp, nên migration nổ SCHEMA_CONTRACT_VIOLATION giữa lúc dán.
   *
   * Dựng chuỗi mong đợi bằng String.fromCharCode(92) để chính bài test này
   * không bị công cụ ghi file nuốt mất dấu gạch.
   */
  it("biểu thức nối đuôi còn nguyên dấu gạch chéo ngược", () => {
    const bs = String.fromCharCode(92);
    const pattern = `'(${bs}]${bs})+)$'`;
    expect(count(CODE, pattern)).toBe(2);
    expect(count(CODE, `::text${bs}1'`)).toBe(2);
  });

  it("chạy lại vô hại: loại đã có thì bỏ qua", () => {
    expect(count(CODE, "if position(quote_literal('mentee_session_invite') in v_existing) > 0 then")).toBe(1);
    expect(count(CODE, "if position(quote_literal('mentee_session_confirmed') in v_existing) > 0 then")).toBe(1);
  });
});

describe("6. tự kiểm cuối migration", () => {
  it("kiểm đủ: 24 ca, 30 phút, 25 ghế, cùng hạn, 12 ca mỗi ngày", () => {
    expect(CODE).toContain("v_total <> 24");
    expect(CODE).toContain("ends_at - starts_at <> interval '30 minutes'");
    expect(CODE).toContain("seat_limit is distinct from 25");
    expect(CODE).toContain("v_day3 <> 12 or v_day4 <> 12 or v_other <> 0");
  });

  it("kiểm cả hai loại thư mới có mặt, và loại cũ không bị rơi", () => {
    expect(CODE).toContain("SELFCHECK: outbound_emails_kind_check chưa có đủ hai loại thư mới");
    expect(CODE).toContain("quote_literal('interview_slot_invite')");
    expect(CODE).toContain("quote_literal('mentee_application_confirmation')");
  });

  it("tự kiểm nằm SAU mọi thay đổi, TRƯỚC commit", () => {
    const selfcheck = CODE.indexOf("$gd1_selfcheck$");
    const lastChange = CODE.lastIndexOf("$gd1_kind_confirmed$");
    const commit = CODE.lastIndexOf("commit;");
    expect(selfcheck).toBeGreaterThan(lastChange);
    expect(selfcheck).toBeLessThan(commit);
  });
});
