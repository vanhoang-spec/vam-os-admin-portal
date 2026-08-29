import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const DATA_LIB = join(process.cwd(), "lib/data.ts");

function read(path: string) {
  return readFileSync(path, "utf-8");
}

describe("S12 Application Review UX Completion - Static Checks", () => {
  it("getS12ApplicationReviewQueue replaces getMentorReviewQueue and accepts role/search", () => {
    const source = read(DATA_LIB);
    
    // Ensure the old helper is fully removed
    expect(source).not.toContain("export async function getMentorReviewQueue");
    
    // Ensure the new shared helper exists
    expect(source).toContain("export async function getS12ApplicationReviewQueue");
    
    // Ensure it accepts search
    const queueHelper = source.slice(source.indexOf("export async function getS12ApplicationReviewQueue"));
    expect(queueHelper).toContain("search?: string");
    
    // Ensure it preserves the performance gates
    expect(queueHelper).toContain('SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE');
    expect(queueHelper).toContain('.eq("status", "submitted")');
    expect(queueHelper).toContain('.order("submitted_at", { ascending: false })');
    expect(queueHelper).toContain('.range(from, to)');
    expect(queueHelper).toContain('role: "mentor" | "mentee"');
    expect(queueHelper).toContain('.eq("role_applied", role)');
  });

  it("getS12ApplicationReviewQueue implements server-side search safely", () => {
    const source = read(DATA_LIB);
    const queueHelper = source.slice(source.indexOf("export async function getS12ApplicationReviewQueue"));
    
    // Checks that UUID is not sanitized, but everything else is stripped of unsafe characters
    expect(queueHelper).toContain(".replace(/[,()\"'%_]/g, \" \")");
    expect(queueHelper).toContain("searchFilter.push(`id.eq.${trimmed}`);");
    expect(queueHelper).toContain("query = query.or(searchFilter.join(");
    expect(queueHelper).toContain("isUUID");
  });

  it("classifyS12Mentors batches queries and implements authoritative returning rule", () => {
    const source = read(DATA_LIB);
    const classifyHelper = source.slice(source.indexOf("export async function classifyS12Mentors"));
    
    // Ensures batch fetching via .in
    expect(classifyHelper).toContain('.in("email_primary", nullPersonEmails)');
    expect(classifyHelper).toContain('.in("person_id", Array.from(allPersonIds))');
    
    // Ensures ambiguous emails result in 'Chưa xác định'
    expect(classifyHelper).toContain('result.set(app.id, "Chưa xác định")');
    expect(classifyHelper).toContain("matchedPeople.length > 1");
    
    // Ensures checking prior season profiles
    // "source_application_id exists and != current application.id"
    expect(classifyHelper).toContain("p.source_application_id !== app.id");
    expect(classifyHelper).toContain('result.set(app.id, "Mentor cũ quay lại")');
    
    // "no person match => NEW"
    // "no prior mentor profile => NEW"
    // "profile source_application_id=current app => NEW"
    expect(classifyHelper).toContain('result.set(app.id, "Mentor mới")');
    
    // NO broad scope scans
    expect(classifyHelper).not.toContain("getScopedPersonIds");
    expect(classifyHelper).not.toContain("getPeople");
    expect(classifyHelper).not.toContain("getMentorProfiles");
  });
});
