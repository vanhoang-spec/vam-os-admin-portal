/**
 * Sức nhận mentee của một mentor — một cửa cho mọi nơi đếm chỗ.
 *
 * Tách khỏi lib/matches.ts (server-only) để phần thuần của Vòng 2 dùng chung đúng luật
 * với trang Ghép cặp và với trigger vam104_match_capacity_guard: cùng số
 * `mentor_profiles.capacity_target`, cùng giá trị dự phòng 3.
 */

/**
 * Fallback mentor capacity, used only when the mentor's own
 * `mentor_profiles.capacity_target` is absent or not a positive integer.
 *
 * This was previously the cap for EVERY mentor. On UEHM-S12 that is wrong for
 * most of them: of 142 approved mentors, 65 declared a capacity of 1 and 57
 * declared 2. Applying 3 to all of them let an operator assign three mentees to
 * a mentor who agreed to one. `capacity_target` is written at approval time by
 * vam092 from the applicant's own answer, so the number the mentor gave is
 * already in the database — it was simply never read here.
 */
export const DEFAULT_MENTOR_CAPACITY = 3;

/**
 * The capacity to enforce for one mentor.
 *
 * The mutation guard, the candidate list and the load bar must all agree: a UI
 * that shows `1/2` while the mutation enforces 3 is worse than either rule on its
 * own, because the operator cannot tell which one is real.
 */
export function effectiveMentorCapacity(capacityTarget: unknown): number {
  const value = typeof capacityTarget === "number" ? capacityTarget : Number(capacityTarget);
  if (!Number.isFinite(value)) return DEFAULT_MENTOR_CAPACITY;
  if (!Number.isInteger(value) || value < 1) return DEFAULT_MENTOR_CAPACITY;
  return value;
}
