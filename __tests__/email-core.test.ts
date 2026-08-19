/**
 * lib/email-core.ts — send gating, address handling and template safety.
 *
 * The gate is the control that stops a preview deployment from mailing 442 real
 * mentors, so it is tested exhaustively. The templates are tested for the one
 * property that matters for a public form: applicant-supplied text can never
 * change the structure of the message.
 */
import { describe, it, expect } from "vitest";
import {
  buildApplicationConfirmationEmail,
  buildMentorConfirmationLinkEmail,
  DEFAULT_EMAIL_PROVIDER,
  escapeHtml,
  evaluateEmailGate,
  isSafeAppLink,
  normalizeEmailAddress,
  parseSenderAddress,
  resolveEmailProvider,
  safeDisplayName
} from "@/lib/email-core";

const FULL_CONFIG = {
  VAM_OS_EMAIL_ENABLED: "true",
  VERCEL_ENV: "production",
  VAM_OS_EMAIL_PROVIDER: "brevo",
  BREVO_API_KEY: "xkeysib-test",
  VAM_OS_EMAIL_FROM: "VAM Mentoring <no-reply@example.test>"
};

describe("evaluateEmailGate", () => {
  it("allows sending only when every switch is on, and says who will send", () => {
    expect(evaluateEmailGate(FULL_CONFIG)).toEqual({
      canSend: true,
      provider: "brevo",
      apiKey: "xkeysib-test",
      from: "VAM Mentoring <no-reply@example.test>"
    });
  });

  it("refuses when the explicit opt-in is missing or not exactly 'true'", () => {
    for (const value of [undefined, "", "false", "TRUE", "yes", "1"]) {
      const result = evaluateEmailGate({ ...FULL_CONFIG, VAM_OS_EMAIL_ENABLED: value });
      expect(result.canSend, `flag=${String(value)}`).toBe(false);
    }
  });

  it("refuses on preview and development deployments", () => {
    for (const env of ["preview", "development", ""]) {
      const result = evaluateEmailGate({ ...FULL_CONFIG, VERCEL_ENV: env });
      expect(result.canSend, `VERCEL_ENV=${env}`).toBe(false);
      if (!result.canSend) expect(result.reason).toContain("production");
    }
  });

  it("falls back to NODE_ENV when VERCEL_ENV is absent", () => {
    const { VERCEL_ENV: _ignored, ...withoutVercel } = FULL_CONFIG;
    expect(evaluateEmailGate({ ...withoutVercel, NODE_ENV: "production" }).canSend).toBe(true);
    expect(evaluateEmailGate({ ...withoutVercel, NODE_ENV: "development" }).canSend).toBe(false);
    expect(evaluateEmailGate({ ...withoutVercel, NODE_ENV: "test" }).canSend).toBe(false);
  });

  it("refuses when provider configuration is incomplete", () => {
    expect(evaluateEmailGate({ ...FULL_CONFIG, BREVO_API_KEY: "" }).canSend).toBe(false);
    expect(evaluateEmailGate({ ...FULL_CONFIG, BREVO_API_KEY: "   " }).canSend).toBe(false);
    expect(evaluateEmailGate({ ...FULL_CONFIG, VAM_OS_EMAIL_FROM: undefined }).canSend).toBe(false);
  });

  it("asks for the key of the provider it was told to use, and no other", () => {
    // A Resend key does not open the gate while the provider is Brevo: calling
    // one provider with another's key would fail at the wire, after the row was
    // already counted as attempted.
    const wrongKey = evaluateEmailGate({
      ...FULL_CONFIG,
      BREVO_API_KEY: undefined,
      RESEND_API_KEY: "re_test_key"
    });
    expect(wrongKey.canSend).toBe(false);
    if (!wrongKey.canSend) expect(wrongKey.reason).toContain("BREVO_API_KEY");

    const resend = evaluateEmailGate({
      ...FULL_CONFIG,
      VAM_OS_EMAIL_PROVIDER: "resend",
      BREVO_API_KEY: undefined,
      RESEND_API_KEY: "re_test_key"
    });
    expect(resend.canSend).toBe(true);
    if (resend.canSend) {
      expect(resend.provider).toBe("resend");
      expect(resend.apiKey).toBe("re_test_key");
    }
  });

  it("refuses a From value that is not an address", () => {
    for (const from of ["VAM Mentoring", "no-reply@", "<>", "a b c"]) {
      const result = evaluateEmailGate({ ...FULL_CONFIG, VAM_OS_EMAIL_FROM: from });
      expect(result.canSend, from).toBe(false);
    }
  });

  it("reports a Vietnamese reason when it refuses", () => {
    const result = evaluateEmailGate({});
    expect(result.canSend).toBe(false);
    if (!result.canSend) expect(result.reason).toMatch(/[À-ỹ]/);
  });

  it("is closed by default on an empty environment", () => {
    expect(evaluateEmailGate({}).canSend).toBe(false);
  });
});

describe("normalizeEmailAddress", () => {
  it("lowercases and trims a valid address", () => {
    expect(normalizeEmailAddress("  Mentor@Example.COM ")).toBe("mentor@example.com");
  });

  it("rejects malformed values", () => {
    for (const value of ["", "   ", "not-an-email", "a@b", "a b@c.dev", null, undefined, 42]) {
      expect(normalizeEmailAddress(value as unknown), String(value)).toBeNull();
    }
  });

  it("rejects header-injection attempts outright", () => {
    expect(normalizeEmailAddress("victim@example.com\nBcc: attacker@example.com")).toBeNull();
    expect(normalizeEmailAddress("victim@example.com\r\nSubject: x")).toBeNull();
  });
});

describe("safeDisplayName / escapeHtml", () => {
  it("falls back to a neutral Vietnamese greeting when the name is empty", () => {
    expect(safeDisplayName("")).toBe("anh/chị");
    expect(safeDisplayName(null)).toBe("anh/chị");
    expect(safeDisplayName(undefined, "bạn")).toBe("bạn");
  });

  it("flattens newlines and bounds the length", () => {
    expect(safeDisplayName("Nguyễn\nVăn\tA")).toBe("Nguyễn Văn A");
    const long = safeDisplayName("x".repeat(300));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith("...")).toBe(true);
  });

  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;"
    );
  });
});

describe("isSafeAppLink", () => {
  const base = "https://portal.example.test";

  it("accepts a link under the application's own base URL", () => {
    expect(isSafeAppLink(`${base}/confirm/6f0f9c2e-1111-4222-8333-444455556666`, base)).toBe(true);
    expect(isSafeAppLink(`${base}/confirm/abc`, `${base}/`)).toBe(true);
  });

  it("rejects other hosts, including look-alike prefixes", () => {
    expect(isSafeAppLink("https://evil.test/confirm/abc", base)).toBe(false);
    expect(isSafeAppLink(`${base}.evil.test/confirm/abc`, base)).toBe(false);
    expect(isSafeAppLink("javascript:alert(1)", base)).toBe(false);
  });

  it("rejects whitespace or newlines in the URL", () => {
    expect(isSafeAppLink(`${base}/confirm/a b`, base)).toBe(false);
    expect(isSafeAppLink(`${base}/confirm/a\nb`, base)).toBe(false);
  });

  it("refuses to build links from a non-https base, except localhost", () => {
    expect(isSafeAppLink("http://portal.example.test/confirm/a", "http://portal.example.test")).toBe(false);
    expect(isSafeAppLink("http://localhost:3000/confirm/a", "http://localhost:3000")).toBe(true);
  });
});

describe("buildMentorConfirmationLinkEmail", () => {
  const built = buildMentorConfirmationLinkEmail({
    mentorName: "Nguyễn Văn A",
    seasonLabel: "UEHM-S12",
    confirmUrl: "https://portal.example.test/confirm/6f0f9c2e-1111-4222-8333-444455556666",
    deadlineLabel: "30/09/2026"
  });

  it("writes a Vietnamese subject and body naming the season", () => {
    expect(built.subject).toContain("UEHM-S12");
    expect(built.subject).toMatch(/[À-ỹ]/);
    expect(built.text).toContain("Nguyễn Văn A");
    expect(built.text).toContain("UEHM-S12");
    expect(built.html).toContain("Nguyễn Văn A");
  });

  it("states the three questions the mentor must answer", () => {
    expect(built.text).toContain("Số mentee tối đa có thể nhận (1 đến 3)");
    expect(built.text).toContain("Có tiếp tục tham gia mùa này hay không");
    expect(built.text).toContain("chấm hồ sơ và phỏng vấn");
  });

  it("includes the link in both parts and the deadline when given", () => {
    expect(built.text).toContain("https://portal.example.test/confirm/6f0f9c2e-1111-4222-8333-444455556666");
    expect(built.html).toContain("https://portal.example.test/confirm/6f0f9c2e-1111-4222-8333-444455556666");
    expect(built.text).toContain("30/09/2026");
  });

  it("warns that the link is personal", () => {
    expect(built.text).toContain("không chuyển tiếp");
  });

  it("escapes a hostile display name instead of rendering it as markup", () => {
    const hostile = buildMentorConfirmationLinkEmail({
      mentorName: '<img src=x onerror="alert(1)">',
      seasonLabel: "UEHM-S12",
      confirmUrl: "https://portal.example.test/confirm/x"
    });
    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).toContain("&lt;img");
  });
});

describe("buildApplicationConfirmationEmail", () => {
  it("addresses a mentee informally and a mentor formally", () => {
    const mentee = buildApplicationConfirmationEmail({
      applicantName: "Trần Thị B",
      role: "mentee",
      seasonLabel: "UEHM-S12"
    });
    const mentor = buildApplicationConfirmationEmail({
      applicantName: "Lê Văn C",
      role: "mentor",
      seasonLabel: "UEHM-S12"
    });

    expect(mentee.subject).toContain("mentee");
    expect(mentee.text).toContain("bạn");
    expect(mentor.subject).toContain("mentor");
    expect(mentor.text).toContain("anh/chị");
  });

  it("explains the next steps without promising an outcome", () => {
    const built = buildApplicationConfirmationEmail({
      applicantName: "Trần Thị B",
      role: "mentee",
      seasonLabel: "UEHM-S12"
    });
    expect(built.text).toContain("rà soát và chấm hồ sơ");
    expect(built.text).toContain("mời phỏng vấn");
    expect(built.text).not.toMatch(/đã (được )?(trúng tuyển|chấp nhận)/i);
  });

  it("carries no link at all, so the receipt cannot be used to deliver a URL", () => {
    const built = buildApplicationConfirmationEmail({
      applicantName: "Trần Thị B",
      role: "mentee",
      seasonLabel: "UEHM-S12"
    });
    expect(built.text).not.toMatch(/https?:\/\//);
    expect(built.html).not.toContain("<a ");
  });

  it("neutralises an applicant name containing markup or newlines", () => {
    const built = buildApplicationConfirmationEmail({
      applicantName: 'A</p><a href="https://evil.test">click</a>\nBcc: x@y.z',
      role: "mentee",
      seasonLabel: "UEHM-S12"
    });
    expect(built.html).not.toContain('<a href="https://evil.test"');
    expect(built.html).toContain("&lt;a href=");
    expect(built.text.split("\n")[0]).toBe(
      'Chào A</p><a href="https://evil.test">click</a> Bcc: x@y.z,'
    );
  });
});

describe("resolveEmailProvider", () => {
  it("defaults to Brevo, the provider with the higher daily allowance", () => {
    expect(DEFAULT_EMAIL_PROVIDER).toBe("brevo");
    for (const value of [undefined, "", "   ", "mailgun", "postmark"]) {
      expect(resolveEmailProvider(value), String(value)).toBe("brevo");
    }
  });

  it("accepts either provider, however it was typed", () => {
    expect(resolveEmailProvider("resend")).toBe("resend");
    expect(resolveEmailProvider(" RESEND ")).toBe("resend");
    expect(resolveEmailProvider("Brevo")).toBe("brevo");
  });
});

describe("parseSenderAddress", () => {
  it("splits the display form an operator copies from a dashboard", () => {
    expect(parseSenderAddress("VAM Mentoring <no-reply@vam.test>")).toEqual({
      name: "VAM Mentoring",
      email: "no-reply@vam.test"
    });
  });

  it("accepts a bare address", () => {
    expect(parseSenderAddress("no-reply@vam.test")).toEqual({
      name: null,
      email: "no-reply@vam.test"
    });
  });

  it("drops quotes around the name and lowercases the address", () => {
    expect(parseSenderAddress('"VAM Mentoring" <No-Reply@VAM.test>')).toEqual({
      name: "VAM Mentoring",
      email: "no-reply@vam.test"
    });
  });

  it("keeps a Vietnamese display name intact", () => {
    expect(parseSenderAddress("Ban tổ chức VAM <btc@vam.test>")?.name).toBe("Ban tổ chức VAM");
  });

  it("refuses anything that is not an address", () => {
    for (const value of ["", "   ", "VAM Mentoring", "VAM <not-an-email>", null, undefined]) {
      expect(parseSenderAddress(value), String(value)).toBeNull();
    }
  });

  it("refuses a header-injection attempt", () => {
    // A newline in the From would let a caller append its own headers.
    expect(parseSenderAddress("VAM <a@b.test>\nBcc: victim@x.test")).toBeNull();
  });
});
