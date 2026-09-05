"use server";

import { getMatchingQuickView } from "@/lib/matching-quick-view";
import type { QuickViewPayload } from "@/lib/matching-quick-view-core";

/**
 * Server action behind the "Xem hồ sơ" drawer on /matches.
 *
 * Deliberately NOT a form action and NOT cached: the drawer calls it once when
 * the operator opens one person, so nothing about the candidate pool is loaded
 * in advance. There is no `revalidatePath` because this reads and writes
 * nothing — revalidating would re-render /matches and throw away the operator's
 * search text and selections, which is the whole problem the drawer exists to
 * avoid.
 */
export type QuickViewActionResult =
  | { ok: true; data: QuickViewPayload }
  | { ok: false; message: string };

export async function loadMatchingQuickViewAction(input: {
  personId: string;
  role: "mentor" | "mentee";
  intakeBatchId: string;
}): Promise<QuickViewActionResult> {
  try {
    return await getMatchingQuickView(input);
  } catch (error) {
    console.error("[loadMatchingQuickViewAction]", error);
    return { ok: false, message: "Đã xảy ra lỗi khi tải hồ sơ. Vui lòng thử lại." };
  }
}
