/**
 * Đổi mùa xong thì quay về đúng trang đang xem.
 *
 * Danh sách trang được quay về và danh sách trang hiện ô chọn mùa là MỘT danh
 * sách (lib/season-labels.ts). Hai danh sách riêng thì trang nào được thêm vào
 * một mà quên cái kia sẽ hiện ô chọn mùa, rồi đổi mùa xong lại bị đẩy về trang
 * chủ — đúng chuyện sẽ xảy ra với /participant-accounts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ redirects: [] as string[], cookieSet: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.cookieSet }) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    h.redirects.push(url);
    throw new Error("NEXT_REDIRECT");
  })
}));
vi.mock("@/lib/season-context", () => ({
  SEASON_COOKIE_NAME: "vam_season",
  resolveSeasonContext: vi.fn(async () => ({ selectedSeasonCode: "UEHM-S11", availableSeasons: [] }))
}));

import { setSeasonContextAction } from "@/app/actions/season-context";

async function switchSeason(returnTo: string) {
  const data = new FormData();
  data.set("season", "UEHM-S11");
  data.set("returnTo", returnTo);
  await expect(setSeasonContextAction(data)).rejects.toThrow("NEXT_REDIRECT");
  return h.redirects[h.redirects.length - 1];
}

beforeEach(() => {
  h.redirects.length = 0;
  h.cookieSet.mockReset();
});

describe("quay về trang đang xem", () => {
  it("trang tài khoản đăng nhập: giữ bộ lọc, bỏ tham số mùa cũ", async () => {
    expect(await switchSeason("/participant-accounts?role=mentee&season=UEHM-S12")).toBe("/participant-accounts?role=mentee");
  });

  it("các trang theo mùa cũ vẫn như trước", async () => {
    expect(await switchSeason("/mentors")).toBe("/mentors");
    expect(await switchSeason("/operations/tasks?tab=mine")).toBe("/operations/tasks?tab=mine");
  });

  it("trang không theo mùa thì về trang chủ", async () => {
    expect(await switchSeason("/admin/users")).toBe("/");
  });

  it("không bao giờ đưa ra ngoài hệ thống", async () => {
    expect(await switchSeason("//evil.example/participant-accounts")).toBe("/");
    expect(await switchSeason("https://evil.example/participant-accounts")).toBe("/");
    expect(await switchSeason("/\\evil.example")).toBe("/");
  });
});
