import type { Metadata } from "next";
import { MatchProfileCard } from "@/components/match-profile-card";
import { Card } from "@/components/ui";
import { getMatchProfilePage } from "@/lib/match-profile";

/**
 * Hồ sơ tóm tắt của người đồng hành — công khai, mở từ link riêng trong thư kết quả ghép cặp
 * (BTC 22/10/2026). Không cần đăng nhập: ai cầm link là xem được, nên link chỉ còn hiệu lực khi
 * cặp còn hoạt động (cổng ở lib/match-profile.ts). Trang chỉ đọc, không có nút nào ghi.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
  title: "Hồ sơ người đồng hành · UEH Mentoring",
  robots: { index: false, follow: false },
  // same-origin, không phải no-referrer: xem middleware.ts. Trang ngoài (link CV, LinkedIn) không
  // thấy mã trong URL.
  referrer: "same-origin"
};

export default async function MatchProfilePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const data = await getMatchProfilePage(token);
  const heading =
    data.state === "ok" ? (data.role === "mentor" ? "Hồ sơ Mentor đồng hành" : "Hồ sơ Mentee đồng hành") : "Hồ sơ người đồng hành";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">UEH Mentoring · {data.seasonLabel}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">{heading}</h1>
        </div>

        {data.state === "ok" ? (
          <>
            <MatchProfileCard card={data.card} />
            <p className="text-xs leading-5 text-slate-500" data-testid="profile-privacy-note">
              Hồ sơ này chỉ dành cho bạn — người đồng hành trong cặp Mentoring. Vui lòng không chia sẻ đường dẫn,
              số điện thoại hay email trong hồ sơ cho người khác.
            </p>
          </>
        ) : (
          <Card>
            <p className="text-sm leading-6 text-vam-ink" data-testid="profile-invalid">{data.message}</p>
          </Card>
        )}
      </div>
    </main>
  );
}
