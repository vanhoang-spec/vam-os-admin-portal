import Link from "next/link";
import { notFound } from "next/navigation";
import { getReadablePost } from "@/lib/blog";
import { resolveBlogViewer } from "@/lib/blog-viewer";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Một bài viết.
 *
 * ---------------------------------------------------------------------------
 * "KHÔNG CÓ" VÀ "KHÔNG ĐỌC ĐƯỢC" TRẢ LỜI GIỐNG HỆT NHAU
 * ---------------------------------------------------------------------------
 * `getReadablePost` trả về `null` cho cả hai, và trang hiện 404 cho cả hai.
 *
 * Phân biệt chúng — chẳng hạn hiện "bài này chỉ dành cho thành viên" — là nói
 * cho người ngoài biết một bài nội bộ có tồn tại và đường dẫn của nó là gì. Với
 * một bài kể chuyện riêng của một người, chính cái tiêu đề trong đường dẫn đã
 * là thứ không nên lộ.
 */
export default async function BlogPostPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const viewer = await resolveBlogViewer();
  const { post, error } = await getReadablePost(params.slug, viewer);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          {error} Vui lòng thử lại sau ít phút.
        </p>
      </div>
    );
  }

  if (!post) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/blog"
        className="text-sm font-medium text-vam-green underline-offset-2 hover:underline"
      >
        ← Tất cả bài viết
      </Link>

      <header className="mt-6">
        <h1 className="text-3xl font-semibold leading-tight text-vam-ink">{post.title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {post.authorDisplayName ? `${post.authorDisplayName} · ` : ""}
          {post.publishedAt ? formatDate(post.publishedAt) : "Chưa đăng"}
          {viewer.canManage && post.visibility === "internal" ? " · Nội bộ" : ""}
          {viewer.canManage && post.status !== "published" ? " · Bản nháp" : ""}
        </p>
      </header>

      {post.excerpt ? (
        <p className="mt-6 border-l-4 border-vam-green bg-vam-mint px-5 py-4 text-base text-vam-ink">
          {post.excerpt}
        </p>
      ) : null}

      {/* `whitespace-pre-line` chứ không dựng HTML từ thân bài: nội dung do
          người ngoài viết, và dựng HTML từ đó là mở một đường chèn mã vào trang
          mà cả internet đọc được. Xuống dòng người viết gõ ra sao thì hiện vậy. */}
      <div className="mt-6 whitespace-pre-line text-[1.05rem] leading-relaxed text-slate-800">
        {post.body}
      </div>
    </article>
  );
}
