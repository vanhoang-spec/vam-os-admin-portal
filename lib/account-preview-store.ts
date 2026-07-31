import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "crypto";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 50;
type Entry = { actorId: string; csv: string; digest: string; expiresAt: number };
const previews = new Map<string, Entry>();

function digest(csv: string) {
  return createHash("sha256").update(csv, "utf8").digest("hex");
}

function prune(now = Date.now()) {
  previews.forEach((entry, id) => { if (entry.expiresAt <= now) previews.delete(id); });
  while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value as string);
}

export function createAccountPreview(actorId: string, csv: string, now = Date.now()) {
  prune(now);
  const id = randomUUID();
  const integrity = digest(`${id}:${actorId}:${csv}`);
  previews.set(id, { actorId, csv, digest: integrity, expiresAt: now + PREVIEW_TTL_MS });
  return { id, integrity, expiresAt: now + PREVIEW_TTL_MS };
}

export function consumeAccountPreview(actorId: string, id: string, integrity: string, now = Date.now()) {
  prune(now);
  const entry = previews.get(id);
  if (!entry || entry.actorId !== actorId || entry.expiresAt <= now) return { ok: false, reason: "preview_missing_or_expired" } as const;
  const supplied = Buffer.from(integrity, "hex");
  const expected = Buffer.from(entry.digest, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { ok: false, reason: "preview_tampered" } as const;
  previews.delete(id);
  return { ok: true, csv: entry.csv } as const;
}

export function clearAccountPreviewsForTests() {
  previews.clear();
}
