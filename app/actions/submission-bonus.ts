"use server";

import { revalidatePath } from "next/cache";
import { SUBMISSION_BONUS_PATH, type BonusRuleActionState } from "@/lib/submission-bonus-core";
import { addApplicationBonusRule, deleteApplicationBonusRule } from "@/lib/submission-bonus-write";

/**
 * Thêm / xoá một mốc điểm cộng theo ngày nộp. Quyền và kiểm dữ liệu nằm ở hàm ghi.
 */

function revalidateBonusScreens() {
  revalidatePath(SUBMISSION_BONUS_PATH);
  revalidatePath("/applications/mentee-review");
  revalidatePath("/applications/mentor-review");
}

export async function addApplicationBonusRuleAction(
  _previous: BonusRuleActionState,
  formData: FormData
): Promise<BonusRuleActionState> {
  try {
    const result = await addApplicationBonusRule({
      role: formData.get("role"),
      label: formData.get("label"),
      startsOn: formData.get("starts_on"),
      endsOn: formData.get("ends_on"),
      points: formData.get("points")
    });
    if (result.ok) revalidateBonusScreens();
    return result;
  } catch (error) {
    console.error("[submission-bonus] addApplicationBonusRuleAction", error);
    return { ok: false, message: "Lỗi hệ thống. Thử lưu lại." };
  }
}

export async function deleteApplicationBonusRuleAction(
  _previous: BonusRuleActionState,
  formData: FormData
): Promise<BonusRuleActionState> {
  try {
    const result = await deleteApplicationBonusRule({
      role: formData.get("role"),
      ruleId: formData.get("rule_id")
    });
    if (result.ok) revalidateBonusScreens();
    return result;
  } catch (error) {
    console.error("[submission-bonus] deleteApplicationBonusRuleAction", error);
    return { ok: false, message: "Lỗi hệ thống. Thử lại." };
  }
}
