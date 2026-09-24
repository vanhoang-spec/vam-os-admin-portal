import { Card } from "@/components/ui";
import { LiveRefresh } from "@/app/events/[id]/live-refresh";
import { getMenteeSessionPageData } from "@/lib/mentee-interview";
import { SessionForm } from "./session-form";

/**
 * Trang đặt ca phỏng vấn mentee — công khai, không cần đăng nhập.
 *
 * Người mở là ứng viên cầm điện thoại, vào bằng mã riêng trong thư báo kết quả
 * vòng đơn. Số chỗ từng ca đổi liên tục khi người khác giữ chỗ, nên trang tự
 * đọc lại mỗi 15 giây — còn phép giữ chỗ thật thì database phân xử, đếm lại
 * dưới khoá hàng.
 */

export const dynamic = "force-dynamic";

export default async function MenteeSessionBookingPage(props: {
  params: Promise<{ token: string }>;
}) {
  const params = await props.params;
  const data = await getMenteeSessionPageData(params.token);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">
            Vòng 2 · Phỏng vấn · UEH Mentoring Mùa 12
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {data.ok ? data.candidateName : "Chọn ca phỏng vấn"}
          </h1>
          <p className="mt-2 text-sm text-slate-200">
            Phỏng vấn trực tiếp tại UEH, ngày 03 và 04/10/2026. Bạn chọn một ca phù hợp với lịch
            của mình.
          </p>
        </div>

        {!data.ok ? (
          <Card>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <h2 className="text-lg font-semibold">Không mở được trang đặt ca</h2>
              <p className="mt-2 text-sm">{data.message}</p>
            </div>
          </Card>
        ) : data.state === "booked" ? (
          <Card>
            <div className="rounded-lg border border-vam-green/40 bg-vam-mint/40 p-5 text-vam-ink">
              <h2 className="text-lg font-semibold">Bạn đã có ca phỏng vấn</h2>
              <p className="mt-2 text-sm font-medium">{data.booking.sessionLabel}</p>
              <p className="mt-2 text-sm">
                {data.booking.venue
                  ? `Địa điểm: ${data.booking.venue}`
                  : "Ban tổ chức sẽ gửi địa điểm cụ thể qua email trước ngày phỏng vấn."}
              </p>
              <p className="mt-2 text-sm">
                Cần đổi ca, bạn nhắn Zalo ban tổ chức <strong>{data.hotlineZalo}</strong> giúp mình nhé.
              </p>
            </div>
          </Card>
        ) : data.state === "ineligible" ? (
          <Card>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <h2 className="text-lg font-semibold">Chưa đặt ca được</h2>
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
                Bạn chọn <strong>một</strong> ca bên dưới. Bấm vào ca là giữ chỗ luôn, không cần
                bước xác nhận nào nữa.
              </p>
              {data.deadlineLabel ? (
                <p className="mb-4 text-xs text-slate-500">
                  Hạn đăng ký: <strong>{data.deadlineLabel}</strong>. Quá hạn mà chưa chọn ca, ban
                  tổ chức hiểu là bạn không tiếp tục. Cần hỗ trợ: {data.support.name} —{" "}
                  {data.support.phone}.
                </p>
              ) : null}

              {data.anyBookable ? (
                <SessionForm token={params.token} days={data.days} />
              ) : (
                <>
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Ban tổ chức đang hoàn tất xếp ca, các khung giờ sẽ mở trong ít giờ tới. Bạn quay
                    lại trang này sau giúp mình nhé — link vẫn dùng được.
                  </p>
                  <div className="mt-4 grid gap-4 opacity-60">
                    {data.days.map((day) => (
                      <div key={day.dateKey}>
                        <h3 className="mb-2 text-sm font-semibold text-vam-ink">{day.label}</h3>
                        <div className="grid gap-2">
                          {day.sessions.map((session) => (
                            <div
                              key={session.id}
                              className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-vam-line bg-slate-50 px-4 py-2 text-sm text-slate-500"
                            >
                              <span>{session.timeLabel}</span>
                              <span className="text-xs">{session.note}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <LiveRefresh />
          </>
        )}
      </div>
    </main>
  );
}
