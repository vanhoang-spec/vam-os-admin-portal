/**
 * Ai đọc được bài nào.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐÂY LÀ CA TEST ĐÁNG VIẾT KỸ NHẤT CỦA MODULE BLOG
 * ---------------------------------------------------------------------------
 * Một bài nội bộ lọt ra công khai là KHÔNG THU HỒI ĐƯỢC. Nó mang tên thật và
 * câu chuyện thật của một người; khi Google đã đọc nó thì gỡ bài đi cũng không
 * gỡ được bản lưu.
 *
 * Không có thông báo lỗi nào khi việc đó xảy ra. Không ai biết, cho tới lúc
 * chính người viết tìm tên mình trên mạng.
 */
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS,
  DEFAULT_VISIBILITY,
  MAX_TITLE_LENGTH,
  canReadPost,
  filterReadablePosts,
  postExcerpt,
  slugifyTitle,
  validatePost,
  type Viewer
} from "@/lib/blog-core";

const ANON: Viewer = ANONYMOUS;
const MEMBER: Viewer = { signedIn: true, canManage: false };
const EDITOR: Viewer = { signedIn: true, canManage: true };

const publicPost = { visibility: "public", status: "published" };
const internalPost = { visibility: "internal", status: "published" };
const draftPublic = { visibility: "public", status: "draft" };

describe("bài nội bộ KHÔNG bao giờ ra ngoài", () => {
  it("người chưa đăng nhập không đọc được bài nội bộ", () => {
    // Ca quan trọng nhất trong cả bộ test của module này.
    expect(canReadPost(internalPost, ANON)).toBe(false);
  });

  it("người đã đăng nhập đọc được bài nội bộ", () => {
    expect(canReadPost(internalPost, MEMBER)).toBe(true);
  });

  it("lọc danh sách cũng bỏ bài nội bộ ra khỏi tay người lạ", () => {
    // Danh sách và trang chi tiết phải nói cùng một câu trả lời — một bài hiện
    // trong danh sách mà mở ra bị từ chối là một lời rò rỉ tiêu đề.
    const rows = filterReadablePosts([publicPost, internalPost], ANON);
    expect(rows).toEqual([publicPost]);
  });
});

describe("giá trị lạ thì TỪ CHỐI, không đoán", () => {
  it("mức hiển thị không nhận ra được thì coi như không đọc được", () => {
    // Dữ liệu cũ, một lần sửa tay, một migration nửa vời. Viết theo lối "chặn
    // khi thấy internal" sẽ cho những giá trị này lọt ra ngoài.
    for (const visibility of ["", "Public", "PUBLIC", "world", "everyone", null, undefined, 1]) {
      expect(
        canReadPost({ visibility, status: "published" }, ANON),
        String(visibility)
      ).toBe(false);
    }
  });

  it("người đã đăng nhập cũng không đọc được bài mang giá trị lạ", () => {
    expect(canReadPost({ visibility: "world", status: "published" }, MEMBER)).toBe(false);
  });

  it("trạng thái lạ thì cũng không hiện ra", () => {
    for (const status of ["", "Published", "live", null, undefined]) {
      expect(canReadPost({ visibility: "public", status }, ANON), String(status)).toBe(false);
    }
  });
});

describe("bản nháp chỉ người soạn bài thấy", () => {
  it("bản nháp công khai vẫn không ra ngoài", () => {
    // "Công khai" nói ai đọc được KHI ĐÃ ĐĂNG. Nó không đăng bài hộ.
    expect(canReadPost(draftPublic, ANON)).toBe(false);
    expect(canReadPost(draftPublic, MEMBER)).toBe(false);
  });

  it("người soạn bài xem được bản nháp", () => {
    expect(canReadPost(draftPublic, EDITOR)).toBe(true);
  });

  it("bài đã lưu trữ biến khỏi mắt người đọc", () => {
    const archived = { visibility: "public", status: "archived" };
    expect(canReadPost(archived, ANON)).toBe(false);
    expect(canReadPost(archived, MEMBER)).toBe(false);
    expect(canReadPost(archived, EDITOR)).toBe(true);
  });
});

describe("mặc định là nội bộ", () => {
  it("quên chọn thì thành nội bộ, không phải thành công khai", () => {
    // Cái giá của hai lần quên rất khác nhau: một bài công khai để nhầm nội bộ
    // thì chỉ ít người đọc hơn.
    expect(DEFAULT_VISIBILITY).toBe("internal");
  });

  it("không chọn mức hiển thị thì không lưu được", () => {
    const result = validatePost({ title: "Một bài", body: "Nội dung", visibility: undefined });
    expect(result.ok).toBe(false);
  });

  it("mức hiển thị lạ cũng không lưu được", () => {
    for (const visibility of ["world", "PUBLIC", "", null]) {
      expect(
        validatePost({ title: "Một bài", body: "Nội dung", visibility }).ok,
        String(visibility)
      ).toBe(false);
    }
  });
});

describe("kiểm bài trước khi lưu", () => {
  it("bài đủ tiêu đề, nội dung và mức hiển thị thì lưu được", () => {
    expect(
      validatePost({ title: "Một năm làm mentor", body: "Nội dung", visibility: "internal" })
    ).toEqual({ ok: true });
  });

  it("thiếu tiêu đề hoặc nội dung thì không", () => {
    expect(validatePost({ title: "", body: "x", visibility: "public" }).ok).toBe(false);
    expect(validatePost({ title: "x", body: "   ", visibility: "public" }).ok).toBe(false);
  });

  it("tiêu đề không dựng được đường dẫn thì không lưu được", () => {
    // Tiêu đề toàn dấu câu ra đường dẫn rỗng, và một bài không có đường dẫn là
    // một bài không mở được.
    expect(validatePost({ title: "!!! ???", body: "x", visibility: "public" }).ok).toBe(false);
  });

  it("tiêu đề quá dài thì không", () => {
    const long = "a".repeat(MAX_TITLE_LENGTH + 1);
    expect(validatePost({ title: long, body: "x", visibility: "public" }).ok).toBe(false);
  });
});

describe("đường dẫn bài viết", () => {
  it("bỏ dấu tiếng Việt", () => {
    expect(slugifyTitle("Một năm làm mentor")).toBe("mot-nam-lam-mentor");
    expect(slugifyTitle("Điều tôi học được")).toBe("dieu-toi-hoc-duoc");
  });

  it("giữ chữ số", () => {
    expect(slugifyTitle("5 điều tôi học được")).toBe("5-dieu-toi-hoc-duoc");
  });

  it("chỉ còn chữ thường, số và dấu gạch nối", () => {
    expect(slugifyTitle('Chuyện "của" tôi: phần 1!')).toMatch(/^[a-z0-9-]+$/);
  });

  it("không để lại dấu gạch nối thừa ở hai đầu", () => {
    expect(slugifyTitle("  --- Xin chào ---  ")).toBe("xin-chao");
  });

  it("tiêu đề rất dài bị cắt, và không kết thúc bằng dấu gạch nối", () => {
    const slug = slugifyTitle("a ".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("tiêu đề không có chữ nào thì ra rỗng, để chỗ gọi biết mà từ chối", () => {
    expect(slugifyTitle("!!! ???")).toBe("");
    expect(slugifyTitle("")).toBe("");
    expect(slugifyTitle(null)).toBe("");
  });
});

describe("tóm tắt trên danh sách", () => {
  it("người viết tự đặt thì dùng của họ", () => {
    expect(postExcerpt({ excerpt: "Tóm tắt riêng", body: "Thân bài dài" })).toBe("Tóm tắt riêng");
  });

  it("không có thì cắt từ thân bài, và cắt ở khoảng trắng", () => {
    const body = "một hai ba bốn năm sáu bảy tám chín mười ".repeat(10);
    const excerpt = postExcerpt({ body }, 60);
    expect(excerpt.endsWith("…")).toBe(true);
    // Không cắt giữa chữ: ký tự ngay trước dấu ba chấm không phải nửa chữ.
    expect(excerpt.replace("…", "").trim().split(" ").pop()).not.toBe("mộ");
  });

  it("thân bài ngắn thì không thêm dấu ba chấm", () => {
    expect(postExcerpt({ body: "Ngắn thôi" })).toBe("Ngắn thôi");
  });

  it("bài rỗng thì ra chuỗi rỗng, không phải chữ undefined", () => {
    expect(postExcerpt({})).toBe("");
  });
});
