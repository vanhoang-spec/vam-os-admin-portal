import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewMktPlan } from "@/lib/permissions";
import { listMktSpaces } from "@/lib/mkt-spaces";
import { CHANNEL_LABELS } from "@/lib/mkt-core";

/**
 * Page: /operations/mkt
 *
 * Which fanpage are we planning for?
 *
 * Every programme runs its own page with its own support team, so the first
 * question is which one — and the answer decides the brand name, the audience,
 * the channels and the approval queue for everything after it. The shared VAM
 * space is listed last and marked, because it is the odd one out: it owns
 * LinkedIn for the whole organisation and belongs to no school.
 */
export const dynamic = "force-dynamic";

export default async function MktSpacesPage() {
  const adminUser = await getCurrentAdminUser();
  if (!canViewMktPlan(adminUser?.role)) notFound();

  const spaces = await listMktSpaces();
  const programmes = spaces.filter((space) => !space.isShared);
  const shared = spaces.filter((space) => space.isShared);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kế hoạch nội dung"
        description="Lên plan tháng, chia slot tuần, viết bài và duyệt — riêng cho từng trang của từng chương trình."
      />

      {spaces.length === 0 ? (
        <EmptyState message="Chưa có không gian nào. Migration 074 tạo sẵn một không gian cho mỗi chương trình đang hoạt động." />
      ) : null}

      {programmes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-vam-ink">Trang của từng chương trình</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {programmes.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </div>
        </section>
      ) : null}

      {shared.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-vam-ink">Kênh chung của VAM</h2>
          <p className="max-w-2xl text-sm text-vam-muted">
            LinkedIn là một tài khoản cho cả hệ thống, không tách theo trường. Một bài mỗi tuần.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {shared.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SpaceCard({
  space
}: {
  space: Awaited<ReturnType<typeof listMktSpaces>>[number];
}) {
  const active = space.channels.filter((channel) => channel.isActive);
  const off = space.channels.filter((channel) => !channel.isActive);

  return (
    <Link
      href={`/operations/mkt/${space.id}`}
      className="block rounded-lg border border-vam-line bg-white p-4 transition hover:border-vam-green"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-vam-ink">{space.brandName}</span>
        <span className="text-xs text-vam-muted">{space.weeklyLoad} bài/tuần</span>
      </div>

      <p className="mt-2 text-sm text-vam-muted">
        {active.length
          ? `Đang chạy: ${active.map((channel) => CHANNEL_LABELS[channel.channel]).join(", ")}`
          : "Chưa bật kênh nào"}
      </p>

      {off.length ? (
        <p className="mt-1 text-xs text-vam-muted">
          Chưa bật: {off.map((channel) => CHANNEL_LABELS[channel.channel]).join(", ")}
        </p>
      ) : null}

      {!space.brand?.diagnosis ? (
        <p className="mt-2 text-xs text-amber-700">
          Chưa có hồ sơ thương hiệu — AI sẽ viết chung chung cho tới khi điền.
        </p>
      ) : null}
    </Link>
  );
}
