import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { getExemptionConfirmPage } from "@/lib/mentee-exemption";
import { ConfirmForm } from "./confirm-form";

/**
 * Trang xác nhận tham gia mentee của một bạn Support team được đặc cách — công khai, không
 * cần đăng nhập (BTC 11/10/2026).
 *
 * Người nhận vào bằng đường dẫn riêng trong thư mời, bấm một nút là xong. Trang chỉ hiện
 * tên người nhận; không email, không số điện thoại — ai cầm link cũng mở được trang này.
 * Mở trang không ghi gì: chỉ nút "Xác nhận tham gia" mới ghi (xem confirm-form.tsx).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Xác nhận tham gia Mentee · UEH Mentoring",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

const SUPPORT = "Cần hỗ trợ, bạn nhắn Zalo ban tổ chức 0919144638 hoặc trả lời thư mời.";

export default async function MenteeConfirmPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const data = await getExemptionConfirmPage(token);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">UEH Mentoring · {data.seasonLabel}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {data.name && data.state !== "invalid" ? `Chào ${data.name}` : "Xác nhận tham gia Mentee"}
          </h1>
        </div>

        {data.state === "ready" ? (
          <Card>
            <div className="grid gap-4" data-testid="confirm-ready">
              <p className="text-sm leading-6 text-vam-ink">
                Cảm ơn bạn đã đồng hành cùng chương trình trong vai trò Support team. Ban tổ chức đặc cách để bạn tham gia{" "}
                <strong>{data.seasonLabel}</strong> với vai trò <strong>Mentee</strong> mà không cần qua vòng phỏng vấn.
              </p>
              <p className="text-sm leading-6 text-vam-ink">
                Bấm nút dưới đây là bạn xác nhận tham gia với vai trò Mentee trong mùa này, và đồng ý để ban tổ chức lưu trữ, sử dụng thông tin của bạn cho
                hoạt động của mùa. Sau đó ban tổ chức sẽ đưa bạn vào bước ghép cặp Mentor – Mentee.
              </p>
              <ConfirmForm token={token} />
              <p className="text-xs text-slate-500">
                Nếu bạn chưa tham gia được với vai trò Mentee trong mùa này, bạn không cần bấm — nhắn ban tổ chức một tiếng là được. {SUPPORT}
              </p>
            </div>
          </Card>
        ) : data.state === "confirmed" ? (
          <Card className="border-green-200 bg-green-50">
            <div data-testid="confirm-already">
              <h2 className="text-base font-semibold text-green-900">Bạn đã xác nhận tham gia</h2>
              <p className="mt-2 text-sm text-green-800">{data.message}</p>
              <p className="mt-2 text-sm text-green-800">Ban tổ chức sẽ báo cho bạn khi có kết quả ghép cặp Mentor – Mentee.</p>
            </div>
          </Card>
        ) : (
          <Card className="border-amber-200 bg-amber-50">
            <div data-testid="confirm-blocked">
              <h2 className="text-base font-semibold text-amber-900">Không mở được trang xác nhận</h2>
              <p className="mt-2 text-sm text-amber-900">{data.message}</p>
              <p className="mt-2 text-sm text-amber-900">{SUPPORT}</p>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
