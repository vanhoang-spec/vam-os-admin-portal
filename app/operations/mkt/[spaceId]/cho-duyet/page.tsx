import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewMktPlan } from "@/lib/permissions";
import { listPostsAwaitingApproval } from "@/lib/mkt-posts";
import { PostCard, type WeekPostView } from "../week-client";

/**
 * Page: /operations/mkt/[spaceId]/cho-duyet
 *
 * Everything that has words and artwork and is waiting on one click.
 *
 * Its own screen because it is a different job from planning: the week grid is
 * where somebody decides what to say, and this is where somebody gets through
 * a pile. A post only appears here when both halves are done — a caption with
 * no image is the designer's queue, not this one.
 */
export const dynamic = "force-dynamic";

function summarise(brief: unknown): string | null {
  const record = brief as Record<string, unknown> | null;
  if (!record) return null;

  const parts = ["format", "size", "visual"]
    .map((key) => String(record[key] ?? "").trim())
    .filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
}

export default async function MktApprovalPage(props: { params: Promise<{ spaceId: string }> }) {
  const params = await props.params;
  const adminUser = await getCurrentAdminUser();
  if (!canViewMktPlan(adminUser?.role)) notFound();

  const posts = await listPostsAwaitingApproval(params.spaceId);

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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-vam-ink">Bài chờ duyệt</h2>
        <p className="mt-1 max-w-2xl text-sm text-vam-muted">
          Đã có nội dung và đã có hình. Duyệt xong, hệ thống chốt giờ đăng và dừng ở đó — tới giờ
          thì người phụ trách mở trang và đăng. Không có gì tự đăng.
        </p>
      </div>

      {views.length === 0 ? (
        <EmptyState message="Không còn bài nào chờ duyệt." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {views.map((post) => (
            <PostCard key={post.id} spaceId={params.spaceId} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
