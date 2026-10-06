import { vietnamDateKeyOf } from "@/lib/mentee-interview-core";
import type { OfflineDashboard } from "@/lib/mentee-offline-core";

/**
 * lib/mentee-interview-waves.ts — ĐỢT phỏng vấn mentee trực tiếp (BTC 06–07/10/2026).
 *
 * Một đợt là các ngày có ca liền nhau: 03–04/10 là đợt 1, 10–11/10 là đợt 2. Một cửa
 * cho mọi nơi chia theo đợt — báo cáo, màn hình phỏng vấn, menu — để "đợt 2" ở trang
 * này và "đợt 2" ở trang kia là cùng những ca.
 *
 * Không I/O, không phụ thuộc nặng: menu (component client) cũng đọc file này.
 */

export type InterviewWave = {
  /** Ngày đầu đợt, YYYY-MM-DD giờ Việt Nam — dùng làm ?dot= trên đường dẫn. */
  key: string;
  number: number;
  /** "03–04/10/2026" */
  dateLabel: string;
  /** "Đợt 1 · 03–04/10/2026" */
  label: string;
  dateKeys: string[];
  sessionIds: string[];
};

/**
 * Các đợt hiện trên menu, dưới “Phỏng vấn mentee trực tiếp”. Menu dựng ở trình duyệt
 * từ vai trò, không đọc database, nên danh sách này ghi tay — khoá phải trùng ngày
 * đầu đợt mà interviewWaves() suy từ ca. Thêm đợt 3 thì thêm một dòng ở đây.
 */
export const MENTEE_INTERVIEW_WAVE_LINKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "2026-10-03", label: "Đợt 1 · 03–04/10" },
  { key: "2026-10-10", label: "Đợt 2 · 10–11/10" }
];

function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function waveDateLabel(dateKeys: readonly string[]): string {
  if (!dateKeys.length) return "";
  const [y1, m1, d1] = dateKeys[0].split("-");
  const [y2, m2, d2] = dateKeys[dateKeys.length - 1].split("-");
  if (dateKeys.length === 1) return `${d1}/${m1}/${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2}/${m2}/${y2}`;
  if (y1 === y2) return `${d1}/${m1}–${d2}/${m2}/${y2}`;
  return `${d1}/${m1}/${y1}–${d2}/${m2}/${y2}`;
}

/**
 * Gom ca thành đợt: các ngày phỏng vấn liền nhau (cách nhau ≤ 1 ngày) là một đợt.
 * Thứ Bảy + Chủ nhật là một đợt; cuối tuần sau là đợt kế tiếp — tự xuất hiện khi
 * BTC tạo ca, không phải sửa mã.
 */
export function interviewWaves(sessions: ReadonlyArray<{ id: string; starts_at: string }>): InterviewWave[] {
  const byDate = new Map<string, string[]>();
  for (const s of sessions) {
    const key = vietnamDateKeyOf(s.starts_at);
    if (!key) continue;
    const ids = byDate.get(key) ?? [];
    ids.push(s.id);
    byDate.set(key, ids);
  }
  const groups: string[][] = [];
  for (const date of Array.from(byDate.keys()).sort()) {
    const last = groups[groups.length - 1];
    if (last && dayNumber(date) - dayNumber(last[last.length - 1]) <= 1) last.push(date);
    else groups.push([date]);
  }
  return groups.map((dateKeys, index) => {
    const dateLabel = waveDateLabel(dateKeys);
    return {
      key: dateKeys[0],
      number: index + 1,
      dateLabel,
      label: `Đợt ${index + 1} · ${dateLabel}`,
      dateKeys,
      sessionIds: dateKeys.flatMap((d) => byDate.get(d) ?? [])
    };
  });
}

/**
 * Đợt cho màn hình VẬN HÀNH (phỏng vấn trực tiếp): đợt được hỏi trên đường dẫn; không
 * có thì đợt đang diễn ra hoặc sắp tới — giữa hai đợt, Support mở màn hình là thấy
 * ngay đợt kế tiếp chứ không phải đợt đã xong. Mọi đợt đã qua thì đợt cuối.
 */
export function pickCurrentWave(
  waves: readonly InterviewWave[],
  todayKey: string,
  requested?: string | null
): InterviewWave | null {
  if (!waves.length) return null;
  const asked = requested ? waves.find((w) => w.key === requested) : undefined;
  if (asked) return asked;
  return waves.find((w) => w.dateKeys[w.dateKeys.length - 1] >= todayKey) ?? waves[waves.length - 1];
}

/** Đợt chứa một ca — để đường dẫn mở thẳng một hồ sơ (?application=) rơi đúng đợt của hồ sơ đó. */
export function waveOfSession(waves: readonly InterviewWave[], sessionId: string | null | undefined): InterviewWave | null {
  if (!sessionId) return null;
  return waves.find((w) => w.sessionIds.includes(sessionId)) ?? null;
}

/**
 * Dữ liệu màn hình phỏng vấn trực tiếp, chỉ còn các ca và mentee của MỘT đợt. Danh
 * sách ca đầy đủ giữ ở `moveTargets` — BTC vẫn đổi được một bạn sang ca của đợt khác
 * (người vắng đợt 1 chuyển sang đợt 2).
 */
export function dashboardForWave(data: OfflineDashboard, wave: InterviewWave): OfflineDashboard {
  const inWave = new Set(wave.sessionIds);
  const candidates = data.candidates.filter((c) => inWave.has(c.sessionId));
  const candidateIds = new Set(candidates.map((c) => c.id));
  return {
    ...data,
    sessions: data.sessions.filter((s) => inWave.has(s.id)),
    candidates,
    logs: data.logs.filter((log) => candidateIds.has(log.application_id)),
    moveTargets: data.moveTargets ?? data.sessions
  };
}
