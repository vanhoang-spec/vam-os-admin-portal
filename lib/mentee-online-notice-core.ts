import { BOOKING_ELIGIBLE_STATUSES } from "@/lib/interview-schedule-core";
import { isOnlineVenue, sessionFullLabel } from "@/lib/mentee-interview-core";
import { linkify } from "@/lib/text-links";

/**
 * lib/mentee-online-notice-core.ts — phần thuần của thư "ca của bạn chuyển sang
 * PHỎNG VẤN ONLINE" (BTC 08/10/2026: chiều Thứ Bảy 10/10).
 *
 * Ai nhận thư: mentee ĐANG giữ chỗ một ca có địa điểm online (isOnlineVenue — câu
 * migration 20261008153000 ghi), ca chưa kết thúc, hồ sơ còn ở bước phỏng vấn, có
 * email và có link riêng. Link nhóm Zalo đọc từ chính địa điểm của ca — một nơi giữ
 * link; BTC đổi nhóm thì sửa địa điểm là thư gửi sau đó tự đúng.
 */

export const ONLINE_NOTICE_SUBJECT = "[UEH Mentoring Mùa 12] Ca phỏng vấn của bạn chuyển sang PHỎNG VẤN ONLINE";

export type OnlineSession = { id: string; startsAtIso: string; endsAtIso: string; venue: string | null };
export type OnlineBooking = { applicationId: string; sessionId: string };
export type OnlineApplicant = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  roleApplied: string;
  seasonId: string;
};
export type OnlineInvite = { id: string; applicationId: string; token: string | null; notifiedAt: string | null };

export type OnlineRecipient = {
  inviteId: string;
  applicationId: string;
  token: string;
  fullName: string;
  email: string;
  sessionLabel: string;
  groupUrl: string;
  notified: boolean;
};

/** Link đầu tiên trong địa điểm của ca (nhóm Zalo). Không có thì chuỗi rỗng. */
export function venueGroupUrl(venue: string | null | undefined): string {
  return linkify(String(venue ?? "")).find((part) => part.kind === "link")?.value ?? "";
}

export function pickOnlineAudience(input: {
  sessions: readonly OnlineSession[];
  bookings: readonly OnlineBooking[];
  applicants: readonly OnlineApplicant[];
  invites: readonly OnlineInvite[];
  seasonId: string;
  nowIso: string;
}): { recipients: OnlineRecipient[]; sessionsWithoutLink: number } {
  const now = Date.parse(input.nowIso);
  const online = new Map<string, OnlineSession>();
  let sessionsWithoutLink = 0;
  for (const s of input.sessions) {
    if (!isOnlineVenue(s.venue) || !(Date.parse(s.endsAtIso) > now)) continue;
    // Thư không có link nhóm thì mentee không biết vào đâu — không gửi, và báo cho BTC.
    if (!venueGroupUrl(s.venue)) {
      sessionsWithoutLink += 1;
      continue;
    }
    online.set(s.id, s);
  }
  const apps = new Map(input.applicants.map((a) => [a.id, a]));
  const invites = new Map(input.invites.map((i) => [i.applicationId, i]));
  const seen = new Set<string>();
  const recipients: OnlineRecipient[] = [];
  for (const b of input.bookings) {
    const session = online.get(b.sessionId);
    if (!session || seen.has(b.applicationId)) continue;
    const app = apps.get(b.applicationId);
    const invite = invites.get(b.applicationId);
    if (!app || app.seasonId !== input.seasonId || app.roleApplied.toLowerCase() !== "mentee") continue;
    // Hồ sơ đã rời bước phỏng vấn (rút, đã có kết quả) thì không báo lịch nữa.
    if (!BOOKING_ELIGIBLE_STATUSES.has(app.status)) continue;
    if (!invite?.token || !app.email.includes("@")) continue;
    seen.add(b.applicationId);
    recipients.push({
      inviteId: invite.id,
      applicationId: b.applicationId,
      token: invite.token,
      fullName: app.fullName,
      email: app.email,
      sessionLabel: sessionFullLabel(session.startsAtIso, session.endsAtIso),
      groupUrl: venueGroupUrl(session.venue),
      notified: Boolean(invite.notifiedAt)
    });
  }
  recipients.sort((a, b) => a.fullName.localeCompare(b.fullName, "vi") || a.applicationId.localeCompare(b.applicationId));
  return { recipients, sessionsWithoutLink };
}

/** Văn bản thuần: sổ thư dựng HTML từ đây (tự thoát ký tự, tự gắn link). */
export function buildOnlineNoticeEmail(input: {
  candidateName: string;
  sessionLabel: string;
  groupUrl: string;
  manageUrl: string;
  hotlineZalo: string;
}): { subject: string; text: string } {
  const lines = [
    `Chào bạn ${input.candidateName || "bạn"},`,
    `Ban tổ chức UEH Mentoring Mùa 12 xin thông báo: ca phỏng vấn của bạn vào ${input.sessionLabel} được chuyển sang hình thức PHỎNG VẤN ONLINE. Giờ ca của bạn giữ nguyên.`,
    [
      "Bạn vui lòng:",
      `1. Tham gia nhóm Zalo trước giờ ca: ${input.groupUrl}`,
      "2. Support Team sẽ điều phối theo từng ca trong nhóm; tới lượt, mentor phỏng vấn sẽ gửi link phòng online cho bạn.",
      "3. Chuẩn bị sẵn thiết bị có camera, micro và kết nối mạng ổn định."
    ].join("\n"),
    `Bạn xem lại thông tin ca của mình tại: ${input.manageUrl}`,
    `Nếu cần hỗ trợ, bạn nhắn Zalo ban tổ chức ${input.hotlineZalo}.`,
    "Thân ái,\nBan tổ chức UEH Mentoring"
  ];
  return { subject: ONLINE_NOTICE_SUBJECT, text: lines.join("\n\n") };
}
