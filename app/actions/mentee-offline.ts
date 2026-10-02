"use server";
import { revalidatePath } from "next/cache";
import { cancelMenteeBooking, lookupOfflineTicket, moveMenteeBooking, saveOfflineInterview } from "@/lib/mentee-offline";
import { OFFLINE_PATH } from "@/lib/mentee-offline-core";

export async function saveOfflineInterviewAction(input: Parameters<typeof saveOfflineInterview>[0]) {
  const result=await saveOfflineInterview(input);
  if (result.ok) { revalidatePath(OFFLINE_PATH); revalidatePath("/matches"); revalidatePath("/applications"); }
  return result;
}
export async function lookupOfflineTicketAction(code: string) { return lookupOfflineTicket(code); }
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
