import Link from "next/link";
import { LiveRefresh } from "@/app/events/[id]/live-refresh";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getMentorProgress } from "@/lib/mentor-progress";
import { MentorProgressBoard } from "./mentor-progress-board";

/**
 * /interviews/tien-do-mentor — BTC theo dõi vòng phỏng vấn / trao đổi 1:1 của mentor
 * mới Mùa 12 với core team (03/10/2026): ai đặt lịch ngày nào giờ nào với ai, ai đã
 * xong và kết quả, ai đang phỏng vấn, ai qua giờ hẹn mà chưa có phiếu, ai chưa đặt.
 * Mọi cổng quyền nằm trong lib/mentor-progress.ts (fail-closed).
 */
export const dynamic = "force-dynamic";

const TITLE = "Tiến độ phỏng vấn mentor";

export default async function MentorProgressPage() {
  const result = await getMentorProgress();
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title={TITLE} />
        <Card>
          <EmptyState message={result.message} />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <PageHeader
        title={TITLE}
        description="Mentor mới Mùa 12 trao đổi 1:1 với core team: lịch hẹn theo ngày, ai đã phỏng vấn xong và kết quả, ai đang phỏng vấn, ai qua giờ hẹn chưa có phiếu, ai chưa đặt lịch."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveRefresh />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/interviews/lich" className="font-medium text-vam-green underline">Lịch phỏng vấn mentor</Link>
          <Link href="/interviews/ket-qua-mentor" className="font-medium text-vam-green underline">Kết quả phỏng vấn Mentor S12</Link>
        </div>
      </div>
      <MentorProgressBoard progress={result.progress} />
    </div>
  );
}
