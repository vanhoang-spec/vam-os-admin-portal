/**
 * Gia hạn "một nút" (BTC chốt 13/10/2026) — phần thuần, không I/O.
 *
 * Trước ngày này mentor mùa cũ phải rà lại cả hồ sơ, tick từng ô cam kết, gõ lại một
 * câu xác nhận và tick ô đồng ý lưu dữ liệu. BTC nhận phản ánh "mentor cũ chỉ cần nhấn
 * nút gia hạn là được", và còn 144 link chưa ai trả lời. Từ nay:
 *
 *   - một dòng nói rõ bấm nút nghĩa là gì (RENEWAL_ONE_CLICK_NOTICE), rồi một nút;
 *   - hồ sơ mùa trước được giữ nguyên; muốn sửa thì mở phần cập nhật, không bắt buộc;
 *   - thứ duy nhất vẫn hỏi lại là số mentee nhận mùa này, vì đó là cam kết của từng mùa
 *     chứ không phải một con số tự kéo dài (xem RENEWAL_MENTEE_CAPACITY_CHOICES).
 *
 * File này không `server-only`: màn hình và máy chủ phải dùng CHUNG câu chữ và chung
 * cách đổi ngành/chức năng trong hồ sơ sang lựa chọn của form.
 */

/** Dấu trong payload: đơn gia hạn này đi theo lối một nút, không phải lối tick từng ô. */
export const RENEWAL_ONE_CLICK_MODE = "one_click";

/**
 * Đúng câu chữ người bấm nhìn thấy ngay trên nút. Được LƯU cùng đơn gia hạn: đây là
 * bằng chứng duy nhất về điều mentor đã đồng ý, nên đổi chữ ở đây là đổi điều họ đồng ý
 * từ lúc đổi trở đi — các đơn cũ vẫn giữ câu chữ của ngày họ bấm.
 */
export const RENEWAL_ONE_CLICK_NOTICE =
  "Bấm “Gia hạn Season 12” là anh/chị xác nhận tiếp tục tham gia với vai trò mentor trong Season 12, " +
  "đồng ý với các cam kết của mentor liệt kê bên dưới, và đồng ý để VAM lưu trữ, sử dụng thông tin hồ sơ " +
  "của anh/chị cho hoạt động Season 12.";

/** Chữ trên nút. Câu ở trên nhắc đúng chữ này, nên hai hằng số đứng cạnh nhau. */
export const RENEWAL_ONE_CLICK_BUTTON = "Gia hạn Season 12";

/** Cách một đơn gia hạn được đồng ý, đọc từ payload đã lưu. Đơn trước 13/10/2026 không có dấu này. */
export function renewalAcceptanceModeOf(renewalPayload: Record<string, unknown> | null | undefined): string | null {
  const mode = renewalPayload?.acceptance_mode;
  return typeof mode === "string" && mode.trim() !== "" ? mode : null;
}

/**
 * Dòng "Cam kết Mentor" trên bảng gia hạn của BTC.
 *
 * Đơn một nút nói rõ là đồng ý bằng lần bấm: "Đã xác nhận đầy đủ" sẽ khiến người đọc
 * tưởng mentor đã tick từng ô như các đơn trước 13/10/2026.
 */
export function renewalCommitmentSummary(input: {
  commitmentsCompleted: boolean | null;
  acceptanceMode: string | null;
}): { ok: boolean; text: string } | null {
  if (input.commitmentsCompleted === null) return null;
  if (!input.commitmentsCompleted) return { ok: false, text: "Cam kết Mentor: Chưa xác nhận đủ hoặc lỗi dữ liệu" };
  if (input.acceptanceMode === RENEWAL_ONE_CLICK_MODE) {
    return { ok: true, text: "Cam kết Mentor: Đồng ý khi bấm “Gia hạn” (gia hạn một nút)" };
  }
  return { ok: true, text: "Cam kết Mentor: Đã xác nhận đầy đủ" };
}

type Option = { value: string; label: string };

/**
 * Hồ sơ cũ lưu ngành/chức năng khi thì bằng mã lựa chọn, khi thì bằng nhãn tiếng Việt,
 * khi thì bằng chữ tự do của các mùa trước. Trả về mã lựa chọn nếu nhận ra, không thì "".
 *
 * Không đoán: chữ tự do không khớp nhãn nào thì KHÔNG được ép vào một lựa chọn gần giống
 * — nhóm ngành Vòng 2 đọc đúng ô này, đoán sai là xếp mentor nhầm nhóm.
 */
export function profileOptionValue(stored: unknown, options: readonly Option[]): string {
  const text = typeof stored === "string" ? stored.trim() : "";
  if (!text) return "";
  if (options.some((option) => option.value === text)) return text;
  return options.find((option) => option.label === text)?.value ?? "";
}

export type CarryOverProfile = {
  company_current?: unknown;
  title_current?: unknown;
  years_experience_min?: unknown;
  industry?: unknown;
  function_area?: unknown;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function hasValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Chép hồ sơ mùa trước vào những ô mentor KHÔNG tự điền.
 *
 * Vì sao phải chép chứ không để trống: báo cáo tuyển mentor, xếp nhóm ngành Vòng 2 và
 * file xuất đều đọc công ty / chức danh / số năm / ngành / chức năng từ chính đơn gia
 * hạn. Một đơn một nút để trống các ô đó sẽ hiện "không rõ" ở mọi nơi dù hồ sơ có đủ.
 *
 * Ô mentor đã điền thì không bao giờ bị đụng tới. Mỗi ô được chép đều ghi tên vào
 * `filled`, để về sau phân biệt được "mentor khai lại" với "hệ thống giữ nguyên".
 *
 * Giá trị chép sang trùng hồ sơ hiện có, nên bước BTC xác nhận gia hạn không thấy thay
 * đổi nào — đúng nghĩa "gia hạn, giữ nguyên hồ sơ".
 *
 * KHÔNG chép số mentee: form luôn gửi con số mentor chọn (mặc định 1), và đó là cam kết
 * riêng của mùa này.
 */
export function carryOverRenewalProfile(
  payload: Record<string, unknown>,
  profile: CarryOverProfile | null | undefined,
  options: { industries: readonly Option[]; functions: readonly Option[] }
): { payload: Record<string, unknown>; filled: string[] } {
  const next: Record<string, unknown> = { ...payload };
  const filled: string[] = [];
  const fill = (key: string, value: unknown) => {
    if (hasValue(next[key]) || !hasValue(value)) return;
    next[key] = value;
    filled.push(key);
  };

  fill("company_current", text(profile?.company_current));
  fill("title_current", text(profile?.title_current));

  const years = profile?.years_experience_min;
  if (typeof years === "number" && Number.isInteger(years) && years >= 0) {
    fill("mentor_total_work_years", years);
  }

  // Ngành/chức năng chỉ chép khi nhận ra đúng một lựa chọn; "Khác" cần câu ghi rõ mà hồ
  // sơ cũ không có, nên không chép.
  const industry = profileOptionValue(profile?.industry, options.industries);
  if (industry && industry !== "other") fill("industry_primary", industry);
  const functionArea = profileOptionValue(profile?.function_area, options.functions);
  if (functionArea && functionArea !== "other") fill("function_primary", functionArea);

  return { payload: next, filled };
}
