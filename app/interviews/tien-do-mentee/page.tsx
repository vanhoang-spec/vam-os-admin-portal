import Link from "next/link";
import { LiveRefresh } from "@/app/events/[id]/live-refresh";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getOfflineDashboard } from "@/lib/mentee-offline";
import { buildMenteeProgress } from "@/lib/mentee-progress-core";
import { canViewMenteeSessionStatus } from "@/lib/permissions";
import { vietnamDateKey } from "@/lib/utils";
import { ProgressBoard } from "./progress-board";

/**
 * /interviews/tien-do-mentee — BTC (core team / support team) theo dõi buổi phỏng
 * vấn mentee 03–04/10/2026: ai đăng ký ca nào, sáng hay chiều, ai đã xong và kết
 * quả ra sao, ai đang phỏng vấn, ai đã đến chờ phân bàn, ai chưa đến.
 *
 * Hai cổng, cả hai fail-closed: vai trò (canViewMenteeSessionStatus) và quyền vận
 * hành mùa của chính màn hình phỏng vấn (data.canOperate — cùng hàm database
 * vam104_offline_access). Mentor phỏng vấn KHÔNG xem được kết quả của người khác
 * qua trang này.
 */
export const dynamic = "force-dynamic";

const TITLE = "Tiến độ phỏng vấn mentee";

function Refused({ message }: { message: string }) {
  return (
    <div className="grid gap-4">
      <PageHeader title={TITLE} />
      <Card>
        <EmptyState message={message} />
      </Card>
    </div>
  );
}

export default async function MenteeProgressPage() {
  const admin = await getCurrentAdminUser();
  if (!admin || !canViewMenteeSessionStatus(admin.role)) {
    return <Refused message="Trang này dành cho BTC (Core team, Support team)." />;
  }
  const result = await getOfflineDashboard();
  if (!result.ok) return <Refused message={result.message} />;
  if (!result.data.canOperate) {
    return <Refused message="Tài khoản chưa có quyền vận hành mùa hiện tại nên chưa xem được tiến độ phỏng vấn." />;
  }

  const progress = buildMenteeProgress(result.data);
  const todayKey = vietnamDateKey(new Date()) ?? "";

  return (
    <div className="grid gap-4">
      <PageHeader
        title={TITLE}
        description="Danh sách mentee theo từng ca, buổi sáng / chiều ngày 03–04/10: ai đã phỏng vấn xong và kết quả, ai đang phỏng vấn, ai đã đến chờ phân bàn, ai chưa đến."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveRefresh />
        <Link href="/interviews/mentee-offline" className="text-sm font-medium text-vam-green underline">
          Mở màn hình check-in, phân bàn và chấm phỏng vấn
        </Link>
      </div>
      <ProgressBoard progress={progress} todayKey={todayKey} />
    </div>
  );
}
