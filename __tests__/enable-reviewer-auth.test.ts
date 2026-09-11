import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
// The password link in the letter is built from the public origin. The header
// stub is what lets these cases prove the origin is carried.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "os.alumni-mentoring.edu.vn", "x-forwarded-proto": "https" })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  canOperateSeason: vi.fn(),
  getAdminScopeContext: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendReviewerInvite: vi.fn() }));
vi.mock("@/lib/outbound-emails", () => ({ hasRecentSentEmail: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendReviewerInvite } from "@/lib/email";
import { hasRecentSentEmail } from "@/lib/outbound-emails";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { enableMentorAsReviewer } from "@/lib/enable-reviewer";

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const SEASON_ID = "22222222-2222-2222-2222-222222222222";
const TARGET_EMAIL = "target.person@example.com";
const INVITE_ERROR = "Không thể tạo lời mời đăng nhập cá nhân.";

/** GoTrue caps perPage server-side; emulate a 50-per-page directory. */
const GOTRUE_PAGE_SIZE = 50;

type DirectoryUser = { id: string; email: string; last_sign_in_at?: string | null };

function makeAuthDirectory(emails: string[], extra: Partial<DirectoryUser> = {}) {
  return vi.fn(async ({ page }: { page: number; perPage: number }) => {
    const start = (page - 1) * GOTRUE_PAGE_SIZE;
    const slice = emails.slice(start, start + GOTRUE_PAGE_SIZE);
    return {
      data: { users: slice.map((email, i) => ({ id: "auth-" + (start + i), email, ...extra })) },
      error: null
    };
  });
}

/** Like Supabase: an invite creates a new account; a recovery link belongs to the account that owns the email. */
function defaultGenerateLink(directoryEmails: string[]) {
  return vi.fn(async ({ type, email }: { type: string; email: string }) => {
    const index = directoryEmails.findIndex((entry) => entry.trim().toLowerCase() === email);
    return {
      data: {
        user: { id: type === "invite" ? "auth-invited" : `auth-${index}`, email },
        properties: { hashed_token: `hash-${type}`, verification_type: type }
      },
      error: null
    };
  });
}

function buildClient(opts: {
  listUsers: ReturnType<typeof vi.fn>;
  emails?: string[];
  generateLink?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
  deleteUser?: ReturnType<typeof vi.fn>;
}) {
  const rpc = opts.rpc ?? vi.fn().mockResolvedValue({ data: "admin-user-1", error: null });
  const generateLink = opts.generateLink ?? defaultGenerateLink(opts.emails ?? []);
  const deleteUser = opts.deleteUser ?? vi.fn().mockResolvedValue({ data: null, error: null });

  const client: any = {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(
        table === "seasons"
          ? { data: { code: "UEHM-S12", name: "UEH Mentoring Season 12" }, error: null }
          : { data: { id: PERSON_ID, full_name: "Target Person", email_primary: TARGET_EMAIL }, error: null }
      )
    })),
    auth: { admin: { listUsers: opts.listUsers, generateLink, deleteUser } },
    rpc
  };

  return { client, rpc, generateLink, deleteUser };
}

const grantReviewer = () =>
  enableMentorAsReviewer({ personId: PERSON_ID, seasonId: SEASON_ID, participationRole: "reviewer" });

const inviteCalls = (generateLink: ReturnType<typeof vi.fn>) =>
  generateLink.mock.calls.filter((call) => call[0]?.type === "invite");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "actor-1",
    role: "super_admin",
    email: "actor@example.com"
  } as any);
  vi.mocked(getAdminScopeContext).mockResolvedValue({} as any);
  vi.mocked(canOperateSeason).mockResolvedValue(true as any);
  vi.mocked(sendReviewerInvite).mockResolvedValue({ ok: true, skipped: false });
  vi.mocked(hasRecentSentEmail).mockResolvedValue({ ok: true, found: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("enable-reviewer Auth pagination", () => {
  it("EXISTING_AUTH_USER_FOUND_ACROSS_PAGES: finds a user that is not on page 1", async () => {
    // 120 accounts; the target sits on page 3 of a 50-per-page directory.
    const emails = Array.from({ length: 120 }, (_, i) => "filler" + i + "@example.com");
    emails[117] = TARGET_EMAIL;

    const listUsers = makeAuthDirectory(emails);
    const { client, rpc, generateLink } = buildClient({ listUsers, emails });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "interviewer"
    });

    expect(result.ok).toBe(true);
    // Proves the walk continued past page 1.
    expect(listUsers.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(listUsers.mock.calls[0][0].page).toBe(1);

    // NO_DUPLICATE_ACCOUNT: an existing account is never re-created.
    expect(inviteCalls(generateLink)).toHaveLength(0);
    expect(result.authInvited).toBe(false);

    // TRUSTED_GRANT_RECEIVES_EXISTING_AUTH_USER_ID
    expect(rpc).toHaveBeenCalledWith(
      "vam084_grant_recruitment_participation",
      expect.objectContaining({
        p_auth_user_id: "auth-117",
        p_person_id: PERSON_ID,
        p_season_id: SEASON_ID,
        p_participation_role: "interviewer",
        p_email: TARGET_EMAIL
      })
    );
  });

  it("CASE_INSENSITIVE_MATCH: an existing account differing only in case is not re-created", async () => {
    const emails = ["  TARGET.Person@Example.COM  "];
    const listUsers = makeAuthDirectory(emails);
    const { client, rpc, generateLink } = buildClient({ listUsers, emails });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(inviteCalls(generateLink)).toHaveLength(0);
    expect(rpc).toHaveBeenCalledWith(
      "vam084_grant_recruitment_participation",
      expect.objectContaining({ p_auth_user_id: "auth-0" })
    );
  });

  it("SHORT_PAGE_IS_NOT_END_OF_DIRECTORY: keeps paging until an EMPTY page", async () => {
    // Page 1 returns fewer rows than the requested perPage (1000) but the
    // directory continues. A short-page break would miss the target and
    // create a second account for an address that already has one.
    const emails = Array.from({ length: 60 }, (_, i) => "filler" + i + "@example.com");
    emails[55] = TARGET_EMAIL;

    const listUsers = makeAuthDirectory(emails);
    const { client, generateLink } = buildClient({ listUsers, emails });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(inviteCalls(generateLink)).toHaveLength(0);
  });

  it("GENUINELY_ABSENT_USER_IS_INVITED_ONCE after the directory is exhausted", async () => {
    const listUsers = makeAuthDirectory(["someone.else@example.com"]);
    const { client, rpc, generateLink } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(result.authInvited).toBe(true);
    expect(generateLink).toHaveBeenCalledTimes(1);
    // No redirectTo: the link in the letter is this application's own, built
    // from the token hash — Supabase's action link is never used.
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: TARGET_EMAIL });
    expect(rpc).toHaveBeenCalledWith(
      "vam084_grant_recruitment_participation",
      expect.objectContaining({ p_auth_user_id: "auth-invited" })
    );
    expect(sendReviewerInvite).toHaveBeenCalledWith({
      toEmail: TARGET_EMAIL,
      mentorName: "Target Person",
      seasonLabel: "Mùa 12",
      linkType: "invite",
      tokenHash: "hash-invite",
      adminUserId: "admin-user-1",
      requestOrigin: "https://os.alumni-mentoring.edu.vn"
    });
  });

  it("FAILS_CLOSED_ON_INCONCLUSIVE_LOOKUP: never creates an account when paging is exhausted mid-directory", async () => {
    // Always-full pages: the walk can never prove the user is absent.
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: {
        users: Array.from({ length: GOTRUE_PAGE_SIZE }, (_, i) => ({
          id: "auth-" + page + "-" + i,
          email: "filler" + page + "-" + i + "@example.com"
        }))
      },
      error: null
    }));
    const { client, rpc, generateLink } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(false);
    expect(generateLink).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("NO_PERSON_SYNTHESIS: a missing people row is refused, never created", async () => {
    const listUsers = makeAuthDirectory([]);
    const { client, rpc, generateLink } = buildClient({ listUsers });
    const insert = vi.fn();
    client.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert,
      upsert: insert
    }));
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "interviewer"
    });

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SCOPE_DENIED: a season the actor cannot operate is refused before any Auth call", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false as any);
    const listUsers = makeAuthDirectory([TARGET_EMAIL]);
    const { client, rpc, generateLink } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "interviewer"
    });

    expect(result.ok).toBe(false);
    expect(listUsers).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("NON_MANAGER_CANNOT_GRANT_INTERVIEWER: explicit grant stays privileged", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "reviewer-1",
      role: "reviewer",
      email: "reviewer@example.com"
    } as any);
    const listUsers = makeAuthDirectory([TARGET_EMAIL]);
    const { client, rpc } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "interviewer"
    });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("thư đặt mật khẩu đi qua Brevo, không qua thư của Supabase", () => {
  it("tài khoản mới: báo đã gửi thư tới đúng địa chỉ", async () => {
    const { client } = buildClient({ listUsers: makeAuthDirectory([]) });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      `Đã cấp quyền Reviewer hồ sơ cho đúng mùa. Đã gửi thư đặt mật khẩu tới ${TARGET_EMAIL} — nhắc họ xem cả mục Spam.`
    );
  });

  it("Supabase từ chối tạo tài khoản: không cấp quyền, không gửi thư, và GHI LẠI lý do", async () => {
    const generateLink = vi.fn(async () => ({
      data: null,
      error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }
    }));
    const { client, rpc } = buildClient({ listUsers: makeAuthDirectory([]), generateLink });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result).toEqual({ ok: false, message: INVITE_ERROR });
    expect(rpc).not.toHaveBeenCalled();
    expect(sendReviewerInvite).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[enable-reviewer] generateLink failed",
      expect.objectContaining({ type: "invite", code: "over_email_send_rate_limit" })
    );
  });

  it("link trả về thuộc một email khác: không cấp quyền", async () => {
    const generateLink = vi.fn(async () => ({
      data: { user: { id: "auth-x", email: "nguoi-khac@example.com" }, properties: { hashed_token: "h" } },
      error: null
    }));
    const { client, rpc } = buildClient({ listUsers: makeAuthDirectory([]), generateLink });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result).toEqual({ ok: false, message: INVITE_ERROR });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cấp quyền hỏng sau khi đã tạo tài khoản: xoá tài khoản vừa tạo, không gửi thư", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const { client, deleteUser } = buildClient({ listUsers: makeAuthDirectory([]), rpc });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("auth-invited");
    expect(sendReviewerInvite).not.toHaveBeenCalled();
  });

  it("có tài khoản mà chưa đăng nhập lần nào: cấp quyền TRƯỚC, rồi gửi link khôi phục", async () => {
    const emails = [TARGET_EMAIL];
    const { client, rpc, generateLink } = buildClient({ listUsers: makeAuthDirectory(emails), emails });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: TARGET_EMAIL });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(generateLink.mock.invocationCallOrder[0]);
    expect(sendReviewerInvite).toHaveBeenCalledWith(
      expect.objectContaining({ linkType: "recovery", tokenHash: "hash-recovery" })
    );
  });

  it("vừa gửi thư cho người này trong một giờ qua: không gửi thư thứ hai làm hỏng link thư đầu", async () => {
    const emails = [TARGET_EMAIL];
    vi.mocked(hasRecentSentEmail).mockResolvedValue({ ok: true, found: true });
    const { client, generateLink } = buildClient({ listUsers: makeAuthDirectory(emails), emails });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.message).toBe("Đã cấp quyền Reviewer hồ sơ cho đúng mùa.");
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendReviewerInvite).not.toHaveBeenCalled();
    expect(hasRecentSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reviewer_invite", toEmail: TARGET_EMAIL })
    );
  });

  it("đã từng đăng nhập: chỉ cấp quyền, không gửi thư", async () => {
    const emails = [TARGET_EMAIL];
    const listUsers = makeAuthDirectory(emails, { last_sign_in_at: "2026-09-01T00:00:00Z" });
    const { client, generateLink } = buildClient({ listUsers, emails });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.message).toBe("Đã cấp quyền Reviewer hồ sơ cho đúng mùa.");
    expect(generateLink).not.toHaveBeenCalled();
    expect(hasRecentSentEmail).not.toHaveBeenCalled();
    expect(sendReviewerInvite).not.toHaveBeenCalled();
  });

  it("link khôi phục thuộc tài khoản khác: vẫn giữ quyền đã cấp, nói rõ CHƯA gửi thư", async () => {
    const emails = [TARGET_EMAIL];
    const generateLink = vi.fn(async () => ({
      data: { user: { id: "auth-9", email: TARGET_EMAIL }, properties: { hashed_token: "h" } },
      error: null
    }));
    const { client } = buildClient({ listUsers: makeAuthDirectory(emails), emails, generateLink });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(result.message).toContain("CHƯA gửi được thư đặt mật khẩu");
    expect(sendReviewerInvite).not.toHaveBeenCalled();
  });

  it("thư không đi được: quyền vẫn đã cấp, dòng báo nói rõ và chỉ cách gửi lại", async () => {
    vi.mocked(sendReviewerInvite).mockResolvedValue({ ok: false, skipped: false, providerStatus: 500 });
    const { client } = buildClient({ listUsers: makeAuthDirectory([]) });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.ok).toBe(true);
    expect(result.message).toContain("CHƯA gửi được thư đặt mật khẩu");
    expect(result.message).toContain("Thu hồi rồi Cấp lại");
    expect(result.message).not.toContain("Đã gửi thư");
  });

  it("cổng thư tắt: không báo là đã gửi", async () => {
    vi.mocked(sendReviewerInvite).mockResolvedValue({ ok: true, skipped: true });
    const { client } = buildClient({ listUsers: makeAuthDirectory([]) });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await grantReviewer();

    expect(result.message).toContain("đang tắt gửi thư");
    expect(result.message).not.toContain("Đã gửi thư");
  });

  it("mã nguồn không còn gọi thư mời của Supabase", () => {
    const source = readFileSync(join(__dirname, "..", "lib", "enable-reviewer.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toContain("inviteUserByEmail");
  });
});
