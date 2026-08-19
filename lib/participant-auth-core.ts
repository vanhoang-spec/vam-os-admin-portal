/**
 * lib/participant-auth-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Where somebody goes after they sign in.
 *
 * The login form asks for an email and a password and nothing else — no
 * programme, no role, no season. Everything after that is the system working out
 * who this is and what they are entitled to, which is exactly the kind of
 * branching that should be a pure function with tests rather than conditionals
 * scattered through a server action.
 *
 * Three rules shape it:
 *
 * NOBODY IS GUESSED AT. A signed-in visitor who is neither staff nor a linked
 * participant gets a refusal, not a best effort. Guessing which person an
 * unrecognised address belongs to means showing someone else's records.
 *
 * ONE PROGRAMME MEANS NO QUESTION. The picker exists for people in more than one
 * programme. Asking someone to choose from a list of one is a step that teaches
 * them nothing.
 *
 * A PARTICIPANT NEVER LANDS IN THE STAFF PORTAL. Their `next` is honoured only
 * when it points somewhere participants are allowed; otherwise it is dropped
 * rather than followed.
 */

// ── Where the flow can end ───────────────────────────────────────────────────

/** Routes this module can send somebody to. Kept here so the tests read as prose. */
export const ROUTES = {
  /** More than one programme: choose. Shared by staff and participants. */
  chooseProgram: "/chon-chuong-trinh",
  /** One participant programme, entered directly. */
  participantHome: "/ct",
  /** Signed in, but belonging to no programme yet. */
  noMembership: "/ct",
  /** Cross-programme reporting console. */
  reports: "/bao-cao",
  /** Where staff have always landed. */
  staffHome: "/operations",
  /** Signed in to Supabase but recognised as nobody. */
  login: "/login"
} as const;

export type PostLoginOutcome =
  | "staff"
  | "reports"
  | "choose_program"
  | "single_program"
  | "no_membership"
  | "no_account";

export type PostLoginDecision = {
  outcome: PostLoginOutcome;
  redirectTo: string;
  /** Set when the outcome is `single_program`, for the message on arrival. */
  programCode?: string;
};

/** The roles that read across every programme and operate none of them. */
export const CROSS_PROGRAM_REPORT_ROLES = ["super_admin", "vam_admin"] as const;

/** Reporting is all `vam_admin` may do; super_admin has it in addition to everything else. */
export function canViewCrossProgramReports(role: unknown): boolean {
  return (CROSS_PROGRAM_REPORT_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** True for the read-only reporting account — no operational screen should admit it. */
export function isReportOnlyRole(role: unknown): boolean {
  return String(role ?? "") === "vam_admin";
}

// ── What the decision is made from ───────────────────────────────────────────

export type ProgramChoice = {
  programId: string;
  programCode: string;
  programName: string;
  /** mentor or mentee — what this person is in this programme. */
  role?: string | null;
  /** The season the programme is running, if one has been set. */
  currentSeasonCode?: string | null;
  currentSeasonName?: string | null;
};

export type PostLoginInput = {
  /** An active `admin_users` row, if this login is staff. */
  adminRole?: string | null;
  /** True when an active `participant_accounts` row resolved. */
  hasParticipantAccount?: boolean;
  /** Programmes this person may enter — already filtered to active. */
  programs?: ProgramChoice[];
  /** The `next` parameter from the login form, already passed through safeNext. */
  requestedNext?: string | null;
};

// ── Participant routes ───────────────────────────────────────────────────────

/**
 * Paths a participant is allowed to reach.
 *
 * Deliberately a prefix allow-list rather than a deny-list of staff routes: a
 * page added tomorrow is closed to participants until somebody decides
 * otherwise, which is the safe direction for a list that will keep growing.
 */
const PARTICIPANT_PATH_PREFIXES = ["/ct", "/chon-chuong-trinh"];

export function isParticipantPath(path: unknown): boolean {
  const value = String(path ?? "").trim();
  if (!value.startsWith("/")) return false;
  return PARTICIPANT_PATH_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)
  );
}

/**
 * Paths the read-only reporting account may reach.
 *
 * `vam_admin` exists to generate and export reports and to do nothing else, so
 * the fence is an allow-list here rather than a list of screens to keep them
 * out of. A page added tomorrow is closed to them by default.
 */
const REPORT_ONLY_PATH_PREFIXES = [ROUTES.reports, ROUTES.chooseProgram];

export function isReportOnlyPath(path: unknown): boolean {
  const value = String(path ?? "").trim();
  if (!value.startsWith("/")) return false;
  return REPORT_ONLY_PATH_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)
  );
}

/** The home of one programme, for a participant. */
export function participantHomePath(programCode: unknown): string {
  const code = String(programCode ?? "").trim();
  if (!code) return ROUTES.noMembership;
  return `${ROUTES.participantHome}/${encodeURIComponent(code)}`;
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * Decide where a freshly signed-in visitor goes.
 *
 * Staff are resolved first: somebody who is both staff and a participant (a
 * mentor granted an interviewer account, which the app already does) keeps the
 * staff experience, because that is the more capable of the two and the one
 * they signed in expecting.
 */
export function resolvePostLogin(input: PostLoginInput): PostLoginDecision {
  const programs = Array.isArray(input.programs) ? input.programs : [];
  const adminRole = String(input.adminRole ?? "").trim();

  // ── Staff ──────────────────────────────────────────────────────────────────
  if (adminRole) {
    // Read-only reporting: there is nowhere else for this account to be.
    if (isReportOnlyRole(adminRole)) {
      return { outcome: "reports", redirectTo: ROUTES.reports };
    }

    // A deep link they followed before being asked to sign in wins over the
    // picker — they already said where they were going.
    const next = String(input.requestedNext ?? "").trim();
    if (next && next !== ROUTES.staffHome) {
      return { outcome: "staff", redirectTo: next };
    }

    // Super admins reach every programme, so the picker is always worth showing;
    // other staff only see it when they genuinely have a choice to make.
    if (adminRole === "super_admin" || programs.length > 1) {
      return { outcome: "choose_program", redirectTo: ROUTES.chooseProgram };
    }

    return { outcome: "staff", redirectTo: next || ROUTES.staffHome };
  }

  // ── Participants ───────────────────────────────────────────────────────────
  if (input.hasParticipantAccount) {
    if (programs.length === 0) {
      return { outcome: "no_membership", redirectTo: ROUTES.noMembership };
    }

    if (programs.length === 1) {
      const only = programs[0];
      const next = String(input.requestedNext ?? "").trim();
      // Honour a deep link only if it leads somewhere participants may go.
      const target = isParticipantPath(next) ? next : participantHomePath(only.programCode);
      return { outcome: "single_program", redirectTo: target, programCode: only.programCode };
    }

    return { outcome: "choose_program", redirectTo: ROUTES.chooseProgram };
  }

  // ── Neither ────────────────────────────────────────────────────────────────
  // A Supabase account with no staff row and no participant link. Never guessed
  // at, never partially admitted.
  return { outcome: "no_account", redirectTo: ROUTES.login };
}

// ── Matching an address to a person ──────────────────────────────────────────

export type EmailMatchResult =
  | { ok: true; personId: string }
  | { ok: false; reason: "no_match" | "ambiguous" | "invalid_email"; message: string };

/**
 * Resolve a login address to exactly one person, or refuse.
 *
 * This is the self-registration path: somebody invited by nobody signs up with
 * the address the programme already holds for them. `people.email_primary` is
 * globally unique in the database, so more than one candidate means the data is
 * wrong — and the honest response is to stop and let an organiser look, not to
 * pick the first row.
 */
export function matchPersonByEmail(
  email: unknown,
  candidates: Array<{ id: string; email_primary?: string | null }>
): EmailMatchResult {
  const normalized = String(email ?? "").trim().toLowerCase();

  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    return {
      ok: false,
      reason: "invalid_email",
      message: "Địa chỉ email không hợp lệ."
    };
  }

  const matches = (candidates ?? []).filter(
    (row) => String(row?.email_primary ?? "").trim().toLowerCase() === normalized && row?.id
  );

  if (matches.length === 0) {
    return {
      ok: false,
      reason: "no_match",
      message:
        "Email này chưa có trong dữ liệu chương trình. Vui lòng liên hệ ban tổ chức để được thêm vào."
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message:
        "Email này đang trùng với nhiều hồ sơ. Ban tổ chức cần xử lý trước khi bạn đăng nhập được."
    };
  }

  return { ok: true, personId: matches[0].id };
}

// ── Presenting the programmes ────────────────────────────────────────────────

export const PROGRAM_ROLE_LABELS: Record<string, string> = {
  mentor: "mentor",
  mentee: "mentee"
};

/**
 * The one-line description under a programme on the picker.
 *
 * Says what season the programme is on and what this person is in it. When no
 * season has been set the line says so plainly rather than leaving a gap the
 * reader has to interpret.
 */
export function describeProgramChoice(choice: ProgramChoice): string {
  const parts: string[] = [];

  const season = String(choice.currentSeasonName ?? choice.currentSeasonCode ?? "").trim();
  parts.push(season ? season : "chưa mở mùa nào");

  const role = PROGRAM_ROLE_LABELS[String(choice.role ?? "")];
  if (role) parts.push(`vai trò ${role}`);

  return parts.join(" · ");
}

/** Alphabetical by name, so the list does not reshuffle between visits. */
export function sortProgramChoices(programs: ProgramChoice[]): ProgramChoice[] {
  return [...(programs ?? [])].sort((a, b) =>
    String(a.programName ?? "").localeCompare(String(b.programName ?? ""), "vi")
  );
}
