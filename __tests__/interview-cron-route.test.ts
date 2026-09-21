/**
 * __tests__/interview-cron-route.test.ts
 *
 * Cửa cron của bộ gửi thư mời/nhắc đặt lịch. Ba lời hứa: thiếu CRON_SECRET
 * thì nói thẳng 503 (không giả vờ chạy), sai bearer thì 401 và KHÔNG chạm bộ
 * gửi, đúng bearer thì chạy và trả kết quả. Kèm hai khẳng định tĩnh mà route
 * không tự kiểm được: vercel.json phải khai lịch chạy, và middleware phải
 * chừa `api/cron` khỏi cổng phiên — middleware không chạy trong vitest, nên
 * thiếu dòng loại trừ đó thì cron chết lặng ngoài production.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/interview-schedule", () => ({
  runInterviewInviteDispatch: vi.fn(async () => ({
    ok: true,
    message: "Đã gửi 3 thư.",
    sent: 3,
    failed: 0,
    remaining: 0,
    stopped429: false
  }))
}));

import { GET } from "@/app/api/cron/interview-emails/route";
import { runInterviewInviteDispatch } from "@/lib/interview-schedule";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function requestWith(auth?: string) {
  return new Request("https://os.example.org/api/cron/interview-emails", {
    headers: auth ? { authorization: auth } : {}
  });
}

describe("1. cổng CRON_SECRET", () => {
  it("chưa cấu hình secret → 503 nói thẳng, không chạy bộ gửi", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(requestWith("Bearer gi-do"));
    expect(response.status).toBe(503);
    expect(runInterviewInviteDispatch).not.toHaveBeenCalled();
  });

  it("sai bearer → 401, không chạy bộ gửi", async () => {
    process.env.CRON_SECRET = "bi-mat";
    const response = await GET(requestWith("Bearer sai"));
    expect(response.status).toBe(401);
    expect(runInterviewInviteDispatch).not.toHaveBeenCalled();
  });

  it("thiếu hẳn header cũng 401", async () => {
    process.env.CRON_SECRET = "bi-mat";
    const response = await GET(requestWith());
    expect(response.status).toBe(401);
  });

  it("đúng bearer → chạy nguồn cron và trả kết quả của bộ gửi", async () => {
    process.env.CRON_SECRET = "bi-mat";
    const response = await GET(requestWith("Bearer bi-mat"));
    expect(response.status).toBe(200);
    expect(runInterviewInviteDispatch).toHaveBeenCalledWith({ source: "cron" });
    const body = (await response.json()) as { sent: number };
    expect(body.sent).toBe(3);
  });
});

describe("2. khẳng định tĩnh — hai mảnh route không tự kiểm được", () => {
  it("vercel.json khai cron 02:00 UTC (= 09:00 giờ Việt Nam) trỏ đúng đường", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const cron = (config.crons ?? []).find((row) => row.path === "/api/cron/interview-emails");
    expect(cron?.schedule).toBe("0 2 * * *");
  });

  it("middleware chừa api/cron khỏi cổng phiên — request cron không mang cookie", () => {
    const source = readFileSync("middleware.ts", "utf8");
    const matcher = source.slice(source.indexOf("matcher:"));
    expect(matcher).toContain("api/cron");
  });
});
