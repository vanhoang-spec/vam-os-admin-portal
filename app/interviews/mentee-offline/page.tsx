import Link from "next/link";
import { getOfflineDashboard } from "@/lib/mentee-offline";
import { roomDeskBounds } from "@/lib/mentee-offline-core";
import { sessionDayLabel, vietnamDateKeyOf } from "@/lib/mentee-interview-core";
import { dashboardForWave, interviewWaves, pickCurrentWave, waveOfSession, type InterviewWave } from "@/lib/mentee-interview-waves";
import { vietnamDateKey } from "@/lib/utils";
import { PageHeader, Card } from "@/components/ui";
import { OfflineDashboardClient } from "./workflow";

export const dynamic="force-dynamic";

const PATH = "/interviews/mentee-offline";

/**
 * "Thứ Bảy 10/10: 6 phòng, tối đa 18 mentee/ca · Chủ nhật 11/10: …" — đọc từ ca của
 * đợt, không ghi tay: đợt 1 ghi cứng "03–04/10 · Thứ Bảy 3 phòng…" và câu đó sẽ sai
 * ngay khi đợt 2 mở.
 */
function daySummary(sessions: ReadonlyArray<{ starts_at: string; venue: string | null; seat_limit: number | null }>): string {
  const byDay = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) {
    const key = vietnamDateKeyOf(s.starts_at);
    if (key && !byDay.has(key)) byDay.set(key, s);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, s]) => {
      const day = sessionDayLabel(s.starts_at).replace(/\/\d{4}$/, "");
      const where = s.venue ? `${roomDeskBounds(s.venue).rooms} phòng` : "chưa có địa điểm";
      return `${day}: ${where}, tối đa ${s.seat_limit ?? "—"} mentee/ca`;
    })
    .join(" · ");
}

function WaveTabs({ waves, current }: { waves: InterviewWave[]; current: InterviewWave }) {
  if (waves.length < 2) return null;
  return (
    <nav aria-label="Chọn đợt phỏng vấn" className="flex flex-wrap gap-2" data-testid="wave-tabs">
      {waves.map((w) => (
        <Link
          key={w.key}
          href={`${PATH}?dot=${w.key}`}
          aria-current={w.key === current.key ? "page" : undefined}
          className={
            w.key === current.key
              ? "rounded-md bg-vam-green px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-ink hover:bg-vam-mint"
          }
        >
          {w.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function OfflineInterviewPage({searchParams}:{searchParams:Promise<{application?:string; dot?:string}>}) {
  const {application, dot}=await searchParams;
  const result=await getOfflineDashboard();
  if (!result.ok) {
    return <div className="grid gap-4">
      <PageHeader title="Phỏng vấn mentee trực tiếp" />
      <Card><p role="alert">{result.message}</p></Card>
    </div>;
  }

  // Mỗi lần chỉ một đợt (BTC 07/10/2026): danh sách, ca, bàn, nhật ký đều của đợt đó.
  // Đường dẫn mở thẳng một hồ sơ rơi đúng đợt của hồ sơ đó.
  const waves=interviewWaves(result.data.sessions);
  const linked=application ? waveOfSession(waves, result.data.candidates.find(c=>c.id===application)?.sessionId) : null;
  const wave=(dot ? null : linked) ?? pickCurrentWave(waves, vietnamDateKey(new Date()) ?? "", dot?.trim() || null);
  const data=wave ? dashboardForWave(result.data, wave) : result.data;

  return <div className="grid gap-4">
    <PageHeader
      title="Phỏng vấn mentee trực tiếp"
      description={wave ? `${wave.label} · Mỗi ca 30 phút · ${daySummary(data.sessions)}` : "Chưa có ca phỏng vấn nào."}
    />
    {wave ? <WaveTabs waves={waves} current={wave} /> : null}
    <OfflineDashboardClient key={wave?.key ?? "all"} data={data} initialApplication={application} />
  </div>;
}
