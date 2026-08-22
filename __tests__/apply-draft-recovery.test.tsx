// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { ApplyMenteeForm } from "../app/apply/mentee/apply-mentee-form";
import { ClearApplyDraft } from "../app/apply/thanks/clear-draft";
import { APPLY_DRAFT_VERSION, applyDraftStorageKey } from "../lib/apply-draft";
import { SEASON_CONFIG } from "../lib/season-config";

if (typeof CSS === "undefined") {
  Object.defineProperty(window, "CSS", { value: { escape: (s: string) => s } });
}

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    useFormState: vi.fn((action, initialState) => [initialState, vi.fn()])
  };
});

// Mock the submit button and server action like in __tests__/uat-s12-error-ux-and-phone.test.tsx
vi.mock("@/app/apply/_components/submit-button", () => ({
  ApplySubmitButton: ({ idleLabel }: { idleLabel: string }) => <button type="submit">{idleLabel}</button>
}));
vi.mock("@/app/actions/apply", () => ({
  submitMenteeApplicationAction: vi.fn(async () => {
    // For test req 4, just return an error state.
    return { ok: false, fieldErrors: { full_name: "Required" }, serverError: null };
  })
}));

describe("Apply Draft Recovery (R1A) - DOM", () => {
  const role = "mentee";
  const storageKey = applyDraftStorageKey(role);

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("prompts on mount and prevents auto-apply until accepted", async () => {
    const draftPayload = {
      v: APPLY_DRAFT_VERSION,
      role,
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: { full_name: ["Test Name"] }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(draftPayload));

    render(<ApplyMenteeForm />);
    
    // Assert prompt appears
    expect(screen.getByText(/Chúng tôi tìm thấy một bản nháp chưa gửi/i)).toBeDefined();
    
    // Assert field is NOT populated yet
    const nameInput = screen.getByLabelText(/Họ và tên/i) as HTMLInputElement;
    expect(nameInput.value).toBe("");

    // Accept restore
    const restoreBtn = screen.getByRole("button", { name: /Khôi phục bản nháp/i });
    fireEvent.click(restoreBtn);

    // Assert field populated (Phase 1)
    expect(nameInput.value).toBe("Test Name");
    expect(screen.queryByText(/Chúng tôi tìm thấy/i)).toBeNull();
  });

  it("handles conditional fields correctly on restore (two-phase)", async () => {
    const draftPayload = {
      v: APPLY_DRAFT_VERSION,
      role,
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: { 
        university: ["OTHER"], 
        university_other: ["My Custom University"] 
      }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(draftPayload));

    render(<ApplyMenteeForm />);
    
    // Accept restore
    const restoreBtn = screen.getByRole("button", { name: /Khôi phục bản nháp/i });
    fireEvent.click(restoreBtn);

    // Wait for two-phase restore (requestAnimationFrame)
    await waitFor(() => {
      const otherInput = screen.getByLabelText(/Vui lòng ghi rõ/i) as HTMLInputElement;
      expect(otherInput).toBeDefined();
      expect(otherInput.value).toBe("My Custom University");
    });
  });

  it("clears consent fields on restore", async () => {
    // Hand-crafted payload to bypass createDraft redaction (simulating old data)
    const draftPayload = {
      v: APPLY_DRAFT_VERSION,
      role,
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: { 
        full_name: ["Test Name"],
        consent_data_storage: ["yes"],
        email_notification_consent: ["yes"]
      }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(draftPayload));

    render(<ApplyMenteeForm />);
    
    const restoreBtn = screen.getByRole("button", { name: /Khôi phục bản nháp/i });
    fireEvent.click(restoreBtn);

    // Consent should be stripped by parseDraft so it doesn't even populate
    const dataConsents = screen.getAllByLabelText(/Tôi đồng ý cho VAM OS lưu trữ/i) as HTMLInputElement[];
    expect(dataConsents[0].checked).toBe(false);
  });

  it("discarding clears draft and storage", async () => {
    const draftPayload = {
      v: APPLY_DRAFT_VERSION,
      role,
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: { full_name: ["Test Name"] }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(draftPayload));

    render(<ApplyMenteeForm />);
    
    const discardBtn = screen.getByRole("button", { name: /Bắt đầu mới \(xoá bản nháp\)/i });
    fireEvent.click(discardBtn);

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    // Re-query the input because the form remounts on discard
    const newNameInput = screen.getByLabelText(/Họ và tên/i) as HTMLInputElement;
    expect(newNameInput.value).toBe("");
  });

  it("submitting preserves draft on validation error, thanks page clears it", async () => {
    const draftPayload = {
      v: APPLY_DRAFT_VERSION,
      role,
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: { full_name: ["Test Name"] }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(draftPayload));

    render(<ApplyMenteeForm />);
    
    const restoreBtn = screen.getByRole("button", { name: /Khôi phục bản nháp/i });
    fireEvent.click(restoreBtn);

    // Fire submit
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    // Wait for async validation cycle (it's a server action, but we mocked it to return ok: false)
    await waitFor(() => {
      // Draft should still exist
      expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    });

    // Render thanks page component which clears the draft
    render(<ClearApplyDraft role="mentee" />);
    
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("debounced input saves to draft and strips tokens", async () => {
    vi.useFakeTimers();
    render(<ApplyMenteeForm applyToken="secret-token-123" />);

    const nameInput = screen.getByLabelText(/Họ và tên/i) as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: "New Name" } });

    act(() => {
      vi.advanceTimersByTime(1000); // Trigger debounce
    });

    const stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    expect(stored.fields.full_name).toEqual(["New Name"]);
    expect(JSON.stringify(stored)).not.toContain("secret-token-123");
    
    vi.useRealTimers();
  });
});
