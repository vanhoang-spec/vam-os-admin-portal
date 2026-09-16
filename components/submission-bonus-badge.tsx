import { addSubmissionBonus, describeBonusWindow, type SubmissionBonus } from "@/lib/submission-bonus-core";

/**
 * Ô "Điểm cộng" trong danh sách duyệt.
 *
 * Ba trạng thái nhìn khác nhau: được cộng, không được cộng, và KHÔNG ĐỌC ĐƯỢC. Cái
 * cuối không được trông như cái thứ hai — người xếp hạng sẽ đọc nó là "0".
 */
export function SubmissionBonusBadge({ bonus }: { bonus: SubmissionBonus }) {
  if (bonus.kind === "unknown") {
    return (
      <span
        data-testid="submission-bonus-unknown"
        title="Không đọc được mốc điểm cộng"
        className="inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
      >
        Chưa rõ
      </span>
    );
  }
  if (bonus.kind === "none") return <span className="text-slate-400">—</span>;
  return (
    <span
      data-testid="submission-bonus-points"
      title={bonus.rule.label ? `${bonus.rule.label} · ${describeBonusWindow(bonus.rule)}` : describeBonusWindow(bonus.rule)}
      className="inline-flex rounded-md border border-vam-green/40 bg-vam-mint px-2 py-0.5 text-xs font-semibold tabular-nums text-vam-green"
    >
      +{bonus.points}
    </span>
  );
}

/** `18`, hoặc `18 + 3 = 21` khi đơn được cộng. */
export function scoreWithBonusText(total: number | null | undefined, bonus: SubmissionBonus): string {
  if (typeof total !== "number") return "-";
  if (bonus.kind !== "bonus") return String(total);
  return `${total} + ${bonus.points} = ${addSubmissionBonus(total, bonus)}`;
}
