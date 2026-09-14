import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canScanEvent } from "@/lib/event-supporters";
import { countScansByStation } from "@/lib/event-checkin";
import {
  CHECKIN_STEPS_PANEL_ID,
  buildCheckinSteps,
  checkinStepsOf,
  summarizeStepCounts
} from "@/lib/event-checkin-steps";
import { canConfigureCheckinSteps } from "@/lib/event-checkin-steps-server";
import { getEventDetailData } from "@/lib/events";
import { displayText } from "@/lib/utils";
import { CheckinStepsPanel } from "./checkin-steps-panel";
import { EventScanner } from "./scanner";

export const dynamic = "force-dynamic";

export const metadata = { title: "Quét điểm danh — VAM OS" };

export default async function EventScanPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!(await canScanEvent(adminUser, id))) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có quyền điểm danh tại sự kiện."
      />
    );
  }

  const detail = await getEventDetailData(id);
  if (!detail.event) {
    return (
      <>
        <PageHeader title="Quét điểm danh" description="Không tìm thấy sự kiện." />
        <ErrorBox message={detail.error} />
      </>
    );
  }

  const purposes = checkinStepsOf(detail.event);
  const steps = buildCheckinSteps(purposes);
  const scans = await countScansByStation(id);
  const summary = summarizeStepCounts(steps, scans.counts);

  // Người sửa được sự kiện, và support team được ghép vào đúng buổi này, thiết lập
  // được các lần quét ngay tại đây (chủ dự án chốt lại 14/09/2026). Support team
  // không mở được form Sửa sự kiện, nên máy quét là chỗ duy nhất họ tới được.
  const canConfigure = await canConfigureCheckinSteps(adminUser, {
    id,
    season_id: detail.event.season_id ?? null
  });

  return (
    <>
      <PageHeader
        title={`Quét điểm danh — ${displayText(detail.event.event_name, "Sự kiện")}`}
        description="Chĩa camera vào mã QR trên điện thoại người tham dự. Không ai phải gõ gì."
      />

      <p className="mb-4 text-sm">
        <Link href={`/events/${id}`} className="text-vam-green hover:underline">
          ← Về trang sự kiện
        </Link>
      </p>

      {/* Đọc số lượt quét hỏng thì nói ra, không vẽ một dãy số 0: "Check in: 0"
          giữa buổi làm người đứng quét tưởng máy không ghi được gì. */}
      {scans.error ? (
        <p className="mb-6 text-sm text-amber-800">Chưa đọc được số lượt quét. Máy quét vẫn dùng được.</p>
      ) : (
        <div className="mb-6 flex flex-wrap gap-2">
          {summary.map((row) => (
            <span
              key={row.station}
              className={`rounded-full border border-vam-line px-3 py-1 text-sm ${
                row.configured ? "bg-white text-vam-ink" : "bg-slate-50 text-slate-500"
              }`}
            >
              {row.label}:{" "}
              <strong className="tabular-nums text-vam-green">{row.total}</strong>
            </span>
          ))}
        </div>
      )}

      <EventScanner
        eventId={id}
        steps={steps.map((step) => ({ station: step.station, label: step.label }))}
        settingsHref={canConfigure ? `#${CHECKIN_STEPS_PANEL_ID}` : null}
      />

      {canConfigure ? <CheckinStepsPanel eventId={id} initialSteps={purposes} /> : null}
    </>
  );
}
