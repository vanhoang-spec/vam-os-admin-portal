import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { buildInterviewReport, interviewWaves, pickWave } from "@/lib/mentee-interview-report-core";
import { notesForWave } from "@/lib/mentee-interview-report-notes";
import { getInterviewReportData } from "@/lib/mentee-offline";
import { canViewMenteeSessionStatus } from "@/lib/permissions";
import { ReportView } from "./report-view";

/**
 * /interviews/bao-cao-mentee — báo cáo kết quả phỏng vấn mentee theo ĐỢT (BTC
 * 06/10/2026): (a) Đạt / (b) Không đạt / (c) Cần BTC xem xét theo năm học và ngành
 * nghề mục tiêu, điểm quy đổi theo người phỏng vấn, mẫu hình nhận xét, và nhóm được
 * mentor chọn ngay so với nhóm còn lại.
 *
 * Cùng hai cổng với trang tiến độ, cả hai fail-closed: vai trò
 * (canViewMenteeSessionStatus) và quyền vận hành mùa (canOperate — vam104_offline_access).
 * Trang có điểm theo từng người phỏng vấn và nhận xét về mentee: mentor phỏng vấn
 * (reviewer) không được xem.
 */
export const dynamic = "force-dynamic";

const TITLE = "Báo cáo phỏng vấn mentee";

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

export default async function MenteeInterviewReportPage({ searchParams }: { searchParams: Promise<{ dot?: string }> }) {
  const admin = await getCurrentAdminUser();
  if (!admin || !canViewMenteeSessionStatus(admin.role)) {
    return <Refused message="Trang này dành cho BTC (Core team, Support team)." />;
  }
  const result = await getInterviewReportData();
  if (!result.ok) return <Refused message={result.message} />;
  if (!result.data.canOperate) {
    return <Refused message="Tài khoản chưa có quyền vận hành mùa hiện tại nên chưa xem được báo cáo phỏng vấn." />;
  }

  const { dot } = await searchParams;
  const waves = interviewWaves(result.data.sessions);
  const wave = pickWave(waves, result.data.rows, dot?.trim() || null);
  if (!wave) return <Refused message="Mùa này chưa có ca phỏng vấn mentee nào." />;

  return (
    <ReportView
      report={buildInterviewReport(result.data.rows, wave)}
      waves={waves}
      notes={notesForWave(wave.key)}
      generatedAt={new Date().toISOString()}
    />
  );
}
