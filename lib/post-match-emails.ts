import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageProgramDocuments } from "@/lib/permissions";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { getApprovedTemplate } from "@/lib/email-templates";
import { renderTemplate, TEMPLATE_SPECS, type TemplateKind } from "@/lib/email-templates-core";
import { getDocumentLinks } from "@/lib/program-documents";
import { ensureDossierLinks, getDossierLinksForMentor } from "@/lib/mentee-dossier";
import { formatInterviewTimeVi } from "@/lib/interview-scheduling-core";
import { callProvider, getProviderConfig } from "@/lib/ai-provider";
import {
  MAX_PER_BATCH,
  type CommunicationReadiness,
  type ReadinessKindState
} from "@/lib/post-match-email-action-types";

/**
 * lib/post-match-emails.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The four sends that close the season's recruitment.
 *
 *   1. mentee_selected       — you are in, here are the rules and the tips
 *   2. mentee_mentor_intro   — this is your mentor  (locked until nobody is left unmatched)
 *   3. mentor_mentee_package — these are your mentees, here is their dossier
 *   4. kickoff_invite        — come to the kick-off, here is the sign-up link
 *
 * Three rules run through all of them.
 *
 * AN APPROVED TEMPLATE OR NOTHING. A send with no approved template is refused
 * before a single address is read.
 *
 * NOBODY IS WRITTEN TO TWICE. Every attempt is already recorded in
 * outbound_emails; a recipient who has a `sent` row for this kind is skipped, so
 * a second click after a timeout continues rather than repeats.
 *
 * STAGE 2 WAITS FOR STAGE 1 TO BE TRUE. Telling a mentee who their mentor is
 * while other mentees still have nobody turns a good message into a comparison.
 * `getCommunicationReadiness` is what the screen locks on.
 */

const SAFE_ERROR = "Không thể gửi thư. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mentees who passed and should hear the result. */
const SELECTED_STATUSES = ["approved_as_mentee"];

/** Mentees still waiting for a mentor — the same definition as /matches/unmatched. */
const WAITING_STATUSES = ["interview_completed", "approved_as_mentee"];

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[post-match-emails]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type SendBatchResult = {
  ok: boolean;
  message: string;
  batchId?: string | null;
  sent?: number;
  skipped?: number;
  failed?: number;
  remaining?: number;
};

async function requireCommunicator(seasonId: string) {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false as const, message: "Bạn chưa đăng nhập." };
  if (!canManageProgramDocuments(admin.role)) {
    return { ok: false as const, message: "Bạn không có quyền gửi thư cho mentee/mentor." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền vận hành mùa này." };
  }
  return { ok: true as const, admin, adminId: admin.id };
}

// ── Readiness ────────────────────────────────────────────────────────────────

function emptyReadiness(error: string | null): CommunicationReadiness {
  return {
    ok: !error,
    error,
    seasonLabel: null,
    menteesSelected: 0,
    menteesWaiting: 0,
    activePairs: 0,
    mentorsWithMentees: 0,
    mentorsMissingBio: 0,
    everybodyMatched: false,
    documentsReady: { mentee: false, mentor: false },
    kinds: []
  };
}

export async function getCommunicationReadiness(input: {
  seasonId: string;
}): Promise<CommunicationReadiness> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) return emptyReadiness("Mùa không hợp lệ.");

  const admin = await getCurrentAdminUser();
  if (!canManageProgramDocuments(admin?.role)) {
    return emptyReadiness("Bạn không có quyền xem trung tâm gửi thư.");
  }
  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, seasonId))) {
    return emptyReadiness("Bạn không có quyền xem dữ liệu của mùa này.");
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return emptyReadiness(SAFE_ERROR);

  const [seasonRes, matchRes, menteeRes, confirmationRes, sentRes, menteeDocs, mentorDocs] =
    await Promise.all([
      client.from("seasons").select("code,name").eq("id", seasonId).maybeSingle(),
      client
        .from("matches")
        .select("mentor_person_id,mentee_person_id")
        .eq("season_id", seasonId)
        .eq("status", "active"),
      client
        .from("applications")
        .select("id,person_id,status")
        .eq("season_id", seasonId)
        .eq("role_applied", "mentee")
        .in("status", Array.from(new Set([...SELECTED_STATUSES, ...WAITING_STATUSES]))),
      client
        .from("mentor_season_confirmations")
        .select("person_id,bio_short")
        .eq("season_id", seasonId)
        .eq("status", "confirmed"),
      client.from("outbound_emails").select("kind,related_id,status").eq("status", "sent"),
      getDocumentLinks({ seasonId, audience: "mentee" }),
      getDocumentLinks({ seasonId, audience: "mentor" })
    ]);

  if (matchRes.error || menteeRes.error) {
    log("readiness queries", matchRes.error ?? menteeRes.error);
    return emptyReadiness(SAFE_ERROR);
  }

  const matches = (matchRes.data ?? []) as Array<{
    mentor_person_id: string | null;
    mentee_person_id: string | null;
  }>;
  const matchedMentees = new Set(
    matches.map((row) => row.mentee_person_id).filter((id): id is string => Boolean(id))
  );
  const mentorsWithMentees = new Set(
    matches.map((row) => row.mentor_person_id).filter((id): id is string => Boolean(id))
  );

  const applications = (menteeRes.data ?? []) as Array<{
    id: string;
    person_id: string | null;
    status: string;
  }>;
  const selected = applications.filter((row) => SELECTED_STATUSES.includes(row.status));
  const waiting = applications.filter(
    (row) => WAITING_STATUSES.includes(row.status) && (!row.person_id || !matchedMentees.has(row.person_id))
  );

  const confirmations = (confirmationRes.data ?? []) as Array<{
    person_id: string;
    bio_short: string | null;
  }>;
  const mentorsMissingBio = confirmations.filter(
    (row) => mentorsWithMentees.has(row.person_id) && !String(row.bio_short ?? "").trim()
  ).length;

  const sentByKind = new Map<string, Set<string>>();
  for (const row of (sentRes.data ?? []) as Array<{ kind: string; related_id: string | null }>) {
    if (!row.related_id) continue;
    if (!sentByKind.has(row.kind)) sentByKind.set(row.kind, new Set());
    sentByKind.get(row.kind)!.add(row.related_id);
  }

  const matchedApplications = selected.filter(
    (row) => row.person_id && matchedMentees.has(row.person_id)
  );

  const everybodyMatched = waiting.length === 0 && matchedMentees.size > 0;
  const documentsReady = {
    mentee: menteeDocs.missing.length === 0,
    mentor: mentorDocs.missing.length === 0
  };

  const approvals = await Promise.all(
    (Object.keys(TEMPLATE_SPECS) as TemplateKind[]).map(async (kind) => ({
      kind,
      approved: Boolean(await getApprovedTemplate({ seasonId, kind }))
    }))
  );
  const approvedByKind = new Map(approvals.map((row) => [row.kind, row.approved]));

  const kinds: ReadinessKindState[] = [
    buildKindState({
      kind: "mentee_selected",
      recipients: selected.length,
      sentIds: sentByKind.get("mentee_selected"),
      recipientIds: selected.map((row) => row.id),
      approved: approvedByKind.get("mentee_selected") ?? false,
      extraBlockers: documentsReady.mentee ? [] : ["Tài liệu cho mentee chưa phát hành đủ."]
    }),
    buildKindState({
      kind: "mentee_mentor_intro",
      recipients: matchedApplications.length,
      sentIds: sentByKind.get("mentee_mentor_intro"),
      recipientIds: matchedApplications.map((row) => row.id),
      approved: approvedByKind.get("mentee_mentor_intro") ?? false,
      extraBlockers: [
        ...(everybodyMatched ? [] : [`Còn ${waiting.length} mentee chưa có mentor.`]),
        ...(documentsReady.mentee ? [] : ["Tài liệu cho mentee chưa phát hành đủ."]),
        ...(mentorsMissingBio ? [`${mentorsMissingBio} mentor chưa có giới thiệu ngắn.`] : [])
      ]
    }),
    buildKindState({
      kind: "mentor_mentee_package",
      recipients: mentorsWithMentees.size,
      sentIds: sentByKind.get("mentor_mentee_package"),
      recipientIds: Array.from(mentorsWithMentees),
      approved: approvedByKind.get("mentor_mentee_package") ?? false,
      extraBlockers: [
        ...(everybodyMatched ? [] : [`Còn ${waiting.length} mentee chưa có mentor.`]),
        ...(documentsReady.mentor ? [] : ["Tài liệu cho mentor chưa phát hành đủ."])
      ]
    }),
    buildKindState({
      kind: "kickoff_invite",
      recipients: matchedMentees.size + mentorsWithMentees.size,
      sentIds: sentByKind.get("kickoff_invite"),
      recipientIds: [],
      approved: approvedByKind.get("kickoff_invite") ?? false,
      extraBlockers: []
    })
  ];

  const season = seasonRes.data as { code: string | null; name: string | null } | null;

  return {
    ok: true,
    error: null,
    seasonLabel: season?.code ?? season?.name ?? null,
    menteesSelected: selected.length,
    menteesWaiting: waiting.length,
    activePairs: matches.length,
    mentorsWithMentees: mentorsWithMentees.size,
    mentorsMissingBio,
    everybodyMatched,
    documentsReady,
    kinds
  };
}

function buildKindState(input: {
  kind: TemplateKind;
  recipients: number;
  recipientIds: string[];
  sentIds?: Set<string>;
  approved: boolean;
  extraBlockers: string[];
}): ReadinessKindState {
  const alreadySent = input.recipientIds.filter((id) => input.sentIds?.has(id)).length;
  const blockers = [...input.extraBlockers];
  if (!input.approved) blockers.push("Mẫu thư chưa được duyệt.");
  if (input.recipients === 0) blockers.push("Chưa có người nhận.");

  return {
    kind: input.kind,
    label: TEMPLATE_SPECS[input.kind]?.label ?? input.kind,
    templateApproved: input.approved,
    recipients: input.recipients,
    alreadySent,
    pending: Math.max(0, input.recipients - alreadySent),
    blockers
  };
}

// ── Shared send plumbing ─────────────────────────────────────────────────────

async function openBatch(
  client: ServiceClient,
  input: {
    seasonId: string;
    kind: TemplateKind;
    templateId: string;
    requested: number;
    actorId: string;
    eventId?: string | null;
  }
): Promise<string | null> {
  const { data, error } = await client
    .from("email_batches")
    .insert({
      season_id: input.seasonId,
      kind: input.kind,
      template_id: input.templateId,
      event_id: input.eventId ?? null,
      status: "running",
      requested_count: input.requested,
      created_by: input.actorId
    })
    .select("id")
    .maybeSingle();

  if (error) {
    log("open batch", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

async function closeBatch(
  client: ServiceClient,
  batchId: string,
  counts: { sent: number; skipped: number; failed: number }
) {
  const { error } = await client
    .from("email_batches")
    .update({
      status: "completed",
      sent_count: counts.sent,
      skipped_count: counts.skipped,
      failed_count: counts.failed,
      completed_at: new Date().toISOString()
    })
    .eq("id", batchId);
  if (error) log("close batch (non-fatal)", error);
}

/** Who already received this kind, so nobody is written to twice. */
async function loadAlreadySent(
  client: ServiceClient,
  kind: TemplateKind
): Promise<Set<string>> {
  const { data, error } = await client
    .from("outbound_emails")
    .select("related_id")
    .eq("kind", kind)
    .eq("status", "sent");

  if (error) {
    log("load already sent", error);
    // Fail closed: without the list, a send could duplicate.
    return new Set(["__unknown__"]);
  }

  return new Set(
    ((data ?? []) as Array<{ related_id: string | null }>)
      .map((row) => row.related_id)
      .filter((id): id is string => Boolean(id))
  );
}

// ── 1. The mentee is told they were selected ─────────────────────────────────

export async function sendMenteeSelectedBatch(input: {
  seasonId?: unknown;
  limit?: unknown;
}): Promise<SendBatchResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) return { ok: false, message: "Mùa không hợp lệ." };

  const access = await requireCommunicator(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await getApprovedTemplate({ seasonId, kind: "mentee_selected" });
  if (!template) {
    return { ok: false, message: "Chưa có mẫu thư đã duyệt cho thư báo trúng tuyển." };
  }

  const links = await getDocumentLinks({ seasonId, audience: "mentee" });
  if (links.missing.length) {
    return {
      ok: false,
      message: "Tài liệu cho mentee chưa phát hành đủ (quy tắc ứng xử và cẩm nang)."
    };
  }

  const seasonLabel = await loadSeasonLabel(client, seasonId);
  const limit = boundedLimit(input.limit);

  const { data: appRows, error: appErr } = await client
    .from("applications")
    .select("id,full_name,email_primary")
    .eq("season_id", seasonId)
    .eq("role_applied", "mentee")
    .in("status", SELECTED_STATUSES)
    .order("submitted_at", { ascending: true });

  if (appErr) {
    log("load selected mentees", appErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const alreadySent = await loadAlreadySent(client, "mentee_selected");
  const candidates = ((appRows ?? []) as Array<{
    id: string;
    full_name: string | null;
    email_primary: string | null;
  }>).filter((row) => !alreadySent.has(row.id));

  if (!candidates.length) {
    return { ok: true, message: "Tất cả mentee đã nhận thư báo trúng tuyển.", sent: 0, skipped: 0 };
  }

  const slice = candidates.slice(0, limit);
  const batchId = await openBatch(client, {
    seasonId,
    kind: "mentee_selected",
    templateId: template.id,
    requested: slice.length,
    actorId: access.adminId
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const application of slice) {
    const rendered = renderTemplate({
      kind: "mentee_selected",
      subject: template.subject,
      body: template.body,
      values: {
        ten_mentee: application.full_name ?? "bạn",
        mua: seasonLabel,
        link_quy_tac_ung_xu: links.codeOfConduct,
        link_cam_nang: links.tips
      }
    });

    if (!rendered.ok) {
      failed++;
      continue;
    }

    const result = await sendTemplatedEmail({
      kind: "mentee_selected",
      toEmail: String(application.email_primary ?? ""),
      subject: rendered.subject,
      body: rendered.body,
      relation: { table: "applications", id: application.id },
      batchId
    });

    if (result.ok && !result.skipped) sent++;
    else if (result.ok) skipped++;
    else failed++;
  }

  if (batchId) await closeBatch(client, batchId, { sent, skipped, failed });

  return {
    ok: true,
    batchId,
    sent,
    skipped,
    failed,
    remaining: Math.max(0, candidates.length - slice.length),
    message: buildSummary({
      sent,
      skipped,
      failed,
      remaining: Math.max(0, candidates.length - slice.length)
    })
  };
}

// ── 2. The mentee is told who their mentor is ────────────────────────────────

export async function sendMenteeMentorIntroBatch(input: {
  seasonId?: unknown;
  limit?: unknown;
}): Promise<SendBatchResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) return { ok: false, message: "Mùa không hợp lệ." };

  const access = await requireCommunicator(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  const readiness = await getCommunicationReadiness({ seasonId });
  if (!readiness.everybodyMatched) {
    return {
      ok: false,
      message: `Chưa gửi được: còn ${readiness.menteesWaiting} mentee chưa có mentor. Ghép xong hết rồi mới gửi đợt này.`
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await getApprovedTemplate({ seasonId, kind: "mentee_mentor_intro" });
  if (!template) return { ok: false, message: "Chưa có mẫu thư đã duyệt cho thư giới thiệu mentor." };

  const links = await getDocumentLinks({ seasonId, audience: "mentee" });
  if (links.missing.length) {
    return { ok: false, message: "Tài liệu cho mentee chưa phát hành đủ." };
  }

  const seasonLabel = await loadSeasonLabel(client, seasonId);
  const limit = boundedLimit(input.limit);

  const pairs = await loadPairs(client, seasonId);
  if (!pairs.length) return { ok: false, message: "Mùa này chưa có cặp ghép nào." };

  const alreadySent = await loadAlreadySent(client, "mentee_mentor_intro");
  const candidates = pairs.filter(
    (pair) => pair.applicationId && !alreadySent.has(pair.applicationId) && pair.menteeEmail
  );

  if (!candidates.length) {
    return { ok: true, message: "Tất cả mentee đã nhận thư giới thiệu mentor.", sent: 0, skipped: 0 };
  }

  const slice = candidates.slice(0, limit);
  const batchId = await openBatch(client, {
    seasonId,
    kind: "mentee_mentor_intro",
    templateId: template.id,
    requested: slice.length,
    actorId: access.adminId
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const pair of slice) {
    const rendered = renderTemplate({
      kind: "mentee_mentor_intro",
      subject: template.subject,
      body: template.body,
      values: {
        ten_mentee: pair.menteeName ?? "bạn",
        ten_mentor: pair.mentorName ?? "mentor của bạn",
        gioi_thieu_mentor: pair.mentorBio ?? "",
        mua: seasonLabel,
        link_quy_tac_ung_xu: links.codeOfConduct,
        link_cam_nang: links.tips
      }
    });

    if (!rendered.ok) {
      // Most often a mentor with no short introduction yet.
      failed++;
      continue;
    }

    const result = await sendTemplatedEmail({
      kind: "mentee_mentor_intro",
      toEmail: pair.menteeEmail as string,
      subject: rendered.subject,
      body: rendered.body,
      relation: { table: "applications", id: pair.applicationId as string },
      batchId
    });

    if (result.ok && !result.skipped) sent++;
    else if (result.ok) skipped++;
    else failed++;
  }

  if (batchId) await closeBatch(client, batchId, { sent, skipped, failed });

  const remaining = Math.max(0, candidates.length - slice.length);
  return {
    ok: true,
    batchId,
    sent,
    skipped,
    failed,
    remaining,
    message: buildSummary({ sent, skipped, failed, remaining })
  };
}

// ── 3. The mentor receives their mentees ─────────────────────────────────────

export async function sendMentorPackageBatch(input: {
  seasonId?: unknown;
  limit?: unknown;
}): Promise<SendBatchResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) return { ok: false, message: "Mùa không hợp lệ." };

  const access = await requireCommunicator(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  const readiness = await getCommunicationReadiness({ seasonId });
  if (!readiness.everybodyMatched) {
    return {
      ok: false,
      message: `Chưa gửi được: còn ${readiness.menteesWaiting} mentee chưa có mentor.`
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await getApprovedTemplate({ seasonId, kind: "mentor_mentee_package" });
  if (!template) return { ok: false, message: "Chưa có mẫu thư đã duyệt cho thư gửi mentor." };

  const links = await getDocumentLinks({ seasonId, audience: "mentor" });
  if (links.missing.length) {
    return { ok: false, message: "Tài liệu cho mentor chưa phát hành đủ." };
  }

  // The dossier links have to exist before the letter that carries them.
  const ensured = await ensureDossierLinks({ seasonId });
  if (!ensured.ok) return { ok: false, message: ensured.message };

  const seasonLabel = await loadSeasonLabel(client, seasonId);
  const limit = boundedLimit(input.limit);

  const pairs = await loadPairs(client, seasonId);
  const byMentor = new Map<
    string,
    { mentorName: string | null; mentorEmail: string | null; mentees: string[] }
  >();
  for (const pair of pairs) {
    if (!pair.mentorPersonId) continue;
    const entry =
      byMentor.get(pair.mentorPersonId) ??
      { mentorName: pair.mentorName, mentorEmail: pair.mentorEmail, mentees: [] as string[] };
    if (pair.menteeName) entry.mentees.push(pair.menteeName);
    byMentor.set(pair.mentorPersonId, entry);
  }

  const alreadySent = await loadAlreadySent(client, "mentor_mentee_package");
  const candidates = Array.from(byMentor.entries()).filter(
    ([personId, entry]) => !alreadySent.has(personId) && entry.mentorEmail
  );

  if (!candidates.length) {
    return { ok: true, message: "Tất cả mentor đã nhận thư kèm hồ sơ mentee.", sent: 0, skipped: 0 };
  }

  const slice = candidates.slice(0, limit);
  const batchId = await openBatch(client, {
    seasonId,
    kind: "mentor_mentee_package",
    templateId: template.id,
    requested: slice.length,
    actorId: access.adminId
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [personId, entry] of slice) {
    const dossiers = await getDossierLinksForMentor({ seasonId, mentorPersonId: personId });
    if (!dossiers.length) {
      failed++;
      continue;
    }

    const rendered = renderTemplate({
      kind: "mentor_mentee_package",
      subject: template.subject,
      body: template.body,
      values: {
        ten_mentor: entry.mentorName ?? "anh/chị",
        so_luong_mentee: entry.mentees.length,
        danh_sach_mentee: entry.mentees.join(", "),
        link_ho_so: dossiers.map((row) => row.url).join("\n"),
        mua: seasonLabel,
        link_quy_tac_ung_xu: links.codeOfConduct,
        link_cam_nang: links.tips
      }
    });

    if (!rendered.ok) {
      failed++;
      continue;
    }

    const result = await sendTemplatedEmail({
      kind: "mentor_mentee_package",
      toEmail: entry.mentorEmail as string,
      subject: rendered.subject,
      body: rendered.body,
      relation: { table: "people", id: personId },
      batchId
    });

    if (result.ok && !result.skipped) sent++;
    else if (result.ok) skipped++;
    else failed++;
  }

  if (batchId) await closeBatch(client, batchId, { sent, skipped, failed });

  const remaining = Math.max(0, candidates.length - slice.length);
  return {
    ok: true,
    batchId,
    sent,
    skipped,
    failed,
    remaining,
    message: buildSummary({ sent, skipped, failed, remaining })
  };
}

// ── 4. Both sides are invited to the kick-off ───────────────────────────────

export async function sendKickoffInviteBatch(input: {
  seasonId?: unknown;
  eventId?: unknown;
  audience?: unknown;
  limit?: unknown;
}): Promise<SendBatchResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  const eventId = String(input.eventId ?? "").trim();
  const audience = String(input.audience ?? "both").trim();

  if (!isValidUuid(seasonId)) return { ok: false, message: "Mùa không hợp lệ." };
  if (!isValidUuid(eventId)) return { ok: false, message: "Vui lòng chọn sự kiện kick-off." };
  if (!["mentee", "mentor", "both"].includes(audience)) {
    return { ok: false, message: "Nhóm người nhận không hợp lệ." };
  }

  const access = await requireCommunicator(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await getApprovedTemplate({ seasonId, kind: "kickoff_invite" });
  if (!template) return { ok: false, message: "Chưa có mẫu thư đã duyệt cho thư mời kick-off." };

  const event = await loadEventWithLink(client, eventId);
  if (!event) {
    return {
      ok: false,
      message: "Sự kiện chưa có đường dẫn đăng ký công khai. Vui lòng tạo đường dẫn ở trang sự kiện trước."
    };
  }

  const seasonLabel = await loadSeasonLabel(client, seasonId);
  const limit = boundedLimit(input.limit);
  const pairs = await loadPairs(client, seasonId);

  type Recipient = { id: string; name: string | null; email: string | null; table: string };
  const recipients: Recipient[] = [];

  if (audience !== "mentor") {
    for (const pair of pairs) {
      if (!pair.applicationId || !pair.menteeEmail) continue;
      recipients.push({
        id: pair.applicationId,
        name: pair.menteeName,
        email: pair.menteeEmail,
        table: "applications"
      });
    }
  }
  if (audience !== "mentee") {
    const seen = new Set<string>();
    for (const pair of pairs) {
      if (!pair.mentorPersonId || !pair.mentorEmail || seen.has(pair.mentorPersonId)) continue;
      seen.add(pair.mentorPersonId);
      recipients.push({
        id: pair.mentorPersonId,
        name: pair.mentorName,
        email: pair.mentorEmail,
        table: "people"
      });
    }
  }

  const alreadySent = await loadAlreadySent(client, "kickoff_invite");
  const candidates = recipients.filter((row) => !alreadySent.has(row.id));

  if (!candidates.length) {
    return { ok: true, message: "Tất cả người nhận đã có thư mời kick-off.", sent: 0, skipped: 0 };
  }

  const slice = candidates.slice(0, limit);
  const batchId = await openBatch(client, {
    seasonId,
    kind: "kickoff_invite",
    templateId: template.id,
    requested: slice.length,
    actorId: access.adminId,
    eventId
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipient of slice) {
    const rendered = renderTemplate({
      kind: "kickoff_invite",
      subject: template.subject,
      body: template.body,
      values: {
        ten_nguoi_nhan: recipient.name ?? "bạn",
        ten_su_kien: event.name,
        thoi_gian: event.timeLabel ?? "sẽ thông báo",
        dia_diem: event.location ?? "sẽ thông báo",
        link_dang_ky: event.registrationUrl,
        mua: seasonLabel
      }
    });

    if (!rendered.ok) {
      failed++;
      continue;
    }

    const result = await sendTemplatedEmail({
      kind: "kickoff_invite",
      toEmail: recipient.email as string,
      subject: rendered.subject,
      body: rendered.body,
      relation: { table: recipient.table, id: recipient.id },
      batchId
    });

    if (result.ok && !result.skipped) sent++;
    else if (result.ok) skipped++;
    else failed++;
  }

  if (batchId) await closeBatch(client, batchId, { sent, skipped, failed });

  const remaining = Math.max(0, candidates.length - slice.length);
  return {
    ok: true,
    batchId,
    sent,
    skipped,
    failed,
    remaining,
    message: buildSummary({ sent, skipped, failed, remaining })
  };
}

// ── Mentor introductions ─────────────────────────────────────────────────────

export type DraftBiosResult = {
  ok: boolean;
  message: string;
  drafted?: number;
  failed?: number;
};

const BIO_SYSTEM_PROMPT = [
  "Bạn viết đoạn giới thiệu ngắn (2-3 câu, tiếng Việt) về một mentor cho mentee đọc.",
  "Bạn chỉ nhận thông tin nghề nghiệp, không có tên — đừng bịa tên, tuổi, nơi học hay thành tích.",
  "Giọng văn ấm áp, tôn trọng, không tô hồng.",
  "Chỉ trả về JSON: {\"bio\": \"...\"}."
].join(" ");

/**
 * Draft the short introduction a mentee reads about their mentor.
 *
 * What is sent is the professional description the mentor themselves would give
 * a mentee — title, company, industry, field, years — and never a name, an
 * address or a phone number. Each draft is stored for an organiser to edit; it
 * is not used until they do.
 */
export async function draftMentorBios(input: {
  seasonId?: unknown;
  limit?: unknown;
}): Promise<DraftBiosResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) return { ok: false, message: "Mùa không hợp lệ." };

  const access = await requireCommunicator(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  const provider = getProviderConfig();
  if (!provider.ok) return { ok: false, message: `Chưa bật soạn thảo bằng AI: ${provider.reason}.` };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: confirmationRows, error: confirmationErr } = await client
    .from("mentor_season_confirmations")
    .select("id,person_id,bio_short")
    .eq("season_id", seasonId)
    .eq("status", "confirmed");

  if (confirmationErr) {
    log("load confirmations for bios", confirmationErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const missing = ((confirmationRows ?? []) as Array<{
    id: string;
    person_id: string;
    bio_short: string | null;
  }>).filter((row) => !String(row.bio_short ?? "").trim());

  if (!missing.length) {
    return { ok: true, message: "Mọi mentor đã xác nhận đều đã có giới thiệu ngắn.", drafted: 0 };
  }

  const slice = missing.slice(0, Math.min(20, boundedLimit(input.limit)));

  const { data: profileRows } = await client
    .from("mentor_profiles")
    .select("person_id,title_current,company_current,industry,function_area,years_experience_min")
    .in(
      "person_id",
      slice.map((row) => row.person_id)
    );

  const profileByPerson = new Map(
    ((profileRows ?? []) as Array<{
      person_id: string | null;
      title_current: string | null;
      company_current: string | null;
      industry: string | null;
      function_area: string | null;
      years_experience_min: number | null;
    }>)
      .filter((row) => row.person_id)
      .map((row) => [row.person_id as string, row])
  );

  let drafted = 0;
  let failed = 0;

  for (const confirmation of slice) {
    const profile = profileByPerson.get(confirmation.person_id);
    if (!profile) {
      failed++;
      continue;
    }

    // Professional fields only. No name, email or phone number is in this payload.
    const payload = JSON.stringify({
      chuc_danh: profile.title_current ?? "",
      cong_ty: profile.company_current ?? "",
      nganh: profile.industry ?? "",
      linh_vuc: profile.function_area ?? "",
      so_nam_kinh_nghiem: profile.years_experience_min ?? ""
    });

    try {
      const reply = await callProvider({
        config: provider,
        systemPrompt: BIO_SYSTEM_PROMPT,
        userPrompt: payload,
        maxTokens: 400
      });
      const parsed = JSON.parse(extractJson(reply.content)) as { bio?: unknown };
      const bio = String(parsed?.bio ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
      if (!bio) {
        failed++;
        continue;
      }

      const { error } = await client
        .from("mentor_season_confirmations")
        .update({ bio_short: bio })
        .eq("id", confirmation.id);
      if (error) {
        log("store bio", error);
        failed++;
        continue;
      }
      drafted++;
    } catch (err) {
      log("bio draft (non-fatal)", err);
      failed++;
    }
  }

  return {
    ok: true,
    drafted,
    failed,
    message: `Đã soạn ${drafted} giới thiệu ngắn${failed ? `, ${failed} chưa soạn được` : ""}. Vui lòng đọc và sửa lại trước khi gửi cho mentee.`
  };
}

function extractJson(text: string): string {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

// ── Shared loaders ───────────────────────────────────────────────────────────

type PairRow = {
  mentorPersonId: string | null;
  mentorName: string | null;
  mentorEmail: string | null;
  mentorBio: string | null;
  menteePersonId: string | null;
  menteeName: string | null;
  menteeEmail: string | null;
  applicationId: string | null;
};

async function loadPairs(client: ServiceClient, seasonId: string): Promise<PairRow[]> {
  const { data: matchRows, error } = await client
    .from("matches")
    .select("mentor_person_id,mentee_person_id")
    .eq("season_id", seasonId)
    .eq("status", "active");

  if (error) {
    log("load pairs", error);
    return [];
  }

  const matches = ((matchRows ?? []) as Array<{
    mentor_person_id: string | null;
    mentee_person_id: string | null;
  }>).filter((row) => row.mentor_person_id && row.mentee_person_id);
  if (!matches.length) return [];

  const personIds = Array.from(
    new Set(
      matches
        .flatMap((row) => [row.mentor_person_id, row.mentee_person_id])
        .filter((id): id is string => Boolean(id))
    )
  );

  const [peopleRes, confirmationRes, appRes] = await Promise.all([
    client.from("people").select("id,full_name,email_primary").in("id", personIds),
    client
      .from("mentor_season_confirmations")
      .select("person_id,bio_short")
      .eq("season_id", seasonId)
      .in("person_id", personIds),
    client
      .from("applications")
      .select("id,person_id,full_name,email_primary,submitted_at")
      .eq("season_id", seasonId)
      .eq("role_applied", "mentee")
      .in("person_id", personIds)
      .order("submitted_at", { ascending: false })
  ]);

  const peopleById = new Map(
    ((peopleRes.data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email_primary: string | null;
    }>).map((row) => [row.id, row])
  );
  const bioByPerson = new Map(
    ((confirmationRes.data ?? []) as Array<{ person_id: string; bio_short: string | null }>).map(
      (row) => [row.person_id, row.bio_short]
    )
  );
  const applicationByPerson = new Map<
    string,
    { id: string; full_name: string | null; email_primary: string | null }
  >();
  for (const row of (appRes.data ?? []) as Array<{
    id: string;
    person_id: string | null;
    full_name: string | null;
    email_primary: string | null;
  }>) {
    if (!row.person_id || applicationByPerson.has(row.person_id)) continue;
    applicationByPerson.set(row.person_id, row);
  }

  return matches.map((match) => {
    const mentor = match.mentor_person_id ? peopleById.get(match.mentor_person_id) : undefined;
    const menteePerson = match.mentee_person_id ? peopleById.get(match.mentee_person_id) : undefined;
    const application = match.mentee_person_id
      ? applicationByPerson.get(match.mentee_person_id)
      : undefined;

    return {
      mentorPersonId: match.mentor_person_id,
      mentorName: mentor?.full_name ?? null,
      mentorEmail: mentor?.email_primary ?? null,
      mentorBio: match.mentor_person_id ? bioByPerson.get(match.mentor_person_id) ?? null : null,
      menteePersonId: match.mentee_person_id,
      menteeName: application?.full_name ?? menteePerson?.full_name ?? null,
      menteeEmail: application?.email_primary ?? menteePerson?.email_primary ?? null,
      applicationId: application?.id ?? null
    };
  });
}

async function loadSeasonLabel(client: ServiceClient, seasonId: string): Promise<string> {
  const { data } = await client.from("seasons").select("code,name").eq("id", seasonId).maybeSingle();
  const season = data as { code: string | null; name: string | null } | null;
  return season?.code ?? season?.name ?? "mùa mới";
}

async function loadEventWithLink(
  client: ServiceClient,
  eventId: string
): Promise<{ name: string; timeLabel: string | null; location: string | null; registrationUrl: string } | null> {
  const [eventRes, linkRes] = await Promise.all([
    client.from("events").select("id,name,starts_at,location").eq("id", eventId).maybeSingle(),
    client
      .from("event_links")
      .select("token,is_active")
      .eq("event_id", eventId)
      .eq("link_type", "registration")
      .maybeSingle()
  ]);

  const event = eventRes.data as {
    name: string | null;
    starts_at: string | null;
    location: string | null;
  } | null;
  const link = linkRes.data as { token: string; is_active: boolean } | null;

  if (!event || !link?.token || link.is_active === false) return null;

  const { resolveEmailBaseUrl } = await import("@/lib/email");
  const base = resolveEmailBaseUrl(null);
  if (!base) return null;

  return {
    name: event.name ?? "Buổi kick-off",
    timeLabel: formatInterviewTimeVi(event.starts_at),
    location: event.location,
    registrationUrl: `${base}/register/${link.token}`
  };
}

function boundedLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_PER_BATCH;
  return Math.min(MAX_PER_BATCH, Math.floor(parsed));
}

function buildSummary(counts: {
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
}): string {
  const parts = [`Đã gửi ${counts.sent} thư`];
  if (counts.skipped) parts.push(`${counts.skipped} thư bị bỏ qua do cấu hình gửi mail`);
  if (counts.failed) parts.push(`${counts.failed} thư chưa gửi được`);
  if (counts.remaining) parts.push(`còn ${counts.remaining} người ở lượt sau`);
  return `${parts.join(" · ")}.`;
}

export { MAX_PER_BATCH } from "@/lib/post-match-email-action-types";
export type {
  CommunicationReadiness,
  ReadinessKindState
} from "@/lib/post-match-email-action-types";
