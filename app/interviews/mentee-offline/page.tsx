import { getOfflineDashboard } from "@/lib/mentee-offline";
import { PageHeader, Card } from "@/components/ui";
import { OfflineDashboardClient } from "./workflow";
export const dynamic="force-dynamic";
export default async function OfflineInterviewPage({searchParams}:{searchParams:Promise<{application?:string}>}) {
  const {application}=await searchParams;
  const result=await getOfflineDashboard();
  return <div className="grid gap-4">
    <PageHeader title="Phỏng vấn mentee trực tiếp" description="03–04/10/2026 · Mỗi ca 30 phút · 5 phòng × 5 bàn · 25 mentee/ca" />
    {result.ok ? <OfflineDashboardClient data={result.data} initialApplication={application} /> : <Card><p role="alert">{result.message}</p></Card>}
  </div>;
}
