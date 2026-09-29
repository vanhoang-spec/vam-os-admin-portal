/**
 * __tests__/dieu-chinh-lich-pv-mentee-migration.test.ts
 *
 * Migration điều chỉnh lịch PV mentee 29/09: 28 ca 30 phút (14/ngày), 18 ghế
 * thứ Bảy / 28 ghế Chủ nhật, cận phòng/bàn theo từng ngày, nâng trần
 * seat_limit 25 → 30.
 *
 * Migration được dán tay vào Supabase — không có CI nào chạy nó trước. Bài
 * này là thứ duy nhất đọc nó trước khi một người thật bấm Run trên
 * production. Hành vi thật (RPC, trigger) được kiểm chạy thật trong
 * __tests__/mentee-offline-postgres.test.ts; bài này chỉ soát VĂN BẢN.
 *
 * Mọi phép so khớp chạy trên văn bản ĐÃ BỎ CHÚ THÍCH: chú thích giải thích
 * một câu lệnh thường nhắc lại đúng chữ của câu lệnh đó, và một phép tìm chạy
 * trên cả chú thích sẽ xanh vì câu giải thích chứ không vì mã.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAW = readFileSync(
  join(__dirname, "..", "supabase/migrations/20260929100000_dieu_chinh_lich_pv_mentee.sql"),
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

describe("2. lưới 28 ca — 14 ca mỗi ngày, thêm 11:00 và 13:30", () => {
  const TIMES_CU = [
    "08:00:00", "08:30:00", "09:00:00", "09:30:00", "10:00:00", "10:30:00",
    "14:00:00", "14:30:00", "15:00:00", "15:30:00", "16:00:00", "16:30:00"
  ];
  const TIMES_MOI = ["11:00:00", "13:30:00"];

  it("đủ 14 mốc giờ, mỗi mốc đúng một lần", () => {
    for (const time of [...TIMES_CU, ...TIMES_MOI]) {
      expect(count(CODE, `('${time}')`), time).toBe(1);
    }
  });

  it("KHÔNG có ca 07:30, 11:30 hay 17:30 — ngoài khung 08:00–11:30 / 13:30–17:00", () => {
    expect(CODE).not.toContain("('07:30:00')");
    expect(CODE).not.toContain("('11:30:00')");
    expect(CODE).not.toContain("('12:00:00')");
    expect(CODE).not.toContain("('13:00:00')");
    expect(CODE).not.toContain("('17:30:00')");
  });

  it("đúng hai ngày 03 và 04/10", () => {
    expect(CODE).toContain("('2026-10-03')");
    expect(CODE).toContain("('2026-10-04')");
  });

  it("mỗi ca dài 30 phút, ghế theo CASE ngày — 18 thứ Bảy, 28 Chủ nhật", () => {
    expect(CODE).toContain("interval '30 minutes'");
    expect(CODE).toContain("case d.ngay when '2026-10-03' then 18 when '2026-10-04' then 28 end");
  });

  it("giờ dựng bằng chuỗi có +07:00 tường minh", () => {
    expect(CODE).toContain("|| '+07:00')::timestamptz");
  });

  it("chỉ upsert theo (season_id, starts_at) — không có câu delete nào", () => {
    expect(CODE).toContain("on conflict (season_id, starts_at) do update");
    expect(CODE.toLowerCase()).not.toContain("delete from");
  });
});

describe("3. không định hình lại ca đã có người giữ chỗ", () => {
  it("có chặn cứng khi đã có chỗ được giữ, chạy TRƯỚC câu insert", () => {
    expect(CODE).toContain("DA_CO_NGUOI_DAT");
    expect(CODE).toContain("b.status = 'booked'");
    const guard = CODE.indexOf("DA_CO_NGUOI_DAT");
    const insert = CODE.indexOf("insert into public.interview_sessions");
    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(insert);
  });
});

describe("4. nâng trần seat_limit 25 → 30, chạy TRƯỚC câu insert 28 ghế", () => {
  it("SESSION_MAX_30 thay cho SESSION_MAX_25, cận là 30", () => {
    expect(CODE).toContain("SESSION_MAX_30");
    expect(CODE).not.toContain("SESSION_MAX_25");
    expect(CODE).toContain("new.seat_limit>30");
  });

  it("trần mới được đặt TRƯỚC câu insert 28 ghế — nếu không, chính câu insert bị chặn", () => {
    const guard = CODE.indexOf("vam104_session_capacity_guard");
    const insert = CODE.indexOf("insert into public.interview_sessions");
    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(insert);
  });
});

describe("5. cận phòng/bàn — CHECK rộng 1..6, cận đúng theo ngày nằm ở trigger", () => {
  it("CHECK ở tầng bảng nới thành 1 và 6 cho cả room lẫn desk", () => {
    expect(CODE).toContain("check (room between 1 and 6)");
    expect(CODE).toContain("check (desk between 1 and 6)");
  });

  it("drop constraint if exists trước khi add — chạy lại vô hại", () => {
    expect(count(CODE, "drop constraint if exists mentee_interview_operations_room_check")).toBe(1);
    expect(count(CODE, "drop constraint if exists mentee_interview_operations_desk_check")).toBe(1);
  });

  it("trigger mới đọc NGÀY của ca qua interview_sessions, không đọc room/desk một cách tĩnh", () => {
    expect(CODE).toContain("vam104_room_desk_bounds_guard");
    expect(CODE).toContain("from public.interview_sessions s where s.id = new.session_id");
    expect(CODE).toContain("date '2026-10-03' then 3");
    expect(CODE).toContain("date '2026-10-04' then 6");
    expect(CODE).toContain("date '2026-10-03' then 6");
    expect(CODE).toContain("date '2026-10-04' then 5");
    expect(CODE).toContain("ROOM_DESK_OUT_OF_RANGE");
  });

  it("trigger BEFORE, gắn đúng bảng mentee_interview_operations, có drop trigger if exists", () => {
    expect(CODE).toContain("drop trigger if exists vam104_room_desk_bounds on public.mentee_interview_operations");
    expect(CODE).toContain(
      "create trigger vam104_room_desk_bounds before insert or update of room, desk, session_id on public.mentee_interview_operations"
    );
  });

  it("hàm trigger revoke public/anon/authenticated, chỉ grant service_role", () => {
    expect(CODE).toContain("revoke all on function public.vam104_room_desk_bounds_guard() from public,anon,authenticated");
    expect(CODE).toContain("grant execute on function public.vam104_room_desk_bounds_guard() to service_role");
  });
});

describe("6. vam104_save_offline_interview — chỉ nới cận thô 5 → 6, giữ nguyên phần còn lại", () => {
  it("cận thô mới là 1 and 6 cho cả room lẫn desk, không còn 1 and 5", () => {
    expect(CODE).toContain(
      "if v_room is null or v_room not between 1 and 6 or v_desk is null or v_desk not between 1 and 6"
    );
    // Chỉ kiểm ĐÚNG hai biến phòng/bàn — "s not between 1 and 5" của phần chấm
    // điểm (điểm 1..5) vẫn còn nguyên trong hàm và KHÔNG phải lỗi.
    expect(CODE).not.toContain("v_room not between 1 and 5");
    expect(CODE).not.toContain("v_desk not between 1 and 5");
  });

  it("mọi nhánh hành vi khác của hàm còn nguyên — checkin/result/audit log không bị chạm", () => {
    for (const dauHieu of [
      "if p_action='checkin' then",
      "elsif p_action='result' then",
      "insert into public.mentee_interview_operation_log",
      "MENTOR_NOT_APPROVED",
      "OTHER_MATCH_REQUIRES_BTC",
      "IDENTITY_REQUIRES_BTC"
    ]) {
      expect(CODE).toContain(dauHieu);
    }
  });

  it("revoke/grant giữ nguyên chữ ký hàm", () => {
    expect(CODE).toContain(
      "revoke all on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) from public,anon,authenticated"
    );
    expect(CODE).toContain(
      "grant execute on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) to service_role"
    );
  });
});

describe("7. tự kiểm cuối migration", () => {
  it("kiểm đủ: 28 ca, 30 phút, 14 ca mỗi ngày, đúng ghế theo ngày", () => {
    expect(CODE).toContain("v_total <> 28");
    expect(CODE).toContain("ends_at - starts_at <> interval '30 minutes'");
    expect(CODE).toContain("v_day3 <> 14 or v_day4 <> 14 or v_other <> 0");
    expect(CODE).toContain("seat_limit is distinct from 18");
    expect(CODE).toContain("seat_limit is distinct from 28");
  });

  it("kiểm cả định nghĩa CHECK phòng/bàn lẫn sự tồn tại của trigger", () => {
    expect(CODE).toContain("mentee_interview_operations_room_check");
    expect(CODE).toContain("mentee_interview_operations_desk_check");
    expect(CODE).toContain("pg_get_constraintdef(oid)");
    expect(CODE).toContain("thiếu trigger vam104_room_desk_bounds");
  });

  it("tự kiểm nằm SAU mọi thay đổi, TRƯỚC commit", () => {
    const selfcheck = CODE.indexOf("$dc1_selfcheck$");
    const lastChange = CODE.lastIndexOf("grant execute on function public.vam104_save_offline_interview");
    const commit = CODE.lastIndexOf("commit;");
    expect(selfcheck).toBeGreaterThan(lastChange);
    expect(selfcheck).toBeLessThan(commit);
  });
});
