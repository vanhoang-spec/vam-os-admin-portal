import { sessionDayLabel, sessionTimeLabel, vietnamDateKeyOf } from "@/lib/mentee-interview-core";
import { OFFLINE_OUTCOMES, compareByArrival, type OfflineDashboard, type OfflineOutcome } from "@/lib/mentee-offline-core";
import { formatTime } from "@/lib/utils";

/**
 * lib/mentee-progress-core.ts — tiến độ phỏng vấn mentee cho BTC (03/10/2026).
 *
 * Một bạn đang ở đâu trong buổi phỏng vấn, đọc thẳng từ dữ liệu màn hình phỏng
 * vấn trực tiếp — KHÔNG có nguồn thứ hai: trang tiến độ và màn hình Support
 * phải nói cùng một câu về cùng một người.
 *
 *   Đã xong       — đã có kết quả (Đạt / Không chọn / Cần BTC xem xét).
 *   Đang PV       — đã phân người phỏng vấn, chưa có kết quả.
 *   Chờ phân bàn  — đã check-in, chưa phân người phỏng vấn.
 *   Chưa đến      — chưa check-in.
 *   Đã rút        — hồ sơ đã rút.
 *
 * Phần thuần, không I/O: trang chỉ gửi xuống trình duyệt các cột tiến độ, không
 * gửi câu trả lời đơn hay phiếu chấm của ai.
 */

export type ProgressStatus = "done" | "in_progress" | "waiting" | "not_arrived" | "withdrawn";

export const PROGRESS_LABELS: Record<ProgressStatus, string> = {
  done: "Đã phỏng vấn xong",
  in_progress: "Đang phỏng vấn",
  waiting: "Đã đến, chờ phân bàn",
  not_arrived: "Chưa đến",
  withdrawn: "Đã rút hồ sơ"
};

export type ProgressCounts = Record<ProgressStatus, number> & { total: number } & Record<OfflineOutcome, number>;

export type ProgressRow = {
  id: string;
  name: string;
  phone: string;
  status: ProgressStatus;
  outcome: OfflineOutcome | null;
  outcomeLabel: string;
  room: number | null;
  desk: number | null;
  interviewer: string;
  checkedInAt: string | null;
  /** Tài khoản Support/BTC đã check-in (BTC 04/10/2026). */
  checkedInBy: string;
  isOnline: boolean;
};

export type ProgressSession = { id: string; startsAt: string; label: string; venue: string; counts: ProgressCounts; rows: ProgressRow[] };
export type ProgressHalf = { key: "sang" | "chieu"; label: string; counts: ProgressCounts; sessions: ProgressSession[] };
export type ProgressDay = { dateKey: string; label: string; counts: ProgressCounts; halves: ProgressHalf[] };
export type MenteeProgress = { counts: ProgressCounts; days: ProgressDay[] };

export function emptyCounts(): ProgressCounts {
  return { total: 0, done: 0, in_progress: 0, waiting: 0, not_arrived: 0, withdrawn: 0, passed: 0, rejected: 0, needs_review: 0 };
}

function add(counts: ProgressCounts, row: ProgressRow) {
  counts.total += 1;
  counts[row.status] += 1;
  if (row.status === "done" && row.outcome) counts[row.outcome] += 1;
}

type Candidate = OfflineDashboard["candidates"][number];

export function progressStatus(candidate: Pick<Candidate, "status" | "operation">): ProgressStatus {
  const op = candidate.operation;
  if (op?.outcome) return "done";
  if (candidate.status === "withdrawn") return "withdrawn";
  if (op?.interviewer_id) return "in_progress";
  if (op?.checked_in_at) return "waiting";
  return "not_arrived";
}

/** Buổi sáng là ca bắt đầu trước 12:00 giờ Việt Nam. */
export function halfOf(startsAtIso: string): "sang" | "chieu" {
  const hour = Number(formatTime(startsAtIso).slice(0, 2));
  return Number.isFinite(hour) && hour < 12 ? "sang" : "chieu";
}

export function buildMenteeProgress(data: Pick<OfflineDashboard, "sessions" | "participants" | "candidates">): MenteeProgress {
  const names = new Map(data.participants.map((p) => [p.id, p.full_name || p.email]));
  const bySession = new Map<string, ProgressRow[]>();
  for (const c of data.candidates) {
    const op = c.operation;
    const status = progressStatus(c);
    const outcome = op?.outcome ?? null;
    const row: ProgressRow = {
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      status,
      outcome,
      outcomeLabel: outcome ? OFFLINE_OUTCOMES[outcome] : "",
      room: op?.room ?? null,
      desk: op?.desk ?? null,
      interviewer: op?.interviewer_id ? names.get(op.interviewer_id) ?? "Người phỏng vấn khác" : "",
      checkedInAt: op?.checked_in_at ?? null,
      checkedInBy: op?.checked_in_at ? op?.checked_in_by_name ?? "" : "",
      isOnline: Boolean(op?.is_online)
    };
    bySession.set(c.sessionId, [...(bySession.get(c.sessionId) ?? []), row]);
  }

  const counts = emptyCounts();
  const days = new Map<string, ProgressDay>();
  const sessions = [...data.sessions].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  for (const s of sessions) {
    // Trong ca: ai check-in trước đứng trước (BTC 04/10/2026) — cùng thứ tự với màn
    // hình phỏng vấn; người đã rút hồ sơ xuống cuối.
    const rows = (bySession.get(s.id) ?? []).sort(
      (a, b) =>
        Number(a.status === "withdrawn") - Number(b.status === "withdrawn") ||
        compareByArrival({ name: a.name, checkedInAt: a.checkedInAt }, { name: b.name, checkedInAt: b.checkedInAt })
    );
    const sessionCounts = emptyCounts();
    for (const row of rows) add(sessionCounts, row);

    const dateKey = vietnamDateKeyOf(s.starts_at);
    let day = days.get(dateKey);
    if (!day) {
      day = { dateKey, label: sessionDayLabel(s.starts_at), counts: emptyCounts(), halves: [] };
      days.set(dateKey, day);
    }
    const halfKey = halfOf(s.starts_at);
    let half = day.halves.find((h) => h.key === halfKey);
    if (!half) {
      half = { key: halfKey, label: halfKey === "sang" ? "Buổi sáng" : "Buổi chiều", counts: emptyCounts(), sessions: [] };
      day.halves.push(half);
    }
    half.sessions.push({
      id: s.id,
      startsAt: s.starts_at,
      label: sessionTimeLabel(s.starts_at, s.ends_at),
      venue: s.venue ?? "",
      counts: sessionCounts,
      rows
    });
    for (const row of rows) {
      add(half.counts, row);
      add(day.counts, row);
      add(counts, row);
    }
  }
  return { counts, days: Array.from(days.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey)) };
}
