import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  ANONYMOUS,
  canReadPost,
  filterReadablePosts,
  slugifyTitle,
  type Viewer
} from "@/lib/blog-core";

/**
 * lib/blog.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc và ghi bài viết.
 *
 * ---------------------------------------------------------------------------
 * PHÉP LỌC NẰM Ở ĐÂY, KHÔNG Ở TRANG
 * ---------------------------------------------------------------------------
 * Mọi đường đọc trong file này đều đi qua `canReadPost` / `filterReadablePosts`
 * trước khi trả về. Trang chỉ nhận thứ đã lọc.
 *
 * Lý do: một bài nội bộ chỉ cần LỌT VÀO dữ liệu trả về là đã nằm trong HTML gửi
 * cho người chưa đăng nhập — ẩn nó bằng giao diện không giấu được nó khỏi phần
 * mã nguồn trang, khỏi bộ đệm, hay khỏi con bọ của Google. Và một bài nội bộ ra
 * ngoài là không thu hồi được.
 */

const VI_ERROR = "Không đọc được bài viết lúc này.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[blog]", scope, {
    code: err?.code,
    message: err?.message ?? String(error)
  });
}

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  visibility: string;
  status: string;
  authorDisplayName: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
};

const COLUMNS =
  "id, slug, title, excerpt, body, visibility, status, author_display_name, published_at, updated_at";

function toPost(row: Record<string, unknown>): BlogPost {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    excerpt: row.excerpt ? String(row.excerpt) : null,
    body: String(row.body ?? ""),
    visibility: String(row.visibility ?? ""),
    status: String(row.status ?? ""),
    authorDisplayName: row.author_display_name ? String(row.author_display_name) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null
  };
}

/**
 * Danh sách bài người này đọc được.
 *
 * Truy vấn đã hẹp sẵn theo mức hiển thị — người chưa đăng nhập không kéo về bài
 * nội bộ ngay từ đầu — rồi vẫn lọc lại bằng `filterReadablePosts`. Hai lớp cho
 * cùng một việc là có chủ ý: lớp truy vấn để không chở dữ liệu thừa qua mạng,
 * lớp lọc để một lần sửa câu truy vấn về sau không lặng lẽ mở cửa.
 */
export async function listReadablePosts(viewer: Viewer): Promise<{
  posts: BlogPost[];
  error: string | null;
}> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { posts: [], error: VI_ERROR };

  let query = client.from("blog_posts").select(COLUMNS);

  if (!viewer.canManage) {
    query = query.eq("status", "published");
    if (!viewer.signedIn) query = query.eq("visibility", "public");
  }

  const { data, error } = await query
    .order("published_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    log("đọc danh sách bài", error);
    return { posts: [], error: VI_ERROR };
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(toPost);
  return { posts: filterReadablePosts(rows, viewer), error: null };
}

/**
 * Một bài theo đường dẫn.
 *
 * Trả về `null` cho cả "không có bài này" lẫn "có nhưng bạn không đọc được" —
 * hai câu trả lời phải giống hệt nhau. Phân biệt chúng là nói cho người ngoài
 * biết một bài nội bộ có tồn tại và tên đường dẫn của nó là gì.
 */
export async function getReadablePost(
  slug: string,
  viewer: Viewer
): Promise<{ post: BlogPost | null; error: string | null }> {
  const wanted = String(slug ?? "").trim().toLowerCase();
  if (!wanted) return { post: null, error: null };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { post: null, error: VI_ERROR };

  const { data, error } = await client
    .from("blog_posts")
    .select(COLUMNS)
    .eq("slug", wanted)
    .maybeSingle();

  if (error) {
    log("đọc bài", error);
    return { post: null, error: VI_ERROR };
  }
  if (!data) return { post: null, error: null };

  const post = toPost(data as Record<string, unknown>);
  if (!canReadPost(post, viewer)) return { post: null, error: null };

  return { post, error: null };
}

/** Bài công khai, cho trang ai cũng đọc được. */
export function listPublicPosts() {
  return listReadablePosts(ANONYMOUS);
}

export type SavePostResult = { ok: boolean; message: string; slug?: string };

/**
 * Đường dẫn chưa ai dùng, dựng từ tiêu đề.
 *
 * Trùng thì thêm `-2`, `-3`… chứ không ghi đè: hai bài cùng đường dẫn nghĩa là
 * một trong hai không mở được, và người viết bài sau sẽ không biết mình vừa
 * giấu mất bài của người khác.
 */
export async function reserveSlug(title: string, excludeId?: string): Promise<string | null> {
  const base = slugifyTitle(title);
  if (!base) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("blog_posts")
    .select("id, slug")
    .like("slug", `${base}%`);

  if (error) {
    log("dò đường dẫn trùng", error);
    return null;
  }

  const taken = new Set(
    ((data ?? []) as Array<{ id: string; slug: string }>)
      .filter((row) => String(row.id) !== String(excludeId ?? ""))
      .map((row) => String(row.slug))
  );

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}
