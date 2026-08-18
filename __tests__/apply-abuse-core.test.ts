/**
 * lib/apply-abuse-core.ts — honeypot, rate limit, field caps and the ilike escape.
 *
 * These protect a form that is open to the internet, so the tests care about
 * two things equally: that abuse is stopped, and that a real applicant is not.
 */
import { describe, it, expect } from "vitest";
import {
  checkHoneypot,
  checkRateLimit,
  escapeLikePattern,
  extractClientIp,
  HONEYPOT_FIELD,
  MAX_FIELD_LENGTH,
  SUBMISSIONS_PER_HOUR,
  truncateFieldValues,
  truncateShortField
} from "@/lib/apply-abuse-core";

describe("checkHoneypot", () => {
  it("lets an untouched field through", () => {
    expect(checkHoneypot("")).toEqual({ allowed: true });
    expect(checkHoneypot("   ")).toEqual({ allowed: true });
    expect(checkHoneypot(null)).toEqual({ allowed: true });
    expect(checkHoneypot(undefined)).toEqual({ allowed: true });
  });

  it("rejects a filled field", () => {
    const result = checkHoneypot("https://spam.test");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("honeypot");
  });

  it("answers a bot with a success-shaped message, naming nothing", () => {
    const result = checkHoneypot("x");
    if (!result.allowed) {
      expect(result.message).not.toMatch(/honeypot|bot|spam|website/i);
      expect(result.message).toMatch(/[À-ỹ]/);
    }
  });

  it("uses a field name that looks like a real one", () => {
    expect(HONEYPOT_FIELD).toBe("website");
  });
});

describe("checkRateLimit", () => {
  it("allows submissions below the ceiling", () => {
    expect(checkRateLimit(0).allowed).toBe(true);
    expect(checkRateLimit(SUBMISSIONS_PER_HOUR - 1).allowed).toBe(true);
  });

  it("blocks at and above the ceiling", () => {
    expect(checkRateLimit(SUBMISSIONS_PER_HOUR).allowed).toBe(false);
    expect(checkRateLimit(SUBMISSIONS_PER_HOUR + 10).allowed).toBe(false);
  });

  it("is generous enough for a shared campus connection", () => {
    // A computer lab behind one NAT address must not be locked out.
    expect(SUBMISSIONS_PER_HOUR).toBeGreaterThanOrEqual(20);
  });

  it("explains itself in Vietnamese and suggests what to do", () => {
    const result = checkRateLimit(SUBMISSIONS_PER_HOUR);
    if (!result.allowed) {
      expect(result.reason).toBe("rate_limit");
      expect(result.message).toMatch(/[À-ỹ]/);
      expect(result.message).toMatch(/thử lại|liên hệ/);
    }
  });

  it("honours an explicit limit", () => {
    expect(checkRateLimit(4, 5).allowed).toBe(true);
    expect(checkRateLimit(5, 5).allowed).toBe(false);
  });
});

describe("extractClientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    expect(extractClientIp({ forwardedFor: "203.0.113.9, 70.41.3.18, 150.172.238.178" })).toBe("203.0.113.9");
    expect(extractClientIp({ forwardedFor: " 203.0.113.9 " })).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(extractClientIp({ forwardedFor: null, realIp: "198.51.100.7" })).toBe("198.51.100.7");
    expect(extractClientIp({ forwardedFor: "", realIp: "198.51.100.7" })).toBe("198.51.100.7");
  });

  it("returns null when no address is present", () => {
    expect(extractClientIp({})).toBeNull();
    expect(extractClientIp({ forwardedFor: "", realIp: "" })).toBeNull();
  });
});

describe("truncateFieldValues", () => {
  it("caps long strings and leaves short ones alone", () => {
    const payload = { short: "ok", long: "x".repeat(MAX_FIELD_LENGTH + 500) };
    const result = truncateFieldValues(payload);
    expect(result.short).toBe("ok");
    expect(result.long).toHaveLength(MAX_FIELD_LENGTH);
  });

  it("caps strings inside arrays", () => {
    const result = truncateFieldValues({ answers: ["fine", "y".repeat(MAX_FIELD_LENGTH + 1)] });
    expect((result.answers as string[])[0]).toBe("fine");
    expect((result.answers as string[])[1]).toHaveLength(MAX_FIELD_LENGTH);
  });

  it("passes non-string values through untouched", () => {
    const result = truncateFieldValues({ n: 42, b: true, nul: null, nested: { a: 1 } });
    expect(result).toEqual({ n: 42, b: true, nul: null, nested: { a: 1 } });
  });

  it("keeps every key — capping must never drop an answer", () => {
    const payload = { a: "1", b: "2", c: "3" };
    expect(Object.keys(truncateFieldValues(payload))).toEqual(["a", "b", "c"]);
  });
});

describe("truncateShortField", () => {
  it("caps an oversized identity field", () => {
    expect(truncateShortField("x".repeat(500))).toHaveLength(300);
  });

  it("leaves a normal Vietnamese name untouched", () => {
    expect(truncateShortField("Nguyễn Thị Minh Khai")).toBe("Nguyễn Thị Minh Khai");
  });
});

describe("escapeLikePattern", () => {
  it("escapes the two ilike wildcards", () => {
    expect(escapeLikePattern("a_b@example.test")).toBe("a\\_b@example.test");
    expect(escapeLikePattern("a%b@example.test")).toBe("a\\%b@example.test");
  });

  it("escapes the escape character itself", () => {
    expect(escapeLikePattern("a\\b@example.test")).toBe("a\\\\b@example.test");
  });

  it("leaves an ordinary address unchanged", () => {
    expect(escapeLikePattern("mentee.name@ueh.edu.vn")).toBe("mentee.name@ueh.edu.vn");
  });

  it("stops an underscore address from matching a different person", () => {
    // Unescaped, "a_b@x.test" is a pattern matching "aXb@x.test" — a real
    // applicant would be told they had already applied.
    const escaped = escapeLikePattern("a_b@x.test");
    expect(escaped).toContain("\\_");
    expect(escaped).not.toBe("a_b@x.test");
  });
});
