/**
 * Thư mời nhân sự qua Brevo: lời thư, đường dẫn, và sổ thư.
 *
 * Phân loại: DIRECT PRODUCTION TESTS (gọi thẳng export thật, chỉ giả database
 * và fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { buildStaffInviteEmail, staffInviteSubject } from "@/lib/email-core";
import { sendStaffInvite } from "@/lib/email";

function insertRecorder() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      }
    })
  };
  return { client, inserts };
}

const TOUCHED_ENV = [
  "VAM_OS_EMAIL_ENABLED",
  "VERCEL_ENV",
  "VAM_OS_EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "VAM_OS_EMAIL_FROM",
  "VAM_OS_EMAIL_REPLY_TO",
  "VAM_OS_PUBLIC_BASE_URL"
] as const;
const ORIGINAL_ENV = new Map<string, string | undefined>();
let fetchMock: Mock;

beforeEach(() => {
  ORIGINAL_ENV.clear();
  for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "UEH Mentoring <hello@alumni-mentoring.edu.vn>";
  process.env.VAM_OS_PUBLIC_BASE_URL = "https://os.example.org";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("1. lời thư", () => {
  const letter = (linkType: "invite" | "recovery") =>
    buildStaffInviteEmail({
      fullName: "Võ Thị Thảo",
      roleLabel: "Ban Điều hành",
      linkUrl: "https://os.example.org/reset-password#token_hash=abc&type=invite",
      linkType,
      loginUrl: "https://os.example.org/login",
      loginEmail: "Thao@Example.com"
    });

  it("hai bước: đặt mật khẩu, rồi đăng nhập ở đâu bằng email nào", () => {
    const { subject, text } = letter("invite");
    expect(subject).toBe(staffInviteSubject());
    expect(text).toContain("Bước 1");
    expect(text).toContain("https://os.example.org/reset-password#token_hash=abc&type=invite");
    expect(text).toContain("Bước 2 — Đăng nhập tại https://os.example.org/login bằng email thao@example.com");
  });

  it("nói tên vai trò người nhận được trao", () => {
    expect(letter("invite").text).toContain("Ban Điều hành");
  });

  it("KHÔNG dặn chờ ban tổ chức bật tài khoản — tài khoản đã kích hoạt ngay lúc tạo", () => {
    // Bước chờ kích hoạt đã bỏ (13/09/2026). Một lời dặn chờ không có thật khiến
    // người nhận ngồi chờ thay vì đăng nhập.
    for (const type of ["invite", "recovery"] as const) {
      const { text, html } = letter(type);
      expect(text).not.toMatch(/bật tài khoản|chờ ban tổ chức|chưa sẵn sàng/);
      expect(html).not.toMatch(/bật tài khoản|chờ ban tổ chức|chưa sẵn sàng/);
    }
  });

  it("thư gửi lại nói link cũ đã hết dùng", () => {
    expect(letter("recovery").text).toContain("không còn dùng được");
    expect(letter("invite").text).not.toContain("không còn dùng được");
  });

  it("không nhắc gì tới mục Đánh giá — đây không phải thư reviewer", () => {
    expect(letter("invite").text).not.toContain("Đánh giá");
  });
});

describe("2. gửi thư", () => {
  const input = {
    toEmail: "thao@example.com",
    fullName: "Võ Thị Thảo",
    roleLabel: "Ban Điều hành",
    linkType: "invite" as const,
    tokenHash: "hash-1",
    adminUserId: "admin-user-1"
  };

  it("link về /reset-password của chính hệ thống; sổ thư ghi đúng loại và đúng người", async () => {
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<m@brevo>" }) });

    const result = await sendStaffInvite(input);

    expect(result).toMatchObject({ ok: true, skipped: false });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.textContent).toContain("https://os.example.org/reset-password#token_hash=hash-1&type=invite");
    expect(db.inserts[0].payload).toMatchObject({
      kind: "staff_invite",
      status: "sent",
      related_table: "admin_users",
      related_id: "admin-user-1"
    });
  });

  it("KHÔNG dùng lại loại thư của reviewer", () => {
    // Dùng lại 'reviewer_invite' sẽ làm phép chống gửi trùng 60 phút trong
    // lib/enable-reviewer.ts chặn im lặng thư mời reviewer của chính người này.
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<m@brevo>" }) });
    return sendStaffInvite(input).then(() => {
      expect(db.inserts[0].payload.kind).not.toBe("reviewer_invite");
    });
  });

  it("địa chỉ gốc không an toàn: không gọi nhà cung cấp, sổ thư ghi failed", async () => {
    process.env.VAM_OS_PUBLIC_BASE_URL = "http://os.example.org";
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendStaffInvite(input);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.inserts[0].payload).toMatchObject({ kind: "staff_invite", status: "failed" });
  });

  it("mã rỗng thì không dựng được link, và không gửi gì", async () => {
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendStaffInvite({ ...input, tokenHash: "" });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.inserts[0].payload).toMatchObject({ status: "failed" });
  });
});

describe("3. production không đặt VAM_OS_PUBLIC_BASE_URL", () => {
  // Đúng điều kiện đã làm hỏng thư mời nhân sự đầu tiên trên production: biến môi
  // trường vắng mặt, và địa chỉ của request là nguồn duy nhất để dựng link. Hai ca
  // ở trên đặt sẵn biến đó, nên chúng xanh cả khi nơi gọi quên truyền địa chỉ.
  const input = {
    toEmail: "thao@example.com",
    fullName: "Võ Thị Thảo",
    roleLabel: "Ban Điều hành",
    linkType: "invite" as const,
    tokenHash: "hash-9",
    adminUserId: "admin-9"
  };

  it("dựng link từ địa chỉ của request khi biến môi trường vắng mặt", async () => {
    delete process.env.VAM_OS_PUBLIC_BASE_URL;
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<m@brevo>" }) });

    const result = await sendStaffInvite({ ...input, requestOrigin: "https://os.alumni-mentoring.edu.vn" });

    expect(result.ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.textContent).toContain("https://os.alumni-mentoring.edu.vn/reset-password#token_hash=hash-9&type=invite");
  });

  it("thiếu cả biến môi trường lẫn địa chỉ request: không gửi, sổ thư ghi failed", async () => {
    delete process.env.VAM_OS_PUBLIC_BASE_URL;
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendStaffInvite({ ...input });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.inserts[0].payload).toMatchObject({ kind: "staff_invite", status: "failed" });
  });
});
