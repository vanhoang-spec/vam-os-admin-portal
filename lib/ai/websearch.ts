import "server-only";

import { evaluateAiConfig } from "./ai-core";

/**
 * Tìm kiếm web để "neo" câu trả lời về xu hướng ngành vào nguồn thật.
 *
 * DeepSeek (và mọi LLM) không truy cập internet: hỏi về xu hướng hay tin mới thì nó
 * bịa tên doanh nghiệp và số liệu nghe rất thuyết phục. Có lớp này thì model đọc
 * trích đoạn từ trang web thật rồi mới tổng hợp, và bắt buộc dẫn link để người đọc
 * tự kiểm chứng.
 *
 * Dùng Tavily — dịch vụ tìm kiếm thiết kế cho LLM, trả sẵn nội dung đã bóc tách.
 * Gọi bằng `fetch` thuần. Biến môi trường TAVILY_API_KEY là tuỳ chọn: không có thì
 * công cụ tự rơi về chế độ kiến thức chung và nói rõ điều đó trên màn hình.
 */

const TAVILY_URL = "https://api.tavily.com/search";
export const TAVILY_TIMEOUT_MS = 25_000;
/** Tavily nhận truy vấn tối đa khoảng 400 ký tự. */
const MAX_QUERY_CHARS = 380;

export function isWebSearchConfigured(): boolean {
  return evaluateAiConfig(process.env).tavily;
}

export type WebSource = {
  title: string;
  url: string;
  /** Trích đoạn nội dung Tavily đã bóc tách sẵn từ trang. */
  content: string;
  publishedDate: string | null;
};

type TavilyResponse = {
  results?: { title?: string; url?: string; content?: string; published_date?: string | null }[];
};

/**
 * Trả về các nguồn liên quan. Mảng rỗng nghĩa là không tìm được / chưa cấu hình /
 * lỗi mạng — chỗ gọi phải xử lý được, KHÔNG ném lỗi làm hỏng cả công cụ.
 */
export async function searchWeb(query: string, maxResults = 6): Promise<WebSource[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        // "advanced" bóc tách kỹ hơn (2 credit/lần) — đáng giá vì mỗi lần chạy là
        // do người dùng chủ động bấm.
        search_depth: "advanced",
        max_results: maxResults,
        topic: "general",
        // Bản gốc gửi `days: 365`, tham số Tavily không còn nhận — kết quả cũ
        // nhiều năm lọt vào câu trả lời về "xu hướng". `time_range` là tên hiện hành.
        time_range: "year",
        // Ưu tiên nguồn Việt Nam. Chỉ có hiệu lực với topic "general".
        country: "vietnam",
        // Không bật thì Tavily trả `published_date` rỗng cho mọi kết quả, và phần
        // "ngày đăng" của nguồn tham khảo không bao giờ có chữ.
        include_published_date: true
      }),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!res.ok) {
      console.error("[websearch] Tavily trả lỗi:", res.status, await res.text().catch(() => ""));
      return [];
    }
    const data = (await res.json()) as TavilyResponse;
    return (data.results ?? [])
      .filter((r) => r.url && r.content)
      .map((r) => ({
        title: r.title?.trim() || r.url!,
        url: r.url!,
        // Cắt bớt để không thổi phồng số token gửi lên model.
        content: r.content!.slice(0, 1500),
        publishedDate: r.published_date ?? null
      }));
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") console.error("[websearch] quá thời gian chờ");
    else console.error("[websearch] lỗi:", e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Truy vấn gửi Tavily từ câu hỏi của người dùng.
 *
 * Bản gốc gắn đuôi "sự kiện activation marketing" — đúng cho một agency sự kiện,
 * sai cho câu hỏi "xu hướng tuyển dụng ngành logistics". Ở đây chỉ neo về Việt Nam,
 * và chỉ khi câu hỏi chưa tự nói.
 */
export function buildIndustryQuery(question: string): string {
  const q = question.normalize("NFC").trim().slice(0, MAX_QUERY_CHARS);
  return /việt\s*nam|viet\s*nam|\bVN\b/i.test(q) ? q : `${q} tại Việt Nam`;
}
