import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewMktPlan } from "@/lib/permissions";
import { getMktSpace } from "@/lib/mkt-spaces";
import { listPostsAwaitingApproval } from "@/lib/mkt-posts";

/**
 * The four tabs, and the header that says which fanpage they belong to.
 *
 * The brand name sits at the top of every tab because it is the one thing a
 * person planning five programmes must never lose track of — writing UEH's
 * post into BK's week is a mistake that only shows up after it is published.
 *
 * The count on "Chờ duyệt" is the number the support team works down.
 */
export const dynamic = "force-dynamic";

const TABS = [
  { href: "", label: "Plan tuần" },
  { href: "/thang", label: "Tháng & đề nghị" },
  { href: "/cho-duyet", label: "Chờ duyệt" },
  { href: "/cau-hinh", label: "Cấu hình" }
];

export default async function MktSpaceLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { spaceId: string };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!canViewMktPlan(adminUser?.role)) notFound();

  const space = await getMktSpace(params.spaceId);
  if (!space) notFound();

  const waiting = await listPostsAwaitingApproval(params.spaceId);
  const base = `/operations/mkt/${params.spaceId}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/operations/mkt" className="text-sm font-medium text-vam-green hover:underline">
          ← Chọn trang khác
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold text-vam-ink">{space.brandName}</h1>
          {space.pageUrl ? (
            <a
              href={space.pageUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-vam-green hover:underline"
            >
              Mở trang để đăng →
            </a>
          ) : null}
        </div>

        <p className="mt-1 text-sm text-vam-muted">
          {space.isShared
            ? "Kênh chung của cả hệ thống VAM. LinkedIn, một bài mỗi tuần."
            : `Trang riêng của chương trình. ${space.weeklyLoad} bài mỗi tuần trên các kênh đang bật.`}
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-vam-line pb-3 text-sm">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={`${base}${tab.href}`}
            className="rounded-md border border-vam-line bg-white px-3 py-1.5 font-medium text-vam-ink hover:border-vam-green"
          >
            {tab.label}
            {tab.href === "/cho-duyet" && waiting.length > 0 ? (
              <span className="ml-2 rounded-full bg-vam-green px-1.5 py-0.5 text-xs text-white">
                {waiting.length}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
