import { Card } from "@/components/ui";
import { getPublicRegistrationData } from "@/lib/events";
import { displayText, formatDate } from "@/lib/utils";
import { RegistrationForm } from "./registration-form";

function selectedParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function RegistrationResult({
  status,
  eventName
}: {
  status: "success" | "already_registered";
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
        {success ? "Đăng ký thành công" : "Bạn đã đăng ký sự kiện này rồi"}
      </h2>
      <p className="mt-2 text-base font-medium">{eventName}</p>
      <p className="mt-2 text-sm">
        {success ? "VAM đã ghi nhận đăng ký của bạn." : "Không cần gửi lại biểu mẫu. VAM đã có đăng ký của bạn."}
      </p>
      {success ? <p className="mt-1 text-sm">Bạn có thể đóng trang này.</p> : null}
    </div>
  );
}

export default async function PublicEventRegistrationPage({
  params,
  searchParams
}: {
  params: { token: string };
  searchParams?: { status?: string | string[] };
}) {
  const data = await getPublicRegistrationData(params.token);
  const eventName = displayText(data.event?.event_name, "Sự kiện");
  const resultStatus = selectedParam(searchParams?.status);
  const showResult = resultStatus === "success" || resultStatus === "already_registered";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">VAM event registration</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">{eventName}</h1>
          {data.event?.starts_at ? (
            <p className="mt-1 text-sm text-slate-200">{formatDate(data.event.starts_at)}</p>
          ) : null}
        </div>

        <Card>
          {showResult && data.event ? (
            <RegistrationResult status={resultStatus} eventName={eventName} />
          ) : data.ok ? (
            <>
              <h2 className="mb-4 text-lg font-semibold text-vam-ink">Đăng ký tham gia</h2>
              <RegistrationForm token={params.token} eventName={eventName} />
            </>
          ) : (
            <div className="py-6 text-center">
              <h2 className="text-lg font-semibold text-vam-ink">Không thể đăng ký</h2>
              <p className="mt-2 text-sm text-slate-600">{data.message}</p>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
