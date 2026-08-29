import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { evaluateMentorClassifications } from "../lib/classification";

const DATA_LIB = join(process.cwd(), "lib/data.ts");
const CLASSIFICATION_LIB = join(process.cwd(), "lib/classification.ts");

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
    const dataSource = read(DATA_LIB);
    const classifyHelperData = dataSource.slice(dataSource.indexOf("export async function classifyS12Mentors"));
    
    // Ensures batch fetching via .in
    expect(classifyHelperData).toContain('.in("email_primary", nullPersonEmails)');
    expect(classifyHelperData).toContain('.in("person_id", Array.from(allPersonIds))');
    
    // NO broad scope scans
    expect(classifyHelperData).not.toContain("getScopedPersonIds");
    expect(classifyHelperData).not.toContain("getPeople");
    expect(classifyHelperData).not.toContain("getMentorProfiles");

    const classSource = read(CLASSIFICATION_LIB);
    const evalHelper = classSource.slice(classSource.indexOf("export function evaluateMentorClassifications"));

    // Ensures ambiguous emails result in 'Chưa xác định'
    expect(evalHelper).toContain('result.set(app.id, "Chưa xác định")');
    expect(evalHelper).toContain("matchedPeople.length > 1");
    
    // Ensures checking prior season profiles
    // "source_application_id exists and != current application.id"
    expect(evalHelper).toContain("p.source_application_id !== app.id");
    expect(evalHelper).toContain('result.set(app.id, "Mentor cũ quay lại")');
    
    // "no person match => NEW"
    // "no prior mentor profile => NEW"
    // "profile source_application_id=current app => NEW"
    expect(evalHelper).toContain('result.set(app.id, "Mentor mới")');
  });

  describe("evaluateMentorClassifications behavioral matrix", () => {
    it("1. linked person + legacy profile source_application_id=null => Mentor cũ quay lại", () => {
      const apps = [{ id: "app1", person_id: "p1", email_primary: null }] as any[];
      const people = [] as any[];
      const profiles = [{ person_id: "p1", source_application_id: null }] as any[];
      const res = evaluateMentorClassifications(apps, people, profiles, false, false);
      expect(res.get("app1")).toBe("Mentor cũ quay lại");
    });

    it("2. linked person + prior source_application_id != current app => Mentor cũ quay lại", () => {
      const apps = [{ id: "app1", person_id: "p1", email_primary: null }] as any[];
      const people = [] as any[];
      const profiles = [{ person_id: "p1", source_application_id: "app0" }] as any[];
      const res = evaluateMentorClassifications(apps, people, profiles, false, false);
      expect(res.get("app1")).toBe("Mentor cũ quay lại");
    });

    it("3. linked person + only source_application_id=current app => Mentor mới", () => {
      const apps = [{ id: "app1", person_id: "p1", email_primary: null }] as any[];
      const people = [] as any[];
      const profiles = [{ person_id: "p1", source_application_id: "app1" }] as any[];
      const res = evaluateMentorClassifications(apps, people, profiles, false, false);
      expect(res.get("app1")).toBe("Mentor mới");
    });

    it("4. linked person + successful profile lookup + no profiles => Mentor mới", () => {
      const apps = [{ id: "app1", person_id: "p1", email_primary: null }] as any[];
      const res = evaluateMentorClassifications(apps, [], [], false, false);
      expect(res.get("app1")).toBe("Mentor mới");
    });

    it("5. unlinked app + no matching person after successful lookup => Mentor mới", () => {
      const apps = [{ id: "app1", email_primary: "test@example.com", person_id: null }] as any[];
      const people = [] as any[]; // no match
      const res = evaluateMentorClassifications(apps, people, [], false, false);
      expect(res.get("app1")).toBe("Mentor mới");
    });

    it("6. unlinked app + exactly one matching person + prior profile => Mentor cũ quay lại", () => {
      const apps = [{ id: "app1", email_primary: "test@example.com", person_id: null }] as any[];
      const people = [{ id: "p1", email_primary: "test@example.com" }] as any[];
      const profiles = [{ person_id: "p1", source_application_id: "app0" }] as any[];
      const res = evaluateMentorClassifications(apps, people, profiles, false, false);
      expect(res.get("app1")).toBe("Mentor cũ quay lại");
    });

    it("7. unlinked app + duplicate people with same email => Chưa xác định", () => {
      const apps = [{ id: "app1", email_primary: "test@example.com", person_id: null }] as any[];
      const people = [
        { id: "p1", email_primary: "test@example.com" },
        { id: "p2", email_primary: "test@example.com" },
      ] as any[];
      const res = evaluateMentorClassifications(apps, people, [], false, false);
      expect(res.get("app1")).toBe("Chưa xác định");
    });

    it("8. people lookup error => Chưa xác định", () => {
      const apps = [{ id: "app1", email_primary: "test@example.com", person_id: null }] as any[];
      const res = evaluateMentorClassifications(apps, [], [], true, false);
      expect(res.get("app1")).toBe("Chưa xác định");
    });

    it("9. mentor profile lookup error => Chưa xác định", () => {
      const apps = [{ id: "app1", person_id: "p1", email_primary: null }] as any[];
      const res = evaluateMentorClassifications(apps, [], [], false, true);
      expect(res.get("app1")).toBe("Chưa xác định");
    });
  });
});
