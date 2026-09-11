/**
 * Đăng nhập bằng mật khẩu ghi mốc lần đầu — đúng lúc, và chỉ cho mentor/mentee.
 *
 * Ghi mốc trước khi nhận ra được người là ghi cho một tài khoản chưa chắc thuộc
 * về ai; ghi cho nhân sự là ghi vào một bảng họ không có dòng nào.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    h.order.push(`redirect:${url}`);
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;push;${url};307;`;
    throw error;
  })
}));
vi.mock("@/lib/public-url", () => ({ getAuthCallbackUrl: vi.fn(async () => null) }));
vi.mock("@/lib/admin-auth", () => ({
  clearAuthCookies: vi.fn(async () => {
    h.order.push("clearCookies");
  }),
  findAdminUserForAuthUser: vi.fn(),
  getSupabaseAuthClientForPasswordSignIn: vi.fn(),
  hasAnyAdminUserRow: vi.fn(),
  setAuthCookies: vi.fn(async () => {
    h.order.push("setCookies");
  })
}));
vi.mock("@/lib/participant-auth", () => ({
  resolveParticipantIdentity: vi.fn(),
  recordParticipantActivation: vi.fn(async () => {
    h.order.push("activation");
  })
}));

import { loginAction } from "@/app/login/actions";
import {
  findAdminUserForAuthUser,
  getSupabaseAuthClientForPasswordSignIn,
  hasAnyAdminUserRow
} from "@/lib/admin-auth";
import { recordParticipantActivation, resolveParticipantIdentity } from "@/lib/participant-auth";

function form() {
  const data = new FormData();
  data.set("email", "an@example.com");
  data.set("password", "mat-khau-1");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  vi.mocked(getSupabaseAuthClientForPasswordSignIn).mockReturnValue({
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: {
          session: { access_token: "t", refresh_token: "r", expires_in: 3600 },
          user: { id: "auth-1", email: "an@example.com" }
        },
        error: null
      })),
      signOut: vi.fn(async () => ({ error: null }))
    }
  } as never);
  vi.mocked(findAdminUserForAuthUser).mockResolvedValue(null);
  vi.mocked(hasAnyAdminUserRow).mockResolvedValue(false);
});

describe("mentor/mentee đăng nhập", () => {
  it("ghi mốc SAU khi nhận ra người, TRƯỚC khi đặt cookie, rồi vào /ct", async () => {
    vi.mocked(resolveParticipantIdentity).mockResolvedValue({
      decision: { kind: "linked", personId: "person-1" },
      personId: "person-1",
      refusal: null,
      error: null
    } as never);

    await expect(loginAction({ error: null }, form())).rejects.toThrow("NEXT_REDIRECT");

    expect(recordParticipantActivation).toHaveBeenCalledWith({ authUserId: "auth-1", personId: "person-1" });
    expect(h.order).toEqual(["activation", "setCookies", "redirect:/ct"]);
  });

  it("không nhận ra được người thì không ghi gì", async () => {
    vi.mocked(resolveParticipantIdentity).mockResolvedValue({
      decision: { kind: "no_match" },
      personId: null,
      refusal: "Chưa nhận ra bạn.",
      error: null
    } as never);

    const result = await loginAction({ error: null }, form());

    expect(result.error).toBe("Chưa nhận ra bạn.");
    expect(recordParticipantActivation).not.toHaveBeenCalled();
  });
});

describe("nhân sự đăng nhập", () => {
  it("không đụng tới mốc của mentor/mentee", async () => {
    vi.mocked(findAdminUserForAuthUser).mockResolvedValue({ id: "admin-1", role: "admin" } as never);

    await expect(loginAction({ error: null }, form())).rejects.toThrow("NEXT_REDIRECT");

    expect(recordParticipantActivation).not.toHaveBeenCalled();
    expect(resolveParticipantIdentity).not.toHaveBeenCalled();
  });
});
