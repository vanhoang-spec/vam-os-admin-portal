/**
 * Hướng dẫn một trang "Mời reviewer vào VAM OS" — không được nói sai màn hình.
 *
 * Người đọc tin hướng dẫn và đi tìm đúng chữ trên màn hình. Mỗi câu hướng dẫn
 * trích — tên menu, nhãn nút, lời báo — phải có thật trong mã nguồn. Đổi một
 * nhãn mà quên sửa hướng dẫn thì test này đỏ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_CAP_QUYEN_REVIEWER.html");
/** The guide as a reader sees it: tags gone, whitespace collapsed. */
const guideText = html.replace(/<style[\s\S]*?<\/style>/i, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const POOL_CLIENT = "app/reviews/reviewer-pool/reviewer-pool-client.tsx";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  ["Danh sách nhân sự tuyển sinh", "lib/nav-model.ts", '"Danh sách nhân sự tuyển sinh"'],
  ["Giao hồ sơ đánh giá", "lib/nav-model.ts", '"Giao hồ sơ đánh giá"'],
  ["Đợt tuyển", "app/reviews/reviewer-pool/page.tsx", ">Đợt tuyển<"],
  ["Tìm theo tên, email, mentor code…", POOL_CLIENT, 'placeholder="Tìm theo tên, email, mentor code…"'],
  // Nhãn nút dựng bằng `Cấp ${rightLabel}` / `Thu hồi ${rightLabel}`.
  ["Cấp quyền đánh giá", POOL_CLIENT, '"quyền đánh giá"'],
  ["Cấp quyền phỏng vấn", POOL_CLIENT, '"quyền phỏng vấn"'],
  ["Thu hồi quyền", POOL_CLIENT, "`Thu hồi ${rightLabel}`"],
  ["Chưa có tài khoản", POOL_CLIENT, 'no_account: "Chưa có tài khoản"'],
  ["Đang có quyền đánh giá", POOL_CLIENT, 'reviewer_active: "Đang có quyền đánh giá"'],
  ["Tài khoản hiện tại", POOL_CLIENT, ">Tài khoản hiện tại<"],
  ["Đã cấp quyền Reviewer hồ sơ cho đúng mùa.", "lib/enable-reviewer.ts", "Đã cấp quyền ${label} cho đúng mùa."],
  ["Bạn không có quyền vận hành mùa này.", "lib/enable-reviewer.ts", "Bạn không có quyền vận hành mùa này."],
  ["Không thể tạo lời mời đăng nhập cá nhân.", "lib/enable-reviewer.ts", "Không thể tạo lời mời đăng nhập cá nhân."],
  ["Không thể cấp quyền tham gia tuyển sinh", "lib/enable-reviewer.ts", "Không thể cấp quyền tham gia tuyển sinh"],
  ["Gửi liên kết đăng nhập qua email", "app/login/login-form.tsx", '"Gửi liên kết đăng nhập qua email"']
];

describe("mỗi câu hướng dẫn trích đều có thật trên màn hình", () => {
  for (const [quote, file, needle] of QUOTED) {
    it(`"${quote}"`, () => {
      expect(guideText).toContain(quote);
      expect(read(file), `${file} không còn "${needle}"`).toContain(needle);
    });
  }

  it("dòng báo cấp quyền đánh giá dùng đúng nhãn Reviewer hồ sơ", () => {
    expect(read("lib/enable-reviewer.ts")).toContain('"Reviewer hồ sơ"');
  });
});

describe("những điều hướng dẫn khẳng định về cách hệ thống chạy", () => {
  it("bấm liên kết trong thư mời là vào thẳng trang Đánh giá", () => {
    expect(guideText).toContain("trang Đánh giá");
    expect(read("app/auth/callback/actions.ts")).toContain('safeNext(input.next ?? "/reviews")');
  });

  it("chỉ lần bấm đầu tiên gửi thư mời — người đã có tài khoản không bị mời lại", () => {
    expect(guideText).toContain("không gửi thêm thư");
    const source = read("lib/enable-reviewer.ts");
    const lookup = source.indexOf("findAuthUserByEmail(client, email)");
    const invite = source.indexOf("inviteUserByEmail(");
    expect(lookup).toBeGreaterThan(0);
    expect(source.slice(lookup, invite)).toContain("if (!authUser) {");
  });

  it("support_team vào được trang cấp quyền mà hướng dẫn dẫn tới", () => {
    expect(read("lib/permissions.ts")).toMatch(
      /export function canManageReviewers[\s\S]*?"support_team"[\s\S]*?\n}/
    );
  });
});

describe("hướng dẫn không mang dữ liệu người thật", () => {
  it("mọi địa chỉ email trong hướng dẫn đều là ví dụ", () => {
    const emails = html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email, email).toMatch(/@example\.com$/);
  });
});
