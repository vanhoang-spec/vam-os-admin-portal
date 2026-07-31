import { describe, expect, it } from "vitest";
import { ACCOUNT_IMPORT_HEADERS, accountImportResultsCsv, parseAccountImportCsv } from "@/lib/account-import";
import { normalizeEmail } from "@/lib/identity";

const ref = { programs: [{ id: "p1", code: "UEH" }, { id: "p2", code: "HAM" }], seasons: [{ id: "s1", code: "UEHM-S12", programId: "p1" }, { id: "s2", code: "HAM-S6", programId: "p2" }], intakeBatches: [{ id: "b1", code: "UEHM-S12-B01", seasonId: "s1" }] };
const header = ACCOUNT_IMPORT_HEADERS.join(",");

describe("account import parser", () => {
  it("normalizes mixed-case whitespace email and accepts BOM/quoted fields", () => {
    expect(normalizeEmail("  Ops@Example.COM ")).toBe("ops@example.com");
    const result = parseAccountImportCsv(`\uFEFF${header}\n" Ops@Example.COM ","Nguyen, Ops",viewer,UEH,UEHM-S12,UEHM-S12-B01\n`, ref);
    expect(result.ok).toBe(true); expect(result.rows[0].email).toBe("ops@example.com"); expect(result.rows[0].displayName).toBe("Nguyen, Ops");
  });
  it("rejects missing and extra headers", () => {
    expect(parseAccountImportCsv("email,role\na@b.com,viewer", ref).ok).toBe(false);
    expect(parseAccountImportCsv(`${header},extra\na@b.com,A,viewer,UEH,UEHM-S12,,x`, ref).ok).toBe(false);
  });
  it("rejects malformed quoting", () => expect(parseAccountImportCsv(`${header}\n"a@b.com,A,viewer,UEH,UEHM-S12,`, ref).errors[0]).toContain("chưa đóng"));
  it("rejects unsupported roles and invalid program/season/batch relationships", () => {
    const result = parseAccountImportCsv(`${header}\na@b.com,A,owner,UEH,HAM-S6,UEHM-S12-B01`, ref);
    expect(result.rows[0].reasons.join(" ")).toMatch(/Vai trò|Season không thuộc program|Intake batch không thuộc season/);
  });
  it("detects same-file duplicates after normalization", () => {
    const result = parseAccountImportCsv(`${header}\nA@B.com,A,viewer,UEH,UEHM-S12,\n a@b.COM ,A2,viewer,UEH,UEHM-S12,`, ref);
    expect(result.rows[1].reasons).toContain("Email trùng trong cùng tệp sau khi chuẩn hóa.");
  });
  it("keeps participant membership distinct from admin access", () => {
    const result = parseAccountImportCsv(`${header}\nmentor@x.com,Mentor,mentor,UEH,UEHM-S12,`, ref);
    expect(result.ok).toBe(true); expect(result.rows[0].role).toBe("mentor");
  });
  it("escapes downloadable partial-row outcomes", () => expect(accountImportResultsCsv([{ rowNumber: 2, status: "failed", reason: "bad, quoted" }])).toContain('"bad, quoted"'));
});
