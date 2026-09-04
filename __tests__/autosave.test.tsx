/** @vitest-environment jsdom */
/**
 * Mentee application autosave.
 *
 * WHAT THE PREVIOUS VERSION OF THIS FILE PROVED, AND DID NOT
 * ----------------------------------------------------------
 * Fourteen of its sixteen tests did not run at all: `fireEvent` was used but
 * never imported, so every case that typed into the form died on a
 * ReferenceError, and the matchers it asserted with (`toHaveValue`,
 * `toBeInTheDocument`) come from `jest-dom`, which this repository does not
 * install. The suite was red, not green.
 *
 * The one security test that did run checked the WRONG KEY. The pilot relay
 * field is `__apply_token` (two leading underscores — see
 * `lib/apply-types.ts`); the test asserted `_apply_token` was absent, which was
 * true for a reason unrelated to safety, while the real token sat in the draft.
 *
 * So this file is rebuilt to assert against the real names and the real DOM,
 * with no matcher library and no placeholder assertions. Rendering this form is
 * expensive in jsdom (several hundred controls), so the storage-contract cases
 * exercise `lib/autosave.ts` directly and only the cases that genuinely need
 * the component render it.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { expect, test, describe, beforeAll, beforeEach, afterEach, vi } from "vitest";

// main's SubmitAreaAlert scrolls the failure banner into view; jsdom has no
// implementation. Same stub the other form suites use.
beforeAll(() => {
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

// The mentee action itself is NOT mocked — its success contract is the thing
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

const routerMock = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };

import { useFormState } from "react-dom";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  getAutosaveKey,
  getApplyFormAutosaveKey,
  isAutosaveSafeFieldName,
  AUTOSAVE_VERSION,
  AUTOSAVE_TTL_DAYS,
  AUTOSAVE_TTL_MS,
  type AutosaveData
} from "@/lib/autosave";
import { ApplyMenteeForm } from "@/app/apply/mentee/apply-mentee-form";
import { submitMenteeApplicationAction } from "@/app/actions/apply";
import { submitPilotApplication } from "@/lib/applications-create";
import { evaluateApplyGate } from "@/lib/apply-gate";
import { redirect } from "next/navigation";
import { APPLY_TOKEN_FIELD, MENTEE_APPLY_SUCCESS_PATH } from "@/lib/apply-types";
import { SEASON_CONFIG } from "@/lib/season-config";
import {
  APPLICATION_ACKNOWLEDGEMENTS,
  MENTEE_CONFIRMATION_PHRASE,
  acknowledgementsForRole
} from "@/lib/application-commitments";

const MENTEE_KEY = getApplyFormAutosaveKey("mentee");
const MENTOR_KEY = getApplyFormAutosaveKey("mentor");
const OTHER_SEASON_KEY = getAutosaveKey("VAM", "UEHM-S11", "mentee", "v1");
const OTHER_FORM_VERSION_KEY = getAutosaveKey("VAM", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE, "mentee", "v2");

const APPLY_TOKEN_VALUE = "pilot_token_abc123";

function writeRaw(key: string, raw: string) {
  localStorage.setItem(key, raw);
}

/** Writes a payload envelope directly, bypassing `saveDraft`'s sanitising. */
function writeEnvelope(key: string, envelope: unknown) {
  localStorage.setItem(key, JSON.stringify(envelope));
}

function storedData(key: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw).data;
}

function renderForm() {
  return render(<ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />);
}

/** The form defers its first paint until the draft has been read. */
async function renderFormReady() {
  const utils = renderForm();
  await screen.findByRole("button", { name: "Gửi đơn đăng ký mentee" });
  return utils;
}

function input(label: RegExp | string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

/**
 * Query by control NAME rather than by label where a label is ambiguous:
 * "Giới tính" also appears inside "Bạn có ưu tiên giới tính mentor không?", and
 * "Email" is both the contact field and a notification-channel checkbox.
 */
function byName<T extends HTMLElement = HTMLInputElement>(name: string) {
  return document.querySelector<T>(`[name="${name}"]`);
}

function checkboxByValue(name: string, value: string) {
  return document.querySelector<HTMLInputElement>(
    `input[type="checkbox"][name="${name}"][value="${value}"]`
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(useFormState).mockImplementation(() => [{ ok: false, message: null }, vi.fn()] as never);
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  vi.mocked(redirect).mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("key isolation", () => {
  test("a key is scoped by program, season, role and form version", () => {
    expect(MENTEE_KEY).toBe(`vam_autosave_VAM_${SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE}_mentee_v1`);
    expect(MENTEE_KEY).not.toBe(MENTOR_KEY);
    expect(MENTEE_KEY).not.toBe(OTHER_SEASON_KEY);
    expect(MENTEE_KEY).not.toBe(OTHER_FORM_VERSION_KEY);
  });

  test("the TTL contract is seven days", () => {
    expect(AUTOSAVE_TTL_DAYS).toBe(7);
    expect(AUTOSAVE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("8. a mentor draft does not restore into the mentee form", async () => {
    saveDraft(MENTOR_KEY, { full_name: "Mentor Name" });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("");
    expect(screen.queryByText("Đã khôi phục bản nháp chưa gửi.")).toBeNull();
  });

  test("9. a draft from another season does not restore", async () => {
    saveDraft(OTHER_SEASON_KEY, { full_name: "Old Mentee" });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("");
  });

  test("10. a draft from another form version does not restore", async () => {
    saveDraft(OTHER_FORM_VERSION_KEY, { full_name: "Next Form" });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("structural validation of stored drafts", () => {
  // Every case here is a payload localStorage will happily hand back. Valid
  // JSON is not evidence of a valid draft: this is a shared-browser feature, so
  // the store is writable by anyone who sat at the machine.
  const invalidEnvelopes: Array<[string, unknown]> = [
    ["an empty object", {}],
    ["an array", []],
    ["null", null],
    ["a string", "just a string"],
    ["a number", 42],
    ["the wrong version", { version: AUTOSAVE_VERSION + 1, savedAt: Date.now(), data: { full_name: "x" } }],
    ["a missing version", { savedAt: Date.now(), data: { full_name: "x" } }],
    ["a missing savedAt", { version: AUTOSAVE_VERSION, data: { full_name: "x" } }],
    ["a string savedAt", { version: AUTOSAVE_VERSION, savedAt: String(Date.now()), data: { full_name: "x" } }],
    ["a null savedAt", { version: AUTOSAVE_VERSION, savedAt: null, data: { full_name: "x" } }],
    ["missing data", { version: AUTOSAVE_VERSION, savedAt: Date.now() }],
    ["array data", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: ["full_name", "x"] }],
    ["null data", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: null }],
    ["a nested object value", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { full_name: { first: "x" } } }],
    ["a numeric value", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { full_name: 42 } }],
    ["a boolean value", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { consent_data_storage: true } }],
    ["a null value", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { full_name: null } }],
    ["an array of non-strings", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { target_soft_skills: [1, 2] } }],
    ["an array containing an object", { version: AUTOSAVE_VERSION, savedAt: Date.now(), data: { target_soft_skills: [{ a: 1 }] } }]
  ];

  test.each(invalidEnvelopes)("rejects and removes %s", (_label, envelope) => {
    writeEnvelope(MENTEE_KEY, envelope);
    expect(loadDraft(MENTEE_KEY)).toBeNull();
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });

  test("12. malformed JSON fails safe and is removed", () => {
    writeRaw(MENTEE_KEY, "{ corrupted JSON");
    expect(loadDraft(MENTEE_KEY)).toBeNull();
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });

  test("NaN serialises to null and is rejected", () => {
    // JSON has no NaN literal — it round-trips as null, which the finite check
    // has to catch or the age comparison silently becomes NaN > ttl === false.
    writeRaw(MENTEE_KEY, `{"version":${AUTOSAVE_VERSION},"savedAt":${JSON.stringify(Number.NaN)},"data":{}}`);
    expect(loadDraft(MENTEE_KEY)).toBeNull();
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });

  test("11. a draft older than seven days does not restore and is removed", () => {
    writeEnvelope(MENTEE_KEY, {
      version: AUTOSAVE_VERSION,
      savedAt: Date.now() - (AUTOSAVE_TTL_MS + 60_000),
      data: { full_name: "Expired Mentee" }
    });
    expect(loadDraft(MENTEE_KEY)).toBeNull();
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });

  test("a draft just inside seven days still restores", () => {
    writeEnvelope(MENTEE_KEY, {
      version: AUTOSAVE_VERSION,
      savedAt: Date.now() - (AUTOSAVE_TTL_MS - 60_000),
      data: { full_name: "Still Fresh" }
    });
    expect(loadDraft(MENTEE_KEY)).toEqual({ full_name: "Still Fresh" });
  });

  test("a savedAt far in the future is rejected rather than living forever", () => {
    writeEnvelope(MENTEE_KEY, {
      version: AUTOSAVE_VERSION,
      savedAt: Date.now() + 48 * 60 * 60 * 1000,
      data: { full_name: "Time Traveller" }
    });
    expect(loadDraft(MENTEE_KEY)).toBeNull();
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });

  test("a savedAt within clock-skew tolerance is accepted", () => {
    writeEnvelope(MENTEE_KEY, {
      version: AUTOSAVE_VERSION,
      savedAt: Date.now() + 30_000,
      data: { full_name: "Slightly Ahead" }
    });
    expect(loadDraft(MENTEE_KEY)).toEqual({ full_name: "Slightly Ahead" });
  });

  test("an unsafe field name inside an otherwise valid draft is dropped, not restored", () => {
    writeEnvelope(MENTEE_KEY, {
      version: AUTOSAVE_VERSION,
      savedAt: Date.now(),
      data: {
        full_name: "Real Answer",
        [APPLY_TOKEN_FIELD]: APPLY_TOKEN_VALUE,
        _apply_token: APPLY_TOKEN_VALUE,
        csrf_token: "x",
        session_id: "y"
      }
    });
    expect(loadDraft(MENTEE_KEY)).toEqual({ full_name: "Real Answer" });
  });

  test("13. a structurally corrupt draft does not crash the form and does not restore", async () => {
    writeEnvelope(MENTEE_KEY, { version: AUTOSAVE_VERSION, savedAt: "not-a-number", data: { full_name: "Corrupt" } });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("");
    expect(screen.queryByText("Đã khôi phục bản nháp chưa gửi.")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("field-name safety contract", () => {
  test("the pilot relay field and credential-shaped names are refused", () => {
    for (const name of [
      APPLY_TOKEN_FIELD,
      "_apply_token",
      "__next_internal",
      "applyToken",
      "token_hash",
      "csrf_token",
      "auth_user_id",
      "session_id",
      "password",
      "api_key",
      ""
    ]) {
      expect({ name, safe: isAutosaveSafeFieldName(name) }).toEqual({ name, safe: false });
    }
  });

  test("real mentee field names are allowed", () => {
    for (const name of [
      "full_name",
      "email_primary",
      "phone_primary",
      "target_soft_skills",
      "target_soft_skills_other",
      "one_year_vision_text",
      "MENTEE_ACTIVE_READING_V1",
      "consent_data_storage",
      "mentor_gender_preference"
    ]) {
      expect({ name, safe: isAutosaveSafeFieldName(name) }).toEqual({ name, safe: true });
    }
  });

  test("saveDraft refuses to persist an unsafe name even if handed one", () => {
    saveDraft(MENTEE_KEY, {
      full_name: "Safe Person",
      [APPLY_TOKEN_FIELD]: APPLY_TOKEN_VALUE,
      auth_session: "nope"
    } as AutosaveData);
    expect(storedData(MENTEE_KEY)).toEqual({ full_name: "Safe Person" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("what the form actually writes", () => {
  test("17/18/19. visible answers are stored; __apply_token and hidden fields are not", async () => {
    await renderFormReady();

    // The token really is on the form — otherwise this test proves nothing.
    const hidden = document.querySelector<HTMLInputElement>(`input[name="${APPLY_TOKEN_FIELD}"]`);
    expect(hidden?.value).toBe(APPLY_TOKEN_VALUE);

    // A hidden field a future change might add. It is in the FormData and is
    // still not stored, because the snapshot reads the registered allowlist
    // rather than the FormData.
    const smuggled = document.createElement("input");
    smuggled.type = "hidden";
    smuggled.name = "internal_security_context";
    smuggled.value = "super-secret";
    hidden?.form?.appendChild(smuggled);

    fireEvent.change(input(/Họ và tên/i), { target: { value: "Nguyễn Văn Ánh" } });

    await waitFor(() => {
      expect(storedData(MENTEE_KEY)).not.toBeNull();
    });

    const data = storedData(MENTEE_KEY)!;
    expect(data.full_name).toBe("Nguyễn Văn Ánh");
    expect(APPLY_TOKEN_FIELD in data).toBe(false);
    expect("_apply_token" in data).toBe(false);
    expect("internal_security_context" in data).toBe(false);

    const raw = localStorage.getItem(MENTEE_KEY)!;
    expect(raw).not.toContain(APPLY_TOKEN_VALUE);
    expect(raw).not.toContain("super-secret");
  });

  test("the stored envelope carries the expected version and a finite savedAt", async () => {
    await renderFormReady();
    fireEvent.change(input(/Họ và tên/i), { target: { value: "Envelope" } });
    await waitFor(() => {
      const payload = JSON.parse(localStorage.getItem(MENTEE_KEY) ?? "null");
      expect(payload?.version).toBe(AUTOSAVE_VERSION);
      expect(Number.isFinite(payload?.savedAt)).toBe(true);
    });
  });

  test("a single ticked checkbox is stored as an array, not a bare string", async () => {
    await renderFormReady();
    const leadership = checkboxByValue("target_soft_skills", "leadership")!;
    fireEvent.click(leadership);
    await waitFor(() => {
      expect(storedData(MENTEE_KEY)?.target_soft_skills).toEqual(["leadership"]);
    });
  });

  test("1. typing persists the value", async () => {
    await renderFormReady();
    fireEvent.change(input(/Họ và tên/i), { target: { value: "Nguyen Van A" } });
    await waitFor(() => {
      expect(loadDraft(MENTEE_KEY)?.full_name).toBe("Nguyen Van A");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("restoration", () => {
  test("2. text fields restore on reload", async () => {
    saveDraft(MENTEE_KEY, { full_name: "Nguyen Van B" });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("Nguyen Van B");
    expect(screen.queryByText("Đã khôi phục bản nháp chưa gửi.")).not.toBeNull();
  });

  test("3. a value typed in one visit restores in the next", async () => {
    const { unmount } = await renderFormReady();
    fireEvent.change(byName("email_primary")!, { target: { value: "test@example.com" } });
    await waitFor(() => {
      expect(loadDraft(MENTEE_KEY)?.email_primary).toBe("test@example.com");
    });
    unmount();

    await renderFormReady();
    expect(byName<HTMLInputElement>("email_primary")!.value).toBe("test@example.com");
  });

  test("2/6. textareas restore, newlines intact", async () => {
    const text = "Phiên bản tốt nhất là...\n\nHello";
    saveDraft(MENTEE_KEY, { one_year_vision_text: text });
    await renderFormReady();
    const textarea = screen.getByLabelText(/Mô tả "phiên bản tốt nhất của bạn sau 1 năm"/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(text);
  });

  test("3. selects restore", async () => {
    saveDraft(MENTEE_KEY, { gender: "female" });
    await renderFormReady();
    expect(byName<HTMLSelectElement>("gender")!.value).toBe("female");
  });

  test("4. a SINGLE ticked checkbox restores — including from a bare-string draft", async () => {
    // The bare string is the shape a one-selection group produced before this
    // fix. `new Set("communication")` is thirteen single characters, which is
    // why the box came back unticked and the counter read 13/3.
    saveDraft(MENTEE_KEY, { target_soft_skills: "communication" });
    await renderFormReady();

    expect(checkboxByValue("target_soft_skills", "communication")?.checked).toBe(true);
    expect(checkboxByValue("target_soft_skills", "leadership")?.checked).toBe(false);
    expect(screen.queryByText("1/3 đã chọn")).not.toBeNull();
  });

  test("4. a single ticked checkbox restores from the array shape too", async () => {
    saveDraft(MENTEE_KEY, { target_soft_skills: ["communication"] });
    await renderFormReady();
    expect(checkboxByValue("target_soft_skills", "communication")?.checked).toBe(true);
    expect(screen.queryByText("1/3 đã chọn")).not.toBeNull();
  });

  test("5. a checkbox GROUP restores every selection and nothing else", async () => {
    saveDraft(MENTEE_KEY, { target_soft_skills: ["leadership", "communication"] });
    await renderFormReady();

    expect(checkboxByValue("target_soft_skills", "leadership")?.checked).toBe(true);
    expect(checkboxByValue("target_soft_skills", "communication")?.checked).toBe(true);
    expect(checkboxByValue("target_soft_skills", "negotiation")?.checked).toBe(false);
    expect(screen.queryByText("2/3 đã chọn")).not.toBeNull();
  });

  test("a single consent checkbox restores ticked", async () => {
    saveDraft(MENTEE_KEY, { consent_data_storage: "true", commitment_understanding: "true" });
    await renderFormReady();
    expect(document.querySelector<HTMLInputElement>('input[name="consent_data_storage"]')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="commitment_understanding"]')?.checked).toBe(true);
  });

  test("an UNCHECKED checkbox restores unchecked", async () => {
    // An unticked box contributes nothing to FormData, so it is simply absent
    // from the draft. Absence must read as "unticked", never as "unknown".
    saveDraft(MENTEE_KEY, { full_name: "Only Text" });
    await renderFormReady();
    expect(document.querySelector<HTMLInputElement>('input[name="consent_data_storage"]')?.checked).toBe(false);
    expect(checkboxByValue("target_soft_skills", "leadership")?.checked).toBe(false);
    expect(checkboxByValue("email_notification_consent", "email")?.checked).toBe(false);
  });

  test("7. Vietnamese Unicode survives the round trip", async () => {
    const uniText = "Nguyễn Văn Á Ớ Ứ Ử Ự Ĩ Ỉ Ò Ó Õ Ọ Ô Ố Ồ Ổ Ỗ Ộ Ở Ỡ Ợ Đ";
    saveDraft(MENTEE_KEY, { full_name: uniText });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe(uniText);
  });

  test("20. restoration goes through React defaults, not direct DOM writes", async () => {
    // A restore implemented by poking `element.value` after mount leaves
    // `defaultValue` empty and desynchronises React. Both must agree.
    saveDraft(MENTEE_KEY, { full_name: "React Restore" });
    await renderFormReady();
    const control = input(/Họ và tên/i);
    expect(control.value).toBe("React Restore");
    expect(control.defaultValue).toBe("React Restore");
    expect(control.getAttribute("value")).toBe("React Restore");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('"Khác / Other" companion fields', () => {
  test("6. a select's Other option and its companion text both restore", async () => {
    saveDraft(MENTEE_KEY, { gender: "other", gender_other: "Nội dung tự nhập" });
    await renderFormReady();

    expect(byName<HTMLSelectElement>("gender")!.value).toBe("other");
    const companion = byName<HTMLInputElement>("gender_other");
    expect(companion?.value).toBe("Nội dung tự nhập");
    expect(companion?.defaultValue).toBe("Nội dung tự nhập");
  });

  test("a select with a custom Other trigger restores its companion", async () => {
    saveDraft(MENTEE_KEY, { university: "OTHER", university_other: "Đại học Bách Khoa" });
    await renderFormReady();
    expect(document.querySelector<HTMLInputElement>('input[name="university_other"]')?.value).toBe(
      "Đại học Bách Khoa"
    );
  });

  test("a checkbox group's Other companion restores alongside the selection", async () => {
    saveDraft(MENTEE_KEY, {
      target_soft_skills: ["other"],
      target_soft_skills_other: "Kỹ năng đàm phán nâng cao"
    });
    await renderFormReady();

    expect(checkboxByValue("target_soft_skills", "other")?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="target_soft_skills_other"]')?.value).toBe(
      "Kỹ năng đàm phán nâng cao"
    );
  });

  test("switching away from Other removes the companion and its stored value", async () => {
    saveDraft(MENTEE_KEY, { gender: "other", gender_other: "Nội dung tự nhập" });
    await renderFormReady();
    expect(document.querySelector('input[name="gender_other"]')).not.toBeNull();

    fireEvent.change(byName<HTMLSelectElement>("gender")!, { target: { value: "female" } });

    // Gone from the DOM, so it cannot reach the Server Action...
    expect(document.querySelector('input[name="gender_other"]')).toBeNull();
    // ...and gone from the draft, so it cannot come back under the new answer.
    await waitFor(() => {
      const data = storedData(MENTEE_KEY)!;
      expect(data.gender).toBe("female");
      expect("gender_other" in data).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("clearing", () => {
  test("14. Xóa bản nháp empties storage and resets the visible fields", async () => {
    vi.spyOn(window, "confirm").mockImplementation(() => true);
    saveDraft(MENTEE_KEY, { full_name: "To be cleared", gender: "female" });
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("To be cleared");

    fireEvent.click(screen.getByRole("button", { name: "Xóa bản nháp" }));

    expect(input(/Họ và tên/i).value).toBe("");
    expect(byName<HTMLSelectElement>("gender")!.value).toBe("");
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
    expect(screen.queryByText("Đã khôi phục bản nháp chưa gửi.")).toBeNull();
  });

  test("declining the confirmation keeps the draft", async () => {
    vi.spyOn(window, "confirm").mockImplementation(() => false);
    saveDraft(MENTEE_KEY, { full_name: "Keep me" });
    await renderFormReady();

    fireEvent.click(screen.getByRole("button", { name: "Xóa bản nháp" }));

    expect(localStorage.getItem(MENTEE_KEY)).not.toBeNull();
    expect(input(/Họ và tên/i).value).toBe("Keep me");
  });

  test("16. a failed submit preserves the draft", async () => {
    vi.mocked(useFormState).mockImplementation(
      () => [{ ok: false, message: "Thiếu trường bắt buộc: full_name.", fieldErrors: [] }, vi.fn()] as never
    );
    saveDraft(MENTEE_KEY, { full_name: "Fail Me" });
    await renderFormReady();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(localStorage.getItem(MENTEE_KEY)).not.toBeNull();
    expect(loadDraft(MENTEE_KEY)?.full_name).toBe("Fail Me");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("15. the real success path", () => {
  /**
   * These cases run the ACTUAL `submitMenteeApplicationAction` and feed its
   * ACTUAL return value into the form. Hand-writing `{ ok: true }` into the
   * `useFormState` mock is what let the previous suite pass while the real
   * path — a server-side `redirect()` the client never observes — left the
   * draft behind.
   */
  function validMenteeForm(overrides: Record<string, string> = {}) {
    const form = new FormData();
    form.set(APPLY_TOKEN_FIELD, APPLY_TOKEN_VALUE);
    form.set("full_name", "Nguyễn Văn Ánh");
    form.set("email_primary", "anh@example.com");
    form.set("phone_primary", "0901234567");
    form.set("gender", "female");
    form.set("consent_data_storage", "true");
    form.set("university", "UEH");
    form.set("school_or_faculty", "marketing");
    form.set("major", "Marketing số");
    form.set("class_cohort", "K48");
    form.set("year_of_study", "3");
    form.set("target_industry", "tech");
    form.set("target_function", "product");
    form.set("one_year_vision_text", "x".repeat(120));
    form.set("mentoring_goals_text", "y".repeat(120));
    form.set("top_3_questions_for_mentor", "z".repeat(60));
    // Narrative minimum lengths are a CURRENT-main requirement the historical
    // fixture predates. Kept explicit (not a loop) so a change to any single
    // minimum surfaces here rather than silently passing.
    form.set("current_difficulty_text", "a".repeat(120));
    form.set("why_uem_text", "b".repeat(120));
    form.set("mentoring_plan_text", "c".repeat(120));
    form.set("if_not_effective_text", "d".repeat(120));
    form.set("available_for_kickoff", "yes");
    form.append("available_for_interview", "week_1");
    form.append("email_notification_consent", "email");
    form.set("commitment_understanding", "true");
    // Built from the real acknowledgement registry, so a change to the
    // commitments contract surfaces here instead of silently passing.
    for (const entry of acknowledgementsForRole("mentee")) {
      if (entry.key.endsWith("ACTIVE_READING_V1")) continue;
      form.set(entry.key, "true");
    }
    form.set("MENTEE_ACTIVE_READING_V1", MENTEE_CONFIRMATION_PHRASE);
    for (const [key, value] of Object.entries(overrides)) form.set(key, value);
    return form;
  }

  const runAction = (form: FormData) => submitMenteeApplicationAction({ ok: false, message: null }, form);

  test("the action returns a confirmed success instead of redirecting", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-123" } as never);

    const result = await runAction(validMenteeForm());

    expect(result).toMatchObject({ ok: true, applicationId: "app-123" });
    // If it still redirected, the client would never observe this state at all.
    expect(vi.mocked(redirect)).not.toHaveBeenCalled();
  });

  test("1. the real success state clears the draft and navigates", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-123" } as never);
    const successState = await runAction(validMenteeForm());
    expect(successState.ok).toBe(true);

    saveDraft(MENTEE_KEY, { full_name: "Submitted Successfully" });
    saveDraft(MENTOR_KEY, { full_name: "Unrelated Mentor Draft" });
    vi.mocked(useFormState).mockImplementation(() => [successState, vi.fn()] as never);

    await renderFormReady();

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith(MENTEE_APPLY_SUCCESS_PATH);
    });
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
    // A mentee submission must not wipe a half-finished mentor draft.
    expect(localStorage.getItem(MENTOR_KEY)).not.toBeNull();
  });

  test("the draft is gone BEFORE the navigation is issued", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-order" } as never);
    const successState = await runAction(validMenteeForm());

    saveDraft(MENTEE_KEY, { full_name: "Ordering" });
    // Once `router.replace` runs the component is on its way out; anything
    // queued behind it is not guaranteed to run.
    let storedAtNavigation: string | null = "not-called";
    routerMock.replace.mockImplementation(() => {
      storedAtNavigation = localStorage.getItem(MENTEE_KEY);
    });
    vi.mocked(useFormState).mockImplementation(() => [successState, vi.fn()] as never);

    await renderFormReady();

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalled();
    });
    expect(storedAtNavigation).toBeNull();
    routerMock.replace.mockReset();
  });

  test("4b. React Strict Mode re-runs the effect; success still happens once", async () => {
    // The plain-rerender case above does NOT exercise the idempotency latch:
    // React skips an effect whose dependencies are unchanged, so it passes even
    // with the latch deleted. Strict Mode is the case the latch exists for — it
    // deliberately unmounts and remounts effects, running the success body a
    // second time against the same confirmed application.
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-strict" } as never);
    const successState = await runAction(validMenteeForm());
    vi.mocked(useFormState).mockImplementation(() => [successState, vi.fn()] as never);
    saveDraft(MENTEE_KEY, { full_name: "Submitted" });

    render(
      <React.StrictMode>
        <ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />
      </React.StrictMode>
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();

    // A draft begun after the confirmed submission belongs to a NEW attempt and
    // must survive any repeat run of the success effect.
    saveDraft(MENTEE_KEY, { full_name: "Written After Success" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MENTEE_KEY)).not.toBeNull();
  });

  test("4. re-rendering the same success state clears and navigates exactly once", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-once" } as never);
    const successState = await runAction(validMenteeForm());
    vi.mocked(useFormState).mockImplementation(() => [successState, vi.fn()] as never);

    const view = await renderFormReady();
    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledTimes(1);
    });

    // A draft written after the success must not be destroyed by a repeat run
    // of the effect, and the applicant must not be navigated twice.
    saveDraft(MENTEE_KEY, { full_name: "Written After Success" });
    view.rerender(<ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />);
    view.rerender(<ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MENTEE_KEY)).not.toBeNull();
  });

  test("5. returning to the form after a successful submission restores nothing", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-revisit" } as never);
    const successState = await runAction(validMenteeForm());

    saveDraft(MENTEE_KEY, { full_name: "Submitted Successfully" });
    vi.mocked(useFormState).mockImplementation(() => [successState, vi.fn()] as never);
    const submitted = await renderFormReady();
    await waitFor(() => {
      expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
    });
    submitted.unmount();

    // A fresh visit, with the action back in its initial state.
    vi.mocked(useFormState).mockImplementation(() => [{ ok: false, message: null }, vi.fn()] as never);
    await renderFormReady();
    expect(input(/Họ và tên/i).value).toBe("");
    expect(screen.queryByText("Đã khôi phục bản nháp chưa gửi.")).toBeNull();
  });

  test("a keystroke still in flight when success arrives cannot resurrect the draft", async () => {
    vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "app-race" } as never);
    const successState = await runAction(validMenteeForm());

    // Start in the pre-submit state so the form is live and editable.
    let state: unknown = { ok: false, message: null };
    vi.mocked(useFormState).mockImplementation(() => [state, vi.fn()] as never);
    const view = await renderFormReady();

    // The snapshot is deferred by a task. Typing queues one, and the success
    // arrives before it lands — the exact ordering that would otherwise write
    // the submitted answers back on top of the clear.
    fireEvent.change(input(/Họ và tên/i), { target: { value: "Late Keystroke" } });
    state = successState;
    view.rerender(<ApplyMenteeForm applyToken={APPLY_TOKEN_VALUE} />);

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
  });

  // ── Failure shapes: every one keeps the draft and navigates nowhere ───────
  const failures: Array<[string, () => FormData, () => void]> = [
    [
      "2. server validation failure (missing required field)",
      () => {
        const form = validMenteeForm();
        form.set("full_name", "");
        return form;
      },
      () => vi.mocked(submitPilotApplication).mockResolvedValue({ ok: true, applicationId: "never" } as never)
    ],
    [
      "3. duplicate email",
      () => validMenteeForm(),
      () =>
        vi.mocked(submitPilotApplication).mockResolvedValue({
          ok: false,
          code: "duplicate",
          message: "Email này đã đăng ký cho mùa và vai trò này."
        } as never)
    ],
    [
      "database/config failure",
      () => validMenteeForm(),
      () =>
        vi.mocked(submitPilotApplication).mockResolvedValue({
          ok: false,
          code: "db",
          message: "Không thể ghi đơn ứng tuyển."
        } as never)
    ],
    [
      "an unhandled error inside the action",
      () => validMenteeForm(),
      () => vi.mocked(submitPilotApplication).mockRejectedValue(new Error("boom"))
    ]
  ];

  test.each(failures)("%s preserves the draft and does not navigate", async (_label, buildForm, arrange) => {
    arrange();
    const failureState = await runAction(buildForm());
    expect(failureState.ok).toBe(false);
    expect(failureState.applicationId).toBeUndefined();

    saveDraft(MENTEE_KEY, { full_name: "Keep My Answers" });
    vi.mocked(useFormState).mockImplementation(() => [failureState, vi.fn()] as never);

    await renderFormReady();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(loadDraft(MENTEE_KEY)?.full_name).toBe("Keep My Answers");
  });

  test("a gate refusal preserves the draft", async () => {
    vi.mocked(evaluateApplyGate).mockResolvedValueOnce({
      status: "closed",
      state: "closed",
      reason: "closed",
      code: "state_closed"
    } as never);

    const refusal = await runAction(validMenteeForm());
    expect(refusal.ok).toBe(false);

    saveDraft(MENTEE_KEY, { full_name: "Gate Closed" });
    vi.mocked(useFormState).mockImplementation(() => [refusal, vi.fn()] as never);
    await renderFormReady();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(loadDraft(MENTEE_KEY)?.full_name).toBe("Gate Closed");
  });

  test("clearDraft targets exactly one key", () => {
    saveDraft(MENTEE_KEY, { full_name: "A" });
    saveDraft(MENTOR_KEY, { full_name: "B" });
    clearDraft(MENTEE_KEY);
    expect(localStorage.getItem(MENTEE_KEY)).toBeNull();
    expect(localStorage.getItem(MENTOR_KEY)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("shared-device privacy", () => {
  test("the banner states the retention window and the shared-machine warning", async () => {
    await renderFormReady();
    const notice = screen.getByText(/Bản nháp được lưu trên trình duyệt này/);
    expect(notice.textContent).toContain(`tối đa ${AUTOSAVE_TTL_DAYS} ngày`);
    expect(notice.textContent).toContain("máy chung/công cộng");
    expect(screen.queryByRole("button", { name: "Xóa bản nháp" })).not.toBeNull();
  });

  test("only fields the applicant filled in are stored", async () => {
    await renderFormReady();
    fireEvent.change(input(/Họ và tên/i), { target: { value: "Minimal" } });

    await waitFor(() => {
      expect(storedData(MENTEE_KEY)).not.toBeNull();
    });
    // Not one key per rendered control — only what was actually answered.
    expect(Object.keys(storedData(MENTEE_KEY)!)).toEqual(["full_name"]);
  });
});
