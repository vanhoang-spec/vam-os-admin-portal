import { Card } from "@/components/ui";
import { getPublicRegistrationData, verifyPublicRegistrationId } from "@/lib/events";
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

/**
 * Shown when the registration link is inactive/closed, expired, or event is cancelled.
 * Replaces the generic "Không thể đăng ký" heading with a clear Vietnamese message.
 */
function RegistrationBlocked({
  status,
  message
}: {
  status: string;
  message: string;
}) {
  const isClosed = status === "inactive" || status === "closed";
  return (
    <div className={isClosed
      ? "rounded-lg border border-red-200 bg-red-50 p-5 text-red-800"
      : "rounded-lg border border-slate-200 bg-slate-50 p-5 text-slate-700"
    }>
      <h2 className="text-lg font-semibold">
        {isClosed ? "Đăng ký đã đóng" : "Không thể đăng ký"}
      </h2>
      <p className="mt-2 text-sm">
        {isClosed ? "Sự kiện hiện đã đóng đăng ký." : message}
      </p>
      {isClosed && (
        <p className="mt-1 text-sm text-red-700">
          Vui lòng liên hệ BTC nếu cần hỗ trợ.
        </p>
      )}
    </div>
  );
}

export default async function PublicEventRegistrationPage(props: { params: Promise<{ token: string }>; searchParams?: Promise<{ status?: string | string[]; registration_id?: string | string[] }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const data = await getPublicRegistrationData(params.token);
  const eventName = displayText(data.event?.event_name, "Sự kiện");

  const resultStatus = selectedParam(searchParams?.status);
  const rawRegistrationId = selectedParam(searchParams?.registration_id);

  // Success is only shown when we can verify the registration_id server-side.
  // ?status=success in the URL is intentionally ignored — it is no longer issued.
  const isVerifiedSuccess = rawRegistrationId
    ? await verifyPublicRegistrationId(params.token, rawRegistrationId)
    : false;

  // already_registered keeps the URL-param path (no false-success risk; duplicate warning preserved).
  const showAlreadyRegistered = resultStatus === "already_registered";

  const showResult = isVerifiedSuccess || showAlreadyRegistered;
  const showResultStatus: "success" | "already_registered" = isVerifiedSuccess ? "success" : "already_registered";

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

        {data.event?.event_description && (
          <div className="rounded-lg bg-white p-5 text-sm text-slate-700 shadow-sm border border-slate-200 whitespace-pre-wrap">
            {data.event.event_description}
          </div>
        )}

        <Card>
          {showResult && data.event ? (
            <RegistrationResult status={showResultStatus} eventName={eventName} />
          ) : data.ok && data.event ? (
            <>
              <h2 className="mb-4 text-lg font-semibold text-vam-ink">Đăng ký tham gia</h2>
              <RegistrationForm token={params.token} eventName={eventName} event={data.event} />
            </>
          ) : (
            <RegistrationBlocked status={data.status} message={data.message} />
          )}
        </Card>
      </div>
    </main>
  );
}
