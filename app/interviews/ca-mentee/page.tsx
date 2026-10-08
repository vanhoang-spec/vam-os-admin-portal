import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { getMenteeInviteStatus } from "@/lib/mentee-invite-dispatch";
import { getOnlineNoticeStatus } from "@/lib/mentee-online-notice";
import { getReopenNoticeStatus } from "@/lib/mentee-reopen-notice";
import { getSessionAdminData } from "@/lib/mentee-session-admin";
import { OnlineNoticePanel } from "./online-notice-panel";
import { ReopenNoticePanel } from "./reopen-notice-panel";
import { BulkPanel, InviteDispatchPanel, SessionRowForm } from "./session-config-client";
import Link from "next/link";

/**
 * Ca phỏng vấn mentee — giai đoạn 1, ngày 3 và 4/10/2026.
 *
 * 28 ca 30 phút (14 ca/ngày). Số ghế khác nhau theo ngày vì số phòng khác
 * nhau: thứ Bảy 3 phòng × 6 mentor = 18 ghế/ca, Chủ nhật 6 phòng × 5 mentor
 * = 28 ghế/ca (chừa buffer so với sức chứa phòng là 30). Trang này là chỗ
 * ban tổ chức chỉnh ghế, điền địa điểm, và gửi thư mời chọn ca.
 *
 * Phép kiểm quyền nằm trong lib/mentee-session-admin.ts và
 * lib/mentee-invite-dispatch.ts, chạy cho cả lượt đọc lẫn mọi lượt ghi — trang
 * chỉ vẽ lại câu từ chối. Từ 01/10/2026: đọc (xem tình hình) rộng hơn ghi
 * (sửa ghế/địa điểm/gửi thư) — support_team qua được cổng đọc nhưng không qua
 * cổng ghi, nên trang dùng data.canOperate để ẩn các ô sửa/nút lưu/nút gửi
 * cho đúng nhóm đó thay vì hiện ra rồi để máy chủ từ chối.
 */

export const dynamic = "force-dynamic";

/**
 * Một lượt gửi thư mời gọi nhà cung cấp tuần tự, tối đa 40 thư. Trần mặc định
 * của Vercel ngắn hơn thế, nên lượt đã gửi xong vẫn có thể bị báo là hỏng.
 */
export const maxDuration = 60;

export default async function MenteeSessionConfigPage() {
  const [data, invite, reopen, online] = await Promise.all([
    getSessionAdminData(),
    getMenteeInviteStatus(),
    getReopenNoticeStatus(),
    getOnlineNoticeStatus()
  ]);

  if (!data.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Ca phỏng vấn mentee" />
        <Card>
          <EmptyState message={data.message} />
        </Card>
      </div>
    );
  }

  const chuaDienGhe = data.totals.sessions - data.totals.configured;
  const sessionsWithoutVenue = data.days.reduce(
    (count, day) => count + day.rows.filter((row) => !row.venue).length,
    0
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Ca phỏng vấn mentee"
        description={`${data.totals.sessions} ca 30 phút: ${data.days.map((day) => day.label).join(", ")}. Ứng viên chọn một ca; ban tổ chức phân mentor tại chỗ.`}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard label="Ca đã điền ghế" value={`${data.totals.configured}/${data.totals.sessions}`} />
        <KpiCard label="Tổng số ghế" value={String(data.totals.seats)} />
        <KpiCard label="Đã giữ chỗ" value={String(data.totals.booked)} />
        <KpiCard label="Còn trống" value={String(Math.max(0, data.totals.seats - data.totals.booked))} />
      </div>
      <Link href="/interviews/mentee-offline" className="rounded-lg bg-vam-green px-4 py-3 font-semibold text-white">Mở danh sách theo ca, check-in và chấm phỏng vấn</Link>

      {chuaDienGhe > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{chuaDienGhe} ca chưa điền số ghế.</strong> Ca chưa điền thì ứng viên mở link ra
          thấy “Chưa mở” và không đặt được — đây là chủ ý, để một ô bị quên không biến thành một ca
          nhận vô hạn người. Điền số vào là ca mở ngay.
        </div>
      ) : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Gửi thư mời chọn ca</h2>
        {invite.ok ? (
          <InviteDispatchPanel
            waiting={invite.summary.waiting}
            invitedNotBooked={invite.summary.invitedNotBooked}
            booked={invite.summary.booked}
            lastFailed={invite.summary.lastFailed}
            sentInWindow={invite.sentInWindow}
            allowance={invite.allowance}
            dailyLimit={invite.dailyLimit}
            reserve={invite.reserve}
            anyBookable={invite.anyBookable}
            deadlineLabel={invite.deadlineLabel}
            sessionsWithoutVenue={sessionsWithoutVenue}
            canOperate={data.canOperate}
          />
        ) : (
          <EmptyState message={invite.message} />
        )}
      </Card>

      {reopen.ok && reopen.total > 0 ? (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mở lại chọn ca cho bạn chưa chọn</h2>
          <ReopenNoticePanel
            total={reopen.total}
            pending={reopen.pending}
            notified={reopen.notified}
            deadlineLabel={reopen.deadlineLabel}
            anyBookable={reopen.anyBookable}
            sentInWindow={reopen.sentInWindow}
            allowance={reopen.allowance}
            preview={reopen.preview}
            canOperate={data.canOperate}
          />
        </Card>
      ) : null}

      {online.ok && online.total > 0 ? (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Báo ca chuyển sang phỏng vấn online</h2>
          <OnlineNoticePanel
            total={online.total}
            pending={online.pending}
            notified={online.notified}
            sessionsWithoutLink={online.sessionsWithoutLink}
            sentInWindow={online.sentInWindow}
            allowance={online.allowance}
            preview={online.preview}
            canOperate={data.canOperate}
          />
        </Card>
      ) : !online.ok ? (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Báo ca chuyển sang phỏng vấn online</h2>
          <EmptyState message={online.message} />
        </Card>
      ) : null}

      {data.canOperate ? (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Điền nhanh cho mọi ca</h2>
          <BulkPanel />
        </Card>
      ) : null}

      {data.deadlineLabel ? (
        <p className="text-xs text-slate-500">
          Hạn ứng viên đăng ký: <strong>{data.deadlineLabel}</strong>. Cần gia hạn thì sửa cột
          <code className="mx-1 rounded bg-slate-100 px-1">booking_closes_at</code>
          của bảng <code className="rounded bg-slate-100 px-1">interview_sessions</code>.
        </p>
      ) : null}

      {data.days.map((day) => (
        <Card key={day.dateKey}>
          <h2 className="text-base font-semibold text-vam-ink">{day.label}</h2>
          <div className="mt-1">
            {day.rows.map((row) => (
              <SessionRowForm key={row.id} row={row} canOperate={data.canOperate} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
