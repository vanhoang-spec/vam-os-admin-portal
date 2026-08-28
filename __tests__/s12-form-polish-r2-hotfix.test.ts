import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateApplyGate: vi.fn(),
  submitPilotApplication: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/apply-gate", () => ({ evaluateApplyGate: mocks.evaluateApplyGate }));
vi.mock("@/lib/applications-create", () => ({
  submitPilotApplication: mocks.submitPilotApplication
}));

import { submitMentorApplicationAction } from "@/app/actions/apply";
import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  requiredCheckboxAcknowledgements
} from "@/lib/application-commitments";

function validMentorForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    full_name: "Mentor Test",
    email_primary: "mentor@example.com",
    phone_primary: "0901234567",
    consent_data_storage: "true",
    company_current: "Acme",
    title_current: "Director",
    years_of_experience: "11-15",
    industry_primary: "technology",
    function_primary: "marketing",
    university: "UEH",
    motivation_text: "Support the next generation",
    can_attend_orientation: "yes",
    open_to_intro_call: "yes",
    mentoring_capacity_total: "2",
    mentor_total_work_years: "12",
    mentor_people_management_years: "5",
    mentor_largest_team_size: "8",
    [ACTIVE_READING_KEYS.mentor]: CONFIRMATION_PHRASES.mentor
  })) {
    form.set(key, value);
  }
  form.set("consent_contact_methods", "email");
  form.set("programs_willing_to_join", "UEHM");
  for (const entry of requiredCheckboxAcknowledgements("mentor")) form.set(entry.key, "true");
  return form;
}

async function submit(form: FormData) {
  return submitMentorApplicationAction({ ok: false, message: "" }, form);
}

function capturedRawPayload() {
  expect(mocks.submitPilotApplication).toHaveBeenCalledOnce();
  return mocks.submitPilotApplication.mock.calls[0][0].rawPayload as Record<string, unknown>;
}

describe("S12 form polish R2 — New Mentor server submission path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateApplyGate.mockResolvedValue({ status: "open", state: "open" });
    mocks.submitPilotApplication.mockResolvedValue({
      ok: false,
      code: "validation",
      message: "captured"
    });
  });

  it("allows blank optional mentoring_topics through validation and submits it as null", async () => {
    const result = await submit(validMentorForm());

    expect(result).toEqual({ ok: false, message: "captured" });
    expect(capturedRawPayload()).toHaveProperty("mentoring_topics", null);
  });

  it("normalizes whitespace-only mentoring_topics to null before submission", async () => {
    const form = validMentorForm();
    form.set("mentoring_topics", "   \t\n  ");

    await submit(form);

    expect(capturedRawPayload()).toHaveProperty("mentoring_topics", null);
  });

  it("passes trimmed nonblank mentoring_topics to submitPilotApplication", async () => {
    const form = validMentorForm();
    form.set("mentoring_topics", "  Career strategy and leadership  ");

    await submit(form);

    expect(capturedRawPayload()).toHaveProperty(
      "mentoring_topics",
      "Career strategy and leadership"
    );
  });

  it("still rejects New Mentor university OTHER without university_other server-side", async () => {
    const form = validMentorForm();
    form.set("university", "OTHER");
    form.set("university_other", "   ");

    const result = await submit(form);

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: [{ name: "university_other", label: "Trường đại học" }]
    });
    expect(mocks.submitPilotApplication).not.toHaveBeenCalled();
  });
});
