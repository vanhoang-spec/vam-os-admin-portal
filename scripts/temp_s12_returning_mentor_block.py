from pathlib import Path

SOURCE = Path("lib/applications-create.ts")
text = SOURCE.read_text(encoding="utf-8")

old = '''  const existingPerson = exactPeople[0] ?? null;

  // Insert
'''
new = '''  const existingPerson = exactPeople[0] ?? null;

  // P0 — Returning Mentors must use the controlled S12 renewal flow rather
  // than creating a new public Mentor application. A people row alone is not
  // enough proof: former mentees/supporters/contacts may already exist in
  // `people`, so we only block when that canonical person has a mentor profile.
  if (input.role === "mentor" && existingPerson) {
    const { data: mentorHistory, error: mentorHistoryErr } = await client
      .from("mentor_profiles")
      .select("id")
      .eq("person_id", existingPerson.id)
      .limit(1);

    if (mentorHistoryErr) {
      log("returning mentor lookup failed", mentorHistoryErr);
      return { ok: false, code: "db", message: SAFE_ERROR };
    }

    if ((mentorHistory ?? []).length > 0) {
      return {
        ok: false,
        code: "validation",
        message:
          "Hồ sơ này cần được xử lý qua luồng xác nhận/gia hạn Mentor Season 12. Vui lòng sử dụng đường dẫn do BTC gửi hoặc liên hệ BTC nếu chưa nhận được."
      };
    }
  }

  // Insert
'''

if text.count(old) != 1:
    raise SystemExit(f"applications-create.ts anchor drifted: expected 1 match, found {text.count(old)}")
SOURCE.write_text(text.replace(old, new, 1), encoding="utf-8")

Path("__tests__/s12-returning-mentor-intake-block.test.ts").write_text(r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("lib/applications-create.ts", "utf8");
const blockStart = SOURCE.indexOf('if (input.role === "mentor" && existingPerson)');
const insertStart = SOURCE.indexOf("// Insert", blockStart);
const block = SOURCE.slice(blockStart, insertStart);

describe("S12 returning Mentor public-intake P0", () => {
  it("checks Mentor history only for canonical existing Mentor applicants before insert", () => {
    expect(blockStart).toBeGreaterThan(-1);
    expect(insertStart).toBeGreaterThan(blockStart);
    expect(block).toContain('.from("mentor_profiles")');
    expect(block).toContain('.eq("person_id", existingPerson.id)');
    expect(block).toContain('.limit(1)');
  });

  it("does not treat a people row alone as returning-Mentor proof", () => {
    expect(block).toContain('if ((mentorHistory ?? []).length > 0)');
    expect(block).not.toContain('if (existingPerson) {\n      return');
  });

  it("routes an existing Mentor profile to S12 renewal instead of a new application", () => {
    expect(block).toContain('code: "validation"');
    expect(block).toContain("xác nhận/gia hạn Mentor Season 12");
    expect(block).toContain("đường dẫn do BTC gửi");
  });

  it("fails closed when Mentor-history lookup cannot be trusted", () => {
    expect(block).toContain('if (mentorHistoryErr)');
    expect(block).toContain('log("returning mentor lookup failed", mentorHistoryErr)');
    expect(block).toContain('code: "db"');
    expect(block).toContain("message: SAFE_ERROR");
  });

  it("preserves same-season duplicate protection before returning-Mentor classification", () => {
    const duplicateCheck = SOURCE.indexOf("duplicateCandidates");
    expect(duplicateCheck).toBeGreaterThan(-1);
    expect(duplicateCheck).toBeLessThan(blockStart);
  });
});
''', encoding="utf-8")
