import { getOfflineDashboard } from "@/lib/mentee-offline";
import { PageHeader, Card } from "@/components/ui";
import { OfflineDashboardClient } from "./workflow";
export const dynamic="force-dynamic";
export default async function OfflineInterviewPage({searchParams}:{searchParams:Promise<{application?:string}>}) {
  const {application}=await searchParams;
  const result=await getOfflineDashboard();
  return <div className="grid gap-4">
    <PageHeader title="Phỏng vấn mentee trực tiếp" description="03–04/10/2026 · Mỗi ca 30 phút · Thứ Bảy 3 phòng, tối đa 18 mentee/ca · Chủ nhật 6 phòng, tối đa 28 mentee/ca" />
    {result.ok ? <OfflineDashboardClient data={result.data} initialApplication={application} /> : <Card><p role="alert">{result.message}</p></Card>}
  </div>;
}
