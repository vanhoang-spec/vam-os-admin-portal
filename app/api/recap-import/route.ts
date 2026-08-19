import { NextResponse } from "next/server";

import { authorizeMachineRequest } from "@/lib/machine-auth";
import { guardPublicSubmission, recordAcceptedSubmission } from "@/lib/apply-abuse";
import { receiveImportBatch } from "@/lib/recap-import";

/**
 * POST /api/recap-import
 * ─────────────────────────────────────────────────────────────────────────────
 * Where the Chrome collector puts what it read off the group feed.
 *
 * This endpoint stages, it does not import. Everything that arrives lands in
 * `recap_import_items` with status `pending`, waiting for an organiser to look
 * at it on /operations/recap-import. Nothing here can write a recap.
 *
 * Three guards, in cost order: the bearer token (cheapest, rejects everyone who
 * should not be here), the payload size (before parsing, so a large body is
 * never held in memory), and the per-IP rate limit (one counting query).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roughly 300 posts of full text, with room to spare. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  const auth = authorizeMachineRequest(request, "VAM_OS_RECAP_IMPORT_TOKEN");
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);

  // Check the declared size before reading the stream.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json(
      { ok: false, message: "Dữ liệu quá lớn. Vui lòng quét khoảng thời gian ngắn hơn." },
      413
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ ok: false, message: "Không đọc được dữ liệu gửi lên." }, 400);
  }

  // …and again on what actually arrived, in case the header lied.
  if (raw.length > MAX_BODY_BYTES) {
    return json(
      { ok: false, message: "Dữ liệu quá lớn. Vui lòng quét khoảng thời gian ngắn hơn." },
      413
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, message: "Dữ liệu gửi lên không phải JSON hợp lệ." }, 400);
  }

  // The token holder is trusted but not unlimited: a looping extension should
  // hit a ceiling rather than fill the table.
  const guard = await guardPublicSubmission({ route: "recap_import", honeypotValue: "" });
  if (!guard.allowed) {
    return json({ ok: false, message: guard.message ?? "Bạn đã gửi quá nhiều lần." }, 429);
  }

  const body = payload as { period_start?: unknown; period_end?: unknown; group_label?: unknown };

  const result = await receiveImportBatch({
    payload,
    periodStart: typeof body?.period_start === "string" ? body.period_start : null,
    periodEnd: typeof body?.period_end === "string" ? body.period_end : null,
    groupLabel: typeof body?.group_label === "string" ? body.group_label.slice(0, 120) : null,
    source: "extension"
  });

  if (!result.ok) return json({ ok: false, message: result.message }, 400);

  await recordAcceptedSubmission("recap_import", guard.ipHash ?? null);

  return json(
    {
      ok: true,
      message: result.message,
      batch_id: result.batchId,
      received: result.received,
      duplicates: result.duplicates,
      matched: result.matched,
      needs_review: result.needsReview,
      skipped: result.skipped
    },
    200
  );
}

/** Anything other than POST gets a plain refusal, not an HTML error page. */
export async function GET() {
  return json({ ok: false, message: "Endpoint này chỉ nhận POST." }, 405);
}
