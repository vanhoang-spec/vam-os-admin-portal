import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ParticipantShell } from "@/components/participant-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getCurrentParticipant } from "@/lib/participant-auth";
import { getProgramsForPerson } from "@/lib/participant-programs";
import { getParticipantHome, type ParticipantHomeView } from "@/lib/participant-home";
import { ROUTES } from "@/lib/participant-auth-core";

/**
 * Page: /ct/[programCode]
 *
 * A mentor's or a mentee's home inside one programme.
 *
 * This is the answer to "the same mentor signing into UEH and into BK must see
 * two different seasons" — the season is not chosen here and not remembered
 * from last time; it is read from the programme in the address.
 *
 * The programme code is checked against this person's own membership before
 * anything is loaded. A code they do not belong to returns not-found rather
 * than a refusal, so editing the address bar reveals nothing about which
 * programmes exist.
 */
export const dynamic = "force-dynamic";

export default async function ParticipantProgramPage({
  params
}: {
  params: { programCode: string };
}) {
  const adminUser = await getCurrentAdminUser();
  if (adminUser) redirect(`/programs/${encodeURIComponent(params.programCode)}`);

  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") redirect(ROUTES.noMembership);

  const view = await getParticipantHome({
    personId: participant.account.personId,
    programCode: params.programCode
  });

  if (!view.program) notFound();

  const programs = await getProgramsForPerson(participant.account.personId);

  return (
    <ParticipantShell
      personName={participant.account.fullName}
      programName={view.program.name}
      seasonLabel={view.currentSeason?.name ?? view.currentSeason?.code ?? "chưa mở mùa nào"}
      showSwitcher={programs.length > 1}
    >
      <SeasonStatus view={view} />

      {view.currentSeason ? (
        <div className="mt-5 grid gap-3">
          <PairCard view={view} />
          {view.role === "mentor" ? <MentorCards view={view} /> : null}
          <DocumentCards view={view} />
          <Row
            label="Cross-mentoring"
            value={
              <Link
                className="font-medium text-vam-green hover:underline"
                href={`/ct/${encodeURIComponent(params.programCode)}/cross`}
              >
                Mở
              </Link>
            }
            hint={
              view.role === "mentor"
                ? "Chọn lĩnh vực anh/chị nhận chia sẻ, và xem các buổi đang mở."
                : "Đề xuất được gặp một mentor ngoài cặp của bạn, và đăng ký các buổi đang mở."
            }
          />
        </div>
      ) : null}

      {view.pastSeasons.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-vam-ink">Các mùa đã tham gia</h2>
          <div className="mt-3 grid gap-2">
            {view.pastSeasons.map((season) => (
              <div
                key={season.seasonId}
                className="flex items-center justify-between gap-4 rounded-md border border-vam-line bg-white px-4 py-3"
              >
                <span className="text-sm text-vam-ink">{season.seasonName || season.seasonCode}</span>
                <span className="text-xs text-slate-500">
                  {season.role === "mentor" ? "mentor" : "mentee"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </ParticipantShell>
  );
}

function SeasonStatus({ view }: { view: ParticipantHomeView }) {
  if (!view.currentSeason) {
    return (
      <Notice
        title={`${view.program?.name} chưa mở mùa nào`}
        body="Ban tổ chức chưa mở mùa mới cho chương trình này. Anh/chị sẽ nhận được thông báo khi mùa mới bắt đầu."
      />
    );
  }

  if (!view.inCurrentSeason) {
    return (
      <Notice
        title={`Anh/chị chưa đăng ký ${view.currentSeason.name || view.currentSeason.code}`}
        body="Ban tổ chức sẽ gửi thư mời khi mở đăng ký cho mùa này. Các mùa đã tham gia trước đây vẫn xem lại được ở bên dưới."
      />
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-vam-ink">
        {view.currentSeason.name || view.currentSeason.code}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Anh/chị đang tham gia với vai trò {view.role === "mentor" ? "mentor" : "mentee"}.
      </p>
    </div>
  );
}

function PairCard({ view }: { view: ParticipantHomeView }) {
  const label = view.role === "mentor" ? "Mentee được ghép" : "Mentor của tôi";

  return (
    <Row
      label={label}
      value={
        view.partnerNames.length ? (
          <span className="text-vam-ink">{view.partnerNames.join(", ")}</span>
        ) : (
          <span className="text-slate-500">chưa ghép cặp</span>
        )
      }
    />
  );
}

function MentorCards({ view }: { view: ParticipantHomeView }) {
  return (
    <>
      <Row
        label="Xác nhận tham gia mùa"
        value={
          view.confirmation?.url ? (
            <Link className="font-medium text-vam-green hover:underline" href={view.confirmation.url}>
              {view.confirmation.status ? "Xem lại" : "Xác nhận ngay"}
            </Link>
          ) : (
            <span className="text-slate-500">
              {view.confirmation?.status ? "đã xác nhận" : "chưa mở"}
            </span>
          )
        }
        hint={
          view.confirmation?.maxMentees
            ? `Nhận tối đa ${view.confirmation.maxMentees} mentee`
            : undefined
        }
      />

      <Row
        label="Hồ sơ mentee được ghép"
        value={
          view.dossierLinks.length ? (
            <span className="grid gap-1">
              {view.dossierLinks.map((link, index) => (
                <a
                  key={link.applicationId}
                  className="font-medium text-vam-green hover:underline"
                  href={link.url}
                >
                  Mở hồ sơ {view.dossierLinks.length > 1 ? index + 1 : ""}
                </a>
              ))}
            </span>
          ) : (
            <span className="text-slate-500">chưa có</span>
          )
        }
      />
    </>
  );
}

function DocumentCards({ view }: { view: ParticipantHomeView }) {
  return (
    <>
      <Row
        label="Quy tắc ứng xử"
        value={
          view.documents.codeOfConduct ? (
            <a className="font-medium text-vam-green hover:underline" href={view.documents.codeOfConduct}>
              Mở
            </a>
          ) : (
            <span className="text-slate-500">chưa phát hành</span>
          )
        }
      />
      <Row
        label="Cẩm nang đồng hành"
        value={
          view.documents.tips ? (
            <a className="font-medium text-vam-green hover:underline" href={view.documents.tips}>
              Mở
            </a>
          ) : (
            <span className="text-slate-500">chưa phát hành</span>
          )
        }
      />
    </>
  );
}

function Row({
  label,
  value,
  hint
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-vam-line bg-white px-4 py-3 shadow-soft">
      <div className="min-w-0">
        <div className="text-sm text-vam-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
      </div>
      <div className="shrink-0 text-right text-sm">{value}</div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6">{body}</p>
    </div>
  );
}
