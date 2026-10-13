"use server";
import { revalidatePath } from "next/cache";
import { cancelMenteeBooking, decideNeedsReview, getOfflineCandidateDetail, lookupOfflineTicket, moveMenteeBooking, saveOfflineInterview } from "@/lib/mentee-offline";
import { OFFLINE_PATH } from "@/lib/mentee-offline-core";

export async function saveOfflineInterviewAction(input: Parameters<typeof saveOfflineInterview>[0]) {
  const result=await saveOfflineInterview(input);
  if (result.ok) { revalidatePath(OFFLINE_PATH); revalidatePath("/matches"); revalidatePath("/applications"); }
  return result;
}
export async function lookupOfflineTicketAction(code: string) { return lookupOfflineTicket(code); }
/** BTC chốt hồ sơ "Cần BTC xem xét thêm". Đạt là thêm một mentee của mùa → làm mới cả Ghép cặp và danh sách đơn. */
export async function decideNeedsReviewAction(input: Parameters<typeof decideNeedsReview>[0]) {
  const result=await decideNeedsReview(input);
  if (result.ok) { revalidatePath(OFFLINE_PATH); revalidatePath("/matches"); revalidatePath("/applications"); }
  return result;
}
/** Đơn đăng ký + phiếu chấm của một bạn, tải khi mở hồ sơ. Chỉ đọc — không làm mới trang nào. */
export async function loadOfflineCandidateDetailAction(applicationId: string) { return getOfflineCandidateDetail(applicationId); }
export async function moveMenteeBookingAction(input: Parameters<typeof moveMenteeBooking>[0]) {
  const result=await moveMenteeBooking(input);
  if (result.ok) { revalidatePath(OFFLINE_PATH); revalidatePath("/interviews/ca-mentee"); }
  return result;
}
export async function cancelMenteeBookingAction(input: Parameters<typeof cancelMenteeBooking>[0]) {
  const result=await cancelMenteeBooking(input);
  if (result.ok) revalidatePath(OFFLINE_PATH);
  return result;
}
