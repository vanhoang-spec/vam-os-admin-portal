/**
 * S12 matching quick view — UI behaviour.
 *
 * These render the REAL `ManualMatchForm` and drive it the way an operator
 * would: type a search, pick a mentor, pick a mentee, write a note, open a
 * drawer, close it. The assertions are about what survives.
 *
 * That is the whole product requirement — a drawer that costs the operator
 * their half-made decision is worse than a link to the application page — and
 * it is not something a marker test can check.
 */
/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const loadQuickView = vi.fn();

vi.mock("@/app/actions/matches", () => ({
  createManualMatchAction: vi.fn(async () => ({ ok: false, message: null })),
  cancelMatchAction: vi.fn(async () => ({ ok: false, message: null }))
}));
vi.mock("@/app/actions/matching-quick-view", () => ({
  loadMatchingQuickViewAction: (...args: unknown[]) => loadQuickView(...args)
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));
vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()],
    useFormStatus: () => ({ pending: false })
  };
});

import { ManualMatchForm } from "@/app/matches/matches-client";
import type { MenteeCandidate, MentorCandidate } from "@/lib/matches";

const B1 = "00000000-0000-4000-8000-000000000011";

const MENTORS: MentorCandidate[] = [
  {
    profile_id: "mp-1",
    person_id: "per-mentor-1",
    full_name: "Nguyen Mentor Alpha",
    email_primary: "alpha@x.vn",
    mentor_code: "M1",
    company_current: "Acme",
    title_current: "Lead",
    active_match_count: 0,
    effective_capacity: 2
  },
  {
    profile_id: "mp-2",
    person_id: "per-mentor-2",
    full_name: "Tran Mentor Beta",
    email_primary: "beta@x.vn",
    mentor_code: "M2",
    company_current: "Beta Co",
    title_current: "PM",
    active_match_count: 2,
    effective_capacity: 2
  }
];

const MENTEES: MenteeCandidate[] = [
  {
    profile_id: "ep-1",
    person_id: "per-mentee-1",
    full_name: "Le Mentee One",
    email_primary: "one@x.vn",
    mentee_code: "E1",
    school_code: "UEH",
    major: "Finance",
    has_active_match: false
  }
];

const PAYLOAD = {
  role: "mentor" as const,
  fullName: "Nguyen Mentor Alpha",
  summary: [{ label: "Công ty hiện tại", value: "Acme" }],
  answers: [{ key: "mentoring_topics", label: "Chủ đề mentoring", value: "Career pivot" }],
  empty: false
};

function renderForm() {
  return render(<ManualMatchForm intakeBatchId={B1} mentors={MENTORS} mentees={MENTEES} />);
}

/** Select a mentor and a mentee, and type into search + note. */
function makeSelections() {
  fireEvent.change(screen.getByPlaceholderText("Tìm theo tên, công ty…"), {
    target: { value: "Alpha" }
  });
  fireEvent.change(screen.getByLabelText("Chọn Mentor"), { target: { value: "mp-1" } });
  fireEvent.change(screen.getByLabelText("Chọn Mentee"), { target: { value: "ep-1" } });
  fireEvent.change(screen.getByPlaceholderText(/Lý do ghép/), { target: { value: "ghi chú nội bộ" } });
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  loadQuickView.mockResolvedValue({ ok: true, data: PAYLOAD });
});

// ═══════════════════════════════════════════════════════════════════════════
// O — wording
// ═══════════════════════════════════════════════════════════════════════════

describe("O · availability wording", () => {
  it('reads "Mentor khả dụng: X/Y" instead of the contradictory FULL wording', () => {
    renderForm();
    expect(screen.getByText("Mentor khả dụng: 1/2")).toBeTruthy();
    expect(screen.queryByText(/Mentor đang FULL/)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I — nothing is loaded until a drawer is opened
// ═══════════════════════════════════════════════════════════════════════════

describe("I · on-demand loading", () => {
  it("loads nothing while the candidate lists render", () => {
    renderForm();
    expect(loadQuickView).not.toHaveBeenCalled();
  });

  it("loads nothing when a mentor is merely selected", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Chọn Mentor"), { target: { value: "mp-1" } });
    expect(loadQuickView).not.toHaveBeenCalled();
  });

  it("loads exactly one person when the drawer is opened", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Chọn Mentor"), { target: { value: "mp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem hồ sơ" }));

    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(1));
    expect(loadQuickView).toHaveBeenCalledWith({
      personId: "per-mentor-1",
      role: "mentor",
      intakeBatchId: B1
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J / K — state preservation
// ═══════════════════════════════════════════════════════════════════════════

describe("J · opening and closing the mentor drawer preserves matching state", () => {
  it("keeps the mentor, the mentee, the search text and the note", async () => {
    renderForm();
    makeSelections();

    const mentorSelect = screen.getByLabelText("Chọn Mentor") as HTMLSelectElement;
    const menteeSelect = screen.getByLabelText("Chọn Mentee") as HTMLSelectElement;
    const search = screen.getByDisplayValue("Alpha") as HTMLInputElement;
    const note = screen.getByPlaceholderText(/Lý do ghép/) as HTMLTextAreaElement;

    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Chủ đề mentoring");

    // Still selected while the drawer is open.
    expect(mentorSelect.value).toBe("mp-1");
    expect(menteeSelect.value).toBe("ep-1");

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByText("Chủ đề mentoring")).toBeNull());

    expect(mentorSelect.value).toBe("mp-1");
    expect(menteeSelect.value).toBe("ep-1");
    expect(search.value).toBe("Alpha");
    expect(note.value).toBe("ghi chú nội bộ");
  });

  it("closes on Escape without disturbing the selections", async () => {
    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Chủ đề mentoring");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Chủ đề mentoring")).toBeNull());

    expect((screen.getByLabelText("Chọn Mentor") as HTMLSelectElement).value).toBe("mp-1");
    expect((screen.getByLabelText("Chọn Mentee") as HTMLSelectElement).value).toBe("ep-1");
  });

  it("does not navigate away or open a tab", async () => {
    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Chủ đề mentoring");

    // The trigger is a button, not a link — nothing to target="_blank".
    const triggers = screen.getAllByRole("button", { name: "Xem hồ sơ" });
    triggers.forEach((node) => expect(node.tagName).toBe("BUTTON"));
    expect(screen.queryByRole("link", { name: /Xem hồ sơ/ })).toBeNull();
  });
});

describe("K · switching between the two drawers", () => {
  it("moves from the mentor drawer to the mentee drawer without resetting selections", async () => {
    renderForm();
    makeSelections();

    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Chủ đề mentoring");

    loadQuickView.mockResolvedValue({
      ok: true,
      data: {
        role: "mentee" as const,
        fullName: "Le Mentee One",
        summary: [{ label: "Trường", value: "UEH" }],
        answers: [{ key: "mentoring_goals_text", label: "Mục tiêu mentoring", value: "Định hướng" }],
        empty: false
      }
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[1]);
    await screen.findByText("Mục tiêu mentoring");

    // Only one drawer at a time: the mentor content is gone.
    expect(screen.queryByText("Chủ đề mentoring")).toBeNull();
    expect(loadQuickView).toHaveBeenLastCalledWith({
      personId: "per-mentee-1",
      role: "mentee",
      intakeBatchId: B1
    });
    expect((screen.getByLabelText("Chọn Mentor") as HTMLSelectElement).value).toBe("mp-1");
    expect((screen.getByLabelText("Chọn Mentee") as HTMLSelectElement).value).toBe("ep-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L — loading and error states
// ═══════════════════════════════════════════════════════════════════════════

describe("L · loading and error states", () => {
  it("shows a loading state while the payload is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    loadQuickView.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    renderForm();
    fireEvent.change(screen.getByLabelText("Chọn Mentor"), { target: { value: "mp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem hồ sơ" }));

    expect(await screen.findByText("Đang tải hồ sơ…")).toBeTruthy();
    release({ ok: true, data: PAYLOAD });
    await screen.findByText("Chủ đề mentoring");
  });

  it("shows a safe error and keeps both selections when loading fails", async () => {
    loadQuickView.mockResolvedValue({ ok: false, message: "Không thể tải hồ sơ." });

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);

    expect(await screen.findByText("Không thể tải hồ sơ.")).toBeTruthy();
    expect((screen.getByLabelText("Chọn Mentor") as HTMLSelectElement).value).toBe("mp-1");
    expect((screen.getByLabelText("Chọn Mentee") as HTMLSelectElement).value).toBe("ep-1");
  });

  it("survives a thrown action without clearing selections", async () => {
    loadQuickView.mockRejectedValue(new Error("network"));

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);

    expect(await screen.findByText(/Không thể tải hồ sơ/)).toBeTruthy();
    expect((screen.getByLabelText("Chọn Mentor") as HTMLSelectElement).value).toBe("mp-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Read-only
// ═══════════════════════════════════════════════════════════════════════════

describe("the drawer is read-only", () => {
  it("offers no edit, decision or review control", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Chọn Mentor"), { target: { value: "mp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem hồ sơ" }));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    for (const label of [/Lưu/, /Duyệt/, /Từ chối/, /Chỉnh sửa/, /Giao review/]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Stale-response concurrency
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Two quick-view loads can be in flight at once and can resolve in either
 * order. The failure these guard against is not a crash — it is the drawer
 * showing one person's answers under another person's name, on the screen whose
 * whole job is deciding who to pair. Server actions cannot be cancelled, so the
 * stale response still arrives; it must simply be ignored.
 */
const MENTEE_PAYLOAD = {
  role: "mentee" as const,
  fullName: "Le Mentee One",
  summary: [{ label: "Trường", value: "UEH" }],
  answers: [{ key: "mentoring_goals_text", label: "Mục tiêu mentoring", value: "Định hướng" }],
  empty: false
};

/** A promise plus the handles to settle it whenever the test chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("stale quick-view responses are ignored", () => {
  it("A · a slow Mentor response never overwrites the Mentee opened after it", async () => {
    const mentorRequest = deferred<unknown>();
    const menteeRequest = deferred<unknown>();
    loadQuickView
      .mockReturnValueOnce(mentorRequest.promise)
      .mockReturnValueOnce(menteeRequest.promise);

    renderForm();
    makeSelections();

    // 1. Mentor A opened — request A pending.
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");

    // 2. Mentee B opened — request B pending, A now stale.
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[1]);

    // 3. B resolves first and is shown.
    menteeRequest.resolve({ ok: true, data: MENTEE_PAYLOAD });
    await screen.findByText("Mục tiêu mentoring");

    // 4. A resolves late. It must change nothing.
    mentorRequest.resolve({ ok: true, data: PAYLOAD });
    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Mục tiêu mentoring")).toBeTruthy();
    expect(screen.queryByText("Chủ đề mentoring")).toBeNull();
    expect(screen.queryByText("Career pivot")).toBeNull();
    // The header still names B, and now so does the body.
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Le Mentee One");
  });

  it("A · the late response also does not resurrect the loading state", async () => {
    const mentorRequest = deferred<unknown>();
    const menteeRequest = deferred<unknown>();
    loadQuickView
      .mockReturnValueOnce(mentorRequest.promise)
      .mockReturnValueOnce(menteeRequest.promise);

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[1]);

    // The stale one settles BEFORE the current one. An unguarded `finally`
    // would clear the current request's spinner here and leave a blank drawer.
    mentorRequest.resolve({ ok: true, data: PAYLOAD });
    await waitFor(() => expect(screen.getByText("Đang tải hồ sơ…")).toBeTruthy());
    expect(screen.queryByText("Chủ đề mentoring")).toBeNull();

    menteeRequest.resolve({ ok: true, data: MENTEE_PAYLOAD });
    await screen.findByText("Mục tiêu mentoring");
  });

  it("B · a stale FAILURE does not replace the newer content", async () => {
    const mentorRequest = deferred<unknown>();
    const menteeRequest = deferred<unknown>();
    loadQuickView
      .mockReturnValueOnce(mentorRequest.promise)
      .mockReturnValueOnce(menteeRequest.promise);

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[1]);

    menteeRequest.resolve({ ok: true, data: MENTEE_PAYLOAD });
    await screen.findByText("Mục tiêu mentoring");

    // The abandoned request fails. That is not an error about what is on screen.
    mentorRequest.resolve({ ok: false, message: "Không thể tải hồ sơ." });
    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(2));

    expect(screen.queryByText("Không thể tải hồ sơ.")).toBeNull();
    expect(screen.getByText("Mục tiêu mentoring")).toBeTruthy();
  });

  it("B · a stale THROWN error is ignored too", async () => {
    const mentorRequest = deferred<unknown>();
    const menteeRequest = deferred<unknown>();
    loadQuickView
      .mockReturnValueOnce(mentorRequest.promise)
      .mockReturnValueOnce(menteeRequest.promise);

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[1]);

    menteeRequest.resolve({ ok: true, data: MENTEE_PAYLOAD });
    await screen.findByText("Mục tiêu mentoring");

    mentorRequest.reject(new Error("network"));
    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/Không thể tải hồ sơ/)).toBeNull();
    expect(screen.getByText("Mục tiêu mentoring")).toBeTruthy();
  });

  it("C · closing before the response arrives leaves the drawer closed", async () => {
    const pending = deferred<unknown>();
    loadQuickView.mockReturnValueOnce(pending.promise);

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    pending.resolve({ ok: true, data: PAYLOAD });
    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(1));

    // Neither the drawer nor its content comes back.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Chủ đề mentoring")).toBeNull();
    expect(screen.queryByText("Đang tải hồ sơ…")).toBeNull();
    // And the operator's decision is still intact.
    expect((screen.getByLabelText("Chọn Mentor") as HTMLSelectElement).value).toBe("mp-1");
    expect((screen.getByLabelText("Chọn Mentee") as HTMLSelectElement).value).toBe("ep-1");
  });

  it("C · a failure arriving after close does not reopen the drawer either", async () => {
    const pending = deferred<unknown>();
    loadQuickView.mockReturnValueOnce(pending.promise);

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    pending.reject(new Error("network"));
    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Không thể tải hồ sơ/)).toBeNull();
  });

  it("reopening the same profile after a stale request still shows fresh content", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    loadQuickView.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    renderForm();
    makeSelections();
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    await screen.findByText("Đang tải hồ sơ…");

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Reopen, then settle the CURRENT request first and the abandoned one
    // after. That order is what exposes the bug: without invalidation on close,
    // the request from before the close would land last and win.
    fireEvent.click(screen.getAllByRole("button", { name: "Xem hồ sơ" })[0]);
    second.resolve({ ok: true, data: PAYLOAD });
    await screen.findByText("Chủ đề mentoring");

    first.resolve({ ok: true, data: MENTEE_PAYLOAD });
    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Chủ đề mentoring")).toBeTruthy();
    expect(screen.queryByText("Mục tiêu mentoring")).toBeNull();
  });
});
