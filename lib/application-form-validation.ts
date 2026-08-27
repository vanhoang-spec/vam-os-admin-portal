export type SelectionValidation =
  | { ok: true }
  | { ok: false; message: string; fieldName: string; fieldLabel: string };

export function validateMaxThreeWithOther({
  values,
  otherText,
  fieldName,
  fieldLabel
}: {
  values: string[];
  otherText: string;
  fieldName: string;
  fieldLabel: string;
}): SelectionValidation {
  if (values.length > 3) {
    return {
      ok: false,
      message: "Bạn chỉ có thể chọn tối đa 3 lựa chọn.",
      fieldName,
      fieldLabel
    };
  }
  if (values.includes("other") && !otherText.trim()) {
    return {
      ok: false,
      message: "Vui lòng ghi rõ kỹ năng/lĩnh vực khác.",
      fieldName: `${fieldName}_other`,
      fieldLabel: "Vui lòng ghi rõ kỹ năng/lĩnh vực khác"
    };
  }
  return { ok: true };
}

/** Server-side phone rule: exactly 10 ASCII digits. Never coerce to a number. */
export function isValidApplicationPhone(value: string): boolean {
  return /^\d{10}$/.test(value);
}

/**
 * One "Khác / Other" parent field and the free-text detail it requires.
 * `parentKey` is read from the submitted values; `detailKey` lives in raw_payload.
 */
export type OtherDetailRule = {
  parentKey: string;
  detailKey: string;
  fieldLabel: string;
  /** Option value that means "Other". Defaults to "other". */
  triggerValue?: string;
};

export const MENTOR_OTHER_DETAIL_RULES: readonly OtherDetailRule[] = [
  { parentKey: "gender", detailKey: "gender_other", fieldLabel: "Giới tính" },
  { parentKey: "industry_primary", detailKey: "industry_primary_other", fieldLabel: "Ngành nghề chính" },
  { parentKey: "function_primary", detailKey: "function_primary_other", fieldLabel: "Chức năng / chuyên môn chính" },
  { parentKey: "highest_degree", detailKey: "highest_degree_other", fieldLabel: "Bằng cấp cao nhất" },
  { parentKey: "university", detailKey: "university_other", fieldLabel: "Trường đại học", triggerValue: "OTHER" },
  {
    parentKey: "activities_willing_to_support",
    detailKey: "activities_willing_to_support_other",
    fieldLabel: "Hoạt động sẵn sàng hỗ trợ"
  },
  {
    parentKey: "secondary_industries_functions",
    detailKey: "secondary_industries_functions_other",
    fieldLabel: "Ngành / chức năng phụ"
  },
  { parentKey: "referrer_or_source", detailKey: "referrer_or_source_other", fieldLabel: "Biết đến chương trình qua đâu" }
];

export const MENTEE_OTHER_DETAIL_RULES: readonly OtherDetailRule[] = [
  { parentKey: "gender", detailKey: "gender_other", fieldLabel: "Giới tính" },
  // The mentee university list uses an uppercase "OTHER" option value.
  { parentKey: "university", detailKey: "university_other", fieldLabel: "Trường đại học", triggerValue: "OTHER" },
  { parentKey: "school_or_faculty", detailKey: "school_or_faculty_other", fieldLabel: "Khoa / viện" },
  { parentKey: "target_industry", detailKey: "target_industry_other", fieldLabel: "Ngành nghề muốn theo đuổi" },
  { parentKey: "target_function", detailKey: "target_function_other", fieldLabel: "Chức năng / vị trí quan tâm" },
  { parentKey: "target_soft_skills", detailKey: "target_soft_skills_other", fieldLabel: "Soft skills muốn phát triển" },
  {
    parentKey: "training_topics_interest",
    detailKey: "training_topics_interest_other",
    fieldLabel: "Chủ đề training / workshop quan tâm"
  },
  { parentKey: "referrer_or_source", detailKey: "referrer_or_source_other", fieldLabel: "Biết đến chương trình qua đâu" }
];

/**
 * Authoritative server-side enforcement of every "Khác / Other" detail.
 *
 * - Parent selects Other + blank/whitespace-only detail  -> reject before insert.
 * - Parent selects Other + real detail                   -> persist it trimmed.
 * - Parent does not select Other                         -> drop the detail, so a
 *   stale or forged `_other` value is never persisted.
 *
 * `source` supplies parent values (raw_payload plus top-level columns such as
 * `gender`); `payload` is the raw_payload object that gets normalised in place.
 */
export function enforceOtherDetails(
  source: Record<string, unknown>,
  payload: Record<string, unknown>,
  rules: readonly OtherDetailRule[]
): SelectionValidation {
  for (const rule of rules) {
    const trigger = rule.triggerValue ?? "other";
    const parent = source[rule.parentKey];
    const selectedOther = Array.isArray(parent)
      ? parent.map((v) => String(v)).includes(trigger)
      : String(parent ?? "") === trigger;

    if (!selectedOther) {
      payload[rule.detailKey] = null;
      continue;
    }

    const detail = String(payload[rule.detailKey] ?? "").trim();
    if (!detail) {
      return {
        ok: false,
        message: `Vui lòng ghi rõ nội dung "Khác" cho mục: ${rule.fieldLabel}.`,
        fieldName: rule.detailKey,
        fieldLabel: rule.fieldLabel
      };
    }
    payload[rule.detailKey] = detail;
  }
  return { ok: true };
}
