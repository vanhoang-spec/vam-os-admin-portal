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

/**
 * Trần khi BTC sửa tay số mentee tối đa trên hồ sơ mentor (BTC 10/10/2026). Form đăng
 * ký chỉ cho mentor chọn 1–3; Core team được đặt cao hơn cho trường hợp riêng, nhưng
 * không vô hạn — gõ nhầm "22" thay cho "2" là mở 22 chỗ. CÙNG CẬN với hàm
 * vam116_set_mentor_capacity trong database.
 */
export const MENTOR_CAPACITY_MAX = 10;

/** Số BTC gõ vào ô "Số mentee tối đa": số nguyên 1..MENTOR_CAPACITY_MAX; cái gì khác → null. */
export function parseMentorCapacity(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (text.length < 1 || text.length > 2) return null;
  for (const ch of text) if (ch < "0" || ch > "9") return null;
  const n = Number(text);
  return n >= 1 && n <= MENTOR_CAPACITY_MAX ? n : null;
}

/**
 * Giá trị ĐANG LƯU của capacity_target, để gửi kèm lúc sửa: database chỉ ghi khi số
 * này còn đúng (hai người cùng mở một hồ sơ). Khác effectiveMentorCapacity ở chỗ không
 * thay giá trị rỗng / 0 bằng 3 — so với cái đang lưu thì phải là chính cái đang lưu.
 */
export function storedMentorCapacity(capacityTarget: unknown): number | null {
  if (capacityTarget === null || capacityTarget === undefined || capacityTarget === "") return null;
  const n = typeof capacityTarget === "number" ? capacityTarget : Number(capacityTarget);
  return Number.isInteger(n) ? n : null;
}

export type MentorCapacityView = {
  /** Số mentor / BTC đã đặt; null = chưa khai, hệ thống đang dùng DEFAULT_MENTOR_CAPACITY. */
  declared: number | null;
  /** Trần đang được cưỡng chế. */
  effective: number;
  /** Số cặp đang hoạt động của mentor TRONG MÙA này. */
  active: number;
  remaining: number;
};

type CapacityMatch = { mentor_person_id?: string | null; season_id?: string | null; status?: string | null };

/**
 * Ba con số của khung "Số mentee tối đa" trên hồ sơ mentor. Chỉ đếm cặp ĐANG hoạt động
 * của ĐÚNG mùa — cùng phép đếm với trigger vam104_match_capacity_guard; đếm cả cặp đã
 * kết thúc hay cặp mùa trước là báo "hết chỗ" cho một mentor còn nhận được.
 */
export function mentorCapacityView(input: {
  capacityTarget: unknown;
  personId: string;
  seasonId: string | null | undefined;
  matches: ReadonlyArray<CapacityMatch>;
}): MentorCapacityView {
  const stored = storedMentorCapacity(input.capacityTarget);
  const effective = effectiveMentorCapacity(input.capacityTarget);
  const active = input.seasonId
    ? input.matches.filter(
        (m) =>
          m.mentor_person_id === input.personId &&
          m.season_id === input.seasonId &&
          String(m.status ?? "").trim().toLowerCase() === "active"
      ).length
    : 0;
  return { declared: stored !== null && stored >= 1 ? stored : null, effective, active, remaining: Math.max(0, effective - active) };
}

/**
 * Trang hồ sơ có mời ô sửa hay không — cùng ba điều kiện hàm vam116_set_mentor_capacity
 * kiểm lại: vai trò, quyền vận hành mùa, và người này đang là mentor của mùa. Màn hình
 * không được mời một nút mà máy chủ chắc chắn từ chối.
 *
 * `roleAllowed` là kết quả canEditMentorCapacity(vai trò) — truyền vào thay vì import, để
 * file thuần này (Vòng 2 cũng dùng) không kéo theo bảng quyền.
 */
export function mentorCapacityEditState(input: { roleAllowed: boolean; canOperateSeason: boolean; isSeasonMentor: boolean }): {
  canEdit: boolean;
  lockedReason: string | null;
} {
  const permitted = input.roleAllowed && input.canOperateSeason;
  if (!permitted) return { canEdit: false, lockedReason: null };
  if (!input.isSeasonMentor) {
    return { canEdit: false, lockedReason: "Người này chưa là mentor đang tham dự mùa này nên chưa sửa được số mentee tối đa." };
  }
  return { canEdit: true, lockedReason: null };
}
