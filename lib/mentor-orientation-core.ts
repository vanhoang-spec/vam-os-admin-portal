/**
 * lib/mentor-orientation-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Trong số người đăng ký một buổi Mentor Orientation, bao nhiêu người là mentor
 * cũ, bao nhiêu là mentor mới — để BTC chuẩn bị nội dung cho đúng người.
 *
 * ---------------------------------------------------------------------------
 * "MENTOR CŨ" NGHĨA LÀ GÌ
 * ---------------------------------------------------------------------------
 * Email đăng ký trùng email của một người từng giữ vai trò mentor ở một mùa
 * KHÁC mùa của buổi đó. Còn lại là mentor mới.
 *
 * Vì sao "mùa khác" chứ không phải "bất kỳ mùa nào": mentor lần đầu được duyệt
 * vào mùa này cũng có một membership mentor của mùa này. Đếm cả nó thì mọi
 * mentor mới được import vào CRM đều thành "cũ", và con số BTC dùng để chuẩn bị
 * cho người mới teo dần về 0 đúng lúc buổi orientation tới gần.
 *
 * Vai trò đã huỷ không tính: huỷ nghĩa là vai trò đã được gỡ, người đó chưa làm.
 *
 * Giới hạn đã biết: so theo email. Một mentor cũ đăng ký bằng địa chỉ khác sẽ bị
 * đếm là mới. Đó là quy ước BTC chọn ("tạm xem"), không phải phép nhận diện người.
 *
 * Module thuần, không I/O.
 */

export type MentorSplit = { returning: number; fresh: number };

/** Chuẩn hoá để so email: bỏ khoảng trắng hai đầu, về chữ thường. */
export function emailKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function foldVietnamese(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Buổi này có phải một buổi Mentor Orientation không.
 *
 * Loại `mentor_orientation` thì chắc chắn. Nhưng hai buổi 20/09 và 27/09 của
 * Mùa 12 được tạo với loại chung `orientation` — loại giữ lại cho các sự kiện cũ,
 * xem EVENT_TYPE_OPTIONS — nên với loại chung thì nhìn thêm tên.
 *
 * So theo TỪ "mentor", không theo chuỗi con: "UEH Mentoring Orientation" là buổi
 * chung, và "mentoring" chứa "mentor". Buổi ghi cả mentor lẫn mentee là buổi
 * chung, không tách đếm.
 */
export function isMentorOrientationEvent(event: { event_type?: unknown; event_name?: unknown }): boolean {
  const type = String(event.event_type ?? "").trim();
  if (type === "mentor_orientation") return true;
  if (type !== "orientation") return false;
  const name = foldVietnamese(event.event_name);
  return /\bmentors?\b/.test(name) && !/\bmentees?\b/.test(name);
}

/**
 * Email → các mùa mà người mang email đó từng giữ vai trò mentor.
 *
 * Nối trong JS thay vì embed trong truy vấn: bảng người và bảng membership đều
 * có đường đọc phân trang, còn một phép embed PostgREST vượt 1000 dòng bị cắt
 * mà không báo — và số "cũ" sẽ thấp đi một cách không ai thấy được.
 */
export function buildMentorSeasonsByEmail(
  memberships: Array<{ person_id?: unknown; season_id?: unknown; status?: unknown }>,
  people: Array<{ id?: unknown; email_primary?: unknown }>
): Map<string, Set<string>> {
  const emailByPerson = new Map<string, string>();
  for (const person of people) {
    const id = String(person.id ?? "").trim();
    const key = emailKey(person.email_primary);
    if (id && key) emailByPerson.set(id, key);
  }

  const seasons = new Map<string, Set<string>>();
  for (const row of memberships) {
    if (String(row.status ?? "").trim().toLowerCase() === "cancelled") continue;
    const email = emailByPerson.get(String(row.person_id ?? "").trim());
    const season = String(row.season_id ?? "").trim();
    if (!email || !season) continue;
    const set = seasons.get(email) ?? new Set<string>();
    set.add(season);
    seasons.set(email, set);
  }
  return seasons;
}

/**
 * Đếm cũ/mới cho từng buổi.
 *
 * Tập được đếm phải là ĐÚNG tập của cột "Đăng ký" trên danh sách sự kiện: mọi
 * đăng ký trừ trạng thái `cancelled`, so khít như trang đang so. Nên cũ + mới
 * luôn bằng con số đứng ngay phía trên — lệch nhau một đơn vị là người đọc không
 * còn tin được con số nào trong ô đó.
 */
export function splitMentorRegistrants(input: {
  events: Array<{ id: string; season_id?: string | null }>;
  registrations: Array<{ event_id?: unknown; email?: unknown; registration_status?: unknown }>;
  mentorSeasonsByEmail: Map<string, Set<string>>;
}): Map<string, MentorSplit> {
  const seasonByEvent = new Map<string, string>();
  const splits = new Map<string, MentorSplit>();
  for (const event of input.events) {
    seasonByEvent.set(event.id, String(event.season_id ?? "").trim());
    splits.set(event.id, { returning: 0, fresh: 0 });
  }

  for (const row of input.registrations) {
    const eventId = String(row.event_id ?? "").trim();
    const split = splits.get(eventId);
    if (!split) continue;
    if (row.registration_status === "cancelled") continue;

    const seasons = input.mentorSeasonsByEmail.get(emailKey(row.email));
    const eventSeason = seasonByEvent.get(eventId) ?? "";
    // Buổi không gắn mùa thì mọi mùa đều là "mùa khác".
    const servedElsewhere = seasons
      ? Array.from(seasons).some((season) => !eventSeason || season !== eventSeason)
      : false;

    if (servedElsewhere) split.returning += 1;
    else split.fresh += 1;
  }
  return splits;
}
