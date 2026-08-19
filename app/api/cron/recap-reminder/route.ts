import { NextResponse } from "next/server";

import { authorizeMachineRequest } from "@/lib/machine-auth";
import { sendRecapPeriodReminder } from "@/lib/email";
import { resolveCollectionPeriod, todayInVietnam } from "@/lib/recap-import-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * GET /api/cron/recap-reminder
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs every morning, sends something on two mornings a month.
 *
 * A daily cron that mostly does nothing is the cheap way to hit "the 15th and
 * the last day of the month" — a schedule the cron syntax cannot express,
 * because the last day moves. The date is decided in Vietnam time here, not in
 * whatever zone the server happens to think it is in.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is asked to collect: the roles that may approve a recap. */
const RECIPIENT_ROLES = ["super_admin", "admin", "core_team"];

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const auth = authorizeMachineRequest(request, "CRON_SECRET");
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);

  const today = todayInVietnam();
  const period = resolveCollectionPeriod(today);

  // Any other day of the month: nothing to do, and say so plainly in the log.
  if (!period) return json({ ok: true, sent: 0, today, due: false }, 200);

  const client = getSupabaseServiceRoleClient();
  if (!client) return json({ ok: false, message: "Chưa cấu hình service role." }, 503);

  const { data, error } = await client
    .from("admin_users")
    .select("id,email,full_name,role")
    .eq("status", "active")
    .in("role", RECIPIENT_ROLES);

  if (error) {
    console.error("[cron/recap-reminder] recipient lookup failed", { code: error.code });
    return json({ ok: false, message: "Không đọc được danh sách người nhận." }, 500);
  }

  const recipients = ((data ?? []) as Array<{
    email: string | null;
    full_name: string | null;
  }>).filter((row) => Boolean(row.email));

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const result = await sendRecapPeriodReminder({
      toEmail: String(recipient.email),
      recipientName: recipient.full_name ?? "anh/chị",
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end
    });
    // A skipped send (email disabled, or a preview deploy) is not a failure —
    // lib/email.ts has already written the reason to outbound_emails.
    if (result.ok) sent++;
    else if (!result.skipped) failed++;
  }

  return json({ ok: true, today, due: true, period: period.label, recipients: recipients.length, sent, failed }, 200);
}
