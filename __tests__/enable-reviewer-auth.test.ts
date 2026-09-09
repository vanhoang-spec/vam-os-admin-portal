import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});

vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
// An invite with no destination lands on the Supabase Site URL, where nothing
// can read the token out of the fragment. The header stub is what lets these
// cases prove the destination is carried.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "os.alumni-mentoring.edu.vn", "x-forwarded-proto": "https" })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  canOperateSeason: vi.fn(),
  getAdminScopeContext: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { enableMentorAsReviewer } from "@/lib/enable-reviewer";

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const SEASON_ID = "22222222-2222-2222-2222-222222222222";
const TARGET_EMAIL = "target.person@example.com";

/** GoTrue caps perPage server-side; emulate a 50-per-page directory. */
const GOTRUE_PAGE_SIZE = 50;

function makeAuthDirectory(emails: string[]) {
  return vi.fn(async ({ page }: { page: number; perPage: number }) => {
    const start = (page - 1) * GOTRUE_PAGE_SIZE;
    const slice = emails.slice(start, start + GOTRUE_PAGE_SIZE);
    return {
      data: { users: slice.map((email, i) => ({ id: "auth-" + (start + i), email })) },
      error: null
    };
  });
}

function buildClient(opts: {
  listUsers: ReturnType<typeof vi.fn>;
  inviteUserByEmail?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
  deleteUser?: ReturnType<typeof vi.fn>;
}) {
  const rpc = opts.rpc ?? vi.fn().mockResolvedValue({ data: "admin-user-1", error: null });
  const inviteUserByEmail =
    opts.inviteUserByEmail ??
    vi.fn().mockResolvedValue({ data: { user: { id: "auth-invited" } }, error: null });
  const deleteUser = opts.deleteUser ?? vi.fn().mockResolvedValue({ data: null, error: null });

  const client: any = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: PERSON_ID, full_name: "Target Person", email_primary: TARGET_EMAIL },
        error: null
      })
    })),
    auth: { admin: { listUsers: opts.listUsers, inviteUserByEmail, deleteUser } },
    rpc
  };

  return { client, rpc, inviteUserByEmail };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "actor-1",
    role: "super_admin",
    email: "actor@example.com"
  } as any);
  vi.mocked(getAdminScopeContext).mockResolvedValue({} as any);
  vi.mocked(canOperateSeason).mockResolvedValue(true as any);
});

describe("enable-reviewer Auth pagination", () => {
  it("EXISTING_AUTH_USER_FOUND_ACROSS_PAGES: finds a user that is not on page 1", async () => {
    // 120 accounts; the target sits on page 3 of a 50-per-page directory.
    const emails = Array.from({ length: 120 }, (_, i) => "filler" + i + "@example.com");
    emails[117] = TARGET_EMAIL;

    const listUsers = makeAuthDirectory(emails);
    const { client, rpc, inviteUserByEmail } = buildClient({ listUsers });
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

    // NO_DUPLICATE_INVITE_ATTEMPT
    expect(inviteUserByEmail).not.toHaveBeenCalled();
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

  it("CASE_INSENSITIVE_MATCH: an existing account differing only in case is not re-invited", async () => {
    const listUsers = makeAuthDirectory(["  TARGET.Person@Example.COM  "]);
    const { client, rpc, inviteUserByEmail } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "reviewer"
    });

    expect(result.ok).toBe(true);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "vam084_grant_recruitment_participation",
      expect.objectContaining({ p_auth_user_id: "auth-0" })
    );
  });

  it("SHORT_PAGE_IS_NOT_END_OF_DIRECTORY: keeps paging until an EMPTY page", async () => {
    // Page 1 returns fewer rows than the requested perPage (1000) but the
    // directory continues. A short-page break would miss the target and
    // mis-invite an account that already exists.
    const emails = Array.from({ length: 60 }, (_, i) => "filler" + i + "@example.com");
    emails[55] = TARGET_EMAIL;

    const listUsers = makeAuthDirectory(emails);
    const { client, inviteUserByEmail } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "reviewer"
    });

    expect(result.ok).toBe(true);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("GENUINELY_ABSENT_USER_IS_INVITED_ONCE after the directory is exhausted", async () => {
    const listUsers = makeAuthDirectory(["someone.else@example.com"]);
    const { client, rpc, inviteUserByEmail } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "reviewer"
    });

    expect(result.ok).toBe(true);
    expect(result.authInvited).toBe(true);
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    // The destination is the whole point: without it the invited reviewer lands
    // on a page that cannot consume their token and is bounced to /login.
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      "target.person@example.com",
      { redirectTo: "https://os.alumni-mentoring.edu.vn/auth/callback?next=%2Freviews" }
    );
    expect(rpc).toHaveBeenCalledWith(
      "vam084_grant_recruitment_participation",
      expect.objectContaining({ p_auth_user_id: "auth-invited" })
    );
  });

  it("FAILS_CLOSED_ON_INCONCLUSIVE_LOOKUP: never invites when paging is exhausted mid-directory", async () => {
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
    const { client, rpc, inviteUserByEmail } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "reviewer"
    });

    expect(result.ok).toBe(false);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("NO_PERSON_SYNTHESIS: a missing people row is refused, never created", async () => {
    const listUsers = makeAuthDirectory([]);
    const { client, rpc, inviteUserByEmail } = buildClient({ listUsers });
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
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SCOPE_DENIED: a season the actor cannot operate is refused before any Auth call", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false as any);
    const listUsers = makeAuthDirectory([TARGET_EMAIL]);
    const { client, rpc, inviteUserByEmail } = buildClient({ listUsers });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const result = await enableMentorAsReviewer({
      personId: PERSON_ID,
      seasonId: SEASON_ID,
      participationRole: "interviewer"
    });

    expect(result.ok).toBe(false);
    expect(listUsers).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
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
