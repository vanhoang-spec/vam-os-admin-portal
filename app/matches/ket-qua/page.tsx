import Link from "next/link";
import { redirect } from "next/navigation";
import { MatchProfileCard } from "@/components/match-profile-card";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getMatchResultCoverage, getMatchResultData, getMatchResultPreview, type MatchResultCoverage } from "@/lib/match-result";
import {
  HOLD_REASON_LABELS,
  RECIPIENT_STATUS_LABELS,
  type MatchResultRecipient,
  type RecipientStatus
} from "@/lib/match-result-core";
import { matchingRoundLabel } from "@/lib/matching-round";
import { canManageMatches } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { AddHoldsForm, ConfirmHoldsPanel, GroupTestForm, MatchResultSendPanel, MatchResultSettingsForm, RemoveHoldButton, ResendButton } from "./forms";
import { HANDBOOKS } from "@/lib/handbook";

export const dynamic = "force-dynamic";
// Báo cáo độ phủ đọc hồ sơ của mọi người đang có cặp, và mỗi lần bấm gửi chạy tới 45 giây — cần nhiều
// hơn 10 giây mặc định.
export const maxDuration = 60;

const PATH = "/matches/ket-qua";
const STATUS_ORDER: RecipientStatus[] = ["pending", "too_new", "missing_email", "held", "changed_since_sent", "sent"];
const ROLE_LABEL = { mentor: "Mentor", mentee: "Mentee" } as const;
const RESENDABLE: RecipientStatus[] = ["pending", "sent", "changed_since_sent"];

/** Cùng điều kiện máy chủ kiểm lại ở resendMatchResultNotice. */
function canResend(r: MatchResultRecipient) {
  return RESENDABLE.includes(r.status) && Boolean(r.email) && r.partners.length > 0 && (r.role === "mentor" || r.partners.length === 1);
}

type SearchParams = Record<string, string | string[] | undefined>;

function param(sp: SearchParams, key: string): string {
  const v = sp[key];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function previewHref(role: "mentor" | "mentee", personId: string, status: string) {
  const q = new URLSearchParams({ xem: `${role}:${personId}` });
  if (status) q.set("trang-thai", status);
  return `${PATH}?${q.toString()}#xem-truoc`;
}

function StatusBadge({ r }: { r: MatchResultRecipient }) {
  const tone =
    r.status === "pending" ? "border-green-200 bg-green-50 text-green-800"
    : r.status === "sent" ? "border-slate-200 bg-slate-50 text-slate-700"
    : r.status === "changed_since_sent" ? "border-red-200 bg-red-50 text-red-700"
    : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`} data-status={r.status}>
      {RECIPIENT_STATUS_LABELS[r.status]}
    </span>
  );
}

function CoverageSection({ coverage }: { coverage: MatchResultCoverage }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="match-result-coverage">
      {(["mentee", "mentor"] as const).map((role) => {
        const c = coverage[role];
        return (
          <div key={role} className="grid content-start gap-3">
            <h3 className="text-sm font-semibold text-vam-ink">
              Hồ sơ {ROLE_LABEL[role]} ({c.total} người — đúng thẻ người đồng hành sẽ thấy)
            </h3>
            <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
              <table className="min-w-full divide-y divide-vam-line text-sm tabular-nums">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Trường</th>
                    <th className="px-3 py-2 text-right">Có dữ liệu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {c.fields.map((f) => (
                    <tr key={f.key} data-field={f.key}>
                      <td className="px-3 py-1.5">{f.label}</td>
                      <td className={`px-3 py-1.5 text-right ${f.present < c.total ? "text-amber-700" : ""}`}>
                        {f.present}/{c.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {c.people.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-600">{c.people.length} người thiếu ít nhất một trường (trường thiếu sẽ ẩn trên thẻ)</summary>
                <ul className="mt-2 grid gap-1">
                  {c.people.map((p) => (
                    <li key={p.personId}>
                      <Link href={previewHref(role, p.personId, "")} className="font-medium text-vam-green underline">
                        {p.fullName ?? "(chưa có tên)"}
                      </Link>{" "}
                      <span className="text-slate-500">— thiếu: {p.missing.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Thư kết quả ghép cặp mùa 12 (BTC 22/10/2026): cài link trong thư, danh sách mentor giữ lại, độ phủ
 * dữ liệu hồ sơ, xem trước từng thẻ. Bản này chưa gửi thư.
 */
export default async function MatchResultPage(props: { searchParams: Promise<SearchParams> }) {
  const admin = await getCurrentAdminUser();
  if (!admin) redirect("/login");
  if (!canManageMatches(admin.role)) {
    return <PageHeader title="Không có quyền truy cập" description="Trang này dành cho Core team trở lên." />;
  }
  const sp = await props.searchParams;
  const result = await getMatchResultData();
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Kết quả ghép cặp" />
        <ErrorBox message={result.message} />
      </>
    );
  }
  const data = result.data;

  const statusFilter = STATUS_ORDER.includes(param(sp, "trang-thai") as RecipientStatus) ? (param(sp, "trang-thai") as RecipientStatus) : null;
  const shown = statusFilter ? data.recipients.filter((r) => r.status === statusFilter) : data.recipients;

  const [previewRole, previewId] = param(sp, "xem").split(":");
  const preview =
    (previewRole === "mentor" || previewRole === "mentee") && previewId
      ? await getMatchResultPreview(data.seasonId, previewRole, previewId)
      : null;
  const previewName = preview?.ok ? preview.card.fields.find((f) => f.key === "full_name")?.value ?? null : null;

  const coverage = param(sp, "do-phu") === "1" ? await getMatchResultCoverage(data.seasonId) : null;
  const total = (status: RecipientStatus) => data.counts.mentor[status] + data.counts.mentee[status];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Kết quả ghép cặp · ${data.seasonLabel}`}
        description="Thư thông báo kết quả Matching kèm link hồ sơ người đồng hành. Mọi cặp đang hoạt động, mọi vòng. Cài link, chốt danh sách giữ lại, soát hồ sơ, rồi gửi theo từng nhóm mentor."
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6" data-testid="match-result-kpis">
        {STATUS_ORDER.map((s) => (
          <KpiCard
            key={s}
            label={RECIPIENT_STATUS_LABELS[s]}
            value={total(s)}
            helper={`${data.counts.mentor[s]} mentor · ${data.counts.mentee[s]} mentee`}
            tone={s === "pending" ? "success" : s === "changed_since_sent" ? "danger" : s === "sent" ? "default" : "warning"}
          />
        ))}
      </div>

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">Gửi thư kết quả</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mỗi lần bấm gửi trọn từng nhóm mentor — mentor và các mentee của họ đi cùng nhau, để hai bên một cặp nhận thư cùng ngày.
        </p>
        <div className="mt-3">
          <MatchResultSendPanel blocked={data.blocked} {...data.dispatch} />
        </div>
        <div className="mt-4">
          <GroupTestForm />
        </div>
      </Card>

      <Card id="thu-sau-15-11">
        <h2 className="text-base font-semibold text-vam-ink">Thư nhóm mentor cần Training 15/11 (mẫu “sau 15/11”)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mentor trong danh sách giữ lại (mục 2) và các mentee của họ nhận mẫu “MATCHING SAU 15/11”: mentor chỉ thấy họ tên mentee,
          mentee chưa thấy thông tin mentor, chưa có link hồ sơ. Sau 15/11, BTC bỏ giữ từng mentor đã dự Training để họ và mentee
          nhận thư thường có link hồ sơ.
        </p>
        <p className="mt-2 text-sm text-slate-600" data-testid="late-counts">
          {STATUS_ORDER.map((st) => `${RECIPIENT_STATUS_LABELS[st]}: ${data.late.counts.mentor[st] + data.late.counts.mentee[st]}`).join(" · ")}
        </p>
        <div className="mt-3">
          <MatchResultSendPanel blocked={data.blocked} {...data.late.dispatch} variant="special" />
        </div>
        {data.late.recipients.length ? (
          <div className="vam-table-frame mt-3 overflow-x-auto rounded-lg border border-vam-line bg-white">
            <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="late-recipients">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Vai</th>
                  <th className="px-3 py-2">Người nhận</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Người đồng hành</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Gửi riêng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {data.late.recipients.map((r) => (
                  <tr key={`${r.role}:${r.personId}`} data-late-recipient={`${r.role}:${r.personId}`}>
                    <td className="px-3 py-2">{ROLE_LABEL[r.role]}</td>
                    <td className="px-3 py-2">{r.fullName ?? "(chưa có tên)"}</td>
                    <td className="px-3 py-2">{r.email ?? "—"}</td>
                    <td className="px-3 py-2">{r.partners.map((p) => p.fullName ?? "(chưa có tên)").join(", ") || "Không còn cặp"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge r={r} />
                      {r.sentAt ? <div className="mt-1 text-xs text-slate-500">Gửi lúc {formatDateTime(r.sentAt)}</div> : null}
                      {r.lastError && !r.sentAt ? <div className="mt-1 text-xs text-red-600">Lỗi lần trước: {r.lastError}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      {!data.blocked.length && canResend(r) ? (
                        <ResendButton personId={r.personId} role={r.role} name={r.fullName ?? r.email ?? ""} sentBefore={Boolean(r.sentAt)} variant="special" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Chưa có mentor nào trong danh sách giữ lại.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">1. Handbook và link Kick-off</h2>
        <ul className="mt-2 grid gap-1 text-sm" data-testid="match-result-handbooks">
          {(["mentee", "mentor"] as const).map((role) => (
            <li key={role} data-handbook={role}>
              Handbook {role}:{" "}
              {HANDBOOKS[role].ready ? (
                <a href={HANDBOOKS[role].path} target="_blank" rel="noopener noreferrer" className="font-medium text-vam-green underline">
                  {HANDBOOKS[role].path}
                </a>
              ) : (
                <span className="text-amber-700">chưa có file trên VAM OS — gửi file PDF cho người phụ trách kỹ thuật để đưa lên</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-slate-500">Thư lấy link Handbook từ VAM OS; thay bản mới thì link trong thư đã gửi vẫn đúng.</p>
        {data.settingsReadOk ? (
          <div className="mt-3">
            <MatchResultSettingsForm kickoffRegisterUrl={data.settings?.kickoffRegisterUrl ?? null} />
          </div>
        ) : (
          <ErrorBox message="Không đọc được cài đặt thư — tải lại trang." />
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">2. Mentor cần Training 15/11 (danh sách giữ lại)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mentor trong danh sách này và mọi mentee của họ không nhận thư thường; họ nhận mẫu “sau 15/11” ở mục “Thư nhóm mentor cần
          Training 15/11”. Sau 15/11, bỏ giữ mentor nào đã dự Training để họ nhận thư thường có link hồ sơ.
        </p>
        {data.holdsReadOk ? (
          <div className="mt-3 grid gap-4">
            {data.holds.length ? (
              <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
                <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="match-result-holds">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Mentor</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2 text-right">Mentee</th>
                      <th className="px-3 py-2">Lý do</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vam-line">
                    {data.holds.map((h) => (
                      <tr key={h.mentorPersonId} data-hold={h.mentorPersonId}>
                        <td className="px-3 py-2">{h.fullName ?? "(chưa có tên)"}</td>
                        <td className="px-3 py-2">{h.inputEmail ?? h.email ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h.menteeCount}</td>
                        <td className="px-3 py-2 text-slate-600">{h.reason ?? "—"}</td>
                        <td className="px-3 py-2">
                          <RemoveHoldButton mentorPersonId={h.mentorPersonId} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Chưa giữ lại mentor nào.</p>
            )}
            <ConfirmHoldsPanel
              fingerprint={data.holdsFingerprint}
              count={data.holds.length}
              confirmedLabel={data.settings?.holdsConfirmedAt ? formatDateTime(data.settings.holdsConfirmedAt) : null}
            />
            <AddHoldsForm />
          </div>
        ) : (
          <ErrorBox message="Không đọc được danh sách giữ lại — đã khoá gửi. Tải lại trang." />
        )}
      </Card>

      <Card id="xem-truoc">
        <h2 className="text-base font-semibold text-vam-ink">3. Độ phủ dữ liệu hồ sơ</h2>
        {coverage ? (
          coverage.ok ? (
            <div className="mt-3">
              <CoverageSection coverage={coverage.coverage} />
            </div>
          ) : (
            <ErrorBox message={coverage.message} />
          )
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Đọc hồ sơ của mọi người đang có cặp nên chỉ chạy khi bấm.{" "}
            <Link href={`${PATH}?do-phu=1`} className="font-medium text-vam-green underline" data-testid="match-result-coverage-link">
              Xem độ phủ
            </Link>
          </p>
        )}
        {preview ? (
          <div className="mt-6 grid gap-3" data-testid="match-result-preview">
            <h3 className="text-sm font-semibold text-vam-ink">
              Xem trước: hồ sơ {ROLE_LABEL[previewRole as "mentor" | "mentee"].toLowerCase()} {previewName ?? ""} — đúng thẻ người đồng hành sẽ thấy
            </h3>
            {preview.ok ? <MatchProfileCard card={preview.card} /> : <ErrorBox message={preview.message} />}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">4. Người nhận thư</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm" data-testid="match-result-filters">
          <Link href={PATH} className={`rounded-md border px-2 py-1 ${statusFilter ? "border-vam-line" : "border-vam-green font-semibold"}`}>
            Tất cả ({data.recipients.length})
          </Link>
          {STATUS_ORDER.map((s) => (
            <Link
              key={s}
              href={`${PATH}?trang-thai=${s}`}
              className={`rounded-md border px-2 py-1 ${statusFilter === s ? "border-vam-green font-semibold" : "border-vam-line"}`}
            >
              {RECIPIENT_STATUS_LABELS[s]} ({total(s)})
            </Link>
          ))}
        </div>
        <div className="vam-table-frame mt-3 overflow-x-auto rounded-lg border border-vam-line bg-white">
          <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="match-result-recipients">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Vai</th>
                <th className="px-3 py-2">Người nhận</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Link hồ sơ trong thư</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">Gửi riêng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line">
              {shown.map((r) => (
                <tr key={`${r.role}:${r.personId}`} data-recipient={`${r.role}:${r.personId}`}>
                  <td className="px-3 py-2">{ROLE_LABEL[r.role]}</td>
                  <td className="px-3 py-2">{r.fullName ?? "(chưa có tên)"}</td>
                  <td className="px-3 py-2">{r.email ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.partners.length ? (
                      <ul className="grid gap-0.5">
                        {r.partners.map((p) => (
                          <li key={p.matchId}>
                            <Link
                              href={previewHref(r.role === "mentor" ? "mentee" : "mentor", p.personId, statusFilter ?? "")}
                              className="text-vam-green underline"
                            >
                              {p.fullName ?? "(chưa có tên)"}
                            </Link>
                            {matchingRoundLabel(p.round) ? <span className="text-xs text-slate-500"> · {matchingRoundLabel(p.round)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-500">Không còn cặp</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge r={r} />
                    {r.holdReason ? <div className="mt-1 text-xs text-slate-500">{HOLD_REASON_LABELS[r.holdReason]}</div> : null}
                    {r.sentAt ? <div className="mt-1 text-xs text-slate-500">Gửi lúc {formatDateTime(r.sentAt)}</div> : null}
                    {r.lastError && !r.sentAt ? <div className="mt-1 text-xs text-red-600">Lỗi lần trước: {r.lastError}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    {!data.blocked.length && canResend(r) ? (
                      <ResendButton personId={r.personId} role={r.role} name={r.fullName ?? r.email ?? ""} sentBefore={Boolean(r.sentAt)} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
