import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSupabaseAuthUser, hasAnyAdminUserRow } from "@/lib/admin-auth";
import { resolveParticipantIdentity } from "@/lib/participant-auth";
import { getParticipantProgram, participantRoleLabel } from "@/lib/participant-home";
import { formatTimeRange } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Trang một chương trình của mentor / mentee.
 *
 * ---------------------------------------------------------------------------
 * MÃ CHƯƠNG TRÌNH ĐẾN TỪ ĐƯỜNG DẪN, TỨC LÀ TỪ TAY NGƯỜI DÙNG
 * ---------------------------------------------------------------------------
 * Gõ mã của một chương trình khác vào thanh địa chỉ phải ra con số không.
 * `getParticipantProgram` đối chiếu tư cách thành viên TRƯỚC khi nạp bất cứ gì,
 * và trả về `null` cho cả "mã không có thật" lẫn "bạn không thuộc chương trình
 * này" — hai câu trả lời giống nhau, vì phân biệt chúng là nói cho người ta
 * biết chương trình nào có tồn tại.
 */
export default async function ParticipantProgramPage(props: {
  params: Promise<{ programCode: string }>;
}) {
  const params = await props.params;

  const authUser = await getCurrentSupabaseAuthUser();
  if (!authUser?.id) redirect("/login");

  // Cùng phép chặn với trang /ct: nhân sự bị khoá không đi vòng qua đây được.
  let wasStaff = true;
  try {
    wasStaff = await hasAnyAdminUserRow(authUser);
  } catch {
    return <ErrorNotice />;
  }
  if (wasStaff) notFound();

  const identity = await resolveParticipantIdentity({
    authUserId: authUser.id,
    authEmail: authUser.email ?? null
  });
  if (identity.error) return <ErrorNotice />;
  if (!identity.personId) notFound();

  const { view, error } = await getParticipantProgram({
    personId: identity.personId,
    programCode: params.programCode
  });

  if (error) return <ErrorNotice />;
  if (!view) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/ct"
          className="text-sm font-medium text-vam-green underline-offset-2 hover:underline"
        >
          ← Tất cả chương trình
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-vam-ink">
          {view.programName ?? view.programCode}
        </h1>
      </div>

      {view.seasons.map((season) => (
        <section
          key={season.seasonId}
          className="rounded-lg border border-vam-line bg-white p-5"
        >
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-vam-ink">
              {season.seasonName ?? season.seasonCode ?? "Mùa"}
            </h2>
            <span className="rounded-full bg-vam-mint px-2 py-0.5 text-xs font-medium text-vam-ink">
              {participantRoleLabel(season.role)}
            </span>
            {season.isPast ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Đã hoàn thành
              </span>
            ) : null}
          </header>

          {season.isPast ? (
            // Mùa đã xong là một bản ghi, không phải một màn hình làm việc. Nói
            // thẳng để không ai chờ một nút hành động không bao giờ xuất hiện.
            <p className="mt-2 text-sm text-slate-500">
              Mùa này đã kết thúc. Nội dung dưới đây chỉ để xem lại.
            </p>
          ) : null}

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sự kiện của bạn
          </h3>

          {season.events.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              {season.isPast
                ? "Không có sự kiện nào được ghi nhận trong mùa này."
                : "Bạn chưa đăng ký sự kiện nào của mùa này."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-vam-line">
              {season.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-vam-ink">
                      {event.eventName ?? "Sự kiện"}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      {event.startsAt ? formatTimeRange(event.startsAt, event.endsAt) : "Chưa có lịch"}
                      {event.locationName ? ` · ${event.locationName}` : ""}
                    </span>
                  </span>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                      event.checkedIn
                        ? "bg-green-100 text-green-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {event.checkedIn ? "Đã tham dự" : "Đã đăng ký"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ErrorNotice() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
      <h2 className="text-base font-semibold">Chưa tải được thông tin</h2>
      <p className="mt-2 text-sm">Vui lòng thử lại sau ít phút.</p>
    </div>
  );
}
