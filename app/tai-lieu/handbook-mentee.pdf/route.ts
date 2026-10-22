import { handbookPdfResponse } from "@/lib/handbook-file";

/** Handbook mentee mùa 12 — link trong thư kết quả ghép cặp. Xem lib/handbook.ts. */
export const dynamic = "force-static";

export async function GET() {
  return handbookPdfResponse("mentee");
}
