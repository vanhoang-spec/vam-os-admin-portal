import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Season 12 commitment structural safeguards", () => {
  const action = read("app/actions/apply.ts");
  const persistence = read("lib/applications-create.ts");
  const mentorForm = read("app/apply/mentor/apply-mentor-form.tsx");
  const menteeForm = read("app/apply/mentee/apply-mentee-form.tsx");
  const detail = read("app/applications/[id]/page.tsx");
  const gate = read("lib/apply-gate.ts");
  const primitives = read("app/apply/_components/form-primitives.tsx");

  it("enforces commitments in the server action before persistence", () => {
    expect(action).toContain("validateMentorCommitments");
    expect(action).toContain("validateMenteeCommitments");
    expect(action.indexOf("validateMentorCommitments")).toBeLessThan(action.indexOf("submitPilotApplication({"));
  });

  it("persists semantic key, label, accepted value and timestamp in application_answers via atomic RPC", () => {
    expect(persistence).toContain('client.rpc("vam_submit_intake_application_atomic"');
  });

  it("relies on atomic RPC to avoid manual cleanup on partial answer failure", () => {
    expect(persistence).not.toContain('.from("applications").delete().eq("id", inserted.id)');
  });

  it("renders all acknowledgement checkboxes unchecked by default", () => {
    expect(mentorForm).not.toContain("defaultChecked");
    expect(menteeForm).not.toContain("defaultChecked");
  });

  it("associates Mentor and Mentee active-reading help sentences with their inputs", () => {
    expect(primitives).toContain("aria-describedby={helpId}");
    expect(primitives).toContain('const helpId = helpText ? `${name}-help` : undefined');
    expect(mentorForm).toContain("helpText={MENTOR_CONFIRMATION_PHRASE}");
    expect(menteeForm).toContain("helpText={MENTEE_CONFIRMATION_PHRASE}");
  });

  it("shows historical-safe and exception-review admin states", () => {
    expect(detail).toContain("Không được thu thập cho phiên bản đơn này.");
    expect(detail).toContain("Acknowledgements đã thu thập một phần (phiên bản lịch sử)");
    expect(detail).toContain("Requires Core Team exception review");
    expect(detail).toContain("Acknowledgements completed");
  });

  it("persists and validates max-three Other answers without a migration", () => {
    expect(action).toContain("validateMaxThreeWithOther");
    expect(action).toContain("secondary_industries_functions_other");
    expect(action).toContain("target_soft_skills_other");
    expect(mentorForm).toContain("maxSelections={3}");
    expect(menteeForm).toContain("maxSelections={3}");
  });

  it("renders the revised Mentor helper and prominent required time commitment", () => {
    expect(mentorForm).toContain("Nếu chỉ có chức danh nhưng chưa từng trực tiếp dẫn dắt");
    expect(mentorForm).toContain("Cam kết thời gian — Bắt buộc");
    expect(mentorForm).toContain("1–2 giờ/tháng cho mỗi Mentee");
  });

  it("keeps the gate's three-state model with a server-side token check", () => {
    // M069 replaced the env enable-flag + tokenless opt-in with a
    // database-backed closed/pilot/open state. The token contract survived:
    // pilot still requires the correct token, and CLOSED has no token escape
    // hatch. See __tests__/apply-gate.test.ts for the full decision table.
    expect(gate).toContain('state === "closed"');
    expect(gate).toContain('state === "open"');
    expect(gate).toContain("timingSafeEqual");
    expect(gate).toContain("readApplicationFormState");
    // No environment variable may re-open a form.
    expect(gate).not.toContain("ENABLE_PUBLIC_MENTOR_APPLICATION");
    expect(gate).not.toContain("ALLOW_TOKENLESS");
  });
});
