import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getMentorRecruitmentReport } from "@/lib/mentor-recruitment-report";
import { parseScope } from "@/lib/mentor-recruitment-report-core";
import { MentorReportView } from "./report-view";

/**
 * /interviews/bao-cao-mentor — báo cáo tuyển mentor (BTC 08/10/2026): phễu mentor mới
 * (vòng hồ sơ → phỏng vấn / trao đổi với Core team → chính thức) kèm tỷ lệ, mentor cũ
 * gia hạn, và hồ sơ mentor theo số năm kinh nghiệm, nhóm ngành Vòng 2, cấp bậc, công ty.
 *
 * Cổng nằm trong getMentorRecruitmentReport, fail-closed: vai trò BTC và quyền vận hành
 * mùa. Mentor phỏng vấn (reviewer) không xem được — trang có tên và kết quả của mọi
 * người nộp đơn.
 */
export const dynamic = "force-dynamic";

export default async function MentorRecruitmentReportPage({ searchParams }: { searchParams: Promise<{ "pham-vi"?: string }> }) {
  const params = await searchParams;
  const result = await getMentorRecruitmentReport(parseScope(params["pham-vi"]));
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Báo cáo tuyển mentor" />
        <Card>
          <EmptyState message={result.message} />
        </Card>
      </div>
    );
  }
  return <MentorReportView report={result.report} seasonCode={result.seasonCode} generatedAt={result.generatedAt} />;
}
