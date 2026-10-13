/** @vitest-environment jsdom */
/**
 * Gia hạn mentor "một nút" (BTC chốt 13/10/2026).
 *
 * Trước ngày này form gia hạn bắt rà lại cả hồ sơ, tick từng ô cam kết, gõ lại một câu xác
 * nhận và tick ô đồng ý lưu dữ liệu. Từ nay: một dòng nói rõ bấm nút nghĩa là gì, rồi một
 * nút. Hồ sơ mùa trước được giữ nguyên; thứ duy nhất vẫn hỏi lại là số mentee nhận mùa này.
 *
 * ---------------------------------------------------------------------------
 * BỘ TEST NÀY CANH ĐIỀU GÌ
 * ---------------------------------------------------------------------------
 * Bỏ ô cam kết khỏi màn hình thì dễ. Ba thứ dễ hỏng theo mà không cổng nào bắt:
 *
 *   1. Đơn gia hạn một nút KHÔNG mang công ty / chức danh / ngành — báo cáo tuyển mentor,
 *      nhóm ngành Vòng 2 và file xuất đều đọc các ô đó từ chính đơn. Máy chủ phải chép từ
 *      hồ sơ đang lưu, và chỉ chép vào ô mentor không tự điền.
 *   2. Một ô `required` còn sót trong phần cập nhật đang đóng sẽ chặn nút mà không hiện lý
 *      do. Form không được có ô bắt buộc nào.
 *   3. Thứ ghi vào đơn phải nói đúng điều đã xảy ra: đồng ý bằng một lần bấm, kèm nguyên
 *      văn câu người bấm nhìn thấy — không phải một loạt ô "đã tick" mà không ai tick.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ ok: false, message: "" }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("@/app/actions/renewals", () => ({ acceptRenewalAction: vi.fn(), declineRenewalAction: vi.fn() }));
vi.mock("@/lib/application-approvals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/application-approvals")>();
  return { ...actual, approveApplication: vi.fn() };
});

import { RenewalForm } from "@/app/renew/[token]/renewal-form";
import { ACTIVE_READING_KEYS, requiredCheckboxAcknowledgements } from "@/lib/application-commitments";
import { validateMaxThreeWithOther, validateSelectionWithOther } from "@/lib/application-form-validation";
import { MENTOR_FUNCTION_OPTIONS, MENTOR_INDUSTRY_OPTIONS, MENTOR_PROGRAM_OPTIONS } from "@/lib/mentor-intake-content";
import { hashRenewalInviteToken, mintRenewalInviteToken, type RenewalInviteRow } from "@/lib/renewal-invite-token";
import {
  carryOverRenewalProfile,
  profileOptionValue,
  renewalAcceptanceModeOf,
  renewalCommitmentSummary,
  RENEWAL_ONE_CLICK_BUTTON,
  RENEWAL_ONE_CLICK_MODE,
  RENEWAL_ONE_CLICK_NOTICE
} from "@/lib/renewal-one-click-core";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh } from "@/lib/renewal-profile-safety";
import {
  RENEWAL_DEFAULT_PROGRAM,
  renewalPayloadFromFormData,
  submitRenewalAccepted,
  validateRenewalAcceptance
} from "@/lib/renewal-runtime";
import {
  RENEWAL_MAX_EXPERIENCE_YEARS,
  RENEWAL_MENTEE_CAPACITY_CHOICES,
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD,
  type RenewalPublicDisplayDto
} from "@/lib/renewal-types";

const ACKS = requiredCheckboxAcknowledgements("mentor");
const OPTIONS = { industries: MENTOR_INDUSTRY_OPTIONS, functions: MENTOR_FUNCTION_OPTIONS };
const EDUCATION = MENTOR_INDUSTRY_OPTIONS.find((option) => option.value === "education")!;
const STRATEGY = MENTOR_FUNCTION_OPTIONS.find((option) => option.value === "strategy_consulting")!;

const form = (values: Record<string, string | string[]> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};
/** Đúng thứ một trình duyệt gửi khi mentor chỉ bấm nút: mỗi con số mentee mặc định. */
const oneClick = (extra: Record<string, string | string[]> = {}) => form({ mentoring_capacity_total: "1", ...extra });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe("1. thứ được ghi vào đơn nói đúng điều đã xảy ra", () => {
  it("ghi cách đồng ý và nguyên văn câu người bấm nhìn thấy", () => {
    const payload = renewalPayloadFromFormData(oneClick());
    expect(payload.acceptance_mode).toBe(RENEWAL_ONE_CLICK_MODE);
    expect(payload.acceptance_notice).toBe(RENEWAL_ONE_CLICK_NOTICE);
    expect(payload.participation_confirmed).toBe(true);
  });

  it("câu thông báo nhắc đúng chữ trên nút, và nói đủ ba điều người bấm đồng ý", () => {
    expect(RENEWAL_ONE_CLICK_NOTICE).toContain(`“${RENEWAL_ONE_CLICK_BUTTON}”`);
    expect(RENEWAL_ONE_CLICK_NOTICE).toContain("tiếp tục tham gia với vai trò mentor trong Season 12");
    expect(RENEWAL_ONE_CLICK_NOTICE).toContain("các cam kết của mentor");
    expect(RENEWAL_ONE_CLICK_NOTICE).toContain("lưu trữ, sử dụng thông tin hồ sơ");
  });

  it("mọi cam kết trong danh mục chuẩn được ghi là đã đồng ý — đúng danh mục, không thừa không thiếu", () => {
    const payload = renewalPayloadFromFormData(oneClick());
    expect(ACKS.length).toBeGreaterThan(0);
    expect(payload.commitments).toEqual(Object.fromEntries(ACKS.map((entry) => [entry.key, true])));
    expect(payload.commitments_completed).toBe(true);
  });

  it("không còn dấu vết của câu xác nhận gõ tay hay ô 'đã rà soát hồ sơ'", () => {
    const payload = renewalPayloadFromFormData(oneClick({
      [ACTIVE_READING_KEYS.mentor]: "gõ gì đó",
      [RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD]: "yes"
    }));
    const keys = Object.keys(payload.commitments as Record<string, unknown>);
    expect(keys.some((key) => key.startsWith(ACTIVE_READING_KEYS.mentor))).toBe(false);
    expect(payload).not.toHaveProperty(RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD);
  });

  it("form không còn hỏi cam kết, nên một ô cam kết gửi kèm (đúng hay sai) không đổi được gì", () => {
    const forged = oneClick({ [ACKS[0].key]: "false", participation_confirmed: "no", consent_data_storage: "no" });
    const payload = renewalPayloadFromFormData(forged);
    expect((payload.commitments as Record<string, unknown>)[ACKS[0].key]).toBe(true);
    expect(payload.participation_confirmed).toBe(true);
    expect(payload).not.toHaveProperty("consent_data_storage");
  });

  it("chỉ bấm nút: đơn không mang ô hồ sơ nào do form gửi", () => {
    const payload = renewalPayloadFromFormData(oneClick());
    for (const key of ["company_current", "title_current", "industry_primary", "function_primary", "mentor_total_work_years",
      "mentor_people_management_years", "university", "programs_willing_to_join", "secondary_industries_functions", "core_team_note"]) {
      expect(payload, key).not.toHaveProperty(key);
    }
    expect(payload.mentoring_capacity_total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("2. cổng của máy chủ: chỉ số mentee là bắt buộc", () => {
  it("chỉ có số mentee là đủ", () => {
    expect(validateRenewalAcceptance(oneClick())).toMatchObject({ ok: true });
  });

  it.each(RENEWAL_MENTEE_CAPACITY_CHOICES.map(String))("nhận số mentee %s", (value) => {
    const result = validateRenewalAcceptance(form({ mentoring_capacity_total: value }));
    expect(result).toMatchObject({ ok: true, payload: { mentoring_capacity_total: Number(value) } });
  });

  it.each([["thiếu hẳn", {}], ["0", { mentoring_capacity_total: "0" }], ["4", { mentoring_capacity_total: "4" }],
    ["chữ", { mentoring_capacity_total: "abc" }], ["1.5", { mentoring_capacity_total: "1.5" }]] as const)(
    "số mentee %s bị từ chối", (_label, values) => {
      const result = validateRenewalAcceptance(form(values as Record<string, string>));
      expect(result).toEqual({ ok: false, message: "Vui lòng chọn số mentee có thể đồng hành: 1, 2, 3." });
    });

  it.each(["company_current", "title_current", "industry_primary", "function_primary", "mentor_total_work_years",
    "mentor_people_management_years", "university", "mentoring_topics"])("ô %s để trống không còn bị từ chối", (key) => {
    expect(validateRenewalAcceptance(oneClick({ [key]: "   " }))).toMatchObject({ ok: true });
  });

  it("không tick cam kết nào, không gõ câu xác nhận, không tick đồng ý lưu dữ liệu: vẫn được", () => {
    // Trước 13/10 mỗi thứ này là một lý do từ chối riêng. Giờ form không còn hỏi.
    const result = validateRenewalAcceptance(oneClick());
    expect(result.ok).toBe(true);
  });
});

describe("3. ô hồ sơ không bắt buộc, nhưng đã gửi thì phải hợp lệ", () => {
  const refused = (values: Record<string, string | string[]>) => {
    const result = validateRenewalAcceptance(oneClick(values));
    return result.ok ? null : result.message;
  };

  it("ngành / chức năng chính phải là lựa chọn có thật", () => {
    expect(refused({ industry_primary: "nganh_tu_bia" })).toBe("Vui lòng chọn ngành nghề chính hợp lệ.");
    expect(refused({ function_primary: "chuc_nang_tu_bia" })).toBe("Vui lòng chọn chức năng/chuyên môn chính hợp lệ.");
    expect(refused({ industry_primary: "education", function_primary: "strategy_consulting" })).toBeNull();
  });

  it("'Khác' phải ghi rõ; không chọn 'Khác' thì câu ghi rõ còn sót bị bỏ", () => {
    expect(refused({ industry_primary: "other" })).toBe("Vui lòng ghi rõ ngành nghề chính khác.");
    expect(refused({ function_primary: "other", function_primary_other: "   " })).toBe("Vui lòng ghi rõ chức năng/chuyên môn chính khác.");

    const kept = validateRenewalAcceptance(oneClick({ industry_primary: "other", industry_primary_other: "  Nông nghiệp  " }));
    expect(kept).toMatchObject({ ok: true, payload: { industry_primary_other: "Nông nghiệp" } });

    const dropped = validateRenewalAcceptance(oneClick({ industry_primary: "education", industry_primary_other: "sót lại", function_primary_other: "sót lại" }));
    expect(dropped.ok && dropped.payload).not.toHaveProperty("industry_primary_other");
    expect(dropped.ok && dropped.payload).not.toHaveProperty("function_primary_other");

    // Không chọn ngành / chức năng nào cả mà vẫn gửi câu ghi rõ: cả hai câu đều bị bỏ.
    const orphan = validateRenewalAcceptance(oneClick({ industry_primary_other: "mồ côi", function_primary_other: "mồ côi" }));
    expect(orphan.ok).toBe(true);
    expect(orphan.ok && orphan.payload).not.toHaveProperty("industry_primary_other");
    expect(orphan.ok && orphan.payload).not.toHaveProperty("function_primary_other");
  });

  it.each([String(RENEWAL_MAX_EXPERIENCE_YEARS + 1), "-1", "2.5", "abc"])("số năm kinh nghiệm %s bị từ chối", (value) => {
    expect(refused({ mentor_total_work_years: value })).toBe(`Số năm kinh nghiệm phải là số nguyên từ 0 đến ${RENEWAL_MAX_EXPERIENCE_YEARS}.`);
  });

  it.each(["0", "21", "35", String(RENEWAL_MAX_EXPERIENCE_YEARS)])("số năm kinh nghiệm %s được nhận", (value) => {
    expect(refused({ mentor_total_work_years: value })).toBeNull();
  });

  it("số năm quản lý không vượt số năm kinh nghiệm khi cả hai cùng được gửi", () => {
    expect(refused({ mentor_total_work_years: "10", mentor_people_management_years: "11" })).toBe("Số năm kinh nghiệm quản lý phải là số nguyên từ 0 đến 10.");
    expect(refused({ mentor_total_work_years: "10", mentor_people_management_years: "10" })).toBeNull();
  });

  it("chỉ gửi số năm quản lý: còn trần chung, vẫn chặn số vô lý", () => {
    expect(refused({ mentor_people_management_years: "30" })).toBeNull();
    expect(refused({ mentor_people_management_years: String(RENEWAL_MAX_EXPERIENCE_YEARS + 1) }))
      .toBe(`Số năm kinh nghiệm quản lý phải là số nguyên từ 0 đến ${RENEWAL_MAX_EXPERIENCE_YEARS}.`);
    expect(refused({ mentor_people_management_years: "-2" })).not.toBeNull();
  });

  it("chủ đề mentoring vẫn giới hạn 2.000 ký tự", () => {
    expect(refused({ mentoring_topics: "a".repeat(2001) })).toBe("Chủ đề mentoring không được vượt quá 2.000 ký tự.");
    expect(refused({ mentoring_topics: "a".repeat(2000) })).toBeNull();
  });

  it("trường đại học: lựa chọn có thật, 'trường khác' phải có tên", () => {
    expect(refused({ university: "HARVARD" })).toBe("Vui lòng chọn trường đại học đã tốt nghiệp.");
    expect(refused({ university: "OTHER" })).toBe("Vui lòng nhập tên trường đại học.");
    expect(refused({ university: "OTHER", university_other: "ĐH Ngoại thương" })).toBeNull();
    const ueh = validateRenewalAcceptance(oneClick({ university: "UEH", university_other: "sót lại" }));
    expect(ueh.ok && ueh.payload).not.toHaveProperty("university_other");
  });

  it("chương trình: bỏ trống được, nhưng không nhận chương trình không có thật", () => {
    expect(refused({ programs_willing_to_join: ["UEHM", "KHONG_CO"] })).toBe("Vui lòng chọn chương trình sẵn sàng tham gia hợp lệ.");
    expect(refused({ programs_willing_to_join: ["UEHM", "HAM"] })).toBeNull();
  });
});

describe("4. ngành / chức năng phụ không còn trần 3", () => {
  const five = ["fmcg", "education", "marketing", "data_analytics", "product"];

  it("các giá trị dùng trong ca này đều là lựa chọn có thật", () => {
    const all = new Set([...MENTOR_INDUSTRY_OPTIONS, ...MENTOR_FUNCTION_OPTIONS].map((option) => option.value));
    expect(five.every((value) => all.has(value))).toBe(true);
  });

  it("form gia hạn nhận năm lựa chọn và giữ nguyên cả năm", () => {
    const result = validateRenewalAcceptance(oneClick({ secondary_industries_functions: five }));
    expect(result).toMatchObject({ ok: true, payload: { secondary_industries_functions: five } });
  });

  it("vẫn từ chối lựa chọn không có thật, và 'Khác' mà không ghi rõ", () => {
    const unknown = validateRenewalAcceptance(oneClick({ secondary_industries_functions: ["fmcg", "tu_bia"] }));
    expect(unknown).toEqual({ ok: false, message: "Vui lòng chọn ngành/chức năng phụ hợp lệ." });
    const other = validateRenewalAcceptance(oneClick({ secondary_industries_functions: ["fmcg", "other"] }));
    expect(other.ok).toBe(false);
    expect(!other.ok && other.message).toContain("Ngành / chức năng phụ:");
  });

  it("luật dùng chung: không truyền trần thì không có trần; truyền trần thì đúng trần đó", () => {
    const base = { otherText: "", fieldName: "x", fieldLabel: "X" };
    const ten = Array.from({ length: 10 }, (_, i) => `v${i}`);
    expect(validateSelectionWithOther({ ...base, values: ten })).toEqual({ ok: true });
    expect(validateSelectionWithOther({ ...base, values: ten, max: 10 })).toEqual({ ok: true });
    expect(validateSelectionWithOther({ ...base, values: ten, max: 9 })).toMatchObject({ ok: false, message: "Bạn chỉ có thể chọn tối đa 9 lựa chọn." });
  });

  it("các nhóm khác vẫn giữ trần 3 (soft skills của mentee)", () => {
    const base = { otherText: "", fieldName: "target_soft_skills", fieldLabel: "Soft skills" };
    expect(validateMaxThreeWithOther({ ...base, values: ["a", "b", "c"] })).toEqual({ ok: true });
    expect(validateMaxThreeWithOther({ ...base, values: ["a", "b", "c", "d"] })).toMatchObject({ ok: false, message: "Bạn chỉ có thể chọn tối đa 3 lựa chọn." });
  });

  it("form đăng ký mentor mới: ô ngành phụ không còn trần ở màn hình lẫn máy chủ; form mentee giữ nguyên", () => {
    const mentorForm = readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    const menteeForm = readFileSync("app/apply/mentee/apply-mentee-form.tsx", "utf8");
    const action = readFileSync("app/actions/apply.ts", "utf8");
    // Soi đúng khối của ô đó, không tìm chung cả file.
    const block = mentorForm.slice(mentorForm.indexOf('name="secondary_industries_functions"'));
    const field = block.slice(0, block.indexOf("/>"));
    expect(field).not.toContain("maxSelections");
    expect(field).not.toContain("tối đa 3");
    expect(action).toMatch(/const secondaryValidation = validateSelectionWithOther\(\{\s+values: rawPayload\.secondary_industries_functions/);
    expect(action).toMatch(/const softSkillValidation = validateMaxThreeWithOther\(/);
    expect(menteeForm).toContain("maxSelections={3}");
  });
});

// ---------------------------------------------------------------------------
describe("5. chép hồ sơ mùa trước — phần thuần", () => {
  const profile = { company_current: " Công ty A ", title_current: "Giám đốc", years_experience_min: 12, industry: "education", function_area: STRATEGY.label };

  it("nhận ra mã lựa chọn và nhãn; chữ tự do thì không đoán", () => {
    expect(profileOptionValue("education", MENTOR_INDUSTRY_OPTIONS)).toBe("education");
    expect(profileOptionValue(EDUCATION.label, MENTOR_INDUSTRY_OPTIONS)).toBe("education");
    expect(profileOptionValue(`  ${EDUCATION.label}  `, MENTOR_INDUSTRY_OPTIONS)).toBe("education");
    expect(profileOptionValue("Giáo dục gì đó gần giống", MENTOR_INDUSTRY_OPTIONS)).toBe("");
    expect(profileOptionValue(null, MENTOR_INDUSTRY_OPTIONS)).toBe("");
    expect(profileOptionValue("", MENTOR_INDUSTRY_OPTIONS)).toBe("");
  });

  it("đơn một nút: chép đủ năm ô và ghi tên từng ô đã chép", () => {
    const { payload, filled } = carryOverRenewalProfile({ mentoring_capacity_total: 1 }, profile, OPTIONS);
    expect(payload).toEqual({
      mentoring_capacity_total: 1,
      company_current: "Công ty A",
      title_current: "Giám đốc",
      mentor_total_work_years: 12,
      industry_primary: "education",
      function_primary: "strategy_consulting"
    });
    expect(filled).toEqual(["company_current", "title_current", "mentor_total_work_years", "industry_primary", "function_primary"]);
  });

  it("ô mentor đã điền thì không bị đụng tới và không nằm trong danh sách đã chép", () => {
    const { payload, filled } = carryOverRenewalProfile(
      { company_current: "Công ty MỚI", mentor_total_work_years: 0, industry_primary: "fmcg" }, profile, OPTIONS);
    expect(payload.company_current).toBe("Công ty MỚI");
    // 0 năm là một câu trả lời, không phải ô trống.
    expect(payload.mentor_total_work_years).toBe(0);
    expect(payload.industry_primary).toBe("fmcg");
    expect(filled).toEqual(["title_current", "function_primary"]);
  });

  it("không bao giờ chép số mentee: đó là cam kết của từng mùa", () => {
    const { payload, filled } = carryOverRenewalProfile({}, { ...profile, capacity_target: 3 } as never, OPTIONS);
    expect(payload).not.toHaveProperty("mentoring_capacity_total");
    expect(filled).not.toContain("mentoring_capacity_total");
  });

  it("ngành chữ tự do, ngành 'Khác', số năm không phải số nguyên: không chép", () => {
    const { payload, filled } = carryOverRenewalProfile({}, {
      company_current: "   ", title_current: null, years_experience_min: 7.5, industry: "Ngành ghi tay mùa 9", function_area: "other"
    }, OPTIONS);
    expect(payload).toEqual({});
    expect(filled).toEqual([]);
  });

  it("không sửa payload truyền vào — kể cả khi có ô được chép", () => {
    // Payload truyền vào là kết quả đã kiểm của cổng; chép thẳng vào nó thì lần gọi
    // sau (thử lại, ghi log) nhìn thấy một payload không còn là thứ mentor gửi.
    const original = { mentoring_capacity_total: 2 };
    const result = carryOverRenewalProfile(original, profile, OPTIONS);
    expect(result.filled.length).toBeGreaterThan(0);
    expect(original).toEqual({ mentoring_capacity_total: 2 });
    expect(result.payload).not.toBe(original);
  });

  it("hồ sơ rỗng không làm hỏng gì", () => {
    expect(carryOverRenewalProfile({ mentoring_capacity_total: 2 }, null, OPTIONS))
      .toEqual({ payload: { mentoring_capacity_total: 2 }, filled: [] });
  });

  it("giá trị chép sang trùng hồ sơ: BTC xác nhận gia hạn không thấy thay đổi nào", () => {
    const stored = { company_current: "Công ty A", title_current: "Giám đốc", years_experience_min: 12, industry: "education", function_area: "strategy_consulting", capacity_target: 1 };
    const { payload } = carryOverRenewalProfile({ mentoring_capacity_total: 1 }, stored, OPTIONS);
    expect(buildRenewalProfileDiff(stored, buildRenewalProfileRefresh(payload))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("6. gửi đơn: hồ sơ đi cùng, đúng người của lời mời", () => {
  const IDS = { invite: "00000000-0000-4000-8000-000000000001", person: "00000000-0000-4000-8000-000000000002",
    program: "00000000-0000-4000-8000-000000000003", season: "00000000-0000-4000-8000-000000000004" };
  const PERSON = { id: IDS.person, full_name: "Mentor Cũ", email_primary: "m@example.com", phone_primary: "0900000000" };
  const PROFILE = { id: "p", person_id: IDS.person, mentor_code: "M01", company_current: "Công ty A", title_current: "Giám đốc",
    years_experience_min: 12, years_experience_text: null, capacity_target: 3, industry: EDUCATION.label, function_area: "strategy_consulting" };

  function invite(token: string): RenewalInviteRow {
    return { id: IDS.invite, token_hash: hashRenewalInviteToken(token), person_id: IDS.person, program_id: IDS.program,
      season_id: IDS.season, role: "mentor", expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null, submitted_at: null,
      outcome: null, application_id: null };
  }
  function fakeClient(token: string, tables: { profile?: unknown; person?: unknown; profileError?: boolean } = {}) {
    const lookups: Array<{ table: string; column: string; value: unknown }> = [];
    const from = vi.fn((table: string) => {
      const chain: Record<string, any> = {};
      for (const method of ["select", "order", "limit", "in"]) chain[method] = vi.fn(() => chain);
      chain.eq = vi.fn((column: string, value: unknown) => { lookups.push({ table, column, value }); return chain; });
      chain.maybeSingle = vi.fn(async () => {
        if (table === "person_season_invites") return { data: invite(token), error: null };
        if (table === "people") return { data: "person" in tables ? tables.person : PERSON, error: null };
        if (table === "mentor_profiles") {
          if (tables.profileError) return { data: null, error: { code: "XX000" } };
          return { data: "profile" in tables ? tables.profile : PROFILE, error: null };
        }
        return { data: null, error: null };
      });
      return chain;
    });
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: [{ outcome_status: "accepted" }], error: null }));
    return { from, rpc, lookups };
  }
  const sentPayload = (client: ReturnType<typeof fakeClient>) => client.rpc.mock.calls[0][1].p_raw_payload as Record<string, unknown>;

  it("chỉ bấm nút: đơn mang hồ sơ đang lưu, ghi rõ ô nào do hệ thống điền", async () => {
    const { token, tokenHash } = mintRenewalInviteToken();
    const client = fakeClient(token);

    const result = await submitRenewalAccepted(token, oneClick(), client as never);

    expect(result).toMatchObject({ ok: true, outcome: "accepted" });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0][0]).toBe("vam071_submit_renewal_accepted");
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_token_hash: tokenHash, p_consent_data_storage: true });
    expect(sentPayload(client)).toEqual({
      participation_confirmed: true,
      acceptance_mode: RENEWAL_ONE_CLICK_MODE,
      acceptance_notice: RENEWAL_ONE_CLICK_NOTICE,
      commitments: Object.fromEntries(ACKS.map((entry) => [entry.key, true])),
      commitments_completed: true,
      mentoring_capacity_total: 1,
      company_current: "Công ty A",
      title_current: "Giám đốc",
      mentor_total_work_years: 12,
      industry_primary: "education",
      function_primary: "strategy_consulting",
      programs_willing_to_join: [RENEWAL_DEFAULT_PROGRAM],
      system_filled_fields: ["company_current", "title_current", "mentor_total_work_years", "industry_primary", "function_primary", "programs_willing_to_join"]
    });
  });

  it("hồ sơ được đọc theo người của chính lời mời, không theo thứ gì trong form", async () => {
    const { token } = mintRenewalInviteToken();
    const client = fakeClient(token);
    await submitRenewalAccepted(token, oneClick({ person_id: "ke-khac", id: "ke-khac" }), client as never);

    const profileLookups = client.lookups.filter((lookup) => lookup.table === "mentor_profiles" || lookup.table === "people");
    expect(profileLookups.length).toBeGreaterThan(0);
    expect(profileLookups.every((lookup) => lookup.value === IDS.person)).toBe(true);
    expect(JSON.stringify(sentPayload(client))).not.toContain("ke-khac");
  });

  it("số mentee là con số mentor chọn, không phải con số mùa trước trong hồ sơ", async () => {
    const { token } = mintRenewalInviteToken();
    const client = fakeClient(token);
    await submitRenewalAccepted(token, oneClick({ mentoring_capacity_total: "2" }), client as never);
    expect(PROFILE.capacity_target).toBe(3);
    expect(sentPayload(client).mentoring_capacity_total).toBe(2);
  });

  it("ô mentor tự cập nhật thắng hồ sơ cũ, và không bị ghi là 'hệ thống điền'", async () => {
    const { token } = mintRenewalInviteToken();
    const client = fakeClient(token);
    await submitRenewalAccepted(token, oneClick({ company_current: "Công ty MỚI", programs_willing_to_join: ["UEHM", "HAM"] }), client as never);

    const payload = sentPayload(client);
    expect(payload.company_current).toBe("Công ty MỚI");
    expect(payload.programs_willing_to_join).toEqual(["UEHM", "HAM"]);
    expect(payload.system_filled_fields).toEqual(["title_current", "mentor_total_work_years", "industry_primary", "function_primary"]);
  });

  it("chương trình mặc định là chương trình có thật trong danh sách", () => {
    expect(MENTOR_PROGRAM_OPTIONS.map((option) => option.value)).toContain(RENEWAL_DEFAULT_PROGRAM);
  });

  it.each([["không có hồ sơ mentor", { profile: null }], ["đọc hồ sơ lỗi", { profileError: true }], ["không có hồ sơ người", { person: null }]] as const)(
    "%s: dừng trước khi ghi, lời mời còn nguyên", async (_label, tables) => {
      const { token } = mintRenewalInviteToken();
      const client = fakeClient(token, tables as never);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await submitRenewalAccepted(token, oneClick(), client as never);

      expect(result.ok).toBe(false);
      expect(client.rpc).not.toHaveBeenCalled();
    });

  it("thiếu số mentee: không đụng tới lời mời, không đọc hồ sơ, không ghi", async () => {
    const { token } = mintRenewalInviteToken();
    const client = fakeClient(token);
    const result = await submitRenewalAccepted(token, form({}), client as never);
    expect(result).toEqual({ ok: false, message: "Vui lòng chọn số mentee có thể đồng hành: 1, 2, 3." });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("8. bảng gia hạn của BTC nói đúng cách mentor đã đồng ý", () => {
  it("đọc cách đồng ý từ đơn đã lưu; đơn trước 13/10 không có dấu này", () => {
    expect(renewalAcceptanceModeOf(renewalPayloadFromFormData(oneClick()))).toBe(RENEWAL_ONE_CLICK_MODE);
    expect(renewalAcceptanceModeOf({ commitments_completed: true })).toBeNull();
    expect(renewalAcceptanceModeOf({ acceptance_mode: "  " })).toBeNull();
    expect(renewalAcceptanceModeOf({ acceptance_mode: 1 })).toBeNull();
    expect(renewalAcceptanceModeOf(null)).toBeNull();
  });

  it("đơn một nút: không hiện như thể mentor đã tick từng ô", () => {
    const line = renewalCommitmentSummary({ commitmentsCompleted: true, acceptanceMode: RENEWAL_ONE_CLICK_MODE });
    expect(line).toEqual({ ok: true, text: "Cam kết Mentor: Đồng ý khi bấm “Gia hạn” (gia hạn một nút)" });
  });

  it("đơn tick tay trước 13/10 giữ nguyên câu cũ; thiếu cam kết vẫn báo đỏ; không có dữ liệu thì không hiện gì", () => {
    expect(renewalCommitmentSummary({ commitmentsCompleted: true, acceptanceMode: null }))
      .toEqual({ ok: true, text: "Cam kết Mentor: Đã xác nhận đầy đủ" });
    expect(renewalCommitmentSummary({ commitmentsCompleted: false, acceptanceMode: null }))
      .toEqual({ ok: false, text: "Cam kết Mentor: Chưa xác nhận đủ hoặc lỗi dữ liệu" });
    // Thiếu cam kết thì cách đồng ý không cứu được dòng đó.
    expect(renewalCommitmentSummary({ commitmentsCompleted: false, acceptanceMode: RENEWAL_ONE_CLICK_MODE })?.ok).toBe(false);
    expect(renewalCommitmentSummary({ commitmentsCompleted: null, acceptanceMode: RENEWAL_ONE_CLICK_MODE })).toBeNull();
  });

  it("trang và bảng dữ liệu đi qua đúng hai hàm đó, không tự viết lại câu chữ", () => {
    const page = readFileSync("app/admin/renewals/page.tsx", "utf8");
    const consoleData = readFileSync("lib/renewal-console.ts", "utf8");
    expect(page).toContain("renewalCommitmentSummary(row)");
    expect(page).toContain("<CommitmentLine row={row} />");
    expect(page).not.toContain("Đã xác nhận đầy đủ");
    expect(consoleData).toContain("acceptanceMode: renewalAcceptanceModeOf(renewal),");
  });
});

// ---------------------------------------------------------------------------
describe("7. màn hình: một dòng, một nút", () => {
  const EMPTY: RenewalPublicDisplayDto = { fullName: "Mentor Thử Nghiệm", emailPrimary: null, phonePrimary: null, mentorCode: null,
    firstVamSeason: null, companyCurrent: null, titleCurrent: null, yearsExperienceMin: null, yearsExperienceText: null,
    capacityTarget: null, industry: null, functionArea: null };
  const STORED: RenewalPublicDisplayDto = { ...EMPTY, companyCurrent: "Công ty Thử Nghiệm", titleCurrent: "Giám đốc",
    yearsExperienceMin: 22, capacityTarget: 3, industry: "education", functionArea: STRATEGY.label };

  function renderForm(display: RenewalPublicDisplayDto = STORED) {
    const view = render(<RenewalForm token="token-thu-nghiem" display={display} />);
    const button = screen.getByRole("button", { name: RENEWAL_ONE_CLICK_BUTTON });
    return { ...view, button, accept: button.closest("form") as HTMLFormElement };
  }
  const entries = (accept: HTMLFormElement) => Array.from(new FormData(accept).entries()).map(([key, value]) => [key, String(value)]);
  const openUpdate = () => fireEvent.click(screen.getByRole("button", { name: /Cập nhật hồ sơ hoặc nhắn Ban Tổ chức/ }));
  const control = <T extends HTMLElement = HTMLInputElement>(accept: HTMLFormElement, name: string) => accept.querySelector(`[name="${name}"]`) as T | null;

  it("chưa đụng gì: form chỉ gửi đúng một thứ — số mentee, mặc định 1", () => {
    const { accept } = renderForm();
    expect(entries(accept)).toEqual([["mentoring_capacity_total", "1"]]);
  });

  it("không có ô bắt buộc nào, nên nút không bao giờ bị chặn âm thầm", () => {
    const { accept } = renderForm(EMPTY);
    expect(accept.querySelectorAll("[required]")).toHaveLength(0);
    expect(accept.checkValidity()).toBe(true);
    openUpdate();
    expect(accept.querySelectorAll("[required]")).toHaveLength(0);
    expect(accept.checkValidity()).toBe(true);
  });

  it("câu thông báo là đúng câu được lưu vào đơn, nằm trong form và đứng ngay trước nút", () => {
    const { accept, button } = renderForm();
    const notice = within(accept).getByTestId("renewal-notice");
    expect(notice.textContent).toBe(RENEWAL_ONE_CLICK_NOTICE);
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Giữa câu thông báo và nút không có ô nhập nào chen vào.
    const controls = Array.from(accept.querySelectorAll("input, select, textarea, button"));
    const between = controls.filter((node) =>
      (notice.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) && (node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING));
    expect(between).toEqual([]);
  });

  it("không còn ô tick cam kết, câu xác nhận gõ tay, ô đồng ý lưu dữ liệu hay ô 'đã rà soát'", () => {
    const { accept } = renderForm();
    for (const name of [...ACKS.map((entry) => entry.key), ACTIVE_READING_KEYS.mentor, "consent_data_storage",
      "participation_confirmed", RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD]) {
      expect(control(accept, name), name).toBeNull();
    }
    expect(accept.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("mọi cam kết trong danh mục chuẩn đều đọc được ngay trong form, đúng nguyên văn", () => {
    const { accept } = renderForm();
    const list = within(accept).getByTestId("renewal-commitments");
    const shown = Array.from(list.querySelectorAll("li")).map((item) => [item.getAttribute("data-commitment"), item.textContent]);
    expect(shown).toEqual(ACKS.map((entry) => [entry.key, entry.wording]));
    expect(list.textContent).toContain(`${ACKS.length} điều`);
  });

  it("số mentee: ba lựa chọn, luôn mở ở 1; con số mùa trước chỉ để tham khảo", () => {
    const { accept } = renderForm(STORED);
    const radios = Array.from(accept.querySelectorAll<HTMLInputElement>('input[name="mentoring_capacity_total"]'));
    expect(radios.map((radio) => radio.value)).toEqual(RENEWAL_MENTEE_CAPACITY_CHOICES.map(String));
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["1"]);
    expect(within(accept).getByTestId("renewal-capacity").textContent).toContain("Mùa trước: 3 mentee");

    fireEvent.click(radios[2]);
    expect(entries(accept)).toEqual([["mentoring_capacity_total", "3"]]);
  });

  it("hồ sơ đang lưu hiện ra để mentor biết cái gì được giữ nguyên — mã ngành hiện bằng nhãn", () => {
    renderForm(STORED);
    const current = screen.getByTestId("renewal-current-profile").textContent ?? "";
    expect(current).toContain("Công ty Thử Nghiệm");
    expect(current).toContain("Giám đốc");
    expect(current).toContain(EDUCATION.label);
    expect(current).not.toContain("Ngành nghề chính: education");
    expect(current).toContain(STRATEGY.label);
  });

  it("phần cập nhật hồ sơ chỉ nằm trong form khi mentor mở nó, và mở ra thì điền sẵn hồ sơ đang lưu", () => {
    const { accept } = renderForm(STORED);
    expect(screen.queryByTestId("renewal-profile-update")).toBeNull();
    expect(control(accept, "company_current")).toBeNull();

    openUpdate();

    expect(control(accept, "company_current")?.value).toBe("Công ty Thử Nghiệm");
    expect(control(accept, "title_current")?.value).toBe("Giám đốc");
    expect(control(accept, "mentor_total_work_years")?.value).toBe("22");
    expect(control<HTMLSelectElement>(accept, "industry_primary")?.value).toBe("education");
    // Hồ sơ lưu chức năng bằng NHÃN; ô chọn vẫn mở đúng lựa chọn đó.
    expect(control<HTMLSelectElement>(accept, "function_primary")?.value).toBe("strategy_consulting");
  });

  it("đóng phần cập nhật là gỡ khỏi form: ô đã gõ dở không lặng lẽ đi theo lần bấm Gia hạn", () => {
    const { accept } = renderForm(STORED);
    openUpdate();
    fireEvent.change(control(accept, "company_current") as HTMLInputElement, { target: { value: "Gõ dở rồi đổi ý" } });
    expect(entries(accept)).toContainEqual(["company_current", "Gõ dở rồi đổi ý"]);

    fireEvent.click(screen.getByRole("button", { name: "Bỏ cập nhật, giữ nguyên hồ sơ" }));

    expect(entries(accept)).toEqual([["mentoring_capacity_total", "1"]]);
    // Mở lại thì về đúng hồ sơ đang lưu, không phải chữ gõ dở.
    openUpdate();
    expect(control(accept, "company_current")?.value).toBe("Công ty Thử Nghiệm");
  });

  it("ngành / chức năng phụ: tick năm ô được cả năm, không còn bộ đếm hay lời chặn 'tối đa 3'", () => {
    const { accept } = renderForm(EMPTY);
    openUpdate();
    const five = ["fmcg", "education", "marketing", "data_analytics", "product"];
    for (const value of five) {
      fireEvent.click(accept.querySelector(`input[name="secondary_industries_functions"][value="${value}"]`) as HTMLInputElement);
    }
    expect(new FormData(accept).getAll("secondary_industries_functions")).toEqual(five);
    expect(accept.textContent).not.toMatch(/\d\/3 đã chọn/);
    expect(accept.textContent).not.toContain("tối đa 3");
  });

  it("form 'Không tiếp tục' vẫn là một form riêng, không dính vào nút Gia hạn", () => {
    const { accept } = renderForm();
    const decline = screen.getByRole("button", { name: "Xác nhận không tiếp tục" }).closest("form") as HTMLFormElement;
    expect(decline).not.toBe(accept);
    expect(decline.querySelector('[name="decline_feedback"]')).not.toBeNull();
    expect(accept.querySelector('[name="decline_feedback"]')).toBeNull();
  });
});
