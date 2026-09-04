/** @vitest-environment jsdom */
/**
 * Mentor application autosave — parity with the mentee contract.
 *
 * The mentor form had NO autosave at all before this change, and its action
 * redirected on success, so there was no point at which a client could learn
 * the write had happened. Bolting `localStorage` onto a redirecting action
 * would have produced the exact failure this suite exists to prevent: a
 * submitted application whose draft survives for a week on a shared machine.
 *
 * So these cases run the ACTUAL `submitMentorApplicationAction` and feed its
 * ACTUAL return value into the form. Hand-writing `{ ok: true }` into the
 * `useFormState` mock would let the suite pass while the real path leaked.
 *
 * Cross-role isolation is asserted in both directions here and in
 * `autosave.test.tsx`, because "mentor draft never restores into mentee" and
 * "mentee draft never restores into mentor" are two different bugs.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { expect, test, describe, beforeAll, beforeEach, afterEach, vi } from "vitest";

beforeAll(() => {
  // main's SubmitAreaAlert scrolls the failure banner into view; jsdom has no
  // implementation.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

// Must be mocked before the component graph is imported: React 18's
// `useFormState` needs a real Server Action, which does not exist here.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ ok: false, message: null }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});

// The mentor action itself is NOT mocked — its success contract is the thing
// under test. Its server-only dependencies are, so it can run in jsdom without
// touching a database.
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn(async () => ({ status: "open", state: "open" }))
}));
vi.mock("@/lib/applications-create", () => ({
  submitPilotApplication: vi.fn()
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`UNEXPECTED_REDIRECT:${target}`);
  }),
  useRouter: () => routerMock
}));

const routerMock = {
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn()
};

import { useFormState } from "react-dom";
import { redirect } from "next/navigation";
import { submitPilotApplication } from "@/lib/applications-create";
import { submitMentorApplicationAction } from "@/app/actions/apply";
import { ApplyMentorForm } from "@/app/apply/mentor/apply-mentor-form";
import { ApplyMenteeForm } from "@/app/apply/mentee/apply-mentee-form";
import {
  saveDraft,
  loadDraft,
  getApplyFormAutosaveKey,
  AUTOSAVE_VERSION,
  type AutosaveData
} from "@/lib/autosave";
import {
  APPLY_TOKEN_FIELD,
  MENTOR_APPLY_SUCCESS_PATH,
  type ApplyActionState
} from "@/lib/apply-types";
import {
  acknowledgementsForRole,
  MENTOR_CONFIRMATION_PHRASE
} from "@/lib/application-commitments";

const MENTOR_KEY = getApplyFormAutosaveKey("mentor");
const MENTEE_KEY = getApplyFormAutosaveKey("mentee");
const APPLY_TOKEN_VALUE = "pilot-token-should-never-be-stored";

function setFormState(state: ApplyActionState) {
  vi.mocked(useFormState).mockReturnValue([state, vi.fn()] as never);
}

async function renderMentor(token: string | null = APPLY_TOKEN_VALUE) {
  const utils = render(<ApplyMentorForm applyToken={token} />);
  // The form renders a loading placeholder until storage has been read.
  await waitFor(() => {
    expect(screen.queryByTestId("apply-draft-notice")).not.toBeNull();
  });
  return utils;
}

const byName = <T extends HTMLElement>(name: string) =>
  document.querySelector<T>(`[name="${name}"]`);

const storedRaw = (key: string) => window.localStorage.getItem(key);
const storedData = (key: string) => loadDraft(key);

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  setFormState({ ok: false, message: null });
  vi.mocked(submitPilotApplication).mockReset();
});

afterEach(cleanup);

// ── A. typing saves ─────────────────────────────────────────────────────────
describe("A. typing saves a mentor draft", () => {
  test("a typed value reaches storage under the MENTOR key", async () => {
    await renderMentor();
    fireEvent.change(byName<HTMLInputElement>("full_name")!, { target: { value: "Trần Văn Mentor" } });

    await waitFor(() => {
      expect(storedData(MENTOR_KEY)?.full_name).toBe("Trần Văn Mentor");
    });
    // Nothing was written under the mentee key.
    expect(storedRaw(MENTEE_KEY)).toBeNull();
  });

  test("only answered fields are stored, not one key per control", async () => {
    await renderMentor();
    const controlCount = document.querySelectorAll("input[name], select[name], textarea[name]").length;
    fireEvent.change(byName<HTMLInputElement>("full_name")!, { target: { value: "Minimal" } });

    await waitFor(() => expect(storedData(MENTOR_KEY)).not.toBeNull());
    const keys = Object.keys(storedData(MENTOR_KEY)!).sort();

    // `programs_willing_to_join` is legitimately present: the mentor form ships
    // with UEHM pre-selected (defaultSelected), so it is a real answer in the
    // form state from first render, not an empty control being swept in.
    expect(keys).toEqual(["full_name", "programs_willing_to_join"]);
    expect(storedData(MENTOR_KEY)!.programs_willing_to_join).toEqual(["UEHM"]);

    // The point of the allowlist: a key per ANSWER, not a key per control.
    expect(controlCount).toBeGreaterThan(20);
    expect(keys.length).toBeLessThan(controlCount);
    // Untouched controls that exist on the page contribute nothing.
    expect(keys).not.toContain("title_current");
    expect(keys).not.toContain("company_current");
    expect(keys).not.toContain(APPLY_TOKEN_FIELD);
  });

  test("the pilot token is never persisted", async () => {
    await renderMentor();
    // The token is rendered as a hidden input in the same form.
    expect(byName<HTMLInputElement>(APPLY_TOKEN_FIELD)!.value).toBe(APPLY_TOKEN_VALUE);

    fireEvent.change(byName<HTMLInputElement>("full_name")!, { target: { value: "Token check" } });
    await waitFor(() => expect(storedData(MENTOR_KEY)).not.toBeNull());

    const raw = storedRaw(MENTOR_KEY)!;
    expect(Object.keys(storedData(MENTOR_KEY)!)).not.toContain(APPLY_TOKEN_FIELD);
    expect(raw).not.toContain(APPLY_TOKEN_VALUE);
  });
});

// ── B. reload restores ──────────────────────────────────────────────────────
describe("B. reload restores the mentor draft", () => {
  test("text fields restore and the banner says so", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Restored Mentor", company_current: "ACME" });
    await renderMentor();

    expect(byName<HTMLInputElement>("full_name")!.value).toBe("Restored Mentor");
    expect(byName<HTMLInputElement>("company_current")!.value).toBe("ACME");
    expect(screen.getByTestId("apply-draft-notice").getAttribute("data-restored")).toBe("true");
  });

  test("a value typed in one visit restores in the next", async () => {
    const { unmount } = await renderMentor();
    fireEvent.change(byName<HTMLInputElement>("title_current")!, { target: { value: "Head of Ops" } });
    await waitFor(() => expect(storedData(MENTOR_KEY)?.title_current).toBe("Head of Ops"));
    unmount();

    await renderMentor();
    expect(byName<HTMLInputElement>("title_current")!.value).toBe("Head of Ops");
  });

  test("the eligibility threshold warning survives a restore", async () => {
    // `workYears`/`managementYears` are driven by onChange only. Without
    // seeding them from the draft the mentor guidance would silently vanish
    // across a reload while the numbers themselves came back.
    saveDraft(MENTOR_KEY, {
      mentor_total_work_years: "3",
      mentor_people_management_years: "1"
    });
    await renderMentor();

    expect(byName<HTMLInputElement>("mentor_total_work_years")!.value).toBe("3");
    expect(byName<HTMLInputElement>("mentor_people_management_years")!.value).toBe("1");
    // 3 < 8 and 1 < 3, so the below-threshold guidance must be on screen.
    expect(
      screen.queryByText(/Theo tiêu chí chung của Mùa 12, Mentor cần có tối thiểu 8 năm/)
    ).not.toBeNull();
  });
});

// ── C/D. cross-role isolation ───────────────────────────────────────────────
describe("C/D. cross-role isolation", () => {
  test("the two roles use different keys", () => {
    expect(MENTOR_KEY).not.toBe(MENTEE_KEY);
    expect(MENTOR_KEY).toContain("mentor");
    expect(MENTEE_KEY).toContain("mentee");
  });

  test("C. a MENTOR draft never restores into the MENTEE form", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Mentor Only" });

    render(<ApplyMenteeForm applyToken={null} />);
    await waitFor(() => expect(screen.queryByTestId("apply-draft-notice")).not.toBeNull());

    expect(byName<HTMLInputElement>("full_name")!.value).toBe("");
    expect(screen.getByTestId("apply-draft-notice").getAttribute("data-restored")).toBe("false");
  });

  test("D. a MENTEE draft never restores into the MENTOR form", async () => {
    saveDraft(MENTEE_KEY, { full_name: "Mentee Only" });
    await renderMentor();

    expect(byName<HTMLInputElement>("full_name")!.value).toBe("");
    expect(screen.getByTestId("apply-draft-notice").getAttribute("data-restored")).toBe("false");
  });

  test("clearing the mentor draft leaves the mentee draft alone", async () => {
    saveDraft(MENTEE_KEY, { full_name: "Mentee Keep" });
    saveDraft(MENTOR_KEY, { full_name: "Mentor Drop" });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await renderMentor();
    fireEvent.click(screen.getByTestId("apply-clear-draft"));

    await waitFor(() => expect(storedRaw(MENTOR_KEY)).toBeNull());
    expect(storedData(MENTEE_KEY)?.full_name).toBe("Mentee Keep");
  });
});

// ── E. malformed draft fails safely ─────────────────────────────────────────
describe("E. malformed drafts fail safely", () => {
  const badPayloads: Array<[string, string]> = [
    ["not JSON at all", "{{{"],
    ["a JSON array", JSON.stringify([1, 2, 3])],
    ["a wrong envelope version", JSON.stringify({ version: AUTOSAVE_VERSION + 99, savedAt: Date.now(), data: { full_name: "x" } })],
    ["a non-numeric savedAt", JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: "yesterday", data: { full_name: "x" } })],
    ["a non-object data", JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: Date.now(), data: "nope" })],
    ["a wrongly typed value", JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { full_name: 42 } })]
  ];

  for (const [label, raw] of badPayloads) {
    test(`${label} renders an empty form and is discarded`, async () => {
      window.localStorage.setItem(MENTOR_KEY, raw);
      await renderMentor();

      expect(byName<HTMLInputElement>("full_name")!.value).toBe("");
      expect(screen.getByTestId("apply-draft-notice").getAttribute("data-restored")).toBe("false");
      // A draft that fails validation is removed, not carried around forever.
      expect(storedRaw(MENTOR_KEY)).toBeNull();
    });
  }

  test("a credential-shaped key inside an otherwise good draft is dropped, neighbours kept", async () => {
    window.localStorage.setItem(
      MENTOR_KEY,
      JSON.stringify({
        version: AUTOSAVE_VERSION,
        savedAt: Date.now(),
        data: { full_name: "Good", [APPLY_TOKEN_FIELD]: "stolen", auth_token: "stolen" }
      })
    );
    await renderMentor();

    expect(byName<HTMLInputElement>("full_name")!.value).toBe("Good");
    expect(byName<HTMLInputElement>(APPLY_TOKEN_FIELD)!.value).toBe(APPLY_TOKEN_VALUE);
  });
});

// ── P. storage unavailable ──────────────────────────────────────────────────
describe("P. storage failures never block the form", () => {
  test("a throwing setItem does not prevent rendering or typing", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderMentor();
    const nameInput = byName<HTMLInputElement>("full_name")!;
    fireEvent.change(nameInput, { target: { value: "Quota" } });

    // The value the applicant typed is still in the form; only the draft was lost.
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(nameInput.value).toBe("Quota");
    expect(screen.queryByTestId("apply-draft-notice")).not.toBeNull();

    setItem.mockRestore();
    errorSpy.mockRestore();
  });

  test("a throwing getItem renders a clean form rather than crashing", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderMentor();
    expect(byName<HTMLInputElement>("full_name")!.value).toBe("");

    getItem.mockRestore();
    errorSpy.mockRestore();
  });
});

// ── O. explicit clear ───────────────────────────────────────────────────────
describe("O. explicit Clear Draft", () => {
  test("confirming removes the draft and empties the fields", async () => {
    saveDraft(MENTOR_KEY, { full_name: "To Be Cleared" });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await renderMentor();
    expect(byName<HTMLInputElement>("full_name")!.value).toBe("To Be Cleared");

    fireEvent.click(screen.getByTestId("apply-clear-draft"));

    await waitFor(() => expect(storedRaw(MENTOR_KEY)).toBeNull());
    await waitFor(() => expect(byName<HTMLInputElement>("full_name")!.value).toBe(""));
  });

  test("declining the confirmation keeps the draft", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Keep Me" });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await renderMentor();
    fireEvent.click(screen.getByTestId("apply-clear-draft"));

    expect(storedData(MENTOR_KEY)?.full_name).toBe("Keep Me");
    expect(byName<HTMLInputElement>("full_name")!.value).toBe("Keep Me");
  });
});

// ── F–J. the real mentor action ─────────────────────────────────────────────
describe("F–J. the real mentor success and failure contract", () => {
  function validMentorForm(overrides: Record<string, string> = {}) {
    const form = new FormData();
    form.set(APPLY_TOKEN_FIELD, APPLY_TOKEN_VALUE);
    form.set("full_name", "Trần Văn Mentor");
    form.set("email_primary", "mentor@example.com");
    form.set("phone_primary", "0901234567");
    form.set("gender", "male");
    form.set("consent_data_storage", "true");
    form.append("consent_contact_methods", "email");
    form.set("company_current", "ACME Corp");
    form.set("title_current", "Head of Operations");
    form.set("years_of_experience", "10");
    form.set("industry_primary", "tech");
    form.set("function_primary", "operations");
    form.set("university", "UEH");
    form.set("motivation_text", "m".repeat(120));
    form.set("can_attend_orientation", "yes");
    form.set("open_to_intro_call", "yes");
    form.set("mentoring_capacity_total", "2");
    form.append("programs_willing_to_join", "uehm");
    form.set("mentor_total_work_years", "10");
    form.set("mentor_people_management_years", "4");
    form.set("mentor_largest_team_size", "6");
    for (const entry of acknowledgementsForRole("mentor")) {
      if (entry.key.endsWith("ACTIVE_READING_V1")) continue;
      form.set(entry.key, "true");
    }
    form.set("MENTOR_ACTIVE_READING_V1", MENTOR_CONFIRMATION_PHRASE);
    for (const [key, value] of Object.entries(overrides)) form.set(key, value);
    return form;
  }

  const runAction = (form: FormData) =>
    submitMentorApplicationAction({ ok: false, message: null }, form);

  test("J. the action returns confirmed success instead of redirecting", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "mentor-1" } as never);

    const result = await runAction(validMentorForm());

    expect(result).toMatchObject({ ok: true, applicationId: "mentor-1" });
    // If it still redirected, the client would never observe this state at all.
    expect(vi.mocked(redirect)).not.toHaveBeenCalled();
  });

  test("F. a validation failure returns ok:false with no applicationId", async () => {
    const result = await runAction(validMentorForm({ full_name: "" }));
    expect(result.ok).toBe(false);
    expect(result.applicationId).toBeUndefined();
    // Never reached the database.
    expect(vi.mocked(submitPilotApplication)).not.toHaveBeenCalled();
  });

  test("G. a gate refusal returns ok:false with no applicationId", async () => {
    const { evaluateApplyGate } = await import("@/lib/apply-gate");
    vi.mocked(evaluateApplyGate).mockResolvedValueOnce({ status: "closed", state: "closed" } as never);

    const result = await runAction(validMentorForm());
    expect(result.ok).toBe(false);
    expect(result.applicationId).toBeUndefined();
    expect(vi.mocked(submitPilotApplication)).not.toHaveBeenCalled();
  });

  test("H. a returning-mentor refusal returns ok:false and its errorKind", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({
      ok: false,
      message: "Đã có hồ sơ mentor.",
      reason: "returning_mentor"
    } as never);

    const result = await runAction(validMentorForm());
    expect(result.ok).toBe(false);
    expect(result.applicationId).toBeUndefined();
    expect(result.errorKind).toBe("returning_mentor");
  });

  test("H. a duplicate application returns ok:false with no applicationId", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({
      ok: false,
      message: "Email này đã nộp đơn."
    } as never);

    const result = await runAction(validMentorForm());
    expect(result.ok).toBe(false);
    expect(result.applicationId).toBeUndefined();
  });

  test("I. a thrown database fault returns ok:false with no applicationId", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(submitPilotApplication).mockRejectedValue(new Error("connection reset"));

    const result = await runAction(validMentorForm());
    expect(result.ok).toBe(false);
    expect(result.applicationId).toBeUndefined();
    // The raw fault is not shown to the applicant.
    expect(result.message ?? "").not.toContain("connection reset");
    errorSpy.mockRestore();
  });
});

// ── F–I (client side). every failure shape preserves the draft ──────────────
describe("F–I. failure states preserve the mentor draft", () => {
  const failures: Array<[string, ApplyActionState]> = [
    ["F. validation", { ok: false, message: "Thiếu trường bắt buộc: full_name." }],
    ["G. gate refusal", { ok: false, message: "Đơn đăng ký cho vai trò này hiện chưa được mở." }],
    ["H. returning mentor", { ok: false, message: "Đã có hồ sơ mentor.", errorKind: "returning_mentor" }],
    ["H. duplicate", { ok: false, message: "Email này đã nộp đơn." }],
    ["I. database fault", { ok: false, message: "Đã xảy ra lỗi. Vui lòng thử lại." }],
    // ok:true with NO applicationId is not a confirmed create and must not clear.
    ["ok without applicationId", { ok: true, message: "Đã ghi nhận đơn đăng ký." }]
  ];

  for (const [label, state] of failures) {
    test(`${label} keeps the draft and does not navigate`, async () => {
      saveDraft(MENTOR_KEY, { full_name: "Survivor" });
      setFormState(state);

      await renderMentor();

      expect(storedData(MENTOR_KEY)?.full_name).toBe("Survivor");
      expect(routerMock.replace).not.toHaveBeenCalled();
    });
  }
});

// ── J–N. confirmed success clears, exactly once, before navigation ──────────
describe("J–N. confirmed success clears the mentor draft", () => {
  test("J/K. the draft is gone BEFORE the navigation is issued", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Submitted" });

    let storageAtNavigation: string | null = "not-captured";
    routerMock.replace.mockImplementation(() => {
      storageAtNavigation = storedRaw(MENTOR_KEY);
    });

    setFormState({ ok: true, message: "Đã ghi nhận đơn đăng ký.", applicationId: "mentor-9" });
    await renderMentor();

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    // Ordering, not just eventual consistency: once replace() runs the
    // component is on its way out and a queued clear is not guaranteed to run.
    expect(storageAtNavigation).toBeNull();
    expect(routerMock.replace).toHaveBeenCalledWith(MENTOR_APPLY_SUCCESS_PATH);
  });

  test("M. re-rendering the same success state clears and navigates exactly once", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Submitted" });
    setFormState({ ok: true, message: "ok", applicationId: "mentor-9" });

    const { rerender } = await renderMentor();
    rerender(<ApplyMentorForm applyToken={APPLY_TOKEN_VALUE} />);
    rerender(<ApplyMentorForm applyToken={APPLY_TOKEN_VALUE} />);

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    expect(storedRaw(MENTOR_KEY)).toBeNull();
  });

  test("N1. a snapshot QUEUED before success cannot resurrect the draft", async () => {
    setFormState({ ok: false, message: null });
    const { rerender } = await renderMentor();

    fireEvent.change(byName<HTMLInputElement>("full_name")!, { target: { value: "In Flight" } });
    // Do NOT await the debounce: flip to confirmed success while the snapshot
    // is still queued, which is the real race after a fast submit.
    setFormState({ ok: true, message: "ok", applicationId: "mentor-9" });
    rerender(<ApplyMentorForm applyToken={APPLY_TOKEN_VALUE} />);

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    // Give any pending timer more than enough time to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(storedRaw(MENTOR_KEY)).toBeNull();
  });

  test("N2. a keystroke AFTER success cannot re-open the writer", async () => {
    // The harder half of the race, and the one cancelling a timer does not
    // cover. Navigation is mocked, so the component is still mounted and its
    // change handler is still attached; a late keystroke — an IME commit, an
    // autofill, a browser restoring focus — would schedule a BRAND NEW
    // snapshot after the draft was cleared. Only a permanent latch stops that.
    setFormState({ ok: false, message: null });
    const { rerender } = await renderMentor();
    fireEvent.change(byName<HTMLInputElement>("full_name")!, { target: { value: "Before" } });
    await waitFor(() => expect(storedData(MENTOR_KEY)?.full_name).toBe("Before"));

    setFormState({ ok: true, message: "ok", applicationId: "mentor-9" });
    rerender(<ApplyMentorForm applyToken={APPLY_TOKEN_VALUE} />);
    await waitFor(() => expect(storedRaw(MENTOR_KEY)).toBeNull());

    // Success is confirmed and the draft is gone. Now type again.
    fireEvent.change(byName<HTMLInputElement>("full_name")!, { target: { value: "After success" } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(storedRaw(MENTOR_KEY)).toBeNull();
  });

  test("L. visiting the thank-you URL alone does not clear a draft", async () => {
    // No confirmed success state: the applicant simply navigated to the
    // success URL, or came back to the form afterwards. A draft must survive,
    // because nothing has been written to the database.
    saveDraft(MENTOR_KEY, { full_name: "Still Mine" });
    setFormState({ ok: false, message: null });

    await renderMentor();

    expect(storedData(MENTOR_KEY)?.full_name).toBe("Still Mine");
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  test("returning to the form after a successful submission restores nothing", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Submitted" });
    setFormState({ ok: true, message: "ok", applicationId: "mentor-9" });
    const { unmount } = await renderMentor();
    await waitFor(() => expect(storedRaw(MENTOR_KEY)).toBeNull());
    unmount();

    setFormState({ ok: false, message: null });
    await renderMentor();

    expect(byName<HTMLInputElement>("full_name")!.value).toBe("");
    expect(screen.getByTestId("apply-draft-notice").getAttribute("data-restored")).toBe("false");
  });
});
