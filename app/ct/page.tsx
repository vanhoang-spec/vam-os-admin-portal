import { redirect } from "next/navigation";

import { ParticipantShell } from "@/components/participant-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getCurrentParticipant } from "@/lib/participant-auth";
import { getProgramsForPerson } from "@/lib/participant-programs";
import { participantHomePath, ROUTES } from "@/lib/participant-auth-core";

/**
 * Page: /ct
 *
 * The landing that decides, and the one screen that explains a dead end.
 *
 * Somebody with programmes is sent onward — one goes straight in, several go to
 * the picker. Somebody with none stops here and is told why, in a sentence that
 * names what happens next. An empty page with nothing on it is the outcome this
 * exists to prevent: it reads as a broken site rather than as a status.
 */
export const dynamic = "force-dynamic";

export default async function ParticipantLandingPage() {
  // A staff member who lands here has taken a wrong turn, not lost access.
  const adminUser = await getCurrentAdminUser();
  if (adminUser) redirect("/operations");

  const participant = await getCurrentParticipant();

  if (participant.state === "participant") {
    const programs = await getProgramsForPerson(participant.account.personId);
    if (programs.length === 1) redirect(participantHomePath(programs[0].programCode));
    if (programs.length > 1) redirect(ROUTES.chooseProgram);

    return (
      <ParticipantShell personName={participant.account.fullName}>
        <Notice
          title="Tài khoản của anh/chị chưa gắn với chương trình nào"
          body="Ban tổ chức sẽ thêm anh/chị vào chương trình khi mở mùa mới. Sau khi được thêm, đăng nhập lại là thấy ngay."
        />
      </ParticipantShell>
    );
  }

  if (participant.state === "disabled") {
    return (
      <ParticipantShell>
        <Notice
          title="Tài khoản đang tạm khoá"
          body="Vui lòng liên hệ ban tổ chức chương trình để được mở lại."
        />
      </ParticipantShell>
    );
  }

  if (participant.state === "unmatched" || participant.state === "ambiguous") {
    return (
      <ParticipantShell>
        <Notice title="Chưa nhận diện được tài khoản" body={participant.message} />
      </ParticipantShell>
    );
  }

  if (participant.state === "error") {
    return (
      <ParticipantShell>
        <Notice title="Hệ thống đang gặp sự cố" body={participant.message} tone="error" />
      </ParticipantShell>
    );
  }

  redirect("/login");
}

function Notice({
  title,
  body,
  tone = "info"
}: {
  title: string;
  body: string;
  tone?: "info" | "error";
}) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-lg border p-5 ${styles}`}>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6">{body}</p>
    </div>
  );
}
