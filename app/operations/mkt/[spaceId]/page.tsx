import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewMktPlan } from "@/lib/permissions";
import { addDays, mondayOf, vietnamNow } from "@/lib/mkt-core";
import { getWeekPlan } from "@/lib/mkt-plans";
import { listWeekPosts } from "@/lib/mkt-posts";
import { mktAiStatus } from "@/lib/mkt-ai";
import { PostCard, WeekToolbar, type WeekPostView } from "./week-client";

/**
 * Page: /operations/mkt/[spaceId]
 *
 * The week, one card per slot.
 *
 * The slots exist whether or not a model has said anything about them: they
 * come from the channel mix by arithmetic. A card with no content is a visible
 * gap somebody can fill, which is the entire reason the schedule is not left
 * to the model to decide.
 */
export const dynamic = "force-dynamic";

function summarise(text: unknown): string | null {
  const brief = text as Record<string, unknown> | null;
  if (!brief) return null;

  const parts = ["format", "size", "visual", "text_on_image", "assets_needed"]
    .map((key) => String(brief[key] ?? "").trim())
    .filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
}

export default async function MktWeekPage(
  props: {
    params: Promise<{ spaceId: string }>;
    searchParams?: Promise<{ week?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const adminUser = await getCurrentAdminUser();
  if (!canViewMktPlan(adminUser?.role)) notFound();

  const requested = searchParams?.week?.trim();
  const weekStart = mondayOf(requested || vietnamNow().date) || vietnamNow().date;

  const [plan, posts] = await Promise.all([
    getWeekPlan({ spaceId: params.spaceId, weekStart }),
    listWeekPosts({ spaceId: params.spaceId, weekStart })
  ]);

  const ai = mktAiStatus();
  const base = `/operations/mkt/${params.spaceId}`;

  const views: WeekPostView[] = posts.map((post) => ({
    id: post.id,
    channel: post.channel,
    postDate: post.postDate,
    slotTime: post.slotTime,
    pillar: post.pillar,
    idea: post.idea,
    content: post.content,
    hashtags: post.hashtags,
    cta: post.cta,
    assetUrls: post.assetUrls,
    status: post.status,
    stepLabel: post.step.label,
    waitingOn: post.step.waitingOn,
    scheduledAt: post.scheduledAt,
    postedUrl: post.postedUrl,
    briefText: summarise(post.brief)
  }));

  const byDate = new Map<string, WeekPostView[]>();
  for (const view of views) {
    byDate.set(view.postDate, [...(byDate.get(view.postDate) ?? []), view]);
  }

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          href={`${base}?week=${addDays(weekStart, -7)}`}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 font-medium text-vam-ink"
        >
          ← Tuần trước
        </Link>
        <span className="font-medium text-vam-ink">
          Tuần {weekStart} → {addDays(weekStart, 6)}
        </span>
        <Link
          href={`${base}?week=${addDays(weekStart, 7)}`}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 font-medium text-vam-ink"
        >
          Tuần sau →
        </Link>
      </div>

      <WeekToolbar
        spaceId={params.spaceId}
        weekStart={weekStart}
        topic={plan?.topic ?? null}
        focus={plan?.focus ?? null}
        contentNotes={plan?.contentNotes ?? null}
        aiReady={ai.ready}
        aiReason={ai.reason}
        aiModel={ai.model}
      />

      {plan && plan.orderReview.length > 0 ? (
        <section className="rounded-lg border border-vam-line bg-white p-4">
          <h2 className="text-sm font-semibold text-vam-ink">Đề nghị đã được xử lý thế nào</h2>
          <ul className="mt-2 space-y-1 text-sm text-vam-muted">
            {plan.orderReview.map((item, index) => (
              <li key={index}>
                <span className="text-vam-ink">{item.order_ref ?? "—"}</span> · {item.relation ?? "?"} ·{" "}
                {item.handling ?? ""}
              </li>
            ))}
          </ul>
          {plan.ordersUnplaced.length ? (
            <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Chưa xếp được: {plan.ordersUnplaced.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {views.length === 0 ? (
        <EmptyState message="Tuần này chưa có slot nào. Bấm “Sinh plan tuần bằng AI” ở trên, hoặc bật kênh trong tab Cấu hình trước." />
      ) : (
        <div className="space-y-5">
          {days.map((day) => {
            const dayPosts = byDate.get(day) ?? [];
            if (!dayPosts.length) return null;

            return (
              <section key={day} className="space-y-3">
                <h2 className="text-sm font-semibold text-vam-ink">{day}</h2>
                <div className="grid gap-3 lg:grid-cols-2">
                  {dayPosts.map((post) => (
                    <PostCard key={post.id} spaceId={params.spaceId} post={post} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
