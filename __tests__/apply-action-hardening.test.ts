/**
 * Direct production tests for the public intake actions in app/actions/apply.ts.
 *
 * The lib layer is mocked; the real action bodies run, so the wiring that makes
 * a public POST safe is verified rather than assumed: the gate is re-checked
 * here and not only in the page, the honeypot short-circuits before any write,
 * and a mail failure never turns a stored application into a reported error.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // The real redirect() throws NEXT_REDIRECT; mirror that so code after it
  // never runs, exactly as in production.
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw error;
  })
}));
vi.mock("@/lib/applications-create", () => ({ submitPilotApplication: vi.fn() }));
vi.mock("@/lib/apply-gate", () => ({ evaluateApplyGate: vi.fn() }));
vi.mock("@/lib/apply-abuse", () => ({
  guardPublicSubmission: vi.fn(),
  recordAcceptedSubmission: vi.fn(),
  recordGateRejection: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendApplicationConfirmation: vi.fn() }));

import { redirect } from "next/navigation";
import { submitPilotApplication } from "@/lib/applications-create";
import { evaluateApplyGate } from "@/lib/apply-gate";
import {
  guardPublicSubmission,
  recordAcceptedSubmission,
  recordGateRejection
} from "@/lib/apply-abuse";
import { sendApplicationConfirmation } from "@/lib/email";
import { submitMenteeApplicationAction, submitMentorApplicationAction } from "@/app/actions/apply";

const initialState = { ok: false, message: null };

/**
 * A mentee submission with every field the action requires.
 * Field names mirror app/apply/mentee/apply-mentee-form.tsx exactly — if the
 * form's contract changes, this fixture should fail loudly rather than drift.
 */
function menteeForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values: Record<string, string> = {
    apply_token: "valid-token",
    full_name: "Trần Thị B",
    email_primary: "mentee@example.test",
    phone_primary: "0900000000",
    gender: "female",
    consent_data_storage: "on",
    university: "UEH",
    school_or_faculty: "Khoa Tài chính",
    major: "Tài chính",
    class_cohort: "K47",
    year_of_study: "3",
    target_industry: "finance",
    target_function: "analysis",
    one_year_vision_text: "Thực tập tại một quỹ đầu tư",
    mentoring_goals_text: "Định hướng nghề nghiệp và kỹ năng phỏng vấn",
    top_3_questions_for_mentor: "1) Lộ trình? 2) Kỹ năng? 3) Mạng lưới?",
    available_for_kickoff: "yes",
    // Read with formBoolean, so it must be a checkbox-style value.
    commitment_understanding: "on",
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  // Multi-value fields the action reads with getAll.
  form.append("available_for_interview", "weekday_evening");
  form.append("email_notification_consent", "program_updates");
  return form;
}

async function runMentee(form: FormData) {
  try {
    return { state: await submitMenteeApplicationAction(initialState, form), redirected: false };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT")) {
      return { state: null, redirected: true, target: err.message };
    }
    throw err;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks() clears implementations too, so redirect() must be re-armed
  // here — otherwise it silently returns undefined and the action falls through
  // instead of aborting the way it does in production.
  (redirect as unknown as Mock).mockImplementation((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw error;
  });
  (guardPublicSubmission as Mock).mockResolvedValue({ allowed: true, ipHash: "hash-1" });
  (evaluateApplyGate as Mock).mockReturnValue({ status: "open" });
  (submitPilotApplication as Mock).mockResolvedValue({ ok: true, applicationId: "app-1" });
  (sendApplicationConfirmation as Mock).mockResolvedValue({ ok: true, skipped: false });
});

describe("public intake — the gate is enforced in the action, not only the page", () => {
  it("re-evaluates the gate with the submitted token", async () => {
    await runMentee(menteeForm());

    expect(evaluateApplyGate).toHaveBeenCalledWith("valid-token", "mentee");
  });

  it("refuses when the gate is closed, and stores nothing", async () => {
    (evaluateApplyGate as Mock).mockReturnValue({
      status: "closed",
      reason: "Đơn đăng ký mentee chưa được mở. Vui lòng chờ thông báo chính thức."
    });

    const { state } = await runMentee(menteeForm());

    expect(state?.ok).toBe(false);
    expect(state?.message).toContain("chưa được mở");
    expect(submitPilotApplication).not.toHaveBeenCalled();
    expect(sendApplicationConfirmation).not.toHaveBeenCalled();
  });

  it("records a gate rejection against the rate-limit counter", async () => {
    (evaluateApplyGate as Mock).mockReturnValue({ status: "closed", reason: "closed" });

    await runMentee(menteeForm());

    expect(recordGateRejection).toHaveBeenCalledWith("apply_mentee", "hash-1");
  });

  it("accepts a dev_warning gate, which is open in development", async () => {
    (evaluateApplyGate as Mock).mockReturnValue({ status: "dev_warning", reason: "dev" });

    const result = await runMentee(menteeForm());

    expect(submitPilotApplication).toHaveBeenCalled();
    expect(result.redirected).toBe(true);
  });

  it("applies the same rule to the mentor form", async () => {
    (evaluateApplyGate as Mock).mockReturnValue({ status: "closed", reason: "closed" });
    const form = new FormData();
    form.set("apply_token", "t");
    form.set("full_name", "A");

    const state = await submitMentorApplicationAction(initialState, form);

    expect(evaluateApplyGate).toHaveBeenCalledWith("t", "mentor");
    expect(state.ok).toBe(false);
    expect(submitPilotApplication).not.toHaveBeenCalled();
  });
});

describe("public intake — abuse protection runs before any work", () => {
  it("discards a honeypot submission without writing or mailing", async () => {
    (guardPublicSubmission as Mock).mockResolvedValue({
      allowed: false,
      reason: "honeypot",
      message: "Đã ghi nhận đơn đăng ký.",
      ipHash: "hash-1"
    });

    const { state } = await runMentee(menteeForm({ website: "http://spam.test" }));

    expect(submitPilotApplication).not.toHaveBeenCalled();
    expect(sendApplicationConfirmation).not.toHaveBeenCalled();
    // Looks like success to the bot; nothing names the trap.
    expect(state?.ok).toBe(true);
    expect(state?.message).not.toMatch(/honeypot|bot|spam/i);
  });

  it("stops a rate-limited submission and says so in Vietnamese", async () => {
    (guardPublicSubmission as Mock).mockResolvedValue({
      allowed: false,
      reason: "rate_limit",
      message: "Hệ thống đang nhận quá nhiều lượt gửi từ kết nối của bạn.",
      ipHash: "hash-1"
    });

    const { state } = await runMentee(menteeForm());

    expect(state?.ok).toBe(false);
    expect(state?.message).toContain("quá nhiều lượt gửi");
    expect(submitPilotApplication).not.toHaveBeenCalled();
  });

  it("checks abuse before the gate, so a bot never learns the token state", async () => {
    (guardPublicSubmission as Mock).mockResolvedValue({
      allowed: false,
      reason: "honeypot",
      message: "Đã ghi nhận đơn đăng ký.",
      ipHash: null
    });

    await runMentee(menteeForm());

    expect(evaluateApplyGate).not.toHaveBeenCalled();
  });

  it("counts an accepted submission", async () => {
    await runMentee(menteeForm());

    expect(recordAcceptedSubmission).toHaveBeenCalledWith("apply_mentee", "hash-1");
  });
});

describe("public intake — storage and acknowledgement", () => {
  it("caps stored free text so one request cannot write unbounded data", async () => {
    await runMentee(menteeForm({ mentoring_goal_text: "x".repeat(9000) }));

    const payload = (submitPilotApplication as Mock).mock.calls[0][0];
    const stored = String(payload.rawPayload.mentoring_goal_text ?? "");
    expect(stored.length).toBeLessThanOrEqual(5000);
  });

  it("caps identity fields too", async () => {
    await runMentee(menteeForm({ full_name: "N".repeat(900) }));

    const payload = (submitPilotApplication as Mock).mock.calls[0][0];
    expect(String(payload.fullName).length).toBeLessThanOrEqual(300);
  });

  it("sends the applicant a confirmation for the stored application", async () => {
    await runMentee(menteeForm());

    expect(sendApplicationConfirmation).toHaveBeenCalledTimes(1);
    const arg = (sendApplicationConfirmation as Mock).mock.calls[0][0];
    expect(arg.toEmail).toBe("mentee@example.test");
    expect(arg.role).toBe("mentee");
    expect(arg.applicationId).toBe("app-1");
  });

  it("redirects to the thank-you page after a successful submission", async () => {
    const result = await runMentee(menteeForm());

    expect(result.redirected).toBe(true);
    expect(redirect).toHaveBeenCalledWith("/apply/thanks?role=mentee");
  });

  it("still redirects when the confirmation email fails — the application is stored", async () => {
    (sendApplicationConfirmation as Mock).mockRejectedValue(new Error("provider down"));

    const result = await runMentee(menteeForm());

    expect(result.redirected).toBe(true);
    expect(submitPilotApplication).toHaveBeenCalled();
  });

  it("does not mail anyone when storage failed", async () => {
    (submitPilotApplication as Mock).mockResolvedValue({
      ok: false,
      code: "duplicate",
      message: "Email này đã có đơn đăng ký trong đợt hiện tại."
    });

    const { state } = await runMentee(menteeForm());

    expect(state?.ok).toBe(false);
    expect(state?.message).toContain("đã có đơn đăng ký");
    expect(sendApplicationConfirmation).not.toHaveBeenCalled();
    expect(recordAcceptedSubmission).not.toHaveBeenCalled();
  });

  it("never surfaces a raw database message to the applicant", async () => {
    (submitPilotApplication as Mock).mockRejectedValue(
      new Error('duplicate key value violates unique constraint "applications_email_key"')
    );

    const { state } = await runMentee(menteeForm());

    expect(state?.ok).toBe(false);
    expect(state?.message).not.toContain("duplicate key");
    expect(state?.message).not.toContain("constraint");
  });
});
