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
const CORE = "lib/recruitment-permissions-core.ts";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  ["Danh sách nhân sự tuyển sinh", "lib/nav-model.ts", '"Danh sách nhân sự tuyển sinh"'],
  ["Giao hồ sơ đánh giá", "lib/nav-model.ts", '"Giao hồ sơ đánh giá"'],
  ["Đợt tuyển", "app/reviews/reviewer-pool/page.tsx", ">Đợt tuyển<"],
  ["Tìm theo tên, email, mentor code…", POOL_CLIENT, 'placeholder="Tìm theo tên, email, mentor code…"'],
  // Nhãn nút dựng bằng `Cấp ${rightLabel}`, rightLabel = `quyền ${nhãn nhóm viết thường}`;
  // nhãn bốn nhóm nằm một chỗ ở lib/recruitment-permissions-core.ts (04/10/2026).
  ["Cấp quyền chấm hồ sơ mentee", CORE, 'label: "Chấm hồ sơ mentee"'],
  ["Cấp quyền phỏng vấn mentee", CORE, 'label: "Phỏng vấn mentee"'],
  ["Cấp quyền chấm hồ sơ mentor", CORE, 'label: "Chấm hồ sơ mentor"'],
  ["Cấp quyền phỏng vấn mentor", CORE, 'label: "Phỏng vấn mentor"'],
  ["Cấp quyền", POOL_CLIENT, "`quyền ${participationLabel(participationRole).toLowerCase()}`"],
  ["Chỉ Ban điều hành cấp / thu quyền chấm hồ sơ và phỏng vấn mentor.", "lib/enable-reviewer.ts", "Chỉ Ban điều hành cấp / thu quyền chấm hồ sơ và phỏng vấn mentor."],
  ["Thu hồi quyền", POOL_CLIENT, "`Thu hồi ${rightLabel}`"],
  ["Chưa có tài khoản", POOL_CLIENT, 'no_account: "Chưa có tài khoản"'],
  ["Đang có quyền đánh giá", POOL_CLIENT, 'reviewer_active: "Đang có quyền đánh giá"'],
  ["Tài khoản hiện tại", POOL_CLIENT, ">Tài khoản hiện tại<"],
  ["Đã cấp quyền chấm hồ sơ mentee cho đúng mùa.", "lib/enable-reviewer.ts", "Đã cấp quyền ${label} cho đúng mùa."],
  ["CHƯA gửi được thư đặt mật khẩu", "lib/enable-reviewer.ts", "CHƯA gửi được thư đặt mật khẩu"],
  ["Bạn không có quyền vận hành mùa này.", "lib/enable-reviewer.ts", "Bạn không có quyền vận hành mùa này."],
  ["Không thể tạo lời mời đăng nhập cá nhân.", "lib/enable-reviewer.ts", "Không thể tạo lời mời đăng nhập cá nhân."],
  ["Không thể cấp quyền tham gia tuyển sinh", "lib/enable-reviewer.ts", "Không thể cấp quyền tham gia tuyển sinh"],
  // Nút trong thư, và nút trên trang đặt mật khẩu.
  ["Đặt mật khẩu", "lib/email-core.ts", ">Đặt mật khẩu</a>"],
  ["Tiếp tục", "lib/password-link-core.ts", 'continueLabel: "Tiếp tục"']
];

describe("mỗi câu hướng dẫn trích đều có thật trên màn hình", () => {
  for (const [quote, file, needle] of QUOTED) {
    it(`"${quote}"`, () => {
      expect(guideText).toContain(quote);
      expect(read(file), `${file} không còn "${needle}"`).toContain(needle);
    });
  }

  it("dòng báo cấp quyền dùng đúng nhãn nhóm (viết thường), từ cùng một nguồn với nút", () => {
    expect(read("lib/enable-reviewer.ts")).toContain("const label = participationLabel(input.participationRole).toLowerCase();");
  });
});

describe("những điều hướng dẫn khẳng định về cách hệ thống chạy", () => {
  it("thư mời dẫn tới trang đặt mật khẩu của chính hệ thống, rồi đăng nhập bằng mật khẩu và vào mục Đánh giá", () => {
    expect(guideText).toContain("email và mật khẩu vừa đặt");
    expect(guideText).toContain("Đánh giá");
    expect(read("lib/email.ts")).toMatch(/export async function sendReviewerInvite[\s\S]*?buildPasswordLinkUrl\(/);
    expect(read("lib/email-core.ts")).toContain("rồi vào mục “Đánh giá”");
  });

  it("hướng dẫn không còn dạy đăng nhập bằng liên kết qua email", () => {
    // Liên kết đăng nhập đi qua thư của Supabase, đường mà chính lỗi mời reviewer
    // cho thấy không đáng tin. Mật khẩu là đường reviewer dùng được chắc chắn.
    expect(guideText).not.toContain("Gửi liên kết đăng nhập qua email");
    expect(guideText).not.toContain("Không cần mật khẩu");
  });

  it("chỉ lần bấm đầu tiên tạo tài khoản — người đã có tài khoản không bị mời lại", () => {
    expect(guideText).toContain("không gửi thêm thư");
    const source = read("lib/enable-reviewer.ts");
    const lookup = source.indexOf("findAuthUserByEmail(client, email)");
    const invite = source.indexOf('generatePasswordLink(client, "invite", email)');
    expect(lookup).toBeGreaterThan(0);
    expect(invite).toBeGreaterThan(lookup);
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
