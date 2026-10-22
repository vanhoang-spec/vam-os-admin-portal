/**
 * Hồ sơ tóm tắt gửi kèm thư kết quả ghép cặp — phần thuần (BTC 22/10/2026).
 *
 * Điều phải đúng:
 *   - đủ 15 trường mentee / 13 trường mentor, ĐÚNG thứ tự và nhãn BTC chốt;
 *   - trường không có dữ liệu thì ẩn (không in dòng trống, không in "null");
 *   - thẻ chỉ đọc khoá trong danh sách cho phép: MSSV, GPA, năm sinh, giới tính, SĐT/email trong
 *     đơn, ghi chú gửi BTC (core_team_note của đơn gia hạn) KHÔNG BAO GIỜ lọt ra;
 *   - SĐT/email chỉ có khi nơi gọi đưa khối liên hệ vào;
 *   - người mùa cũ và mùa mới cùng một định dạng: đơn gia hạn → mentor_profiles → đơn mùa trước.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MENTEE_PROFILE_LABELS,
  MENTOR_PROFILE_LABELS,
  MENTEE_PAYLOAD_KEYS,
  MENTOR_PAYLOAD_KEYS,
  groupTag,
  latestDesiredMentorProfile,
  menteeProfileCard,
  mentorProfileCard,
  payloadFromProjectedRow,
  profileLinkUrl,
  profilePayloadProjection,
  schoolLine,
  yearsOfExperienceText,
  type ProfileCard
} from "@/lib/match-profile-core";
import {
  bearerTokenHashEquals,
  hashBearerToken,
  isCanonicalBearerToken,
  mintBearerToken,
  safeHashBearerToken
} from "@/lib/bearer-token";

const CONTACT = { phone: "0901 234 567", email: "ban.mentee@example.test" };

// Mọi thứ KHÔNG được lọt ra thẻ, nhồi sẵn vào payload để soi.
const PRIVATE = {
  mssv: "31241020623",
  gpa_4: "3.92",
  year_of_birth: "2005",
  gender: "female",
  email_primary: "payload-email@example.test",
  phone_primary: "0999999999",
  social_contact: "fb.com/riengtu",
  additional_notes: "ghi chú gửi BTC",
  core_team_note: "MENTOR NHẮN RIÊNG BTC",
  mentor_reference: "người giới thiệu kín",
  commitment_understanding: true
};
const PRIVATE_VALUES = Object.values(PRIVATE).filter((v) => typeof v === "string") as string[];

const MENTEE_PAYLOAD = {
  university: "UEH",
  year_of_study: "3",
  school_or_faculty: "marketing",
  major: "Marketing số",
  target_industry: "other",
  target_industry_other: "Truyền thông sáng tạo",
  target_function: "tech",
  profile_or_cv_url: "https://drive.example.test/cv.pdf",
  mentoring_goals_text: "Định hướng nghề.\nLàm CV tốt hơn.",
  current_difficulty_text: "Chưa biết chọn ngành.",
  mentor_reason_text: "Cần người đi trước.",
  mentor_expectation_text: "Thẳng thắn, lắng nghe.",
  top_3_questions_for_mentor: "1. ... 2. ... 3. ...",
  one_year_vision_text: "Đi thực tập ở agency.",
  ...PRIVATE
};

const labelsOf = (card: ProfileCard) => card.fields.map((f) => f.label);
const valuesOf = (card: ProfileCard) => card.fields.map((f) => f.value).join(" | ");

describe("hồ sơ mentee", () => {
  it("đủ 15 trường, đúng thứ tự và nhãn BTC khi có đủ dữ liệu và có khối liên hệ", () => {
    const card = menteeProfileCard({
      fullName: "Nguyễn Thị Như Quyên",
      groupCode: 4,
      contact: CONTACT,
      payload: MENTEE_PAYLOAD,
      menteeProfile: null,
      desiredMentorProfile: "Mentor nữ ngành Marketing, kiên nhẫn."
    });
    expect(labelsOf(card)).toEqual(MENTEE_PROFILE_LABELS.map(([, label]) => label));
    const by = Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
    expect(by.group).toBe("Marketing - Kinh doanh");
    expect(by.phone).toBe(CONTACT.phone);
    expect(by.email).toBe(CONTACT.email);
    expect(by.school).toBe("Đại học Kinh tế TP. Hồ Chí Minh (UEH) / Năm 3 / Marketing / Marketing số");
    expect(by.target_industry).toBe("Khác: Truyền thông sáng tạo");
    expect(by.desired_mentor_profile).toBe("Mentor nữ ngành Marketing, kiên nhẫn.");
    // Xuống dòng của câu tự luận được giữ nguyên để trang hiện đúng đoạn.
    expect(by.mentoring_goals_text).toBe("Định hướng nghề.\nLàm CV tốt hơn.");
    expect(card.fields.find((f) => f.key === "profile_or_cv_url")?.links).toEqual([
      { kind: "link", value: "https://drive.example.test/cv.pdf", href: "https://drive.example.test/cv.pdf" }
    ]);
  });

  it("KHÔNG có khối liên hệ thì không có dòng SĐT/email — kể cả khi đơn có email/SĐT", () => {
    const card = menteeProfileCard({ fullName: "A", groupCode: 4, contact: null, payload: MENTEE_PAYLOAD, menteeProfile: null, desiredMentorProfile: null });
    expect(card.fields.map((f) => f.key)).not.toContain("phone");
    expect(card.fields.map((f) => f.key)).not.toContain("email");
  });

  it("không bao giờ lộ MSSV, GPA, năm sinh, giới tính, SĐT/email trong đơn, ghi chú gửi BTC", () => {
    const card = menteeProfileCard({ fullName: "A", groupCode: 4, contact: CONTACT, payload: MENTEE_PAYLOAD, menteeProfile: null, desiredMentorProfile: null });
    const all = valuesOf(card);
    for (const secret of PRIVATE_VALUES) expect(all, secret).not.toContain(secret);
    // Khối liên hệ là nguồn DUY NHẤT của SĐT/email.
    expect(all).toContain(CONTACT.email);
  });

  it("trường trống thì ẩn; chữ 'null' do nhập liệu hỏng cũng coi là trống", () => {
    const card = menteeProfileCard({
      fullName: "Bạn đặc cách",
      groupCode: null,
      contact: null,
      payload: { mentoring_goals_text: "null", current_difficulty_text: "   ", one_year_vision_text: "Có mục tiêu" },
      menteeProfile: null,
      desiredMentorProfile: "undefined"
    });
    expect(card.fields.map((f) => f.key)).toEqual(["full_name", "one_year_vision_text"]);
  });

  it("mentee đặc cách (đơn gần như trống): dòng trường học lấy từ mentee_profiles", () => {
    const card = menteeProfileCard({
      fullName: "Bạn đặc cách",
      groupCode: 8,
      contact: null,
      payload: { },
      menteeProfile: { school_raw: "Đại học Kinh tế TP.HCM", major: "Hệ thống thông tin" },
      desiredMentorProfile: null
    });
    expect(card.fields.find((f) => f.key === "school")?.value).toBe("Đại học Kinh tế TP.HCM / Hệ thống thông tin");
  });

  it("thiếu ở đơn mùa này thì lấy từ đơn mùa trước — chỉ khoá trùng tên", () => {
    const card = menteeProfileCard({
      fullName: "A",
      groupCode: null,
      contact: null,
      payload: { mentoring_goals_text: "Mục tiêu mới" },
      olderPayloads: [{ mentoring_goals_text: "Mục tiêu cũ", current_difficulty_text: "Khó khăn cũ", goal_main: "khoá cũ khác tên" }],
      menteeProfile: null,
      desiredMentorProfile: null
    });
    const by = Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
    expect(by.mentoring_goals_text).toBe("Mục tiêu mới");
    expect(by.current_difficulty_text).toBe("Khó khăn cũ");
    expect(valuesOf(card)).not.toContain("khoá cũ khác tên");
  });

  it("trường khác: chỉ in tên trường, không kèm 'Trường khác:'", () => {
    expect(schoolLine({ university: "OTHER", university_other: "ĐH Ngoại thương", year_of_study: "graduated" }, null)).toBe(
      "ĐH Ngoại thương / Đã tốt nghiệp"
    );
  });
});

const RENEWAL_PAYLOAD = {
  company_current: "VinaCapital",
  title_current: "Senior Investment Manager",
  industry_primary: "finance_banking",
  function_primary: "other",
  function_primary_other: "Đầu tư tư nhân",
  secondary_industries_functions: ["consulting", "other"],
  secondary_industries_functions_other: "M&A",
  mentor_total_work_years: 14,
  mentoring_topics: "Định hướng nghề tài chính",
  ...PRIVATE
};

describe("hồ sơ mentor", () => {
  it("đủ 13 trường, đúng thứ tự và nhãn BTC khi có đủ dữ liệu", () => {
    const card = mentorProfileCard({
      fullName: "Nguyễn Công Hạo",
      groupCode: 3,
      contact: { phone: "0912", email: "mentor@example.test" },
      payload: {
        ...RENEWAL_PAYLOAD,
        motivation_text: "Muốn trả lại cho trường.",
        preferred_mentee_persona: "Sinh viên năm 3-4 quan tâm đầu tư",
        linkedin_url: "https://linkedin.com/in/hao"
      },
      mentorProfile: null
    });
    expect(labelsOf(card)).toEqual(MENTOR_PROFILE_LABELS.map(([, label]) => label));
    const by = Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
    expect(by.group).toBe("Tài chính - Đầu tư");
    expect(by.industry).toBe("Tài chính / Ngân hàng");
    expect(by.years).toBe("14 năm");
    // Chức năng chính + ngành/chức năng phụ, bỏ mã "other" trần, giữ chữ "Khác: …" và ô ghi rõ.
    expect(by.strengths).toBe("Khác: Đầu tư tư nhân; Tư vấn / Chiến lược; M&A");
  });

  it("mentor gia hạn: không có lý do / mong muốn / LinkedIn thì ẩn; không lộ core_team_note", () => {
    const card = mentorProfileCard({ fullName: "Mentor gia hạn", groupCode: 3, contact: null, payload: RENEWAL_PAYLOAD, mentorProfile: null });
    const keys = card.fields.map((f) => f.key);
    expect(keys).not.toContain("motivation_text");
    expect(keys).not.toContain("preferred_mentee_persona");
    expect(keys).not.toContain("linkedin");
    const all = valuesOf(card);
    for (const secret of PRIVATE_VALUES) expect(all, secret).not.toContain(secret);
  });

  it("thiếu trong đơn thì lấy từ mentor_profiles, rồi tới đơn mùa trước", () => {
    const card = mentorProfileCard({
      fullName: "Mentor cũ",
      groupCode: null,
      contact: null,
      payload: {},
      mentorProfile: {
        title_current: "Giám đốc",
        company_current: "Công ty X",
        industry: "consulting",
        function_area: "Kinh doanh",
        years_experience_text: "16+",
        bio_url: "https://example.test/bio"
      },
      olderPayloads: [{ motivation_text: "Lý do từ đơn mùa 11", title_current: "Chức danh cũ hơn" }]
    });
    const by = Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
    expect(by.title_current).toBe("Giám đốc");
    expect(by.industry).toBe("Tư vấn / Chiến lược");
    // Mã lạ (bảng tra BTC tạo tay) được giữ nguyên chữ, không đoán.
    expect(by.strengths).toBe("Kinh doanh");
    expect(by.years).toBe("16+ năm");
    expect(by.linkedin).toBe("https://example.test/bio");
    expect(by.motivation_text).toBe("Lý do từ đơn mùa 11");
  });

  it("số năm kinh nghiệm: một định dạng cho mọi nguồn", () => {
    expect(yearsOfExperienceText({ totalWorkYears: "12" })).toBe("12 năm");
    expect(yearsOfExperienceText({ bucket: "7-10" })).toBe("7-10 năm");
    expect(yearsOfExperienceText({ profileText: "8" })).toBe("8 năm");
    expect(yearsOfExperienceText({ profileText: "Hơn 20 năm" })).toBe("Hơn 20 năm");
    expect(yearsOfExperienceText({ profileMin: 5 })).toBe("Từ 5 năm");
    expect(yearsOfExperienceText({ totalWorkYears: 0, profileMin: null })).toBeNull();
  });
});

describe("phần dùng chung", () => {
  it("nhóm ngành: chữ trơn không số; mã lạ hoặc trống thì ẩn", () => {
    expect(groupTag(8)).toBe("Công nghệ - Thống kê - HTTT");
    expect(groupTag("4")).toBe("Marketing - Kinh doanh");
    expect(groupTag(null)).toBeNull();
    expect(groupTag(12)).toBeNull();
  });

  it("chiếu payload: đơn gia hạn đọc tầng renewal, đơn thường đọc tầng ngoài; mảng giữ nguyên là mảng", () => {
    const projection = profilePayloadProjection(["title_current", "secondary_industries_functions"]);
    expect(projection).toBe(
      "title_current:raw_payload->title_current,r__title_current:raw_payload->renewal->title_current," +
        "secondary_industries_functions:raw_payload->secondary_industries_functions,r__secondary_industries_functions:raw_payload->renewal->secondary_industries_functions"
    );
    const renewalRow = { source: "s12_mentor_renewal", title_current: "tầng ngoài (thủ tục)", r__title_current: "Giám đốc", r__secondary_industries_functions: ["tech"] };
    expect(payloadFromProjectedRow(renewalRow, ["title_current", "secondary_industries_functions"])).toEqual({
      title_current: "Giám đốc",
      secondary_industries_functions: ["tech"]
    });
    const formRow = { source: "vam_os_form", title_current: "CEO", r__title_current: null };
    expect(payloadFromProjectedRow(formRow, ["title_current"])).toEqual({ title_current: "CEO" });
  });

  it("danh sách khoá được đọc không chứa khoá riêng tư nào", () => {
    for (const key of [...MENTEE_PAYLOAD_KEYS, ...MENTOR_PAYLOAD_KEYS]) {
      expect(Object.keys(PRIVATE), key).not.toContain(key);
    }
  });

  it("chân dung mentor: phiếu mới nhất CÓ ghi mục này", () => {
    const map = latestDesiredMentorProfile([
      { application_id: "a", desired_mentor_profile: "cũ", updated_at: "2026-10-01T00:00:00Z" },
      { application_id: "a", desired_mentor_profile: "mới", updated_at: "2026-10-05T00:00:00Z" },
      { application_id: "a", desired_mentor_profile: "  ", updated_at: "2026-10-09T00:00:00Z" },
      { application_id: "b", desired_mentor_profile: null, updated_at: "2026-10-09T00:00:00Z" }
    ]);
    expect(Object.fromEntries(map)).toEqual({ a: "mới" });
  });

  it("đường dẫn hồ sơ", () => {
    expect(profileLinkUrl("https://os.alumni-mentoring.edu.vn/", "abc_DEF-1")).toBe("https://os.alumni-mentoring.edu.vn/ho-so/abc_DEF-1");
  });
});

describe("token link hồ sơ", () => {
  it("tạo token 43 ký tự base64url; chỉ hash (64 hex) được lưu", () => {
    const { token, tokenHash } = mintBearerToken();
    expect(isCanonicalBearerToken(token)).toBe(true);
    expect(token).toHaveLength(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashBearerToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("đầu vào lạ không được băm thành câu truy vấn", () => {
    for (const bad of ["", "abc", "a".repeat(44), "../../etc/passwd", null, undefined, 42, "a".repeat(42) + "="]) {
      expect(safeHashBearerToken(bad), String(bad)).toBeNull();
    }
    expect(() => hashBearerToken("ngắn")).toThrow();
  });

  it("so hash: đúng thì bằng, sai định dạng thì không", () => {
    const { tokenHash } = mintBearerToken();
    expect(bearerTokenHashEquals(tokenHash, tokenHash)).toBe(true);
    expect(bearerTokenHashEquals(tokenHash, mintBearerToken().tokenHash)).toBe(false);
    expect(bearerTokenHashEquals(tokenHash, tokenHash.toUpperCase())).toBe(false);
    expect(bearerTokenHashEquals(null, tokenHash)).toBe(false);
  });
});
