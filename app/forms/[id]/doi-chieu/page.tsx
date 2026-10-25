import Link from "next/link";
import { ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { CUSTOM_FORMS_PATH } from "@/lib/custom-form-core";
import { MATCHED_BY_LABELS, ROSTER_CHECK_ROLES, ROSTER_CHECK_ROLE_LABELS } from "@/lib/form-roster-check-core";
import { checkFormRoster, parseRosterRole } from "@/lib/form-roster-check";
import { formatDateTime } from "@/lib/utils";

/**
 * /forms/[id]/doi-chieu — câu trả lời của form so với danh sách mentee/mentor chính thức của mùa
 * (Support team 25/10/2026): gửi form đi rồi tự xem ai đã nộp, ai chưa, không phải nhờ lọc tay.
 */
export const dynamic = "force-dynamic";

export default async function CustomFormRosterCheckPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ doi_tuong?: string; season?: string | string[] }>;
}) {
  const { id } = await props.params;
  const search = (await props.searchParams) ?? {};
  const role = parseRosterRole(search.doi_tuong);
  const check = await checkFormRoster(id, { role, season: search.season });
  if (!check.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Đối chiếu với danh sách" />
        <ErrorBox message={check.message} />
      </div>
    );
  }
  const { form, seasonCode, result } = check.data;
  const roleLabel = ROSTER_CHECK_ROLE_LABELS[role];
  const roleLower = roleLabel.toLowerCase();
  const seasonQuery = typeof search.season === "string" ? `&season=${encodeURIComponent(search.season)}` : "";
  const pct = result.rosterSize ? Math.round((result.submitted.length / result.rosterSize) * 100) : 0;

  const notSubmittedRows = result.notSubmitted.map((p) => ({ name: p.name, email: p.emails[0] ?? "", phone: p.phones[0] ?? "" }));
  const submittedRows = result.submitted.map((e) => ({
    name: e.person.name,
    email: e.person.emails[0] ?? "",
    matchedBy: MATCHED_BY_LABELS[e.matchedBy],
    count: String(e.submissions.length),
    at: formatDateTime(e.submissions[0]?.createdAt)
  }));
  const outsiderRows = result.outsiders.map((o) => ({
    name: o.submission.name,
    email: o.submission.emails.join(", "),
    phone: o.submission.phones.join(", "),
    at: formatDateTime(o.submission.createdAt),
    note: o.note
  }));

  return (
    <div className="grid gap-4">
      <Link href={`${CUSTOM_FORMS_PATH}/${form.id}/tra-loi`} className="text-sm text-vam-green underline">
        ← Về câu trả lời của form “{form.title}”
      </Link>
      <PageHeader
        title={`Đối chiếu — ${form.title}`}
        description={`So câu trả lời với danh sách ${roleLower} chính thức mùa ${seasonCode} (cùng danh sách ở trang ${roleLabel}).`}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="roster-role-switch">
        <span className="text-sm text-slate-600">Đối chiếu với:</span>
        {ROSTER_CHECK_ROLES.map((r) => (
          <Link
            key={r}
            href={`${CUSTOM_FORMS_PATH}/${form.id}/doi-chieu?doi_tuong=${r}${seasonQuery}`}
            aria-current={r === role ? "page" : undefined}
            className={
              r === role
                ? "rounded-md bg-vam-green px-3 py-1.5 text-sm font-semibold text-white"
                : "rounded-md border border-vam-line px-3 py-1.5 text-sm text-vam-ink hover:bg-vam-mint/40"
            }
          >
            {ROSTER_CHECK_ROLE_LABELS[r]}
          </Link>
        ))}
        <a
          href={`/api/exports/custom-form/${form.id}/doi-chieu?doi_tuong=${role}${seasonQuery}`}
          data-testid="download-roster-check"
          className="ml-auto rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
        >
          Tải CSV đối chiếu
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="roster-check-kpis">
        <KpiCard label={`${roleLabel} chính thức`} value={result.rosterSize} helper={`Mùa ${seasonCode}`} />
        <KpiCard label="Đã nộp" value={result.submitted.length} tone="success" helper={`${pct}% danh sách`} />
        <KpiCard label="Chưa nộp" value={result.notSubmitted.length} tone={result.notSubmitted.length ? "warning" : "default"} />
        <KpiCard
          label="Người nộp ngoài danh sách"
          value={result.outsiders.length}
          tone={result.outsiders.length ? "danger" : "default"}
          helper="Không khớp ai trong danh sách"
        />
      </div>

      <section className="grid gap-2" data-testid="roster-not-submitted">
        <h2 className="text-base font-semibold text-vam-ink">Chưa nộp ({result.notSubmitted.length})</h2>
        <SimpleTable
          rows={notSubmittedRows}
          search="Tìm người chưa nộp theo tên, email…"
          columns={[
            { key: "name", label: "Họ và tên" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Số điện thoại", nowrap: true }
          ]}
        />
      </section>

      <section className="grid gap-2" data-testid="roster-outsiders">
        <h2 className="text-base font-semibold text-vam-ink">Người nộp không có trong danh sách ({result.outsiders.length})</h2>
        <SimpleTable
          rows={outsiderRows}
          columns={[
            { key: "name", label: "Họ tên trên form" },
            { key: "email", label: "Email trên form" },
            { key: "phone", label: "SĐT trên form", nowrap: true },
            { key: "at", label: "Gửi lúc", nowrap: true },
            { key: "note", label: "Ghi chú" }
          ]}
        />
      </section>

      <section className="grid gap-2" data-testid="roster-submitted">
        <h2 className="text-base font-semibold text-vam-ink">Đã nộp ({result.submitted.length})</h2>
        <SimpleTable
          rows={submittedRows}
          search="Tìm người đã nộp theo tên, email…"
          columns={[
            { key: "name", label: "Họ và tên" },
            { key: "email", label: "Email" },
            { key: "matchedBy", label: "Khớp theo" },
            { key: "count", label: "Số lần nộp", nowrap: true },
            { key: "at", label: "Gửi lần cuối", nowrap: true }
          ]}
        />
      </section>

      <p className="text-xs text-slate-600">
        Cách khớp: email (email trong hồ sơ hoặc email trên đơn mùa {seasonCode}) → số điện thoại → họ tên bỏ dấu. Khớp theo họ tên
        chỉ khi đúng một người trong danh sách mang tên đó, và ghi “cần xem lại”. Người nộp dùng email/SĐT của một{" "}
        {role === "mentee" ? "mentor" : "mentee"} nằm ở “ngoài danh sách”, không tính là đã nộp.
      </p>
    </div>
  );
}
