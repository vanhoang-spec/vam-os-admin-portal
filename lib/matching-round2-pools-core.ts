/**
 * Ghép cặp Vòng 2 — "cụm chọn" (BTC 14/10/2026). Phần thuần.
 *
 * Cụm = các nhóm ngành chung một danh sách chọn: mentor nhóm nào trong cụm cũng thấy và chọn được
 * mentee mọi nhóm trong cụm. Mùa 12 gộp 1+2+3 (Tài chính) và 6+9 (Nhân sự + Khác) vì cung - cầu lệch
 * theo nhóm. Nhóm ngành của từng người KHÔNG đổi — cụm chỉ nói ai chung danh sách với ai; nhóm không
 * có dòng trong matching_round2_pools là cụm của chính nó (đúng luật cũ "cùng nhóm").
 *
 * Database (vam123_round2_pool trong vam113_round2_pick) là nơi quyết định; file này chỉ để trang,
 * thư và báo cáo nói cùng một điều với database.
 */
import { INDUSTRY_GROUPS, industryGroupLabel } from "@/lib/matching-round2-groups-core";

export type PoolMap = ReadonlyMap<number, number>;

const GROUP_CODES = INDUSTRY_GROUPS.map((g) => g.code);
const isGroup = (n: number) => Number.isInteger(n) && n >= 1 && n <= 9;

export function poolMapFromRows(rows: ReadonlyArray<{ group_code?: unknown; pool_code?: unknown }>): PoolMap {
  const map = new Map<number, number>();
  for (const row of rows) {
    const group = Number(row.group_code);
    const pool = Number(row.pool_code);
    if (isGroup(group) && isGroup(pool)) map.set(group, pool);
  }
  return map;
}

export function poolOf(pools: PoolMap, group: number): number {
  return pools.get(group) ?? group;
}

/** Mọi nhóm chung danh sách với nhóm này (kể cả chính nó), theo thứ tự nhóm. */
export function poolGroups(pools: PoolMap, group: number): number[] {
  const pool = poolOf(pools, group);
  return GROUP_CODES.filter((code) => poolOf(pools, code) === pool);
}

/** Nhãn cho mentor (trang chọn, thư mời): nhóm của mình, kèm các nhóm chung danh sách nếu có. */
export function mentorPoolLabel(pools: PoolMap, group: number): string {
  const others = poolGroups(pools, group).filter((code) => code !== group);
  const own = industryGroupLabel(group);
  return others.length ? `${own} (chung danh sách với ${others.map(industryGroupLabel).join(", ")})` : own;
}

export type PoolInfo = { code: number; groups: number[]; label: string };

/** Mỗi cụm một dòng cho báo cáo, xếp theo nhóm nhỏ nhất trong cụm. */
export function poolList(pools: PoolMap): PoolInfo[] {
  const byPool = new Map<number, number[]>();
  for (const code of GROUP_CODES) {
    const pool = poolOf(pools, code);
    byPool.set(pool, [...(byPool.get(pool) ?? []), code]);
  }
  return Array.from(byPool.entries())
    .map(([code, groups]) => ({
      code,
      groups,
      label: groups.length > 1 ? `Cụm ${groups.join(" + ")}: ${groups.map(industryGroupLabel).join(" · ")}` : industryGroupLabel(groups[0])
    }))
    .sort((a, b) => a.groups[0] - b.groups[0]);
}
