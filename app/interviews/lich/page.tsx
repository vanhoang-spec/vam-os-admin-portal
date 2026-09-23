import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveRefresh } from "@/app/events/[id]/live-refresh";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getBtcOverview, getMyInterviewerSchedule } from "@/lib/interview-schedule";
import { canAssignReview, canSelfClaimInterview } from "@/lib/permissions";
import { AvailabilityGrid } from "./availability-grid";
import { BtcPanel } from "./btc-panel";
import { WaitingPanel } from "./waiting-panel";

/**
 * /interviews/lich — lịch phỏng vấn mentor 1:1 (đợt 22/09–05/10/2026).
 *
 * Hai khán giả trên một trang:
 *   * Interviewer (core team + mentor được bật quyền người phỏng vấn): tick
 *     giờ mình rảnh, thấy tổng giờ đã đăng ký và buổi nào đã có mentor đặt.
 *   * Ban tổ chức (super_admin/admin/core_team): thêm bảng điều hành realtime
 *     — giờ trống, mentor chưa đặt, lịch sắp tới, nút gửi thư và huỷ lịch.
 *
 * Cùng cổng vai trò với /interviews; tài khoản reviewer còn phải được cấp
 * vai trò interviewer của mùa — tầng lib kiểm bằng database, và trang này
 * hiện đúng câu từ chối đó thay vì đá về trang chủ.
 */

export const dynamic = "force-dynamic";

export default async function InterviewSchedulePage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canSelfClaimInterview(adminUser.role)) redirect("/");

  const schedule = await getMyInterviewerSchedule();
  const overview = canAssignReview(adminUser.role) ? await getBtcOverview() : null;

  return (
    <>
      <PageHeader
        title="Lịch phỏng vấn mentor"
        description="Đợt 22/09–05/10/2026, mỗi buổi online 1:1 tròn 60 phút trong khung 07:00–22:00. Anh/chị tick giờ rảnh; mentor tự chọn slot qua link riêng, ai giữ trước được trước."
      />

      <div className="mb-4">
        <Link href="/interviews" className="text-sm text-vam-green hover:underline">
          ← Quay lại Phỏng vấn ứng viên
        </Link>
      </div>

      {overview ? (
        overview.ok ? (
          <div className="mb-6">
            <BtcPanel overview={overview} />
          </div>
        ) : (
          <ErrorBox message={overview.message} />
        )
      ) : null}

      {schedule.ok ? (
        <Card className="mb-5">
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentor đang chờ được ghép</h2>
          <WaitingPanel waiting={schedule.waiting} waitingTotal={schedule.waitingTotal} />
        </Card>
      ) : null}

      <Card className="mb-5">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Giờ rảnh của tôi</h2>
        {schedule.ok ? (
          <AvailabilityGrid
            days={schedule.days}
            phone={schedule.phone}
            needsPhone={schedule.needsPhone}
            stats={schedule.stats}
          />
        ) : (
          <ErrorBox message={schedule.message} />
        )}
      </Card>

      <LiveRefresh />
    </>
  );
}
