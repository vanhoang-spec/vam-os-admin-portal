import { Card } from "@/components/ui";
import { getPublicCheckinData } from "@/lib/events";
import { displayText, formatDate } from "@/lib/utils";
import { CheckinForm } from "./checkin-form";

function selectedParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function CheckinResult({
  status,
  eventName
}: {
  status: "success" | "already_checked_in";
  eventName: string;
}) {
  const success = status === "success";
  return (
    <div
      className={
        success
          ? "rounded-lg border border-green-200 bg-green-50 p-5 text-green-800"
          : "rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900"
      }
    >
      <h2 className="text-lg font-semibold">
        {success ? "Check-in thành công" : "Bạn đã check-in sự kiện này rồi"}
      </h2>
      <p className="mt-2 text-base font-medium">{eventName}</p>
      <p className="mt-2 text-sm">
        {success ? "VAM đã ghi nhận lượt check-in của bạn." : "Không cần check-in lại. VAM đã có lượt check-in của bạn."}
      </p>
      {success ? <p className="mt-1 text-sm">Bạn có thể đóng trang này.</p> : null}
    </div>
  );
}

export default async function PublicEventCheckinPage(
  props: {
    params: Promise<{ token: string }>;
    searchParams?: Promise<{ status?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const data = await getPublicCheckinData(params.token);
  const eventName = displayText(data.event?.event_name, "Sự kiện");
  const status = selectedParam(searchParams?.status);
  const showResult = status === "success" || status === "already_checked_in";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">VAM event check-in</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">{eventName}</h1>
          {data.event?.starts_at ? (
            <p className="mt-1 text-sm text-slate-200">{formatDate(data.event.starts_at)}</p>
          ) : null}
        </div>

        <Card>
          {showResult && data.event ? (
            <CheckinResult status={status} eventName={eventName} />
          ) : data.ok ? (
            <>
              <h2 className="mb-4 text-lg font-semibold text-vam-ink">Check-in sự kiện</h2>
              <CheckinForm token={params.token} />
            </>
          ) : (
            <div className="py-6 text-center">
              <h2 className="text-lg font-semibold text-vam-ink">Không thể check-in</h2>
              <p className="mt-2 text-sm text-slate-600">{data.message}</p>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
