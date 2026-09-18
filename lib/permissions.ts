type AdminLike = {
  role?: string | null;
} | null | undefined;

export function canAccessAdminUser(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

export function canManageUsers(role?: string | null) {
  return role === "super_admin";
}

export function canEditRecap(adminUser: AdminLike) {
  return ["super_admin", "admin", "core_team"].includes(adminUser?.role || "");
}

/** Can assign review tasks to reviewers and see all reviews. */
export function canAssignReview(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can access /reviews and submit scoring.
 * Includes reviewer role in addition to admin tiers.
 */
export function canReview(role?: string | null) {
  return ["super_admin", "admin", "core_team", "reviewer"].includes(role || "");
}

/** True only for pure reviewer role — used to scope list to own assignments. */
export function isReviewerOnly(role?: string | null) {
  return role === "reviewer";
}

/**
 * Can make and record an application decision (status transition + audit row).
 * Intentionally excludes reviewer, support_team, and viewer.
 */
export function canDecide(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can bulk-assign applications to reviewers.
 * Same role set as canAssignReview — reviewer role cannot bulk-assign.
 */
export function canBulkAssignReviews(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can grant and revoke recruitment participation (score applications,
 * interview) on "Danh sách nhân sự tuyển sinh" — which creates the account and
 * sends the invitation for someone who has none.
 *
 * support_team is here by the programme owner's decision of 11/09/2026: they are
 * the group that actually invites reviewers. It carries nothing else — reading
 * scores, exporting results, deciding, configuring review rounds all stay on
 * canAssignReview / canBulkAssignReviews / canDecide. The database re-checks the
 * same thing through vam084_staffing_operator_for_season, which still requires
 * an operations scope on the exact season.
 */
export function canManageReviewers(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can hand one lot of applications to one reviewer, and hand assignments back,
 * on /reviews/assign-bulk.
 *
 * Deliberately NOT canBulkAssignReviews widened: that predicate also opens the
 * review-count settings and interview assignment. Same 11/09 decision and same
 * limits as canManageReviewers.
 */
export function canAssignReviewLots(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can invite mentors and mentees to create a VAM OS login — one person, or a
 * season's worth in runs — on /participant-accounts.
 *
 * support_team is here by the programme owner's decision of 11/09/2026, for the
 * same reason as canManageReviewers: they are the group that does this work.
 * This is only the role half. The caller must ALSO prove canOperateSeason for
 * the exact season, which is what keeps a support account with no operations
 * scope out.
 *
 * Deliberately NOT canSendBulkEmail widened. That gate sends words an operator
 * wrote; this one sends one fixed letter, written in code, to people the season
 * cohort already decides.
 */
export function canInviteParticipants(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can self-claim an interview review from /interviews.
 * Includes reviewer role in addition to all admin tiers.
 * Viewer and support_team cannot self-claim.
 */
export function canSelfClaimInterview(role?: string | null) {
  return ["super_admin", "admin", "core_team", "reviewer"].includes(role || "");
}

/**
 * Can create, view, and cancel mentor–mentee matches.
 * Reviewer role is excluded — only core_team and above.
 * Phase 046A: manual matching foundation.
 */
export function canManageMatches(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can OPEN or CLOSE a public application form (M069).
 *
 * Deliberately narrower than every other admin-tier permission in this file.
 * Changing this state changes what the public internet can do: opening the
 * mentor form publishes a live intake to anyone with the link, and closing it
 * mid-recruitment silently drops applicants who are part-way through.
 *
 * core_team is NOT granted. It holds `canDecide` and `canManageMatches`, but
 * those act on records already inside the system; none of them is an
 * externally-visible publication event, so neither is evidence that core_team
 * was ever intended to control public recruitment. No existing permission
 * safely maps to this action, so core_team stays read-only here until the
 * owner decides otherwise. reviewer, support_team and viewer are excluded for
 * the same reason.
 *
 * This is only the global-role half of the check. The caller must ALSO prove
 * season scope via `canOperateSeason` — a scoped admin with no UEHM-S12 grant
 * must not be able to toggle UEHM-S12.
 */
export function canToggleApplicationForm(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/** Can view the season/form control screen without being able to change it. */
export function canViewApplicationFormControls(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can edit the COPY of the public application forms — intro, deadline note,
 * support contacts — but never their fields, options or commitments.
 *
 * Owner decision 15/09/2026: admin and core team fix wording such as a moved
 * deadline themselves, without waiting for a deploy. Wider than
 * `canToggleApplicationForm` on purpose: changing a sentence on a form that is
 * already open is not a publication event, whereas opening or closing the form
 * is. The caller must ALSO prove operations scope on the season.
 */
export function canEditApplicationFormTexts(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can set the "submitted by date X → +N points" windows of an application form.
 *
 * support_team is here by the programme owner's decision of 16/09/2026: they are
 * the group asked to set these. Deliberately NOT canEditApplicationFormTexts
 * widened — that one changes words the public reads, this one changes the score
 * Core Team ranks by, and the day one of them moves the other must not follow.
 *
 * This is only the role half. The caller must ALSO prove canOperateSeason for the
 * season of the intake batch.
 */
export function canManageSubmissionBonus(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can browse general admin-tier operational surfaces: /operations,
 * /operations/tasks, /matches/[id].
 *
 * H2 fix: these routes previously gated only on season *scope* (e.g.
 * canReadSeason, which is true for any scope level including "review"),
 * never on global role. A reviewer holding a valid season review grant
 * could therefore reach operational dashboards and match detail pages
 * that have nothing to do with reviewing applications. reviewer is
 * deliberately excluded here even though it is included in canReview —
 * this predicate answers a different question (general operations
 * browsing) than review-workflow access.
 */
export function canBrowseOperations(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can switch a MENTOR between "Tham dự" and "Không tham dự" for a season on the
 * CRM profile, or make any other lifecycle move on a mentor membership. New and
 * returning mentors alike: both end up as the same person_season_memberships row.
 *
 * Owner decision 17/09/2026: core team edits the mentor result. support_team is
 * deliberately NOT here even though it holds operations scope on the season —
 * the same decision gives it mentees only. Until then scope was the only gate,
 * so support_team could change mentors too.
 *
 * This is only the role half. The caller must ALSO prove canOperateSeason for the
 * membership's season, and the database re-checks that scope.
 */
export function canChangeMentorParticipation(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/** Mentee counterpart of canChangeMentorParticipation; support_team is here by the same 17/09/2026 decision. */
export function canChangeMenteeParticipation(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * One door for every write on a season membership: the server actions and the
 * CRM controls both ask this, so a button is never offered that the server
 * refuses.
 *
 * `membershipRole` must come from the stored row, never from the form — a form
 * saying "mentee" about a mentor row is exactly how support_team would get
 * around the split. Trainer, speaker, reviewer and interviewer keep the tiers
 * that held operations scope before the split; that set now also shuts out a
 * reviewer or viewer who is ever granted operations scope by mistake.
 */
export function canChangeSeasonMembership(role: string | null | undefined, membershipRole: unknown) {
  const kind = String(membershipRole ?? "").trim().toLowerCase();
  if (kind === "mentor") return canChangeMentorParticipation(role);
  if (kind === "mentee") return canChangeMenteeParticipation(role);
  return canBrowseOperations(role);
}

/**
 * Can read the SAMPLES of the letters the system sends by itself.
 *
 * Owner decision 18/09/2026, asked for by support team: they answer the people
 * who received these letters, and until now nothing in the app showed what a
 * letter actually says.
 *
 * Wider than `canViewOutboundEmails` on purpose, and safely so: a sample is
 * built from invented data — no recipient, no real name, no working link — while
 * the log is a list of real people and their addresses.
 */
export function canViewEmailSamples(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/** Can read the outbound email log without being able to send anything. */
export function canViewOutboundEmails(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can send the confirmation-email backfill to applicants who applied before the
 * email layer existed.
 *
 * As narrow as `canToggleApplicationForm`, and for the same reason: pressing
 * this writes to people outside the system. A mistake here is not a wrong row
 * that can be corrected — it is mail already in somebody's inbox, and a second
 * press is a second letter to the same applicant. core_team is excluded on the
 * same argument used there: nothing it already holds is an outward-facing
 * publication event, so nothing maps to this.
 *
 * This is only the global-role half. The caller must ALSO prove season scope
 * via `canOperateSeason`.
 */
export function canRunConfirmationBackfill(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/**
 * Can write and edit a DRAFT bulk-email template.
 *
 * Deliberately wider than `canViewOutboundEmails`: support_team is the group
 * that actually writes to participants, and the whole point of the Mail module
 * is that they stop filing a ticket to get a sentence changed. Writing a draft
 * sends nothing — the draft sits in the app until somebody who can approve it
 * reads it.
 */
export function canComposeEmailTemplate(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can approve a template, which is what makes it eligible for a bulk send.
 *
 * As narrow as `canRunConfirmationBackfill`, and for the same reason: approval
 * is the last human read before mail reaches hundreds of inboxes, and a mistake
 * is not a wrong row that can be corrected — it is mail already delivered.
 *
 * Editing an approved template drops it back to draft, so this predicate is the
 * only way text reaches a recipient: nobody can send words an approver did not
 * read.
 */
export function canApproveEmailTemplate(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/**
 * Can press the button that sends mail to hundreds of participants.
 *
 * The narrowest gate in the Mail module, and the same allowlist as
 * `canRunConfirmationBackfill` for the same reason: a mistake here is not a
 * wrong row that can be corrected — it is mail already in somebody's inbox, and
 * there is no recall.
 *
 * Named separately from `canApproveEmailTemplate` even though the two currently
 * hold the same roles: they answer different questions, and the day one of them
 * widens, the other must not follow by accident.
 */
export function canSendBulkEmail(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/**
 * Can use the AI tools on /ai: activity ideas, content, Canva brief, industry
 * trends, document drafting.
 *
 * support_team is here by the programme owner's decision of 14/09/2026. Every
 * press sends what the user typed to DeepSeek abroad and costs API money, which
 * is why reviewer and viewer stay out. None of these tools reads programme data:
 * they work only on what the user types or uploads.
 */
export function canUseAiTools(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can run the AI executive report, the one AI tool that reads programme data
 * (season-wide counts, never names) and sends it to DeepSeek.
 *
 * Narrower than canUseAiTools by the same 14/09/2026 decision. The caller must
 * ALSO prove canReadSeason for the season being reported.
 */
export function canRunAiExecutiveReport(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/**
 * Can open /ai/status, which says whether the DeepSeek and Tavily keys are set.
 * It never shows a key, but which paid integrations exist is an admin concern.
 */
export function canViewAiStatus(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}
