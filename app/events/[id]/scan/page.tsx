import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canScanEvent } from "@/lib/event-supporters";
import { countScansByStation } from "@/lib/event-checkin";
import { stationLabel } from "@/lib/event-checkin-code";
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

  const scans = await countScansByStation(id);

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

      {scans.counts.length ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {scans.counts.map((row) => (
            <span
              key={row.station}
              className="rounded-full border border-vam-line bg-white px-3 py-1 text-sm text-vam-ink"
            >
              {stationLabel(row.station)}:{" "}
              <strong className="tabular-nums text-vam-green">{row.total}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <EventScanner eventId={id} />
    </>
  );
}
