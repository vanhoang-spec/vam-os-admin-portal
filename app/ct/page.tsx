import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSupabaseAuthUser, hasAnyAdminUserRow } from "@/lib/admin-auth";
import { resolveParticipantIdentity } from "@/lib/participant-auth";
import { getParticipantHome, participantRoleLabel } from "@/lib/participant-home";
import { getPersonDisplayName } from "@/lib/participant-person";

export const dynamic = "force-dynamic";

/**
 * Trang của mentor và mentee sau khi đăng nhập.
 *
 * ---------------------------------------------------------------------------
 * NHẬN DIỆN LẠI Ở ĐÂY, KHÔNG TIN VÀO MIDDLEWARE
 * ---------------------------------------------------------------------------
 * Middleware đã chặn người chưa đăng nhập, nhưng nó chỉ biết "có phiên đăng
 * nhập thật hay không" — nó không biết phiên đó là ai trong chương trình. Câu
 * hỏi thứ hai được hỏi lại ở đây, bằng chính hàm đã được thử kỹ.
 *
 * Một trang tin rằng middleware đã kiểm hộ mình là một trang sẽ hiện sai dữ
 * liệu vào ngày ai đó đổi cấu hình đường dẫn.
 */
export default async function ParticipantHomePage() {
  const authUser = await getCurrentSupabaseAuthUser();
  if (!authUser?.id) redirect("/login");

  // Trang này dành cho người KHÔNG có chân trong ban tổ chức.
  //
  // Nhân sự đang hoạt động không bao giờ tới đây — middleware cho họ đi thẳng.
  // Ai tới được đây mà vẫn có dòng trong admin_users nghĩa là dòng đó đã bị
  // khoá hoặc đình chỉ. Thu hồi quyền nhân sự rồi lặng lẽ đưa cho họ một cánh
  // cửa khác là điều người bấm nút đình chỉ không hề biết mình vừa làm.
  //
  // Cùng một phép chặn với hành động đăng nhập; middleware chỉ dẫn đường, còn
  // trang mới là chỗ quyết định.
  let wasStaff = true;
  try {
    wasStaff = await hasAnyAdminUserRow(authUser);
  } catch {
    // Fail-closed: đọc không được thì không cho qua.
    return (
      <Notice tone="error" title="Chưa tải được thông tin">
        Vui lòng thử lại sau ít phút.
      </Notice>
    );
  }

  if (wasStaff) {
    return (
      <Notice tone="warn" title="Tài khoản chưa hoạt động">
        Tài khoản của bạn hiện không truy cập được. Vui lòng liên hệ ban tổ chức.
      </Notice>
    );
  }

  const identity = await resolveParticipantIdentity({
    authUserId: authUser.id,
    authEmail: authUser.email ?? null
  });

  if (identity.error) {
    return (
      <Notice tone="error" title="Chưa tải được thông tin">
        {identity.error} Vui lòng thử lại sau ít phút.
      </Notice>
    );
  }

  if (!identity.personId) {
    return (
      <Notice tone="warn" title="Chưa nhận ra bạn">
        {identity.refusal}
      </Notice>
    );
  }

  const [home, displayName] = await Promise.all([
    getParticipantHome(identity.personId),
    getPersonDisplayName(identity.personId)
  ]);

  if (home.error) {
    return (
      <Notice tone="error" title="Chưa tải được thông tin">
        {home.error} Vui lòng thử lại sau ít phút.
      </Notice>
    );
  }

  const current = home.memberships.filter((row) => !row.isPast);
  const past = home.memberships.filter((row) => row.isPast);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-vam-ink">
          Chào {displayName ?? "bạn"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Đây là những chương trình bạn đang và đã tham gia.
        </p>
      </div>

      {home.memberships.length === 0 ? (
        // Người có trong danh bạ nhưng chưa được xếp vào mùa nào — chuyện bình
        // thường khi đợt tuyển đang chạy. Nói ra bằng lời, đừng để trang trắng.
        <Notice tone="warn" title="Chưa có chương trình nào">
          Tài khoản của bạn chưa được xếp vào mùa nào đang diễn ra. Nếu bạn nghĩ đây là
          nhầm lẫn, vui lòng liên hệ ban tổ chức.
        </Notice>
      ) : null}

      {current.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Đang tham gia
          </h2>
          <ul className="flex flex-col gap-3">
            {current.map((row) => (
              <MembershipCard key={`${row.programId}-${row.seasonId}-${row.role}`} row={row} />
            ))}
          </ul>
        </section>
      ) : null}

      {past.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Đã hoàn thành
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((row) => (
              <MembershipCard key={`${row.programId}-${row.seasonId}-${row.role}`} row={row} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MembershipCard({
  row
}: {
  row: {
    programCode: string | null;
    programName: string | null;
    seasonCode: string | null;
    seasonName: string | null;
    role: string;
    isPast: boolean;
  };
}) {
  const programLabel = row.programName ?? row.programCode ?? "Chương trình";
  const seasonLabel = row.seasonName ?? row.seasonCode ?? "Mùa";

  const body = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-vam-ink">{programLabel}</span>
        <span className="rounded-full bg-vam-mint px-2 py-0.5 text-xs font-medium text-vam-ink">
          {participantRoleLabel(row.role)}
        </span>
        {row.isPast ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Đã hoàn thành
          </span>
        ) : null}
      </span>
      <span className="mt-1 block text-sm text-slate-600">{seasonLabel}</span>
    </>
  );

  // Chỉ mùa có mã mới mở được trang riêng — đường dẫn cần mã chương trình.
  return (
    <li className="rounded-lg border border-vam-line bg-white p-4">
      {row.programCode ? (
        <Link href={`/ct/${encodeURIComponent(row.programCode)}`} className="block">
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

function Notice({
  tone,
  title,
  children
}: {
  tone: "warn" | "error";
  title: string;
  children: React.ReactNode;
}) {
  const style =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-lg border p-5 ${style}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm">{children}</p>
    </div>
  );
}
