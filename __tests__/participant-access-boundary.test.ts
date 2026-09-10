/**
 * Ranh giới: mentor/mentee đăng nhập được, nhưng không vào được đường của
 * ban tổ chức.
 *
 * ---------------------------------------------------------------------------
 * BA ĐIỀU DỄ SAI, VÀ CẢ BA ĐỀU IM LẶNG KHI SAI
 * ---------------------------------------------------------------------------
 * 1. Người đăng nhập KHÔNG phải nhân sự bị đá về trang đăng nhập — trong khi họ
 *    vừa đăng nhập xong. Một vòng lặp không lối ra, và không thông báo lỗi nào.
 * 2. Người đăng nhập không phải nhân sự vào được đường của ban tổ chức. Không
 *    có gì đỏ trên màn hình; chỉ có một mentor đọc danh sách ứng viên.
 * 3. Dấu chọn khung màn hình nhận từ đầu vào của client thay vì đặt từ đường
 *    dẫn — người ta tự chọn khung của mình.
 *
 * Phân loại: STRUCTURAL ASSERTIONS trên mã nguồn middleware. Middleware chạy ở
 * tầng Edge của Next và không nạp được vào vitest như một hàm thường, nên bài
 * kiểm này đọc chính mã đó và khẳng định hình dạng các nhánh.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const raw = readFileSync(join(ROOT, "middleware.ts"), "utf8");

/** Mã đã bỏ chú thích, để khẳng định chạm vào lệnh chứ không phải lời văn. */
const code = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("ba trạng thái phiên, không phải hai", () => {
  it("phân biệt được đăng nhập-không-phải-nhân-sự với chưa đăng nhập", () => {
    expect(code).toMatch(/kind:\s*"signed_in"/);
    expect(code).toMatch(/kind:\s*"admin"/);
    expect(code).toMatch(/kind:\s*"none"/);
  });

  it("người đăng nhập không phải nhân sự KHÔNG bị đá về trang đăng nhập", () => {
    // Nhánh signed_in phải đứng TRƯỚC lời gọi redirectToLogin cuối hàm.
    const middlewareBody = code.slice(code.indexOf("export async function middleware"));
    const signedInAt = middlewareBody.indexOf('session.kind === "signed_in"');
    const loginAt = middlewareBody.lastIndexOf("redirectToLogin");

    expect(signedInAt).toBeGreaterThan(-1);
    expect(signedInAt).toBeLessThan(loginAt);
  });
});

describe("đường của participant là danh sách đóng", () => {
  it("có một danh sách tường minh, không phải phép đoán theo tên", () => {
    expect(code).toMatch(/PARTICIPANT_PATHS\s*=\s*\[/);
  });

  it("chỉ /ct nằm trong đó", () => {
    const list = code.match(/PARTICIPANT_PATHS\s*=\s*\[([^\]]*)\]/);
    expect(list).toBeTruthy();
    const entries = (list?.[1].match(/"([^"]+)"/g) ?? []).map((entry) => entry.replace(/"/g, ""));
    expect(entries).toEqual(["/ct"]);
  });

  it("KHÔNG có đường nào của ban tổ chức lọt vào", () => {
    const list = code.match(/PARTICIPANT_PATHS\s*=\s*\[([^\]]*)\]/)?.[1] ?? "";
    for (const staffPath of [
      "/operations",
      "/applications",
      "/reviews",
      "/matches",
      "/people",
      "/admin",
      "/events",
      "/mentors",
      "/mentees"
    ]) {
      expect(list, staffPath).not.toContain(staffPath);
    }
  });

  it("phép so khớp không cho /ctxyz lọt qua", () => {
    // `startsWith("/ct")` trần sẽ nhận cả `/ctx-admin`. Phải là bằng đúng, hoặc
    // theo sau bởi dấu gạch chéo.
    expect(code).toMatch(/pathname === prefix \|\| pathname\.startsWith\(`\$\{prefix\}\/`\)/);
  });

  it("ai không ở đường participant thì được đưa VỀ /ct, không về trang đăng nhập", () => {
    const branch = code.slice(code.indexOf('session.kind === "signed_in"'));
    expect(branch).toMatch(/pathname\s*=\s*"\/ct"/);
    expect(branch).toMatch(/NextResponse\.redirect/);
  });
});

describe("dấu chọn khung màn hình", () => {
  it("đặt từ đường dẫn, KHÔNG đọc từ đầu vào của client", () => {
    // Nếu dấu này đọc được từ header người dùng gửi lên, một người có thể yêu
    // cầu khung participant trên một đường của ban tổ chức.
    expect(code).toMatch(/requestHeaders\.set\("x-vam-participant-route"/);
    expect(code).not.toMatch(/request\.headers\.get\("x-vam-participant-route"\)/);
  });

  it("chỉ đặt bên trong nhánh signed_in", () => {
    const branch = code.slice(code.indexOf('session.kind === "signed_in"'));
    expect(branch).toContain("x-vam-participant-route");

    const beforeBranch = code.slice(0, code.indexOf('session.kind === "signed_in"'));
    expect(beforeBranch).not.toContain('requestHeaders.set("x-vam-participant-route"');
  });
});

describe("KHÔNG tái sinh phép đọc đã bị thu hồi", () => {
  it("vẫn GỌI module tra cứu tin cậy, không chỉ nhập tên nó vào", () => {
    // Câu kiểm chỉ tìm cái tên sẽ xanh cả khi phép gọi đã bị gỡ và chỉ còn lại
    // dòng import — đúng thứ đã xảy ra lần đầu viết bài kiểm này.
    const gate = code.slice(
      code.indexOf("async function hasActiveAdminUser"),
      code.indexOf("async function resolveSession")
    );
    expect(gate).toMatch(/await\s+resolveActiveAdminViaTrustedServer\s*\(/);
  });

  it("KHÔNG tự đọc admin_users bằng token của người dùng", () => {
    // Chồng S12 làm đúng việc này, và nó là phép đọc đã bị thu hồi —
    // lib/middleware-admin-lookup.ts sinh ra để chữa vòng lặp chuyển hướng do
    // nó gây ra.
    expect(code).not.toMatch(/from=admin_users|\/rest\/v1\/admin_users/);
  });
});

describe("đường công khai không bị đụng vào", () => {
  it("bốn đường công khai vẫn được NHẬN RA, không chỉ được nhắc tên", () => {
    // Soi đúng khối điều kiện mở đầu middleware. Tìm chung cả file thì một
    // đường bị gỡ khỏi điều kiện vẫn xanh, vì tên nó còn nằm trong nhánh chọn
    // nhãn ngay bên dưới.
    const middlewareBody = code.slice(code.indexOf("export async function middleware"));
    const guard = middlewareBody.slice(0, middlewareBody.indexOf("const requestHeaders"));

    for (const path of ["/register/", "/checkin/", "/ve/", "/renew/"]) {
      expect(guard, path).toMatch(
        new RegExp(`startsWith\\("${path.replace(/\//g, "\\/")}"\\)`)
      );
    }
  });

  it("vé và trang gia hạn vẫn giữ tiêu đề chống lưu đệm", () => {
    expect(code).toMatch(/Cache-Control/);
    expect(code).toMatch(/Referrer-Policy/);
  });
});
