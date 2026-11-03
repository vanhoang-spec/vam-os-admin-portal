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
  registrationLimitNotice,
  registrationLimitReachedMessage
} from "@/lib/event-registration-limit-core";

const parse = (limit: unknown, scope: unknown, inSeries: boolean) => parseRegistrationLimitInput(limit, scope, { inSeries });

describe("1. đọc ô nhập", () => {
  it("để trống (kể cả toàn khoảng trắng, null, undefined) là không giới hạn", () => {
    for (const empty of ["", "   ", null, undefined]) {
      expect(parse(empty, "series", true)).toEqual({ ok: true, value: { limit: null, scope: "event" } });
    }
  });

  it("chuỗi: số nguyên dương với phạm vi series được giữ nguyên", () => {
    expect(parse("1", "series", true)).toEqual({ ok: true, value: { limit: 1, scope: "series" } });
    expect(parse(" 2 ", "series", true)).toEqual({ ok: true, value: { limit: 2, scope: "series" } });
    expect(parse("3", "series", true)).toEqual({ ok: true, value: { limit: 3, scope: "series" } });
  });

  it.each(["0", "-1", "1.5", "1,5", "abc", "1e3", "٣", "+2", "2 buổi", "NaN", "Infinity"])("%s không phải số nguyên dương: bị từ chối với lời nói rõ", (bad) => {
    const result = parse(bad, "series", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("số nguyên dương");
  });

  it("chặn trên: số quá lớn là gõ nhầm, không phải một giới hạn", () => {
    expect(parse(String(REGISTRATION_LIMIT_MAX), "series", true).ok).toBe(true);
    const over = parse(String(REGISTRATION_LIMIT_MAX + 1), "series", true);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain(String(REGISTRATION_LIMIT_MAX));
  });

  it("phạm vi một sự kiện chỉ nhận số 1: trong một buổi mỗi email vốn chỉ giữ một đăng ký, số lớn hơn là lời hứa không giữ được", () => {
    expect(parse("1", "event", true)).toEqual({ ok: true, value: { limit: 1, scope: "event" } });
    const two = parse("2", "event", true);
    expect(two.ok).toBe(false);
    if (!two.ok) {
      expect(two.message).toContain("Một sự kiện");
      expect(two.message).toContain("Toàn bộ chuỗi");
    }
    // Không gửi phạm vi cũng là "một sự kiện".
    expect(parse("2", "", true).ok).toBe(false);
  });

  it("sự kiện lẻ (không thuộc chuỗi) mà chọn phạm vi chuỗi thì tự về một sự kiện, nên số lớn hơn 1 cũng bị từ chối", () => {
    expect(parse("1", "series", false)).toEqual({ ok: true, value: { limit: 1, scope: "event" } });
    expect(parse("2", "series", false).ok).toBe(false);
  });
});

describe("2. đọc giới hạn đang lưu trên một dòng sự kiện", () => {
  it("không có cột, null, số lạ: không giới hạn", () => {
    for (const row of [null, undefined, {}, { registration_limit_per_email: null }, { registration_limit_per_email: 0 }, { registration_limit_per_email: "x" }]) {
      expect(readRegistrationLimit(row as never)).toEqual({ limit: null, scope: "event" });
    }
  });

  it("phạm vi series chỉ có hiệu lực khi sự kiện thuộc chuỗi", () => {
    expect(readRegistrationLimit({ registration_limit_per_email: 1, registration_limit_scope: "series", series_id: "s1" })).toEqual({ limit: 1, scope: "series" });
    expect(readRegistrationLimit({ registration_limit_per_email: 1, registration_limit_scope: "series" })).toEqual({ limit: 1, scope: "event" });
    expect(readRegistrationLimit({ registration_limit_per_email: 2, registration_limit_scope: "event", series_id: "s1" })).toEqual({ limit: 2, scope: "event" });
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
