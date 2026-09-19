import { Card } from "@/components/ui";
import { getPublicSurveyData } from "@/lib/event-survey";
import { impressionQuestion, trackingNotice } from "@/lib/event-survey-core";
import { displayText, formatDate, formatTimeRange } from "@/lib/utils";
import { SurveyForm } from "./survey-form";

/**
 * Phiếu khảo sát cuối buổi — trang công khai, không cần đăng nhập.
 *
 * Mở trên điện thoại giữa hội trường, thường là qua mã QR chiếu trên màn hình
 * hoặc in ra giấy, nên bố cục một cột và chữ đủ lớn là yêu cầu chứ không phải
 * lựa chọn thẩm mỹ.
 */

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function PublicEventSurveyPage(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ tu?: string | string[] }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const data = await getPublicSurveyData(params.token);
  const eventName = displayText(data.event?.event_name, "Sự kiện");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">Khảo sát cuối buổi</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">{eventName}</h1>
          {data.event?.starts_at ? (
            <p className="mt-2 text-sm text-slate-200">
              {formatTimeRange(data.event.starts_at, data.event.ends_at)}
            </p>
          ) : null}
        </div>

        <Card>
          {data.ok && data.event ? (
            <>
              <p className="mb-4 rounded-md border border-vam-line bg-vam-mint/40 px-3 py-3 text-sm text-vam-ink">
                Phiếu này gồm 2 câu hỏi và <strong>chính là thao tác check out</strong> của bạn cho buổi hôm nay.{" "}
                {trackingNotice(data.event.event_name, formatDate(data.event.starts_at))}
              </p>
              <SurveyForm
                token={params.token}
                source={firstParam(searchParams?.tu)}
                impressionQuestion={impressionQuestion(data.event.event_name)}
              />
            </>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <h2 className="text-lg font-semibold">Chưa mở phiếu khảo sát</h2>
              <p className="mt-2 text-sm">{data.message}</p>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
