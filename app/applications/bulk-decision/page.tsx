import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { BulkDecisionForm } from "./bulk-decision-form";

export default async function BulkDecisionPage() {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecide(actor.role)) redirect("/applications");
  const result = await getApplications(await getScopeFilter(await getAdminScopeContext()));
  const rows = result.data.slice(0, 500).map(app => ({
    id: app.id,
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    role: String(app.role_applied ?? "-"),
    status: String(app.status ?? "")
  }));
  return <><PageHeader title="Bulk Final Decision" description="Quyết định hàng loạt có kiểm tra lifecycle tại database." />
    <div className="mb-4"><Link href="/applications" className="text-sm text-vam-green hover:underline">← Quay lại danh sách</Link></div>
    <ErrorBox message={result.error} /><Card><BulkDecisionForm rows={rows} /></Card></>;
}
