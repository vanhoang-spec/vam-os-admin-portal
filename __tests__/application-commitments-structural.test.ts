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

  it("enforces commitments in the server action before persistence", () => {
    expect(action).toContain("validateMentorCommitments");
    expect(action).toContain("validateMenteeCommitments");
    expect(action.indexOf("validateMentorCommitments")).toBeLessThan(action.indexOf("submitPilotApplication({"));
  });

  it("persists semantic key, label, accepted value and timestamp in application_answers", () => {
    expect(persistence).toContain('.from("application_answers").insert(answerRows)');
    expect(persistence).toContain("question_key: answer.questionKey");
    expect(persistence).toContain("value_text: answer.valueText");
    expect(persistence).toContain("created_at: answer.acceptedAt");
  });

  it("cleans up a new application if acknowledgement persistence fails", () => {
    expect(persistence).toContain('.from("applications").delete().eq("id", inserted.id)');
  });

  it("renders all acknowledgement checkboxes unchecked by default", () => {
    expect(mentorForm).not.toContain("defaultChecked");
    expect(menteeForm).not.toContain("defaultChecked");
  });

  it("shows historical-safe and exception-review admin states", () => {
    expect(detail).toContain("Không được thu thập cho phiên bản đơn này.");
    expect(detail).toContain("Requires Core Team exception review");
    expect(detail).toContain("Acknowledgements completed");
  });

  it("keeps the token/pilot gate's two-condition model", () => {
    expect(gate).toContain("if (!isEnabled)");
    expect(gate).toContain("if (tokenMatched || allowTokenless)");
  });
});
