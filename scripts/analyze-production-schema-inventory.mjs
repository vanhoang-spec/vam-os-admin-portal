import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXPECTED_SECTIONS = [
  "probe_version","target_identity","schemas","extensions","tables","columns","constraints","indexes",
  "functions","aggregates","triggers","policies","table_grants","sequence_grants","function_grants",
  "migration_provenance","table_estimates","safety_counts"
];

const detectors = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  jwt: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  api_key: /(?:service[_-]?role|anon)[_-]?(?:key)?\s*[:=]\s*[A-Za-z0-9._-]{16,}/i,
  password_assignment: /(?:password|passwd)\s*[:=]\s*[^\s,;]{6,}/i,
  oauth_secret: /client_secret\s*[:=]\s*[A-Za-z0-9._-]{8,}/i,
  access_refresh_token: /(?:access_token|refresh_token)\s*[:=]\s*[A-Za-z0-9._-]{12,}/i,
  storage_path: /(?:bucket|storage)[/\\][^\s'"]{3,}/i,
  phone_like: /(?<![A-Za-z0-9])(?:\+?\d[\d .()-]{7,}\d)(?![A-Za-z0-9])/
};

export function analyzeInventoryText(raw) {
  const parsed = JSON.parse(raw);
  const inventory = typeof parsed.production_schema_inventory === "string"
    ? JSON.parse(parsed.production_schema_inventory)
    : (parsed.production_schema_inventory ?? parsed);
  if (!inventory || Array.isArray(inventory) || typeof inventory !== "object") throw new Error("Inventory root must be one object");
  const keys = Object.keys(inventory);
  const missingSections = EXPECTED_SECTIONS.filter((key) => !(key in inventory));
  const findings = [];
  function scan(value, path) {
    if (typeof value === "string") {
      for (const [category, pattern] of Object.entries(detectors)) {
        if (pattern.test(value)) findings.push({ category, path });
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach((item, index) => scan(item, path + "[" + index + "]"));
    if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) scan(item, path + "." + key);
  }
  scan(inventory, "$");
  return {
    file_bytes: Buffer.byteLength(raw),
    sha256: createHash("sha256").update(raw).digest("hex"),
    json_valid: true,
    one_top_level_inventory_object: true,
    truncated: false,
    probe_version: inventory.probe_version,
    top_level_keys: keys.sort(),
    missing_sections: missingSections,
    section_counts: Object.fromEntries(keys.map((key) => [key, Array.isArray(inventory[key]) ? inventory[key].length : inventory[key] == null ? 0 : 1])),
    potential_value_findings: findings
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node analyze-production-schema-inventory.mjs <inventory.json>");
  process.stdout.write(JSON.stringify(analyzeInventoryText(readFileSync(path, "utf8")), null, 2) + "\n");
}
