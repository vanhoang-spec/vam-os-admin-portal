import { notFound } from "next/navigation";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewMktPlan } from "@/lib/permissions";
import { getMktSpace } from "@/lib/mkt-spaces";
import { mktAiStatus } from "@/lib/mkt-ai";
import { BrandPanel, ChannelPanel, type ChannelView } from "../config-client";

/**
 * Page: /operations/mkt/[spaceId]/cau-hinh
 *
 * Who this space speaks as, and on which channels.
 *
 * The channel list is exactly what the space is allowed to run — a programme
 * never sees LinkedIn here, and the shared VAM space sees nothing else. That
 * comes from the same rule the database holds as a CHECK, so the screen and the
 * schema cannot drift apart.
 */
export const dynamic = "force-dynamic";

export default async function MktConfigPage(props: { params: Promise<{ spaceId: string }> }) {
  const params = await props.params;
  const adminUser = await getCurrentAdminUser();
  if (!canViewMktPlan(adminUser?.role)) notFound();

  const space = await getMktSpace(params.spaceId);
  if (!space) notFound();

  const ai = mktAiStatus();

  const channels: ChannelView[] = space.channels.map((channel) => ({
    channel: channel.channel,
    isActive: channel.isActive,
    postsPerWeek: channel.postsPerWeek,
    bestTimes: channel.bestTimes,
    audience: channel.audience,
    topics: channel.topics,
    doWrite: channel.doWrite,
    avoidWrite: channel.avoidWrite,
    distinctAudience: channel.distinctAudience
  }));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-vam-line bg-white p-4">
        <h2 className="text-sm font-semibold text-vam-ink">Mô hình AI</h2>
        <p className="mt-1 text-sm text-vam-muted">
          {ai.ready
            ? `Đang dùng DeepSeek — ${ai.model}. Toàn bộ phần lên plan và viết bài chạy trên DeepSeek.`
            : `Chưa bật: ${ai.reason}. Mọi ô soạn tay vẫn dùng bình thường, chỉ thiếu phần AI gợi ý.`}
        </p>
      </section>

      <BrandPanel
        spaceId={space.id}
        brandName={space.brandName}
        pageUrl={space.pageUrl}
        notes={space.notes}
        brand={space.brand}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-vam-ink">Kênh</h2>
          <p className="mt-1 max-w-2xl text-sm text-vam-muted">
            {space.isShared
              ? "Không gian chung chỉ chạy LinkedIn. Các kênh còn lại thuộc về từng chương trình."
              : "LinkedIn không nằm ở đây — đó là một tài khoản chung cho cả VAM, cấu hình ở không gian chung."}{" "}
            Tổng hiện tại: <strong className="text-vam-ink">{space.weeklyLoad} bài mỗi tuần</strong>.
          </p>
        </div>

        <div className="grid gap-3">
          {channels.map((channel) => (
            <ChannelPanel
              key={channel.channel}
              spaceId={space.id}
              channel={channel}
              weeklyLoad={space.weeklyLoad}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
