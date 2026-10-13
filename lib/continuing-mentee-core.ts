/**
 * lib/continuing-mentee-core.ts — mentee CHUYỂN TIẾP sang mùa mới (BTC 13/10/2026).
 * Phần thuần, không I/O; lib/matches.ts đọc bảng rồi gọi vào đây.
 *
 * Mentee mùa trước tiếp tục mùa này KHÔNG điền form mới, nên mùa này họ không có đơn nào.
 * Họ chỉ có tư cách mentee đang hoạt động trong mùa (person_season_memberships) và hồ sơ
 * mentee cũ. Danh sách ghép tay trước đây lấy mentee từ ĐƠN đã duyệt của mùa, nên loại họ
 * ra dù tư cách mùa đã có sẵn: BTC không chọn được bạn nào để ghép với mentor.
 *
 * Luật nhận diện hẹp có chủ ý: tư cách mentee ĐANG HOẠT ĐỘNG trong mùa VÀ không có bất
 * kỳ đơn mentee nào của mùa đó (mọi trạng thái). Hai vế đều cần:
 *   - Có đơn thì đơn là nguồn quyết định. Người có đơn "chờ BTC chốt" hay "không chọn"
 *     mà vẫn còn một dòng tư cách đang hoạt động thì KHÔNG được ghép bằng đường này, nếu
 *     không tư cách sẽ vượt mặt quyết định tuyển.
 *   - Tư cách rút / không tham gia thì không phải đang tiếp tục.
 * Tập này không giao với tập "đơn đã duyệt": hai tập cộng lại thành danh sách mentee ghép được.
 */

/** Nhãn hiện cạnh tên mentee trên màn hình ghép cặp. */
export const CONTINUING_MENTEE_LABEL = "Chuyển tiếp từ mùa trước";

/**
 * Lời khung "Xem hồ sơ" nói thay cho hồ sơ chi tiết: khung đó đọc đơn của mùa, mà bạn này
 * không điền form mùa này. Nói thẳng lý do thay vì "chưa được duyệt chính thức" (sai sự thật).
 */
export const CONTINUING_MENTEE_QUICK_VIEW_MESSAGE =
  "Bạn này là mentee chuyển tiếp từ mùa trước, không điền form mùa này nên chưa có hồ sơ chi tiết để xem nhanh. Trường và ngành của bạn hiện ở khung bên cạnh; xem thêm ở hồ sơ mentee của mùa trước.";

type MaybeId = string | null | undefined;

function cleanId(value: MaybeId): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/**
 * Người đang là mentee của mùa nhưng không có đơn mentee nào của mùa đó.
 *
 * @param activeMenteeMembers person_id của MỌI tư cách mentee đang hoạt động trong mùa.
 * @param menteeApplicants    person_id của MỌI đơn mentee của mùa, bất kể trạng thái.
 * @returns person_id không trùng, đã xếp tăng dần (cùng một thứ tự mỗi lần tải trang).
 */
export function continuingMenteePersonIds(input: {
  activeMenteeMembers: readonly MaybeId[];
  menteeApplicants: readonly MaybeId[];
}): string[] {
  const applicants = new Set<string>();
  for (const raw of input.menteeApplicants) {
    const id = cleanId(raw);
    if (id) applicants.add(id);
  }
  const out = new Set<string>();
  for (const raw of input.activeMenteeMembers) {
    const id = cleanId(raw);
    if (id && !applicants.has(id)) out.add(id);
  }
  return Array.from(out).sort();
}
