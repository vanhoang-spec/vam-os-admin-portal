import { staffDisplayName } from "@/lib/ui-labels";

/**
 * Thứ tự người trong ô chọn người đánh giá / phỏng vấn (BTC 03/10/2026): Quản trị
 * viên → Ban Điều hành → Người đánh giá hồ sơ, mỗi nhóm A → Z. Danh sách người đánh
 * giá dài dần lên theo mùa, nên nhóm BTC hay chọn phải đứng đầu thay vì trộn theo
 * tên. Ban Hỗ trợ (nếu có trong danh sách) đứng giữa Ban Điều hành và người đánh
 * giá; vai trò lạ đứng cuối cùng chứ không biến mất.
 */
const ROLE_RANK: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  core_team: 2,
  support_team: 3,
  reviewer: 4
};
const UNKNOWN_RANK = 9;

type Staff = { role?: string | null; full_name?: string | null; email?: string | null };

export function sortStaffForAssignment<T extends Staff>(list: readonly T[]): T[] {
  const rank = (s: T) => ROLE_RANK[String(s.role ?? "").trim()] ?? UNKNOWN_RANK;
  const name = (s: T) => staffDisplayName({ adminFullName: s.full_name, email: s.email });
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b), "vi", { sensitivity: "base" }) || String(a.email ?? "").localeCompare(String(b.email ?? ""))
  );
}
