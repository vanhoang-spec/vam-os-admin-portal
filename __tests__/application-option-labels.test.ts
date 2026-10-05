/**
 * Mã lựa chọn trong đơn hiện thành chữ của form (BTC 05/10/2026): "Xem application",
 * "Nội dung đơn" trên phiếu chấm, màn hình phỏng vấn mentee và file xuất cùng đi qua
 * flattenRawPayload → text(value, key) → applicationOptionLabel.
 */
import { describe, expect, it } from "vitest";
import { flattenRawPayload } from "@/lib/application-export";
import {
  MENTEE_APPLICATION_FIELD_OPTIONS,
  MENTOR_APPLICATION_FIELD_OPTIONS,
  applicationOptionLabel
} from "@/lib/application-form-options";

describe("dịch mã lựa chọn", () => {
  it("câu chọn nhiều của mentor: mã thành chữ, giữ thứ tự", () => {
    const rows = flattenRawPayload({ activities_willing_to_support: ["training_sharing", "english_mentoring", "other"] });
    expect(rows).toEqual([
      { key: "activities_willing_to_support", value: "Training / chia sẻ chuyên đề; Mentoring bằng tiếng Anh; Khác" }
    ]);
  });

  it("cùng mã, khác câu hỏi, khác chữ: 'yes' ở câu orientation khác 'other' ở câu nguồn biết đến", () => {
    const rows = Object.fromEntries(
      flattenRawPayload({ can_attend_orientation: "if_scheduled_well", referrer_or_source: "ueh_alumni", gender: "prefer_not_say" }).map((r) => [r.key, r.value])
    );
    expect(rows).toEqual({ can_attend_orientation: "Có nếu xếp lịch hợp lý", referrer_or_source: "UEH Alumni", gender: "Không muốn chia sẻ" });
  });

  it("đơn mentee: ngành, chức năng, kỹ năng, đợt phỏng vấn", () => {
    const rows = Object.fromEntries(
      flattenRawPayload({
        target_industry: "finance_banking",
        target_soft_skills: ["leadership", "public_speaking"],
        available_for_interview: ["week_1"],
        year_of_study: "3"
      }).map((r) => [r.key, r.value])
    );
    expect(rows).toEqual({
      target_industry: "Tài chính / Ngân hàng",
      target_soft_skills: "Leadership; Public speaking",
      available_for_interview: "Đợt 1: 03–04/10",
      year_of_study: "Năm 3"
    });
  });

  it("đường dẫn lồng nhau (đơn gia hạn mentor) vẫn dịch theo phần cuối", () => {
    expect(applicationOptionLabel("renewal.meeting_format_preference", "offline")).toBe("Offline");
    expect(applicationOptionLabel("renewal.programs_willing_to_join[2]", "nonexistent")).toBe("nonexistent");
  });

  it("không đoán: câu trả lời tự do, ô 'Khác' tự ghi, mã lạ đều giữ nguyên", () => {
    const rows = Object.fromEntries(
      flattenRawPayload({
        motivation_text: "other",
        activities_willing_to_support_other: "Mentoring nhóm",
        industry_primary: "ma_cu_khong_con",
        preferred_name: "Duc"
      }).map((r) => [r.key, r.value])
    );
    expect(rows).toEqual({
      motivation_text: "other",
      activities_willing_to_support_other: "Mentoring nhóm",
      industry_primary: "ma_cu_khong_con",
      preferred_name: "Duc"
    });
  });
});

describe("hai form không cho cùng một mã hai nghĩa", () => {
  // Bốn câu hỏi dùng chung tên khoá. Mã trùng giữa hai form chỉ được khác chữ ở đúng các
  // cặp đã duyệt là CÙNG NGHĨA dưới đây. Thêm một cặp mới mà khác nghĩa → test đỏ, phải
  // đổi tên khoá hoặc mã trước khi gộp bảng dịch.
  const SAME_MEANING: Record<string, Record<string, [string, string]>> = {
    university: {
      UEH: ["Đại học Kinh tế TP. Hồ Chí Minh (UEH)", "Đại học Kinh tế TP.HCM (UEH)"],
      OTHER: ["Trường khác", "Các trường đại học khác"]
    },
    meeting_format_preference: { offline: ["Offline", "Offline (gặp trực tiếp)"] }
  };

  it("mọi mã trùng giữa hai form: cùng chữ, hoặc nằm trong danh sách cùng nghĩa đã duyệt", () => {
    const diverging: string[] = [];
    for (const [key, menteeOptions] of Object.entries(MENTEE_APPLICATION_FIELD_OPTIONS)) {
      const mentorOptions = MENTOR_APPLICATION_FIELD_OPTIONS[key];
      if (!mentorOptions) continue;
      for (const e of menteeOptions) {
        const m = mentorOptions.find((o) => o.value === e.value);
        if (!m || m.label === e.label) continue;
        const approved = SAME_MEANING[key]?.[e.value];
        if (!approved || approved[0] !== e.label || approved[1] !== m.label) diverging.push(`${key}.${e.value}: "${e.label}" ≠ "${m.label}"`);
      }
    }
    expect(diverging).toEqual([]);
  });

  it("mỗi lựa chọn của mỗi form dịch ra đúng chữ form đó hiện (hoặc chữ cùng nghĩa đã duyệt)", () => {
    for (const [table, which] of [[MENTEE_APPLICATION_FIELD_OPTIONS, 0], [MENTOR_APPLICATION_FIELD_OPTIONS, 1]] as const) {
      for (const [key, options] of Object.entries(table)) {
        for (const option of options) {
          const shown = applicationOptionLabel(key, option.value);
          const approved = SAME_MEANING[key]?.[option.value];
          expect([option.label, approved?.[1 - which]].filter(Boolean), `${key}.${option.value}`).toContain(shown);
        }
      }
    }
  });
});
