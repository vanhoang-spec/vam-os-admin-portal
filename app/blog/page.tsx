import Link from "next/link";
import { postExcerpt } from "@/lib/blog-core";
import { listReadablePosts } from "@/lib/blog";
import { resolveBlogViewer } from "@/lib/blog-viewer";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Blog — UEH Mentoring",
  description: "Trải nghiệm và chia sẻ từ cộng đồng mentor và mentee UEH Mentoring."
};

/**
 * Danh sách bài viết.
 *
 * Trang này đọc được mà KHÔNG cần đăng nhập, nên người chưa đăng nhập chỉ thấy
 * bài công khai. Phép lọc nằm trong `lib/blog.ts`, không nằm ở đây: trang chỉ
 * nhận thứ đã lọc, và không có nhánh nào ở đây quyết định ai thấy gì.
 */
export default async function BlogListPage() {
  const viewer = await resolveBlogViewer();
  const { posts, error } = await listReadablePosts(viewer);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-vam-green">
          UEH Mentoring
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-vam-ink">Chuyện của chúng tôi</h1>
        <p className="mt-2 text-slate-600">
          Trải nghiệm và chia sẻ từ mentor, mentee của chương trình.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          {error} Vui lòng thử lại sau ít phút.
        </p>
      ) : posts.length === 0 ? (
        <p className="rounded-lg border border-vam-line bg-white p-5 text-sm text-slate-600">
          Chưa có bài viết nào. Mời bạn quay lại sau.
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {posts.map((post) => (
            <li key={post.id} className="rounded-lg border border-vam-line bg-white p-5">
              <Link href={`/blog/${encodeURIComponent(post.slug)}`} className="block">
                <span className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-vam-ink">{post.title}</h2>
                  {/* Nhãn chỉ hiện cho người soạn bài — người đọc thường không
                      cần biết bài nào nội bộ, và với họ thì mọi bài thấy được
                      đều là bài họ được đọc. */}
                  {viewer.canManage ? <StatusChips post={post} /> : null}
                </span>
                <span className="mt-1 block text-sm text-slate-600">{postExcerpt(post)}</span>
                <span className="mt-2 block text-xs text-slate-500">
                  {post.authorDisplayName ? `${post.authorDisplayName} · ` : ""}
                  {post.publishedAt ? formatDate(post.publishedAt) : "Chưa đăng"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusChips({ post }: { post: { visibility: string; status: string } }) {
  return (
    <>
      {post.status !== "published" ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {post.status === "draft" ? "Bản nháp" : "Đã lưu trữ"}
        </span>
      ) : null}
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          post.visibility === "public"
            ? "bg-vam-mint text-vam-ink"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {post.visibility === "public" ? "Công khai" : "Nội bộ"}
      </span>
    </>
  );
}
