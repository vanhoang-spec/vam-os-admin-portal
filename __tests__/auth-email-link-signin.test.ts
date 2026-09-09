/**
 * Signing in from a link that arrived by email.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PATH EXISTS
 * ---------------------------------------------------------------------------
 * Supabase finishes an invite, a recovery or a magic link by redirecting the
 * browser to a URL carrying the tokens in the FRAGMENT. A fragment never
 * reaches a server, so only a client page can read it and hand it back.
 *
 * Before `/auth/callback` the only page that read a fragment was
 * `/reset-password`, and the invite carried no destination at all — so an
 * invited reviewer landed wherever the project's Site URL pointed, their token
 * was discarded by the redirect to /login, and the account they had just been
 * granted could never be entered. Season 12 was about to invite 22 volunteer
 * mentors into that.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE CASES HOLD DOWN
 * ---------------------------------------------------------------------------
 * The token arrives from the client, which read it out of its own URL, so it
 * is not evidence of anything until Supabase says it is. And a real Supabase
 * identity is still not permission to hold a session HERE. Both checks mirror
 * the password path exactly; the point of these cases is that they cannot
 * quietly stop mirroring it.
 *
 * Classification: DIRECT PRODUCTION TESTS.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..");

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSupabaseAuthClientWithAccessToken: vi.fn(),
  getSupabaseAuthClientForPasswordSignIn: vi.fn(),
  findAdminUserForAuthUser: vi.fn(),
  setAuthCookies: vi.fn(),
  clearAuthCookies: vi.fn(),
  signInWithOtp: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "os.alumni-mentoring.edu.vn", "x-forwarded-proto": "https" })
}));
vi.mock("@/lib/admin-auth", () => ({
  getSupabaseAuthClientWithAccessToken: mocks.getSupabaseAuthClientWithAccessToken,
  getSupabaseAuthClientForPasswordSignIn: mocks.getSupabaseAuthClientForPasswordSignIn,
  findAdminUserForAuthUser: mocks.findAdminUserForAuthUser,
  setAuthCookies: mocks.setAuthCookies,
  clearAuthCookies: mocks.clearAuthCookies
}));

import { completeEmailLinkSignIn } from "@/app/auth/callback/actions";
import { requestMagicLinkAction } from "@/app/login/actions";

const REVIEWER = { id: "auth-1", email: "mentor@example.com" };

function authClientReturning(user: unknown, error: unknown = null) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user }, error })) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseAuthClientWithAccessToken.mockReturnValue(authClientReturning(REVIEWER));
  mocks.findAdminUserForAuthUser.mockResolvedValue({ id: "au-1", role: "reviewer", status: "active" });
  mocks.getSupabaseAuthClientForPasswordSignIn.mockReturnValue({
    auth: { signInWithOtp: mocks.signInWithOtp }
  });
  mocks.signInWithOtp.mockResolvedValue({ error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("completeEmailLinkSignIn", () => {
  const validInput = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: 3600,
    next: "/reviews"
  };

  it("establishes the session when the token and the admin account both check out", async () => {
    const result = await completeEmailLinkSignIn(validInput);

    expect(result).toEqual({ ok: true, next: "/reviews" });
    expect(mocks.setAuthCookies).toHaveBeenCalledWith("access-token", "refresh-token", 3600);
  });

  it("lands on the review queue when the link carried no destination", async () => {
    const result = await completeEmailLinkSignIn({ ...validInput, next: undefined });

    // Every role that can hold a review assignment can open /reviews, and it is
    // where an invited mentor is going anyway.
    expect(result).toEqual({ ok: true, next: "/reviews" });
  });

  it("REJECTS_UNVERIFIED_TOKEN: a token Supabase does not recognise sets no cookie", async () => {
    mocks.getSupabaseAuthClientWithAccessToken.mockReturnValue(
      authClientReturning(null, { name: "AuthApiError", status: 401 })
    );

    const result = await completeEmailLinkSignIn({ ...validInput, accessToken: "forged" });

    expect(result.ok).toBe(false);
    expect(mocks.setAuthCookies).not.toHaveBeenCalled();
    expect(mocks.clearAuthCookies).toHaveBeenCalled();
    // The admin lookup must not even be reached on an unverified token.
    expect(mocks.findAdminUserForAuthUser).not.toHaveBeenCalled();
  });

  it("REAL_IDENTITY_IS_NOT_PERMISSION: a valid user with no active admin row is refused", async () => {
    mocks.findAdminUserForAuthUser.mockResolvedValue(null);

    const result = await completeEmailLinkSignIn(validInput);

    expect(result.ok).toBe(false);
    expect(mocks.setAuthCookies).not.toHaveBeenCalled();
    expect(mocks.clearAuthCookies).toHaveBeenCalled();
  });

  it("a thrown identity lookup fails closed rather than falling through", async () => {
    mocks.findAdminUserForAuthUser.mockRejectedValue(new Error("service role unavailable"));

    const result = await completeEmailLinkSignIn(validInput);

    expect(result.ok).toBe(false);
    expect(mocks.setAuthCookies).not.toHaveBeenCalled();
  });

  it("missing tokens are refused before any network call", async () => {
    const result = await completeEmailLinkSignIn({ ...validInput, accessToken: "", refreshToken: "" });

    expect(result.ok).toBe(false);
    expect(mocks.getSupabaseAuthClientWithAccessToken).not.toHaveBeenCalled();
  });

  it("OPEN_REDIRECT: an absolute destination is not honoured", async () => {
    const result = await completeEmailLinkSignIn({ ...validInput, next: "https://evil.example.com" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.startsWith("http")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("requestMagicLinkAction", () => {
  function form(fields: Record<string, string>) {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  }

  it("NEVER_CREATES_ACCOUNTS: shouldCreateUser is false", async () => {
    await requestMagicLinkAction(
      { error: null, sent: false },
      form({ email: "mentor@example.com", next: "/reviews" })
    );

    // Left at its default this form would provision a Supabase identity for any
    // address anyone typed into a public login page.
    expect(mocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "mentor@example.com",
        options: expect.objectContaining({ shouldCreateUser: false })
      })
    );
  });

  it("sends the reviewer to the callback route, not to the Site URL default", async () => {
    await requestMagicLinkAction(
      { error: null, sent: false },
      form({ email: "mentor@example.com", next: "/reviews" })
    );

    const options = mocks.signInWithOtp.mock.calls[0][0].options;
    expect(options.emailRedirectTo).toBe("https://os.alumni-mentoring.edu.vn/auth/callback");
    // See the invite case: a query string would need a wildcard allow-list
    // entry, and its absence fails silently at the worst moment.
    expect(options.emailRedirectTo).not.toContain("?");
  });

  it("NO_ACCOUNT_ENUMERATION: an unknown address gets the same answer as a known one", async () => {
    const known = await requestMagicLinkAction(
      { error: null, sent: false },
      form({ email: "mentor@example.com" })
    );

    mocks.signInWithOtp.mockResolvedValue({
      error: { name: "AuthApiError", status: 400, message: "Signups not allowed for otp" }
    });
    const unknown = await requestMagicLinkAction(
      { error: null, sent: false },
      form({ email: "stranger@example.com" })
    );

    // Any difference here turns the login page into a directory lookup.
    expect(unknown).toEqual(known);
  });

  it("an empty address is rejected without sending anything", async () => {
    const result = await requestMagicLinkAction({ error: null, sent: false }, form({ email: "  " }));

    expect(result.sent).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("normalises the address the way the account lookup does", async () => {
    await requestMagicLinkAction(
      { error: null, sent: false },
      form({ email: "  Mentor@Example.COM  " })
    );

    expect(mocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "mentor@example.com" })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Two gates stand in front of an emailed link, and BOTH have to let it past.
 *
 * The middleware matcher is the one people remember. The second is the app
 * shell, which replaces the page with a "Cần đăng nhập" panel whenever there is
 * no admin user — and it was never told about /reset-password. So the password
 * reset page, whose entire audience is people who are logged out, rendered that
 * panel instead of its own form for every visitor it was built for.
 *
 * /auth/callback would have inherited exactly that: it runs before a session
 * exists, by definition.
 */
describe("pages that create a session are not gated behind one", () => {
  const shell = readFileSync(join(ROOT, "components", "app-shell.tsx"), "utf8");
  const middleware = readFileSync(join(ROOT, "middleware.ts"), "utf8");

  const SESSION_ESTABLISHING = ["/login", "/reset-password", "/auth/callback"];

  it("the app shell lets every session-establishing page render its own content", () => {
    const listed = shell.match(/const SESSION_ESTABLISHING_PATHS = \[([\s\S]*?)\]/);
    expect(listed).not.toBeNull();
    for (const path of SESSION_ESTABLISHING) {
      expect(listed![1]).toContain(JSON.stringify(path));
    }
  });

  it("the middleware matcher excludes the same pages", () => {
    const matcher = middleware.match(/matcher:\s*\["(.*?)"\]/)![1];
    // Written without the leading slash in the alternation.
    for (const path of SESSION_ESTABLISHING) {
      expect(matcher).toContain(path.replace(/^\//, ""));
    }
  });
});
