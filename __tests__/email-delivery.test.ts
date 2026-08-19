/**
 * Direct production tests for the transport in lib/email.ts — what actually
 * goes to Brevo, and what is written down about it.
 *
 * The gate is tested exhaustively next door; these cases are about the wire:
 * the right endpoint with the right header, the From split into the two halves
 * Brevo expects, a failure that stays non-fatal to the caller, and a row in
 * outbound_emails either way — including the ones the gate suppressed, which is
 * what lets an operator see what a preview deployment would have sent.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";

// ── Mock helpers ──────────────────────────────────────────────────────────────

const logged: { payloads: Record<string, unknown>[] } = { payloads: [] };

function makeClient() {
  const chain: Record<string, unknown> = {};
  chain.insert = (payload: Record<string, unknown>) => {
    logged.payloads.push(payload);
    return Promise.resolve({ data: null, error: null });
  };
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

function brevoAccepted(messageId = "<202608.123@smtp-relay.brevo.com>") {
  return {
    ok: true,
    status: 201,
    json: async () => ({ messageId })
  };
}

function providerRejected(status: number, body: Record<string, unknown>) {
  return { ok: false, status, json: async () => body };
}

const MESSAGE = {
  kind: "mentee_selected" as const,
  toEmail: "mentee@example.test",
  subject: "Chúc mừng Nguyễn Văn A",
  body: "Chào Nguyễn Văn A,\n\nBạn đã được chọn.\nhttps://vam.test/documents/quy-tac",
  relation: { table: "applications", id: "00000000-0000-4000-8000-000000000001" },
  batchId: "00000000-0000-4000-8000-0000000000b1"
};

let fetchMock: Mock;

function enableSending(overrides: Record<string, string | undefined> = {}) {
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
  process.env.VAM_OS_EMAIL_REPLY_TO = "btc@vam.test";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const TOUCHED_ENV = [
  "VAM_OS_EMAIL_ENABLED",
  "VERCEL_ENV",
  "VAM_OS_EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "VAM_OS_EMAIL_FROM",
  "VAM_OS_EMAIL_REPLY_TO"
];

const ORIGINAL_ENV = new Map<string, string | undefined>();

beforeEach(() => {
  vi.resetAllMocks();
  logged.payloads = [];
  for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
  fetchMock = vi.fn().mockResolvedValue(brevoAccepted());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

function requestFor(mock: Mock) {
  const [url, init] = mock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
  return { url, headers: init.headers, body: JSON.parse(init.body) as Record<string, any> };
}

// ── Brevo ────────────────────────────────────────────────────────────────────

describe("sending through Brevo", () => {
  it("posts to Brevo with the api-key header and the sender split in two", async () => {
    enableSending();

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = requestFor(fetchMock);
    expect(request.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request.headers["api-key"]).toBe("xkeysib-test");
    // Brevo wants the name and the address separately, unlike Resend.
    expect(request.body.sender).toEqual({ name: "Ban tổ chức VAM", email: "no-reply@vam.test" });
    expect(request.body.to).toEqual([{ email: "mentee@example.test" }]);
    expect(request.body.subject).toBe("Chúc mừng Nguyễn Văn A");
    expect(request.body.replyTo).toEqual({ email: "btc@vam.test" });
  });

  it("sends both halves of the message: the text and the HTML", async () => {
    enableSending();

    await sendTemplatedEmail(MESSAGE);

    const { body } = requestFor(fetchMock);
    expect(body.textContent).toContain("Bạn đã được chọn");
    expect(body.htmlContent).toContain("<p>");
    // The link in the template becomes clickable in the HTML half.
    expect(body.htmlContent).toContain('href="https://vam.test/documents/quy-tac"');
  });

  it("omits replyTo when no monitored inbox is configured", async () => {
    enableSending({ VAM_OS_EMAIL_REPLY_TO: undefined });

    await sendTemplatedEmail(MESSAGE);

    expect(requestFor(fetchMock).body.replyTo).toBeUndefined();
  });

  it("records the provider, the message id and the batch on a successful send", async () => {
    enableSending();

    await sendTemplatedEmail(MESSAGE);

    const row = logged.payloads[0];
    expect(row.status).toBe("sent");
    expect(row.provider).toBe("brevo");
    expect(row.provider_message_id).toBe("<202608.123@smtp-relay.brevo.com>");
    expect(row.kind).toBe("mentee_selected");
    expect(row.to_email).toBe("mentee@example.test");
    expect(row.related_table).toBe("applications");
    expect(row.batch_id).toBe(MESSAGE.batchId);
  });

  it("keeps the provider's own reason when it refuses, without failing the caller's work", async () => {
    enableSending();
    fetchMock.mockResolvedValue(
      providerRejected(400, { code: "invalid_parameter", message: "sender email is not valid" })
    );

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    // The caller sees a safe sentence; the operator sees the provider's words.
    expect(result.reason).not.toContain("sender email is not valid");
    const row = logged.payloads[0];
    expect(row.status).toBe("failed");
    expect(String(row.error)).toContain("invalid_parameter");
    expect(String(row.error)).toContain("400");
  });

  it("survives the daily allowance being reached", async () => {
    enableSending();
    fetchMock.mockResolvedValue(
      providerRejected(429, { code: "too_many_requests", message: "daily limit reached" })
    );

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.ok).toBe(false);
    expect(String(logged.payloads[0].error)).toContain("429");
  });

  it("survives a network failure", async () => {
    enableSending();
    fetchMock.mockRejectedValue(new Error("connection reset"));

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.ok).toBe(false);
    expect(logged.payloads[0].status).toBe("failed");
    expect(String(logged.payloads[0].error)).toContain("connection reset");
  });
});

// ── Resend, still reachable by configuration ─────────────────────────────────

describe("sending through Resend", () => {
  it("posts to Resend with a bearer token and the From as one string", async () => {
    enableSending({
      VAM_OS_EMAIL_PROVIDER: "resend",
      BREVO_API_KEY: undefined,
      RESEND_API_KEY: "re_test_key"
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "re_123" }) });

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.ok).toBe(true);
    const request = requestFor(fetchMock);
    expect(request.url).toBe("https://api.resend.com/emails");
    expect(request.headers.authorization).toBe("Bearer re_test_key");
    expect(request.body.from).toBe("Ban tổ chức VAM <no-reply@vam.test>");
    expect(request.body.to).toEqual(["mentee@example.test"]);
    expect(request.body.reply_to).toBe("btc@vam.test");
    expect(logged.payloads[0].provider).toBe("resend");
    expect(logged.payloads[0].provider_message_id).toBe("re_123");
  });
});

// ── The gate still comes first ───────────────────────────────────────────────

describe("the gate decides before the transport does", () => {
  it("sends nothing from a preview deployment, and says so in the log", async () => {
    enableSending({ VERCEL_ENV: "preview" });

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = logged.payloads[0];
    expect(row.status).toBe("skipped");
    expect(String(row.error)).toContain("production");
  });

  it("sends nothing when the provider key is missing", async () => {
    enableSending({ BREVO_API_KEY: undefined });

    const result = await sendTemplatedEmail(MESSAGE);

    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(logged.payloads[0].error)).toContain("BREVO_API_KEY");
  });

  it("refuses an invalid recipient before it reaches the provider", async () => {
    enableSending();

    const result = await sendTemplatedEmail({ ...MESSAGE, toEmail: "not-an-address" });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged.payloads[0].status).toBe("failed");
  });

  it("refuses a message with no subject or no body", async () => {
    enableSending();

    expect((await sendTemplatedEmail({ ...MESSAGE, subject: "   " })).ok).toBe(false);
    expect((await sendTemplatedEmail({ ...MESSAGE, body: "" })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
