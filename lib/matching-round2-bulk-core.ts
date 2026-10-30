export type GroupApproval = { assignmentId: string; expectedGroup: number; expectedDrift: number | null };

/** Một lượt duyệt hàng loạt nhận tối đa ngần này người (hàm SQL vam115/vam122 cũng giữ đúng trần này). */
export const MAX_BULK_APPROVALS = 500;

export function parseGroupApprovals(value: unknown): GroupApproval[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_APPROVALS) return null;
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" ||
        typeof row.assignmentId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.assignmentId) ||
        !Number.isInteger(row.expectedGroup) || row.expectedGroup < 1 || row.expectedGroup > 9 ||
        !(row.expectedDrift === null || (Number.isInteger(row.expectedDrift) && row.expectedDrift >= 1 && row.expectedDrift <= 9)) ||
        ids.has(row.assignmentId.toLowerCase())) return null;
    ids.add(row.assignmentId.toLowerCase());
  }
  return value.map(({ assignmentId, expectedGroup, expectedDrift }) => ({ assignmentId, expectedGroup, expectedDrift }));
}

export type RoleGroupApproval = GroupApproval & { role: "mentor" | "mentee" };

/**
 * Duyệt chung cả mentor lẫn mentee trong một lượt (VAM00005, 28/10/2026): mỗi dòng mang thêm vai trò để máy chủ
 * chia về đúng hàm duyệt của vai trò đó. Trần 500 tính trên TỔNG cả lượt, như khi duyệt riêng. Vai trò ở đây chỉ
 * để chia việc — vam115/vam122 vẫn tự kiểm vai trò thật của từng dòng, dòng khai sai vai trò bị hàm SQL từ chối.
 */
export function parseRoleGroupApprovals(value: unknown): RoleGroupApproval[] | null {
  const rows = parseGroupApprovals(value);
  if (!rows || !Array.isArray(value)) return null;
  const roles = value.map((row) => (row as { role?: unknown }).role);
  if (!roles.every((role) => role === "mentor" || role === "mentee")) return null;
  return rows.map((row, i) => ({ ...row, role: roles[i] as "mentor" | "mentee" }));
}
