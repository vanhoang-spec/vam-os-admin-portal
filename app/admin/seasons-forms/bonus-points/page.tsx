import Link from "next/link";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { readApplicationFormControls, S12_BINDING } from "@/lib/application-form-controls";
import { readAllPages } from "@/lib/paged-read";
import { canManageSubmissionBonus } from "@/lib/permissions";
import { getAdminScopeContext } from "@/lib/program-scope";
import { readApplicationBonusRules, rulesForTarget } from "@/lib/submission-bonus";
import { describeBonusWindow, summarizeBonusCoverage, type BonusCoverage } from "@/lib/submission-bonus-core";
import { canManageBonusForSeason } from "@/lib/submission-bonus-write";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { formatDateTime, formatInt } from "@/lib/utils";
import { AddBonusRuleForm, DeleteBonusRuleButton } from "./bonus-rules-editor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Điểm cộng theo ngày nộp — VAM OS"
};

const TITLE = "Điểm cộng theo ngày nộp";

// Mentee trước: đó là form đang cần mốc (16/09/2026).
const ROLES = [
  { role: "mentee", label: "mentee", title: "Form tuyển Mentee", reviewQueue: "/applications/mentee-review" },
  { role: "mentor", label: "mentor", title: "Form tuyển Mentor", reviewQueue: "/applications/mentor-review" }
] as const;

function Refused({ message }: { message: string }) {
  return (
    <>
      <PageHeader title={TITLE} />
      <ErrorBox message={message} />
    </>
  );
}

/** Giờ nộp của mọi đơn trong đợt, để đếm mốc vừa đặt trúng bao nhiêu người. Chỉ đọc giờ nộp, không đọc tên. */
async function readSubmissionTimes(intakeBatchId: string) {
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  const { data, error } = await readAllPages<{ role_applied?: string; created_at?: string }>(
    "applications",
    "id,role_applied,created_at",
    (columns) => client.from("applications").select(columns).eq("intake_batch_id", intakeBatchId)
  );
  if (error) {
    console.error("[bonus-points] submission times unreadable", error);
    return null;
  }
  const byRole: Record<string, string[]> = { mentor: [], mentee: [] };
  for (const row of data) {
    const role = String(row.role_applied ?? "");
    if (byRole[role] && row.created_at) byRole[role].push(row.created_at);
  }
  return byRole;
}

export default async function SubmissionBonusPage() {
  const ctx = await getAdminScopeContext();
  const admin = ctx.adminUser ?? (await getCurrentAdminUser());

  if (!admin?.id || admin.status !== "active" || !canManageSubmissionBonus(admin.role)) {
    return <Refused message="Bạn không có quyền đặt điểm cộng cho form đăng ký." />;
  }
  if (ctx.scopeError) return <Refused message={ctx.scopeError} />;

  const form = await readApplicationFormControls();
  if (!form.ok) {
    return <Refused message={`Chưa đọc được form đăng ký của đợt ${S12_BINDING.intakeBatchCode}.`} />;
  }
  const { seasonId, intakeBatchId } = form.controls.mentee;

  if (!(await canManageBonusForSeason(seasonId))) {
    return <Refused message={`Bạn cần quyền vận hành mùa ${S12_BINDING.seasonCode} để đặt điểm cộng.`} />;
  }

  const [lookup, times] = await Promise.all([
    readApplicationBonusRules([intakeBatchId]),
    readSubmissionTimes(intakeBatchId)
  ]);
  if (!lookup.ok) {
    return (
      <Refused message="Chưa đọc được bảng điểm cộng (submission_bonus_rules). Nhiều khả năng migration 20260916170000_submission_bonus_rules.sql chưa được chạy." />
    );
  }

  return (
    <>
      <PageHeader
        title={TITLE}
        description={`Nộp trong khoảng ngày nào thì được cộng bao nhiêu điểm, cho form của đợt ${S12_BINDING.intakeBatchCode}. Thêm hay xoá mốc là có hiệu lực ngay, kể cả với đơn đã nộp.`}
      />

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">Cách tính</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            Ngày nộp là <strong>giờ Việt Nam</strong> lúc người đó bấm gửi form. Mốc tính cả ngày bắt đầu và đến hết
            23:59 ngày kết thúc.
          </li>
          <li>
            Đơn rơi vào nhiều mốc thì nhận <strong>mốc cao nhất</strong>, không cộng dồn. Ví dụ “đến hết 10/09 +5” và
            “đến hết 15/09 +3”: nộp ngày 09/09 được +5, nộp ngày 12/09 được +3.
          </li>
          <li>
            Điểm cộng được cộng vào tổng điểm của <strong>từng</strong> reviewer (thang 25), hiện ở danh sách Duyệt
            Mentee/Mentor S12, trang chi tiết đơn và file CSV điểm review. Reviewer không thấy điểm cộng khi đang chấm.
          </li>
          <li>Mỗi lần thêm hay xoá mốc đều được ghi nhật ký.</li>
        </ul>
        <p className="mt-3 text-sm">
          <Link href="/admin/seasons-forms" className="text-slate-600 hover:underline">
            ← Mùa & Form đăng ký
          </Link>
        </p>
      </Card>

      {ROLES.map((entry) => {
        const rules = rulesForTarget(lookup, intakeBatchId, entry.role) ?? [];
        const submissions = times?.[entry.role] ?? null;
        const coverage: BonusCoverage | null = submissions ? summarizeBonusCoverage(rules, submissions) : null;
        return (
          <Card key={entry.role} className="mt-6" id={`bonus-${entry.role}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-vam-ink">{entry.title}</h2>
              <p className="text-sm text-slate-600" data-testid={`bonus-coverage-${entry.role}`}>
                {coverage
                  ? `${formatInt(coverage.withBonus)} / ${formatInt(coverage.total)} đơn đang được cộng điểm`
                  : "Chưa đếm được số đơn được cộng."}
              </p>
            </div>

            {rules.length === 0 ? (
              <p className="mt-3 rounded-md border border-dashed border-vam-line px-3 py-3 text-sm text-slate-600">
                Chưa có mốc nào. Không đơn nào được cộng điểm.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-vam-line">
                <table className="min-w-full divide-y divide-vam-line text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Mốc</th>
                      <th className="px-3 py-2 text-right">Cộng</th>
                      <th className="px-3 py-2 text-right">Số đơn</th>
                      <th className="px-3 py-2">Người đặt</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vam-line">
                    {rules.map((rule) => {
                      const windowText = describeBonusWindow(rule);
                      return (
                        <tr key={rule.id} data-testid="bonus-rule-row">
                          <td className="px-3 py-2 text-vam-ink">
                            <div className="font-medium">{windowText}</div>
                            {rule.label ? <div className="text-xs text-slate-500">{rule.label}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-vam-green">+{rule.points}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {coverage ? formatInt(coverage.byRule[rule.id] ?? 0) : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500">
                            {[rule.createdByName, rule.createdAt ? formatDateTime(rule.createdAt) : null]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <DeleteBonusRuleButton role={entry.role} ruleId={rule.id} description={`${windowText} → +${rule.points}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {rules.length > 1 ? (
              <p className="mt-2 text-xs text-slate-500">
                “Số đơn” đếm mỗi đơn một lần, ở mốc cao nhất mà đơn đó rơi vào.
              </p>
            ) : null}

            <div className="mt-5 border-t border-vam-line pt-4">
              <h3 className="mb-3 text-sm font-semibold text-vam-ink">Thêm mốc</h3>
              <AddBonusRuleForm role={entry.role} roleLabel={entry.label} />
            </div>

            <p className="mt-4 text-sm">
              <Link href={entry.reviewQueue} className="font-medium text-vam-green hover:underline">
                Xem điểm cộng trong danh sách duyệt {entry.label} →
              </Link>
            </p>
          </Card>
        );
      })}
    </>
  );
}
