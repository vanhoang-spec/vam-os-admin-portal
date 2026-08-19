import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { ParticipantShell } from "@/components/participant-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getCurrentParticipant } from "@/lib/participant-auth";
import { getProgramsForPerson } from "@/lib/participant-programs";
import { getCurrentSeasonForProgram } from "@/lib/current-season";
import { resolveAuthorizedPrograms } from "@/lib/program-context";
import {
  canViewCrossProgramReports,
  describeProgramChoice,
  participantHomePath,
  ROUTES,
  sortProgramChoices,
  type ProgramChoice
} from "@/lib/participant-auth-core";

/**
 * Page: /chon-chuong-trinh
 *
 * One screen, two audiences.
 *
 * A mentor in two programmes chooses which one to enter; a staff member with
 * scope over several does the same. Keeping it one page rather than two means
 * one place where the rule "one programme skips the question" lives, and one
 * place to get the wording right.
 *
 * Nobody sees a list of one. If there is a single choice the page redirects
 * straight into it — asking somebody to pick from one option teaches them
 * nothing and costs a click every time they sign in.
 */
export const dynamic = "force-dynamic";

export default async function ChooseProgramPage() {
  const adminUser = await getCurrentAdminUser();

  if (adminUser) return <StaffPicker role={adminUser.role} />;

  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") redirect(ROUTES.noMembership);

  const programs = await getProgramsForPerson(participant.account.personId);

  if (programs.length === 0) redirect(ROUTES.noMembership);
  if (programs.length === 1) redirect(participantHomePath(programs[0].programCode));

  return (
    <ParticipantShell personName={participant.account.fullName}>
      <h1 className="text-2xl font-semibold text-vam-ink">Chọn chương trình</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Anh/chị đang tham gia {programs.length} chương trình. Chọn một để tiếp tục — đổi lại bất cứ
        lúc nào ở thanh trên cùng.
      </p>

      <div className="mt-6 grid gap-3">
        {programs.map((program) => (
          <ProgramRow key={program.programId} program={program} />
        ))}
      </div>
    </ParticipantShell>
  );
}

function ProgramRow({ program }: { program: ProgramChoice }) {
  return (
    <Link
      href={participantHomePath(program.programCode)}
      className="flex items-center justify-between gap-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft transition hover:border-vam-green hover:bg-vam-mint/40"
    >
      <div className="min-w-0">
        <div className="text-base font-medium text-vam-ink">{program.programName}</div>
        <div className="mt-1 text-sm text-slate-500">{describeProgramChoice(program)}</div>
      </div>
      <span className="shrink-0 text-sm font-medium text-vam-green">Vào →</span>
    </Link>
  );
}

/**
 * The staff half.
 *
 * Reads from `admin_scope_access` through the existing resolver rather than
 * from the participant membership table — staff access has always been granted
 * that way, and this screen is not the place to change it.
 */
async function StaffPicker({ role }: { role: string }) {
  const programs = await resolveAuthorizedPrograms();
  const showAllPrograms = canViewCrossProgramReports(role);

  const choices = sortProgramChoices(
    await Promise.all(
      programs.map(async (program) => {
        const season = await getCurrentSeasonForProgram(program.code);
        return {
          programId: program.id,
          programCode: program.code,
          programName: program.name,
          currentSeasonCode: season?.code ?? null,
          currentSeasonName: season?.name ?? null
        } satisfies ProgramChoice;
      })
    )
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Chọn chương trình"
        description="Chọn chương trình muốn làm việc. Mỗi chương trình mở ở mùa đang chạy của riêng nó."
      />

      {choices.length === 0 && !showAllPrograms ? (
        <ErrorBox message="Bạn chưa được cấp quyền ở chương trình nào. Liên hệ super admin để được cấp." />
      ) : null}

      {showAllPrograms ? (
        <Link
          href={ROUTES.reports}
          className="flex items-center justify-between gap-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft transition hover:border-vam-green hover:bg-vam-mint/40"
        >
          <div>
            <div className="text-base font-medium text-vam-ink">Tất cả chương trình</div>
            <div className="mt-1 text-sm text-slate-500">
              Báo cáo tổng hợp, số liệu lũy kế toàn hệ thống
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium text-vam-green">Mở báo cáo →</span>
        </Link>
      ) : null}

      <div className="grid gap-3">
        {choices.map((program) => (
          <Link
            key={program.programId}
            href={`/programs/${encodeURIComponent(program.programCode)}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft transition hover:border-vam-green hover:bg-vam-mint/40"
          >
            <div className="min-w-0">
              <div className="text-base font-medium text-vam-ink">{program.programName}</div>
              <div className="mt-1 text-sm text-slate-500">{describeProgramChoice(program)}</div>
            </div>
            <span className="shrink-0 text-sm font-medium text-vam-green">Vào →</span>
          </Link>
        ))}
      </div>

      <Card>
        <div className="text-sm text-slate-600">
          Các màn hình vận hành hiện tại vẫn dùng mùa cấu hình chung.{" "}
          <Link href="/operations" className="font-medium text-vam-green hover:underline">
            Về bảng vận hành
          </Link>
        </div>
      </Card>
    </div>
  );
}
