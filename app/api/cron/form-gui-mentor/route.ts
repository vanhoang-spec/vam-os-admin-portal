import { runMentorForwardSweep } from "@/lib/custom-form-mentor";

/**
 * app/api/cron/form-gui-mentor/route.ts
 *
 * Cửa cho Vercel Cron quét các câu trả lời form tùy chỉnh đang chờ ghép cặp (VAM00011). Cặp được tạo bằng
 * nhiều đường, nên quét định kỳ thay vì móc vào từng đường. vercel.json: 03:00 UTC = 10:00 giờ Việt Nam,
 * mỗi ngày một lần vì gói Vercel Hobby từ chối deploy nếu cron dày hơn; cần ngay thì BTC bấm "Gửi các bản
 * đang chờ" trên trang câu trả lời.
 *
 * Cùng khuôn bảo vệ với /api/cron/interview-emails: thiếu CRON_SECRET → 503, sai bearer → 401 và không chạm
 * bộ quét. Route này gửi dữ liệu mentee đi, nên tuyệt đối không có đường chạy khi chưa cấu hình bí mật.
 * `api/cron` đã nằm trong nhóm loại trừ của middleware.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return Response.json({ ok: false, reason: "CRON_SECRET chưa được cấu hình — vẫn gửi được bằng nút trên trang câu trả lời." }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runMentorForwardSweep();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
