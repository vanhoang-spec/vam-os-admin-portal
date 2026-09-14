import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { canScanEvent } from "@/lib/event-supporters";
import { countScansByStation } from "@/lib/event-checkin";
import { buildCheckinSteps, checkinStepsOf, summarizeStepCounts } from "@/lib/event-checkin-steps";
import { getEventDetailData } from "@/lib/events";
import { displayText } from "@/lib/utils";
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

  const steps = buildCheckinSteps(checkinStepsOf(detail.event));
  const scans = await countScansByStation(id);
  const summary = summarizeStepCounts(steps, scans.counts);

  // Chỉ người sửa được sự kiện mới đổi được các lần quét (chủ dự án chốt 14/09/2026).
  // Người hỗ trợ được ghép vào buổi chỉ chọn lần quét của điểm mình đứng.
  const settingsHref = canEditRecaps(adminUser) ? `/events/${id}/edit#checkin-steps` : null;

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
        settingsHref={settingsHref}
      />
    </>
  );
}
