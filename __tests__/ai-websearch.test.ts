/**
 * Tìm web cho "Xu hướng ngành": gửi đúng tham số Tavily hiện hành, và mọi lỗi đều
 * rơi về mảng rỗng thay vì làm hỏng công cụ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreProcessState, snapshotProcessState, type ProcessStateSnapshot } from "./support/process-state";

vi.mock("server-only", () => ({}));

import { TAVILY_TIMEOUT_MS, buildIndustryQuery, isWebSearchConfigured, searchWeb } from "@/lib/ai/websearch";

let state: ProcessStateSnapshot;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state = snapshotProcessState();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.TAVILY_API_KEY = "tvly-test";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  restoreProcessState(state);
});

function tavilyResponse(results: unknown[], status = 200) {
  return new Response(JSON.stringify({ results }), { status, headers: { "Content-Type": "application/json" } });
}

describe("searchWeb", () => {
  it("chưa có khoá (hoặc khoá toàn khoảng trắng) thì không gọi mạng", async () => {
    delete process.env.TAVILY_API_KEY;
    expect(isWebSearchConfigured()).toBe(false);
    expect(await searchWeb("logistics")).toEqual([]);

    process.env.TAVILY_API_KEY = "   ";
    expect(isWebSearchConfigured()).toBe(false);
    expect(await searchWeb("logistics")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gửi tham số Tavily hiện hành: time_range, country, include_published_date — không còn days", async () => {
    fetchMock.mockResolvedValue(tavilyResponse([]));
    await searchWeb("xu hướng logistics tại Việt Nam");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tvly-test");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      query: "xu hướng logistics tại Việt Nam",
      search_depth: "advanced",
      max_results: 6,
      topic: "general",
      time_range: "year",
      country: "vietnam",
      include_published_date: true
    });
    expect(body).not.toHaveProperty("days");
  });

  it("chuẩn hoá kết quả: bỏ nguồn thiếu link hoặc nội dung, cắt nội dung, giữ ngày đăng", async () => {
    fetchMock.mockResolvedValue(
      tavilyResponse([
        { title: "  Báo cáo ngành  ", url: "https://a.vn/1", content: "x".repeat(2000), published_date: "2026-08-01" },
        { url: "https://a.vn/2", content: "không tiêu đề" },
        { title: "Thiếu nội dung", url: "https://a.vn/3" },
        { title: "Thiếu link", content: "abc" }
      ])
    );
    const sources = await searchWeb("q");
    expect(sources).toEqual([
      { title: "Báo cáo ngành", url: "https://a.vn/1", content: "x".repeat(1500), publishedDate: "2026-08-01" },
      { title: "https://a.vn/2", url: "https://a.vn/2", content: "không tiêu đề", publishedDate: null }
    ]);
  });

  it("Tavily trả lỗi HTTP thì trả mảng rỗng", async () => {
    fetchMock.mockResolvedValue(new Response("hết quota", { status: 432 }));
    expect(await searchWeb("q")).toEqual([]);
  });

  it("quá thời gian chờ thì huỷ yêu cầu và trả mảng rỗng", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })
    );
    const pending = searchWeb("q");
    await vi.advanceTimersByTimeAsync(TAVILY_TIMEOUT_MS);
    expect(await pending).toEqual([]);
  });
});

describe("buildIndustryQuery", () => {
  it("neo câu hỏi về Việt Nam khi câu hỏi chưa tự nói", () => {
    expect(buildIndustryQuery("xu hướng tuyển dụng ngành logistics")).toBe("xu hướng tuyển dụng ngành logistics tại Việt Nam");
  });

  it("không thêm lần nữa khi câu hỏi đã nhắc Việt Nam, kể cả viết không dấu, viết tắt, hay dấu tách rời", () => {
    expect(buildIndustryQuery("thị trường fintech Việt Nam 2026")).toBe("thị trường fintech Việt Nam 2026");
    expect(buildIndustryQuery("thi truong Viet Nam")).toBe("thi truong Viet Nam");
    expect(buildIndustryQuery("lương IT ở VN")).toBe("lương IT ở VN");
    expect(buildIndustryQuery("ngành bán lẻ Việt Nam".normalize("NFD"))).toBe("ngành bán lẻ Việt Nam");
  });

  it("không gắn đuôi của agency sự kiện trong bản gốc", () => {
    expect(buildIndustryQuery("ngành logistics")).not.toMatch(/activation|marketing|sự kiện/);
  });

  it("cắt câu hỏi dài cho vừa giới hạn truy vấn của Tavily", () => {
    expect(buildIndustryQuery("a".repeat(1000)).length).toBeLessThanOrEqual(400);
  });
});
