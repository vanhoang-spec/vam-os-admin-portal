import { runInterviewInviteDispatch } from "@/lib/interview-schedule";

/**
 * app/api/cron/interview-emails/route.ts
 *
 * Cửa cho Vercel Cron gọi bộ gửi thư mời/nhắc đặt lịch phỏng vấn mỗi sáng
 * (vercel.json: 02:00 UTC = 09:00 giờ Việt Nam). Đây là lưới đỡ cho vòng
 * tự động 20 giây trên trang ban tổ chức — trang không ai mở thì cron vẫn
 * giữ nhịp nhắc 3 ngày.
 *
 * Bảo vệ bằng CRON_SECRET: Vercel tự gắn "Authorization: Bearer <secret>"
 * khi biến môi trường đó tồn tại. Chưa khai biến → 503 (nói thẳng là chưa
 * cấu hình, đừng im); sai bearer → 401. LƯU Ý middleware: request của cron
 * không mang cookie phiên, nên `api/cron` phải nằm trong nhóm loại trừ của
 * matcher — thiếu nó, request bị đá về /login và job chết lặng, điều mà bài
 * test route này KHÔNG bắt được (middleware không chạy trong vitest);
 * __tests__/interview-cron-route.test.ts khẳng định tĩnh trên mã nguồn.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return Response.json(
      { ok: false, reason: "CRON_SECRET chưa được cấu hình — bộ gửi vẫn chạy từ trang Lịch phỏng vấn." },
      { status: 503 }
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runInterviewInviteDispatch({ source: "cron" });
  return Response.json(result);
}
