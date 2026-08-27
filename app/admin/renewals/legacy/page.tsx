import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireLegacyMentorOperator } from "@/lib/legacy-mentor-service";
import { LegacyMentorClient } from "./legacy-client";

export const dynamic = "force-dynamic";

export default async function LegacyMentorPage() {
  if (!(await requireLegacyMentorOperator())) notFound();
  return (
    <div className="grid gap-6">
      <PageHeader title="Legacy returning mentor" description="Thiết lập/reuse identity và hồ sơ mentor trước khi tạo link mời cá nhân qua runtime gia hạn hiện có." />
      <Link href="/admin/renewals" className="w-fit rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-green">Quay lại danh sách invitation</Link>
      <LegacyMentorClient />
    </div>
  );
}
