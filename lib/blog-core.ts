/**
 * lib/blog-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ai đọc được bài nào.
 *
 * ---------------------------------------------------------------------------
 * ĐÂY LÀ CHỖ NGUY HIỂM NHẤT CỦA MODULE BLOG
 * ---------------------------------------------------------------------------
 * Một bài nội bộ lọt ra công khai là KHÔNG THU HỒI ĐƯỢC. Nó mang tên thật và
 * câu chuyện thật của một người; khi Google đã đọc nó thì gỡ bài đi cũng không
 * gỡ được bản lưu.
 *
 * Nên phép quyết định tách thành một hàm thuần và bị thử riêng với mọi tổ hợp
 * nghĩ ra được. Nó cũng là hàm DUY NHẤT được phép trả lời câu hỏi này — không
 * chỗ nào tự viết lại điều kiện của mình.
 */

export const POST_VISIBILITIES = ["internal", "public"] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

export const POST_STATUSES = ["draft", "published", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Mặc định là NỘI BỘ.
 *
 * Quên chọn thì thành nội bộ, chứ không phải quên chọn thì thành công khai. Cái
 * giá của hai lần quên rất khác nhau: một bài nội bộ để nhầm chế độ nội bộ thì
 * chỉ ít người đọc hơn; một bài nội bộ để nhầm chế độ công khai thì cả internet
 * đọc được.
 */
export const DEFAULT_VISIBILITY: PostVisibility = "internal";

export function isPostVisibility(value: unknown): value is PostVisibility {
  return typeof value === "string" && (POST_VISIBILITIES as readonly string[]).includes(value);
}

export function isPostStatus(value: unknown): value is PostStatus {
  return typeof value === "string" && (POST_STATUSES as readonly string[]).includes(value);
}

/** Bài viết, đúng những gì phép quyết định cần nhìn. */
export type ReadablePost = {
  visibility: unknown;
  status: unknown;
};

/** Người đang đọc. */
export type Viewer = {
  /** Có phiên đăng nhập thật hay không — nhân sự hoặc người tham gia, đều tính. */
  signedIn: boolean;
  /** Nhân sự soạn bài: xem được cả bản nháp. */
  canManage: boolean;
};

export const ANONYMOUS: Viewer = { signedIn: false, canManage: false };

/**
 * Người này đọc được bài này không.
 *
 * ---------------------------------------------------------------------------
 * BA CỬA, PHẢI QUA HẾT
 * ---------------------------------------------------------------------------
 * 1. Bài chưa đăng thì chỉ người soạn bài thấy. Bản nháp là bản chưa ai đọc lại.
 * 2. Bài nội bộ thì phải có phiên đăng nhập.
 * 3. Chỉ `public` mới ra được ngoài, và phải là đúng chuỗi đó — một giá trị lạ
 *    trong cột (dữ liệu cũ, một lần sửa tay) KHÔNG được coi là công khai.
 *
 * Viết theo lối "chỉ cho phép khi thoả", không phải "chặn khi thấy nội bộ": một
 * giá trị ngoài dự kiến thì rơi vào nhánh từ chối, chứ không rơi vào nhánh cho
 * qua.
 */
export function canReadPost(post: ReadablePost, viewer: Viewer): boolean {
  const status = String(post.status ?? "");
  const visibility = String(post.visibility ?? "");

  if (viewer.canManage) return true;

  // Chỉ bài đã đăng mới ra khỏi màn hình soạn thảo.
  if (status !== "published") return false;

  if (visibility === "public") return true;
  if (visibility === "internal") return viewer.signedIn;

  // Giá trị lạ: từ chối. Không đoán.
  return false;
}

/**
 * Lọc một danh sách bài theo đúng phép quyết định trên.
 *
 * Có hàm này để không chỗ nào tự viết lại điều kiện lọc của mình. Danh sách và
 * trang chi tiết phải nói cùng một câu trả lời — một bài hiện trong danh sách
 * mà mở ra bị từ chối là một lời rò rỉ tiêu đề.
 */
export function filterReadablePosts<T extends ReadablePost>(posts: T[], viewer: Viewer): T[] {
  return posts.filter((post) => canReadPost(post, viewer));
}

/**
 * Đường dẫn của bài, dựng từ tiêu đề.
 *
 * Bỏ dấu tiếng Việt vì đường dẫn có dấu bị mã hoá thành một dãy ký tự dài, khó
 * đọc và khó chia sẻ. Giữ nguyên chữ số để "5 điều tôi học được" còn nhận ra
 * được.
 */
export function slugifyTitle(title: unknown): string {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const MAX_TITLE_LENGTH = 160;
export const MAX_EXCERPT_LENGTH = 320;
export const MAX_BODY_LENGTH = 40_000;

export type PostValidation = { ok: true } | { ok: false; message: string };

/**
 * Bài đã đủ để lưu chưa.
 *
 * Không kiểm ở đây: bài có hay không. Đó là việc của người duyệt, và một phép
 * kiểm tự động giả vờ làm được việc ấy chỉ tạo cảm giác an toàn giả.
 */
export function validatePost(input: {
  title: unknown;
  body: unknown;
  excerpt?: unknown;
  visibility: unknown;
}): PostValidation {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, message: "Vui lòng nhập tiêu đề bài viết." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: `Tiêu đề không được dài quá ${MAX_TITLE_LENGTH} ký tự.` };
  }

  if (!slugifyTitle(title)) {
    // Tiêu đề toàn ký tự không dựng được đường dẫn — ví dụ toàn dấu câu.
    return { ok: false, message: "Tiêu đề cần có chữ hoặc số để dựng đường dẫn bài viết." };
  }

  const body = String(input.body ?? "").trim();
  if (!body) return { ok: false, message: "Vui lòng nhập nội dung bài viết." };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, message: `Nội dung không được dài quá ${MAX_BODY_LENGTH} ký tự.` };
  }

  const excerpt = String(input.excerpt ?? "").trim();
  if (excerpt.length > MAX_EXCERPT_LENGTH) {
    return { ok: false, message: `Tóm tắt không được dài quá ${MAX_EXCERPT_LENGTH} ký tự.` };
  }

  if (!isPostVisibility(input.visibility)) {
    return { ok: false, message: "Chưa chọn ai đọc được bài này." };
  }

  return { ok: true };
}

/**
 * Tóm tắt hiện trên danh sách.
 *
 * Người viết tự đặt thì dùng của họ. Không thì cắt từ thân bài — cắt ở khoảng
 * trắng gần nhất chứ không cắt giữa chữ, và bài viết tiếng Việt cắt giữa chữ ra
 * những mẩu vô nghĩa.
 */
export function postExcerpt(post: { excerpt?: unknown; body?: unknown }, limit = 180): string {
  const own = String(post.excerpt ?? "").trim();
  if (own) return own;

  const body = String(post.body ?? "").replace(/\s+/g, " ").trim();
  if (body.length <= limit) return body;

  const cut = body.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
