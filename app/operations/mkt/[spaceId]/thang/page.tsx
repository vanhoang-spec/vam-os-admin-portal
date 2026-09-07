import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewMktPlan } from "@/lib/permissions";
import { channelsForSpace, vietnamNow, weeksInMonth } from "@/lib/mkt-core";
import { getMasterPlan } from "@/lib/mkt-plans";
import { listOrders } from "@/lib/mkt-posts";
import { getMktSpace } from "@/lib/mkt-spaces";
import { MasterPlanPanel, OrdersPanel, type OrderView } from "../month-client";

/**
 * Page: /operations/mkt/[spaceId]/thang
 *
 * The month's direction, and the requests waiting to be planned into it.
 *
 * They share a screen because they are read together: whoever decides what
 * September is about wants to see what people have already asked for in
 * September, before deciding.
 */
export const dynamic = "force-dynamic";

function shiftMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

export default async function MktMonthPage(
  props: {
    params: Promise<{ spaceId: string }>;
    searchParams?: Promise<{ month?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const adminUser = await getCurrentAdminUser();
  if (!canViewMktPlan(adminUser?.role)) notFound();

  const requested = searchParams?.month?.trim() ?? "";
  const month = weeksInMonth(requested).length ? requested : vietnamNow().date.slice(0, 7);

  const [space, plan, orders] = await Promise.all([
    getMktSpace(params.spaceId),
    getMasterPlan({ spaceId: params.spaceId, month }),
    listOrders(params.spaceId)
  ]);

  if (!space) notFound();

  const base = `/operations/mkt/${params.spaceId}/thang`;

  const orderViews: OrderView[] = orders.map((order) => ({
    id: order.id,
    title: order.title,
    purpose: order.purpose,
    body: order.body,
    wantedChannels: order.wantedChannels,
    neededBy: order.neededBy,
    isUrgent: order.isUrgent,
    contentPriority: order.contentPriority,
    status: order.status,
    declineReason: order.declineReason
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          href={`${base}?month=${shiftMonth(month, -1)}`}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 font-medium text-vam-ink"
        >
          ← Tháng trước
        </Link>
        <span className="font-medium text-vam-ink">Tháng {month}</span>
        <Link
          href={`${base}?month=${shiftMonth(month, 1)}`}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 font-medium text-vam-ink"
        >
          Tháng sau →
        </Link>
      </div>

      <MasterPlanPanel
        spaceId={params.spaceId}
        month={month}
        planId={plan?.id ?? null}
        theme={plan?.theme ?? null}
        goals={plan?.goals ?? []}
        weeklyFocus={plan?.weeklyFocus ?? []}
        contentNotes={plan?.contentNotes ?? null}
        notes={plan?.notes ?? null}
        status={plan?.status ?? "draft"}
        aiModel={plan?.aiModel ?? null}
      />

      <OrdersPanel
        spaceId={params.spaceId}
        orders={orderViews}
        channels={channelsForSpace(space.isShared)}
      />
    </div>
  );
}
