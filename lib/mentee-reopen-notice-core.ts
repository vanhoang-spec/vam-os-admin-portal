import { BOOKING_ELIGIBLE_STATUSES } from "@/lib/interview-schedule-core";

/**
 * lib/mentee-reopen-notice-core.ts — phần thuần của thư "mở lại chọn ca".
 *
 * Ai nhận thư: người BTC đã mở lại (mentee_interview_invites.booking_open_until,
 * migration 20261002230000) mà hạn riêng CHƯA qua, hồ sơ vẫn đủ điều kiện đặt ca
 * như vam101 xét, và CHƯA có ca. Người vừa tự chọn được ca thì thôi không nhận —
 * thư "bạn chưa chọn ca" gửi cho người đã chọn là thư sai.
 */

export type ReopenInvite = {
  id: string;
  applicationId: string;
  token: string | null;
  openUntil: string | null;
  notifiedAt: string | null;
};

export type ReopenApplicant = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  roleApplied: string;
  source: string;
  seasonId: string;
};

export type ReopenRecipient = {
  inviteId: string;
  applicationId: string;
  token: string;
  fullName: string;
  email: string;
  openUntil: string;
  notified: boolean;
};

export function pickReopenAudience(input: {
  invites: readonly ReopenInvite[];
  applicants: readonly ReopenApplicant[];
  bookedApplicationIds: ReadonlySet<string>;
  seasonId: string;
  nowIso: string;
}): ReopenRecipient[] {
  const now = Date.parse(input.nowIso);
  const byId = new Map(input.applicants.map((a) => [a.id, a]));
  const out: ReopenRecipient[] = [];
  for (const invite of input.invites) {
    const until = invite.openUntil ? Date.parse(invite.openUntil) : NaN;
    if (!Number.isFinite(until) || until <= now) continue;
    if (!invite.token) continue;
    if (input.bookedApplicationIds.has(invite.applicationId)) continue;
    const app = byId.get(invite.applicationId);
    if (!app || app.seasonId !== input.seasonId) continue;
    // Cùng luật đối tượng với vam101: mời một người mà trang sẽ báo "không đủ điều
    // kiện" là gửi một lá thư vô ích.
    if (app.roleApplied.toLowerCase() !== "mentee" || app.source !== "vam_os_form") continue;
    if (!BOOKING_ELIGIBLE_STATUSES.has(app.status)) continue;
    if (!app.email.includes("@")) continue;
    out.push({
      inviteId: invite.id,
      applicationId: invite.applicationId,
      token: invite.token,
      fullName: app.fullName,
      email: app.email,
      openUntil: invite.openUntil as string,
      notified: Boolean(invite.notifiedAt)
    });
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName, "vi") || a.applicationId.localeCompare(b.applicationId));
}

/** Hạn muộn nhất trong nhóm — một lần mở lại dùng một hạn, nhưng đừng giả định thế. */
export function latestOpenUntil(recipients: readonly ReopenRecipient[]): string | null {
  const stamps = recipients.map((r) => r.openUntil).sort((a, b) => Date.parse(a) - Date.parse(b));
  return stamps.length ? stamps[stamps.length - 1] : null;
}
