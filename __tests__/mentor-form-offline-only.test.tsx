/** @vitest-environment jsdom */
/**
 * Form nộp đơn mentor: khóa mentoring Online, chỉ để Offline — mặc định như vậy
 * (chủ dự án chốt 17/09/2026).
 *
 * Khóa trên màn hình chưa phải là khóa: ô form là thứ người nộp tự đặt được, và một
 * tab mở từ trước khi khóa vẫn gửi "online". Canh: quy tắc dùng chung, server action
 * thật ghi gì vào đơn, và form thật gửi gì — kể cả khi khôi phục bản nháp cũ.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateApplyGate: vi.fn(),
  submitPilotApplication: vi.fn(),
  sendApplicationConfirmation: vi.fn()
}));

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ ok: false, message: null }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() })
}));
vi.mock("@/lib/apply-gate", () => ({ evaluateApplyGate: mocks.evaluateApplyGate }));
vi.mock("@/lib/applications-create", () => ({ submitPilotApplication: mocks.submitPilotApplication }));
vi.mock("@/lib/email", () => ({ sendApplicationConfirmation: mocks.sendApplicationConfirmation }));

import { submitMentorApplicationAction } from "@/app/actions/apply";
import { ApplyMentorForm } from "@/app/apply/mentor/apply-mentor-form";
import { ACTIVE_READING_KEYS, CONFIRMATION_PHRASES, requiredCheckboxAcknowledgements } from "@/lib/application-commitments";
import { getApplyFormAutosaveKey, loadDraft, saveDraft } from "@/lib/autosave";
import {
  MENTOR_MEETING_FORMAT_OPTIONS,
  MENTOR_MEETING_FORMATS_OPEN,
  mentorMeetingFormatsForSubmission
} from "@/lib/mentor-intake-content";

const FIELD = "meeting_format_preference";
const MENTOR_KEY = getApplyFormAutosaveKey("mentor");

describe("1. quy tắc dùng chung", () => {
  it("chỉ Offline mở; Online và Cả hai khóa nhưng vẫn là lựa chọn hiện trên form", () => {
    expect(MENTOR_MEETING_FORMATS_OPEN).toEqual(["offline"]);
    expect(MENTOR_MEETING_FORMAT_OPTIONS.map((option) => [option.value, option.locked])).toEqual([
      ["offline", false],
      ["online", true],
      ["both", true]
    ]);
  });

  it.each([
    [["online"], ["offline"]],
    [["both"], ["offline"]],
    [["online", "offline", "both"], ["offline"]],
    [["offline", "offline"], ["offline"]],
    [[], ["offline"]],
    [["zoom"], ["offline"]]
  ])("form gửi %j thì đơn ghi %j", (submitted, stored) => {
    expect(mentorMeetingFormatsForSubmission(submitted)).toEqual(stored);
  });
});

describe("2. server action thật ghi Offline bất kể form gửi gì", () => {
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
      industry_primary: "tech",
      function_primary: "marketing",
      university: "UEH",
      motivation_text: "m".repeat(120),
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

  async function storedFormats(form: FormData) {
    const state = await submitMentorApplicationAction({ ok: false, message: null }, form);
    expect(state.ok).toBe(true);
    expect(mocks.submitPilotApplication).toHaveBeenCalledTimes(1);
    return mocks.submitPilotApplication.mock.calls[0][0].rawPayload[FIELD];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateApplyGate.mockResolvedValue({ status: "open", state: "open" });
    mocks.submitPilotApplication.mockResolvedValue({ ok: true, applicationId: "00000000-0000-4000-8000-000000000a01" });
    mocks.sendApplicationConfirmation.mockResolvedValue({ ok: true, skipped: false });
  });

  it("tab cũ gửi Online và Cả hai: đơn ghi Offline", async () => {
    const form = validMentorForm();
    form.append(FIELD, "online");
    form.append(FIELD, "both");
    expect(await storedFormats(form)).toEqual(["offline"]);
  });

  it("form không gửi gì cho ô này: đơn vẫn ghi Offline, không để trống", async () => {
    expect(await storedFormats(validMentorForm())).toEqual(["offline"]);
  });
});

describe("3. form thật", () => {
  async function renderMentor() {
    const view = render(<ApplyMentorForm applyToken={null} />);
    await waitFor(() => expect(screen.queryByTestId("apply-draft-notice")).not.toBeNull());
    return view;
  }

  function fieldset() {
    const found = document.querySelector(`fieldset[data-field-name="${FIELD}"]`);
    if (!found) throw new Error("missing meeting format fieldset");
    return found as HTMLFieldSetElement;
  }

  function checkbox(value: string) {
    return fieldset().querySelector(`input[type="checkbox"][value="${value}"]`) as HTMLInputElement;
  }

  function submittedFormats() {
    return new FormData(document.querySelector("form") as HTMLFormElement).getAll(FIELD);
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(cleanup);

  it("Offline tick sẵn và không bỏ được; Online, Cả hai mờ và ghi tạm khóa", async () => {
    await renderMentor();
    expect(checkbox("offline").checked).toBe(true);
    expect(checkbox("offline").disabled).toBe(true);
    for (const value of ["online", "both"]) {
      expect(checkbox(value).checked).toBe(false);
      expect(checkbox(value).disabled).toBe(true);
    }
    expect(fieldset().textContent?.match(/tạm khóa/g)).toHaveLength(2);
  });

  it("form gửi đúng một giá trị: offline", async () => {
    await renderMentor();
    expect(submittedFormats()).toEqual(["offline"]);
    expect(document.querySelectorAll(`[name="${FIELD}"]`)).toHaveLength(1);
  });

  it("bản nháp từ trước khi khóa có Online: không tick lại, form vẫn gửi offline", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Mentor Cũ", [FIELD]: ["online", "both"] });
    await renderMentor();
    expect((document.querySelector('[name="full_name"]') as HTMLInputElement).value).toBe("Mentor Cũ");
    expect(checkbox("online").checked).toBe(false);
    expect(checkbox("both").checked).toBe(false);
    expect(submittedFormats()).toEqual(["offline"]);
  });

  it("gõ ô khác thì bản nháp lưu ô đó, không lưu hình thức gặp", async () => {
    await renderMentor();
    fireEvent.change(document.querySelector('[name="full_name"]') as HTMLInputElement, { target: { value: "Mentor Mới" } });
    await waitFor(() => expect(loadDraft(MENTOR_KEY)?.full_name).toBe("Mentor Mới"));
    expect(Object.keys(loadDraft(MENTOR_KEY) ?? {})).not.toContain(FIELD);
  });
});
