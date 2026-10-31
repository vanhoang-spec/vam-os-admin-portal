/**
 * Cửa cron của lượt quét gửi mentor (VAM00011). Route này đưa dữ liệu mentee đi, nên ca từ chối quan trọng
 * hơn ca chạy được. Kèm hai khẳng định tĩnh vì middleware không chạy trong vitest: thiếu dòng loại trừ
 * `api/cron` thì job bị đá về /login và chết lặng.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/custom-form-mentor", () => ({
  runMentorForwardSweep: vi.fn(async () => ({ ok: true, message: "Đã gửi 2 bản", counts: { sent: 2, waiting: 0, unknown: 0, failed: 0 }, stop: null }))
}));

import { GET } from "@/app/api/cron/form-gui-mentor/route";
import { runMentorForwardSweep } from "@/lib/custom-form-mentor";

const requestWith = (auth?: string) => new Request("https://os.example.org/api/cron/form-gui-mentor", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

describe("cổng CRON_SECRET", () => {
  it("chưa cấu hình bí mật: 503, không quét", async () => {
    const response = await GET(requestWith("Bearer gi-do"));
    expect(response.status).toBe(503);
    expect(runMentorForwardSweep).not.toHaveBeenCalled();
  });

  it("bí mật toàn khoảng trắng coi như chưa cấu hình, 'Bearer ' rỗng không lọt", async () => {
    process.env.CRON_SECRET = "   ";
    expect((await GET(requestWith("Bearer "))).status).toBe(503);
    expect(runMentorForwardSweep).not.toHaveBeenCalled();
  });

  it.each([["sai bearer", "Bearer sai"], ["thiếu Bearer", "bi-mat"], ["thiếu header", undefined]])("%s: 401, không quét", async (_name, auth) => {
    process.env.CRON_SECRET = "bi-mat";
    expect((await GET(requestWith(auth))).status).toBe(401);
    expect(runMentorForwardSweep).not.toHaveBeenCalled();
  });

  it("đúng bearer: quét và trả kết quả", async () => {
    process.env.CRON_SECRET = "bi-mat";
    const response = await GET(requestWith("Bearer bi-mat"));
    expect(response.status).toBe(200);
    expect(runMentorForwardSweep).toHaveBeenCalledTimes(1);
    expect(((await response.json()) as { counts: { sent: number } }).counts.sent).toBe(2);
  });

  it("lượt quét lỗi: trả 500 để lỗi hiện trong log cron, không giả vờ xanh", async () => {
    process.env.CRON_SECRET = "bi-mat";
    vi.mocked(runMentorForwardSweep).mockResolvedValueOnce({ ok: false, message: "lỗi", counts: { sent: 0, waiting: 0, unknown: 0, failed: 0 }, stop: null });
    expect((await GET(requestWith("Bearer bi-mat"))).status).toBe(500);
  });
});

describe("cấu hình ngoài route", () => {
  it("vercel.json khai lịch mỗi ngày một lần, và giữ nguyên cron cũ", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons).toContainEqual({ path: "/api/cron/form-gui-mentor", schedule: "0 3 * * *" });
    expect(config.crons).toContainEqual({ path: "/api/cron/interview-emails", schedule: "0 2 * * *" });
  });

  it("middleware chừa api/cron", () => {
    expect(readFileSync("middleware.ts", "utf8")).toMatch(/matcher:.*api\/cron/);
  });
});
