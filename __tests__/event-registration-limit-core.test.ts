/**
 * Giới hạn số lần một email được đăng ký sự kiện (VAM00015): luật đọc ô nhập, câu báo, nhận ra lỗi của trigger.
 * Phần database có bài riêng chạy trên PostgreSQL thật: event-registration-limit-migration.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  REGISTRATION_LIMIT_ERROR,
  REGISTRATION_LIMIT_MAX,
  countsTowardRegistrationLimit,
  isRegistrationLimitError,
  parseRegistrationLimitInput,
  readRegistrationLimit,
  effectiveRegistrationLimit,
  registrationLimitFromError,
  registrationLimitNotice,
  registrationLimitReachedMessage,
  seriesRegistrationLimit
} from "@/lib/event-registration-limit-core";

const parse = (limit: unknown) => parseRegistrationLimitInput(limit);

describe("1. đọc ô nhập", () => {
  it("để trống (kể cả toàn khoảng trắng, null, undefined) là không giới hạn", () => {
    for (const empty of ["", "   ", null, undefined]) {
      expect(parse(empty)).toEqual({ ok: true, value: { limit: null, scope: "event" } });
    }
  });

  it("VAM00028: mọi số nguyên dương đều là giới hạn của CẢ CHUỖI, không còn lựa chọn phạm vi", () => {
    expect(parse("1")).toEqual({ ok: true, value: { limit: 1, scope: "series" } });
    expect(parse(" 2 ")).toEqual({ ok: true, value: { limit: 2, scope: "series" } });
    expect(parse("3")).toEqual({ ok: true, value: { limit: 3, scope: "series" } });
  });

  it.each(["0", "-1", "1.5", "1,5", "abc", "1e3", "٣", "+2", "2 buổi", "NaN", "Infinity"])("%s không phải số nguyên dương: bị từ chối với lời nói rõ", (bad) => {
    const result = parse(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("số nguyên dương");
  });

  it("chặn trên: số quá lớn là gõ nhầm, không phải một giới hạn", () => {
    expect(parse(String(REGISTRATION_LIMIT_MAX)).ok).toBe(true);
    const over = parse(String(REGISTRATION_LIMIT_MAX + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain(String(REGISTRATION_LIMIT_MAX));
  });

  it("VAM00028: số 2 trên một sự kiện (lẻ hay của chuỗi) được nhận, không còn bị ép về số 1 của phạm vi 'một sự kiện'", () => {
    expect(parse("2")).toEqual({ ok: true, value: { limit: 2, scope: "series" } });
  });
});

describe("1b. giới hạn chung của chuỗi (VAM00028)", () => {
  const row = (limit: unknown, scope: unknown) => ({ registration_limit_per_email: limit, registration_limit_scope: scope });

  it("một buổi mang giới hạn là đủ: cả chuỗi theo nó, bất kể buổi đó đứng thứ mấy", () => {
    expect(seriesRegistrationLimit([row(null, "event"), row(1, "series"), row(null, "event")])).toEqual({ limit: 1, scope: "series" });
    expect(seriesRegistrationLimit([row(1, "series"), row(null, "event")])).toEqual({ limit: 1, scope: "series" });
  });

  it("dòng cũ mang phạm vi 'event' cũng là giới hạn của chuỗi: cột phạm vi không còn được đọc", () => {
    expect(seriesRegistrationLimit([row(1, "event"), row(null, "event")])).toEqual({ limit: 1, scope: "series" });
    expect(seriesRegistrationLimit([row(3, "series"), row(2, "series"), row(1, "event")])).toEqual({ limit: 1, scope: "series" });
  });

  it("các buổi lệch số: lấy số nhỏ nhất; số trống, số lạ không góp vào", () => {
    expect(seriesRegistrationLimit([row(3, "series"), row(2, "event")])).toEqual({ limit: 2, scope: "series" });
    expect(seriesRegistrationLimit([row(0, "series"), row("abc", "series"), row(null, "series")])).toBeNull();
    expect(seriesRegistrationLimit([null, undefined])).toBeNull();
    expect(seriesRegistrationLimit([])).toBeNull();
  });

  it("giới hạn có hiệu lực của một buổi: thuộc chuỗi có giới hạn chung thì theo chuỗi, dù dòng của buổi ghi gì", () => {
    const session = { series_id: "s1", ...row(null, "event") };
    expect(effectiveRegistrationLimit(session, [session, row(1, "series")])).toEqual({ limit: 1, scope: "series" });
    const own = { series_id: "s1", ...row(1, "event") };
    expect(effectiveRegistrationLimit(own, [own, row(null, "event")])).toEqual({ limit: 1, scope: "series" });
    // Sự kiện lẻ: chuỗi một buổi, đọc trên chính dòng.
    expect(effectiveRegistrationLimit(row(1, "series"), [row(5, "series")])).toEqual({ limit: 1, scope: "event" });
  });

  it("đọc số giới hạn từ lỗi của trigger, để câu báo nói đúng số database đã áp", () => {
    const error = { message: REGISTRATION_LIMIT_ERROR, details: "scope=series; limit=2; count=2" };
    expect(registrationLimitFromError(error)).toEqual({ limit: 2, scope: "series" });
    expect(registrationLimitFromError({ message: REGISTRATION_LIMIT_ERROR })).toBeNull();
    expect(registrationLimitFromError({ message: "khác", details: "limit=2" })).toBeNull();
    expect(registrationLimitFromError(null)).toBeNull();
  });
});

describe("2. đọc giới hạn đang lưu trên một dòng sự kiện", () => {
  it("không có cột, null, số lạ: không giới hạn", () => {
    for (const row of [null, undefined, {}, { registration_limit_per_email: null }, { registration_limit_per_email: 0 }, { registration_limit_per_email: "x" }]) {
      expect(readRegistrationLimit(row as never)).toEqual({ limit: null, scope: "event" });
    }
  });

  it("phạm vi suy từ việc thuộc chuỗi, không từ cột phạm vi", () => {
    expect(readRegistrationLimit({ registration_limit_per_email: 1, registration_limit_scope: "series", series_id: "s1" })).toEqual({ limit: 1, scope: "series" });
    expect(readRegistrationLimit({ registration_limit_per_email: 1, registration_limit_scope: "series" })).toEqual({ limit: 1, scope: "event" });
    expect(readRegistrationLimit({ registration_limit_per_email: 2, registration_limit_scope: "event", series_id: "s1" })).toEqual({ limit: 2, scope: "series" });
  });
});

describe("3. luật đếm", () => {
  it("huỷ và bị từ chối hoàn lượt; còn lại đều tính", () => {
    expect(countsTowardRegistrationLimit("cancelled")).toBe(false);
    expect(countsTowardRegistrationLimit("rejected")).toBe(false);
    for (const status of ["registered", "pending_review", "confirmed", "waitlisted"]) {
      expect(countsTowardRegistrationLimit(status), status).toBe(true);
    }
    // Trạng thái trống không phải một lượt đã huỷ: coi là còn tính, như SQL (coalesce(…, '') not in (…)).
    expect(countsTowardRegistrationLimit(null)).toBe(true);
  });
});

describe("4. lời cho người đăng ký", () => {
  it("chuỗi: nói rõ số lần và cách gỡ", () => {
    const text = registrationLimitReachedMessage({ limit: 2, scope: "series" });
    expect(text).toContain("2 lần");
    expect(text).toContain("chuỗi sự kiện");
    expect(text).toContain("huỷ một đăng ký");
  });

  it("một sự kiện: nói đã đăng ký rồi", () => {
    expect(registrationLimitReachedMessage({ limit: 1, scope: "event" })).toContain("đã đăng ký sự kiện này");
  });

  it("dòng thông tin trên form: không có giới hạn thì không hiện gì", () => {
    expect(registrationLimitNotice({ limit: null, scope: "event" })).toBeNull();
    expect(registrationLimitNotice({ limit: 1, scope: "series" })).toBe("Mỗi email được đăng ký tối đa 1 buổi trong chuỗi sự kiện này.");
    expect(registrationLimitNotice({ limit: 2, scope: "series" })).toContain("tối đa 2 buổi");
    expect(registrationLimitNotice({ limit: 1, scope: "event" })).toBe("Mỗi email chỉ đăng ký một lần cho sự kiện này.");
  });
});

describe("5. nhận ra lỗi của trigger", () => {
  it("nhận qua message, details hoặc hint (PostgREST đặt chữ ở các chỗ khác nhau)", () => {
    expect(isRegistrationLimitError({ message: REGISTRATION_LIMIT_ERROR })).toBe(true);
    expect(isRegistrationLimitError({ message: "x", details: `scope=series; ${REGISTRATION_LIMIT_ERROR}` })).toBe(true);
    expect(isRegistrationLimitError({ message: "x", hint: REGISTRATION_LIMIT_ERROR })).toBe(true);
  });

  it("lỗi khác, null, chuỗi trần: không phải", () => {
    for (const other of [null, undefined, "EVENT_REGISTRATION_LIMIT_REACHED", { message: "duplicate key value violates unique constraint", code: "23505" }, {}, 42]) {
      expect(isRegistrationLimitError(other), String(other)).toBe(false);
    }
  });
});
