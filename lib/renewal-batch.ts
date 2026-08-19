import "server-only";

import { renewalInviteState } from "@/lib/renewal-console";
import { createRenewalInvite } from "@/lib/renewal-runtime";
import {
  RENEWAL_BATCH_CONCURRENCY,
  RENEWAL_BATCH_MAX_SIZE,
  type RenewalBatchOutcome,
  type RenewalBatchRow,
  type RenewalBatchState
} from "@/lib/renewal-types";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;

/**
 * Creates renewal links for several mentors in one operator action.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * It is NOT a bulk token minter. There is no second token implementation, no
 * batched INSERT, no shared token material and no new RPC. Every link is
 * produced by calling `createRenewalInvite` — the same function the
 * single-mentor form calls — once per mentor, which means each one inherits,
 * unchanged:
 *
 *   * the same token entropy and the same SHA-256-only storage
 *     (`mintRenewalPath` runs per call, so every mentor gets independent
 *     entropy; the raw half exists only in that call's return value)
 *   * the same `vam071_create_renewal_invite` trusted boundary, including its
 *     service_role gate, actor-authorization check, program/season binding,
 *     Season-11 refusal, mentor-only rule and live/accepted uniqueness arbiters
 *   * the same audit row per invite
 *
 * The database therefore remains the arbiter of uniqueness. The pre-flight
 * classification below is an operator convenience that produces an accurate
 * per-mentor report; it is not the safety mechanism. If a live invite appears
 * between the pre-flight read and the RPC, the RPC refuses and that mentor is
 * reported as failed rather than silently double-invited.
 *
 * ── WHY PER-MENTOR RESULTS ──────────────────────────────────────────────────
 * A batch that reported a single ok/failed would force the operator to re-check
 * 25 mentors by hand to find the one that did not get a link. Each mentor
 * carries its own outcome, and the summary counts are derived from those rows
 * rather than asserted separately, so the console cannot claim success for a
 * batch that partially failed.
 */
export async function createRenewalInviteBatch(
  input: {
    actorAdminUserId: string;
    personIds: string[];
    programId: string;
    seasonId: string;
    expiresAt: string;
  },
  client = getSupabaseServiceRoleClient()
): Promise<RenewalBatchState> {
  const fail = (message: string): RenewalBatchState => ({
    ok: false,
    message,
    createdCount: 0,
    failedCount: 0,
    skippedCount: 0,
    results: []
  });

  if (!client) return fail("Dịch vụ gia hạn chưa sẵn sàng.");

  // De-duplicate while preserving the operator's order, so a mentor selected
  // twice cannot consume two attempts.
  const personIds = Array.from(new Set(input.personIds.map((id) => String(id).trim()).filter(Boolean)));
  if (!personIds.length) return fail("Chưa chọn mentor nào.");
  if (personIds.length > RENEWAL_BATCH_MAX_SIZE) {
    return fail(`Mỗi lần chỉ tạo tối đa ${RENEWAL_BATCH_MAX_SIZE} link. Vui lòng chia nhỏ danh sách.`);
  }

  // Season identity is re-resolved from the database rather than trusted from
  // the form, and pinned to the canonical current season exactly as the
  // single-invite action pins it.
  const { data: season, error: seasonError } = await client
    .from("seasons")
    .select("id,program_id,code")
    .eq("id", input.seasonId)
    .eq("program_id", input.programId)
    .maybeSingle();
  if (seasonError || !season || season.code !== SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) {
    return fail("Season/program không hợp lệ cho gia hạn Season 12.");
  }

  const [peopleResult, profileResult, inviteResult] = await Promise.all([
    client.from("people").select("id,full_name,email_primary").in("id", personIds),
    client.from("mentor_profiles").select("id,person_id,mentor_code").in("person_id", personIds),
    client
      .from("person_season_invites")
      .select("id,person_id,expires_at,revoked_at,outcome")
      .eq("season_id", input.seasonId)
      .eq("role", "mentor")
      .in("person_id", personIds)
  ]);
  if (peopleResult.error || profileResult.error || inviteResult.error) {
    // Refuse the whole batch rather than issuing links against a half-read
    // inventory: a partial read cannot tell "no live invite" from "did not see
    // the live invite".
    console.error("[renewal-batch] inventory read failed", {
      code:
        (peopleResult.error as { code?: string })?.code ??
        (profileResult.error as { code?: string })?.code ??
        (inviteResult.error as { code?: string })?.code ??
        "UNKNOWN"
    });
    return fail("Không thể đọc dữ liệu mentor; không tạo link nào để tránh trạng thái không nhất quán.");
  }

  const peopleById = new Map<string, Row>((peopleResult.data ?? []).map((row: Row) => [String(row.id), row]));
  const profileCount = new Map<string, number>();
  const profileByPerson = new Map<string, Row>();
  for (const profile of (profileResult.data ?? []) as Row[]) {
    const key = String(profile.person_id ?? "");
    profileCount.set(key, (profileCount.get(key) ?? 0) + 1);
    profileByPerson.set(key, profile);
  }
  const acceptedPeople = new Set(
    ((inviteResult.data ?? []) as Row[]).filter((row) => row.outcome === "accepted").map((row) => String(row.person_id))
  );
  const livePeople = new Set(
    ((inviteResult.data ?? []) as Row[])
      .filter((row) => renewalInviteState(row) === "live")
      .map((row) => String(row.person_id))
  );

  function describe(personId: string): RenewalBatchRow {
    const person = peopleById.get(personId);
    const profile = profileByPerson.get(personId);
    return {
      personId,
      fullName: String(person?.full_name ?? "Không xác định"),
      mentorCode: profile?.mentor_code ? String(profile.mentor_code) : null,
      email: person?.email_primary ? String(person.email_primary) : null,
      outcome: "not_eligible",
      expiresAt: null
    };
  }

  // Classify first, mint second. The eligibility test mirrors
  // loadRenewalConsoleData exactly — exactly one canonical profile, a known
  // person, no accepted renewal, no live invite — re-derived here from a fresh
  // read so a stale page cannot smuggle in an ineligible mentor.
  const planned = personIds.map((personId) => {
    const row = describe(personId);
    // A mentor who already ACCEPTED a renewal is not "holding a live link" —
    // they are done, and re-inviting them is a different (and refused)
    // operation. They are reported as ineligible so the operator does not read
    // "Đã có invite đang hiệu lực" and go looking for a link to reuse.
    let outcome: RenewalBatchOutcome | null = null;
    if (acceptedPeople.has(personId)) outcome = "not_eligible";
    else if (livePeople.has(personId)) outcome = "skipped_live_invite";
    else if (!peopleById.has(personId) || profileCount.get(personId) !== 1) outcome = "not_eligible";

    // Eligible rows start as `failed`, not as their `describe()` default. If a
    // worker were ever to miss one, the batch reports a loud failure rather
    // than quietly mislabelling a mentor as ineligible.
    row.outcome = outcome ?? "failed";
    return { row, eligible: outcome === null };
  });

  const queue = planned.filter((item) => item.eligible);
  let cursor = 0;

  // Bounded concurrency. Each worker pulls the next index rather than the batch
  // being split into fixed slices, so one slow RPC cannot leave other workers
  // idle behind it.
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= queue.length) return;
      const item = queue[index];
      try {
        const result = await createRenewalInvite(
          {
            actorAdminUserId: input.actorAdminUserId,
            personId: item.row.personId,
            programId: input.programId,
            seasonId: input.seasonId,
            expiresAt: input.expiresAt
          },
          client
        );
        if (result.ok && result.renewalPath) {
          item.row.outcome = "created";
          item.row.expiresAt = input.expiresAt;
          // The raw path lives here and in the action response only. It is
          // never written to a table, a log line or a file.
          item.row.renewalPath = result.renewalPath;
        } else {
          item.row.outcome = "failed";
        }
      } catch (error) {
        // One mentor throwing must not abort the others, and must not be
        // reported as anyone else's outcome.
        console.error("[renewal-batch] invite failed", {
          code: (error as { code?: string })?.code ?? "UNKNOWN"
        });
        item.row.outcome = "failed";
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(RENEWAL_BATCH_CONCURRENCY, queue.length) }, () => worker())
  );

  const results = planned.map((item) => item.row);
  const createdCount = results.filter((row) => row.outcome === "created").length;
  const failedCount = results.filter((row) => row.outcome === "failed").length;
  const skippedCount = results.filter(
    (row) => row.outcome === "skipped_live_invite" || row.outcome === "not_eligible"
  ).length;

  const parts = [`Đã tạo ${createdCount}/${results.length} link`];
  if (skippedCount) parts.push(`bỏ qua ${skippedCount}`);
  if (failedCount) parts.push(`lỗi ${failedCount}`);

  return {
    // `ok` means "at least one link exists and none failed outright". A batch
    // with failures is never reported as a success, and the per-row table below
    // it is the authority either way.
    ok: createdCount > 0 && failedCount === 0,
    message: `${parts.join(", ")}. Link chỉ hiển thị trong phản hồi này; hãy sao chép hoặc tải CSV ngay.`,
    createdCount,
    failedCount,
    skippedCount,
    results
  };
}
