/** @vitest-environment jsdom */
/**
 * A refused application must come back with the applicant's own answers.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE MECHANISM
 * ───────────────────────────────────────────────────────────────────────────
 * Passing a function to `<form action>` hands React ownership of the
 * submission, and react-dom calls `requestFormReset` on the form fiber BEFORE
 * it invokes the action — unconditionally, with no reference to what the
 * action returns. Every uncontrolled control therefore returns to its
 * `defaultValue` when the action settles, whether the server accepted the
 * answers or refused them.
 *
 * The apply forms take their defaults from the draft read ONCE at mount. So
 * the reset restored the form as it looked when the page loaded, which is what
 * Owner UAT reported, in both of its shapes:
 *
 *   - no draft at mount  -> a refusal blanked the form, and the answers came
 *     back only after a manual page reload;
 *   - a draft at mount   -> a refusal reverted edited fields to their earlier
 *     values. An applicant fixing a rejected email watched the old one
 *     reappear and concluded the form "remembers" it. One mentor stopped
 *     after the seventh attempt.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS RESET THE FORM THEMSELVES
 * ───────────────────────────────────────────────────────────────────────────
 * `useFormState` needs a real Server Action, so every suite here mocks it —
 * which also removes React's form-action machinery, and with it the reset.
 * A test that only re-rendered with a refusal would pass against the BROKEN
 * code and prove nothing.
 *
 * So each case calls `form.reset()` at the point React would, and asserts the
 * revert FIRST. That assertion is the bug, reproduced; everything after it is
 * the recovery. jsdom implements `reset()` with the same defaultValue
 * semantics React relies on.
 *
 * Classification: DIRECT PRODUCTION TESTS against the real components.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { expect, test, describe, beforeAll, beforeEach, afterEach, vi } from "vitest";

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
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn(async () => ({ status: "open", state: "open" }))
}));
vi.mock("@/lib/applications-create", () => ({ submitPilotApplication: vi.fn() }));
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
import { saveDraft, getApplyFormAutosaveKey } from "@/lib/autosave";
import { APPLY_TOKEN_FIELD } from "@/lib/apply-types";
import { ApplyMenteeForm } from "@/app/apply/mentee/apply-mentee-form";
import { ApplyMentorForm } from "@/app/apply/mentor/apply-mentor-form";
import { submitMenteeApplicationAction } from "@/app/actions/apply";
import { submitPilotApplication } from "@/lib/applications-create";

const MENTEE_KEY = getApplyFormAutosaveKey("mentee");
const MENTOR_KEY = getApplyFormAutosaveKey("mentor");
const APPLY_TOKEN_VALUE = "pilot_token_abc123";

/** Drives `useFormState` so a test can move the form from idle to answered. */
let currentState: unknown = { ok: false, message: null };

function byName(name: string) {
  return document.querySelector(`[name="${name}"]`) as HTMLInputElement;
}

function theForm() {
  return document.querySelector("form") as HTMLFormElement;
}

async function renderMentee() {
  const utils = render(<ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />);
  await screen.findByRole("button", { name: "Gửi đơn đăng ký mentee" });
  return utils;
}

/**
 * The submit React performs, in the order React performs it: the capture
 * handler sees the form, then the reset lands, then the answer arrives.
 */
function submitAndLetReactReset() {
  fireEvent.submit(theForm());
  theForm().reset();
}

async function answer(view: { rerender: (ui: React.ReactElement) => void }, state: unknown) {
  currentState = state;
  view.rerender(<ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />);
}

/** A refusal the server really produces, not one hand-written to fit. */
async function realDuplicateRefusal() {
  vi.mocked(submitPilotApplication).mockResolvedValue({
    ok: false,
    code: "duplicate",
    message: "Email bạn nhập đã có một đơn đăng ký trong đợt tuyển sinh hiện tại."
  } as never);
  const form = new FormData();
  form.set(APPLY_TOKEN_FIELD, APPLY_TOKEN_VALUE);
  const refusal = await submitMenteeApplicationAction({ ok: false, message: null }, form);
  expect(refusal.ok).toBe(false);
  return refusal;
}

beforeEach(() => {
  localStorage.clear();
  currentState = { ok: false, message: null };
  vi.mocked(useFormState).mockImplementation(() => [currentState, vi.fn()] as never);
  routerMock.replace.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("a refusal keeps what was submitted", () => {
  test("an edited answer survives — it does not revert to the mount-time draft", async () => {
    saveDraft(MENTEE_KEY, { email_primary: "first@example.com", full_name: "Gian Phối Như" });
    const view = await renderMentee();
    expect(byName("email_primary").value).toBe("first@example.com");

    // The applicant corrects the address the server rejected.
    fireEvent.change(byName("email_primary"), { target: { value: "second@example.com" } });
    submitAndLetReactReset();

    // THE BUG, reproduced: the reset has just undone the correction.
    expect(byName("email_primary").value).toBe("first@example.com");

    await answer(view, await realDuplicateRefusal());

    await waitFor(() => {
      expect(byName("email_primary").value).toBe("second@example.com");
    });
    // The untouched answer is still there too.
    expect(byName("full_name").value).toBe("Gian Phối Như");
  });

  test("a first visit with no draft is not blanked", async () => {
    const view = await renderMentee();
    fireEvent.change(byName("full_name"), { target: { value: "Người Nộp Lần Đầu" } });
    fireEvent.change(byName("email_primary"), { target: { value: "lan.dau@example.com" } });
    submitAndLetReactReset();

    // THE BUG: with no draft to restore, the reset emptied every field.
    expect(byName("full_name").value).toBe("");

    await answer(view, await realDuplicateRefusal());

    await waitFor(() => {
      expect(byName("full_name").value).toBe("Người Nộp Lần Đầu");
    });
    expect(byName("email_primary").value).toBe("lan.dau@example.com");
  });

  test("a field the applicant deliberately emptied stays empty", async () => {
    // The restore snapshot records empty answers instead of skipping them, so
    // a cleared field is not refilled from the older keystroke draft.
    saveDraft(MENTEE_KEY, { full_name: "Tên Cũ", email_primary: "giu.nguyen@example.com" });
    const view = await renderMentee();

    fireEvent.change(byName("full_name"), { target: { value: "" } });
    submitAndLetReactReset();
    await answer(view, await realDuplicateRefusal());

    await waitFor(() => {
      expect(byName("email_primary").value).toBe("giu.nguyen@example.com");
    });
    expect(byName("full_name").value).toBe("");
  });

  test("the restore never carries the pilot token into storage", async () => {
    const view = await renderMentee();
    fireEvent.change(byName("full_name"), { target: { value: "Có Token" } });
    submitAndLetReactReset();
    await answer(view, await realDuplicateRefusal());

    await waitFor(() => {
      expect(byName("full_name").value).toBe("Có Token");
    });
    const stored = JSON.parse(localStorage.getItem(MENTEE_KEY) as string).data;
    expect(Object.keys(stored)).not.toContain(APPLY_TOKEN_FIELD);
    expect(JSON.stringify(stored)).not.toContain(APPLY_TOKEN_VALUE);
  });

  test("a confirmed success still clears the draft rather than writing it back", async () => {
    const view = await renderMentee();
    fireEvent.change(byName("full_name"), { target: { value: "Đã Nộp Thành Công" } });
    submitAndLetReactReset();

    await answer(view, { ok: true, applicationId: "app-success", message: null });

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalled();
    });
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("a stored answer beats the field's initial default", () => {
  test("a mentor who changed the pre-ticked programme keeps the change", async () => {
    // `programs_willing_to_join` renders with UEHM pre-ticked. Under the old
    // `defaultSelected ?? draft` order the default won every time, so the
    // mentor's own choice was overwritten on restore.
    saveDraft(MENTOR_KEY, { programs_willing_to_join: ["BK"] });
    render(<ApplyMentorForm applyToken={APPLY_TOKEN_VALUE} />);
    await screen.findByRole("button", { name: "Gửi đơn đăng ký mentor" });

    const ticked = (value: string) =>
      (document.querySelector(
        `input[type="checkbox"][name="programs_willing_to_join"][value="${value}"]`
      ) as HTMLInputElement).checked;

    expect(ticked("BK")).toBe(true);
    expect(ticked("UEHM")).toBe(false);
  });
});
