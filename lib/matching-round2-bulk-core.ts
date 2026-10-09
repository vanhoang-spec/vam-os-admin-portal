export type GroupApproval = { assignmentId: string; expectedGroup: number; expectedDrift: number | null };

export function parseGroupApprovals(value: unknown): GroupApproval[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
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
