"use server";
import { revalidatePath } from "next/cache";
import { lookupOfflineTicket, saveOfflineInterview } from "@/lib/mentee-offline";
import { OFFLINE_PATH } from "@/lib/mentee-offline-core";

export async function saveOfflineInterviewAction(input: Parameters<typeof saveOfflineInterview>[0]) {
  const result=await saveOfflineInterview(input);
  if (result.ok) { revalidatePath(OFFLINE_PATH); revalidatePath("/matches"); revalidatePath("/applications"); }
  return result;
}
export async function lookupOfflineTicketAction(code: string) { return lookupOfflineTicket(code); }
