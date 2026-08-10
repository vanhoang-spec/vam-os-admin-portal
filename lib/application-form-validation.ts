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
