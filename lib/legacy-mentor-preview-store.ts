import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 50;
type StoredPreview = { ciphertext: string; iv: string; authTag: string };

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const key = (id: string, actor: string, secret: string) =>
  createHash("sha256").update(`VAM083:${id}:${actor}:${secret}`, "utf8").digest();

function encrypt(id: string, actor: string, secret: string, csv: string): StoredPreview {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(id, actor, secret), iv);
  const payload = Buffer.concat([cipher.update(csv, "utf8"), cipher.final()]);
  return { ciphertext: payload.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decrypt(id: string, actor: string, secret: string, stored: StoredPreview): string {
  const decipher = createDecipheriv("aes-256-gcm", key(id, actor, secret), Buffer.from(stored.iv, "base64"));
  decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export async function createLegacyMentorPreview(actorId: string, csv: string, now = Date.now()) {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("LEGACY_PREVIEW_UNAVAILABLE");
  const id = randomUUID();
  const integrity = randomBytes(32).toString("base64url");
  const expiresAt = now + PREVIEW_TTL_MS;
  const encrypted = encrypt(id, actorId, integrity, csv);
  const { error } = await client.rpc("vam083_create_legacy_mentor_preview", {
    p_preview_id: id,
    p_actor_admin_user_id: actorId,
    p_secret_hash: hash(integrity),
    p_ciphertext: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_auth_tag: encrypted.authTag,
    p_expires_at: new Date(expiresAt).toISOString(),
    p_max_previews: MAX_PREVIEWS
  });
  if (error) throw new Error("LEGACY_PREVIEW_UNAVAILABLE");
  return { id, integrity, expiresAt };
}

export async function consumeLegacyMentorPreview(actorId: string, id: string, integrity: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(integrity) || !/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, reason: "preview_invalid" } as const;
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("LEGACY_PREVIEW_UNAVAILABLE");
  const { data, error } = await client.rpc("vam083_consume_legacy_mentor_preview", {
    p_preview_id: id,
    p_actor_admin_user_id: actorId,
    p_secret_hash: hash(integrity)
  });
  if (error) throw new Error("LEGACY_PREVIEW_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, reason: "preview_missing_expired_used_or_actor_mismatch" } as const;
  try {
    return {
      ok: true,
      csv: decrypt(id, actorId, integrity, {
        ciphertext: String(row.ciphertext),
        iv: String(row.iv),
        authTag: String(row.auth_tag)
      })
    } as const;
  } catch {
    return { ok: false, reason: "preview_integrity_failed" } as const;
  }
}
