import { Card } from "@/components/ui";
import { LiveRefresh } from "@/app/events/[id]/live-refresh";
import { getBookingPageData } from "@/lib/interview-schedule";
import { BookingForm, CancelBookingForm } from "./booking-form";

/**
 * Trang đặt lịch phỏng vấn — công khai, không cần đăng nhập.
 *
 * Người mở là ứng viên mentor cầm điện thoại, vào bằng mã riêng trong thư.
 * Số chỗ trống đổi liên tục khi interviewer thêm giờ và mentor khác giữ chỗ,
 * nên trang tự đọc lại mỗi 15 giây (LiveRefresh) — còn phép giữ chỗ thật thì
 * database phân xử, ai bấm trước được trước.
 */

export const dynamic = "force-dynamic";

export default async function PublicInterviewBookingPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const data = await getBookingPageData(params.token);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">
            Phỏng vấn mentor · UEH Mentoring Mùa 12
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {data.ok ? data.mentorName : "Đặt lịch phỏng vấn"}
          </h1>
          <p className="mt-2 text-sm text-slate-200">
            Buổi phỏng vấn online 1:1, kéo dài 60 phút, trong khung 07:00–22:00 hằng ngày.
          </p>
        </div>

        {!data.ok ? (
          <Card>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <h2 className="text-lg font-semibold">Không mở được trang đặt lịch</h2>
              <p className="mt-2 text-sm">{data.message}</p>
            </div>
          </Card>
        ) : data.state === "booked" ? (
          <Card>
            <div className="rounded-lg border border-vam-green/40 bg-vam-mint/40 p-5 text-vam-ink">
              <h2 className="text-lg font-semibold">Anh/chị đã có lịch phỏng vấn</h2>
              <p className="mt-2 text-sm font-medium">{data.booking.slotLabel}</p>
              <p className="mt-2 text-sm">
                Người phỏng vấn: <strong>{data.booking.interviewerName}</strong>
                {data.booking.interviewerPhone ? ` · SĐT ${data.booking.interviewerPhone}` : ""}
              </p>
              <p className="mt-2 text-sm">
                Buổi diễn ra online; người phỏng vấn sẽ liên hệ để thống nhất kênh gọi. Anh/chị để ý email và điện
                thoại trước giờ hẹn.
              </p>
            </div>
            <div className="mt-4">
              {data.booking.canCancel ? (
                <>
                  <p className="mb-2 text-sm text-slate-600">
                    Cần đổi giờ? Huỷ lịch này rồi chọn khung giờ khác (chỉ làm được khi còn hơn 24 giờ trước buổi
                    hẹn).
                  </p>
                  <CancelBookingForm token={params.token} />
                </>
              ) : (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Buổi hẹn còn dưới 24 giờ nên không tự đổi được nữa. Cần hỗ trợ gấp, anh/chị nhắn Zalo ban tổ chức:{" "}
                  <strong>{data.hotlineZalo}</strong>.
                </p>
              )}
            </div>
          </Card>
        ) : data.state === "ineligible" ? (
          <Card>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <h2 className="text-lg font-semibold">Chưa đặt lịch được</h2>
              <p className="mt-2 text-sm">{data.message}</p>
              <p className="mt-2 text-sm">
                Zalo ban tổ chức: <strong>{data.hotlineZalo}</strong>
              </p>
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <p className="mb-1 text-sm text-vam-ink">
                Anh/chị chọn một khung giờ còn chỗ rồi bấm <strong>Giữ chỗ</strong>. Đợt phỏng vấn kéo dài đến hết
                ngày <strong>{data.windowEndLabel}</strong>; hiện còn <strong>{data.totalOpen}</strong> chỗ trống.
              </p>
              <p className="mb-4 text-xs text-slate-500">
                Ai giữ trước được trước — số chỗ đổi liên tục khi có người khác đặt. Cần hỗ trợ: Zalo{" "}
                {data.hotlineZalo}.
              </p>
              {data.days.length > 0 ? (
                <BookingForm token={params.token} days={data.days} />
              ) : (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Hiện chưa có khung giờ trống nào. Ban tổ chức đang bổ sung — anh/chị quay lại sau, hoặc chờ thư
                  nhắc kèm chính đường dẫn này.
                </p>
              )}
            </Card>
            <LiveRefresh />
          </>
        )}
      </div>
    </main>
  );
}
