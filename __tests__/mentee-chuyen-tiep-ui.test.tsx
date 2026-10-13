/**
 * Mentee chuyển tiếp — màn hình ghép tay.
 *
 * Render ManualMatchForm thật và làm như người vận hành: chọn một bạn chuyển tiếp, bấm "Xem hồ sơ".
 * Điều cần giữ: bạn chuyển tiếp được gắn nhãn, và khung xem nhanh nói ĐÚNG lý do (không có form
 * mùa này) thay vì để máy chủ trả "chưa được duyệt chính thức" — vốn sai sự thật với họ.
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
import { CONTINUING_MENTEE_LABEL, CONTINUING_MENTEE_QUICK_VIEW_MESSAGE } from "@/lib/continuing-mentee-core";

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
  }
];

const MENTEES: MenteeCandidate[] = [
  {
    profile_id: "ep-form",
    person_id: "per-mentee-form",
    full_name: "Le Mentee Co Don",
    email_primary: "form@x.vn",
    mentee_code: "E1",
    school_code: "UEH",
    major: "Finance",
    has_active_match: false,
    continuing: false
  },
  {
    profile_id: "ep-cont",
    person_id: "per-mentee-cont",
    full_name: "Tran Mentee Chuyen Tiep",
    email_primary: "cont@x.vn",
    mentee_code: "E2",
    school_code: "UEH",
    major: "Marketing",
    has_active_match: false,
    continuing: true
  }
];

function renderForm() {
  return render(<ManualMatchForm intakeBatchId={B1} mentors={MENTORS} mentees={MENTEES} />);
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  loadQuickView.mockResolvedValue({ ok: false, message: "Người này chưa được duyệt chính thức trong mùa của batch đã chọn." });
});

describe("danh sách mentee", () => {
  it("gắn nhãn chuyển tiếp ở ô chọn, và CHỈ ở bạn chuyển tiếp", () => {
    renderForm();

    const cont = screen.getByRole("option", { name: new RegExp("Tran Mentee Chuyen Tiep") });
    const form = screen.getByRole("option", { name: new RegExp("Le Mentee Co Don") });
    expect(cont.textContent).toContain(CONTINUING_MENTEE_LABEL);
    expect(form.textContent).not.toContain(CONTINUING_MENTEE_LABEL);
  });

  it("dòng đếm nói có bao nhiêu bạn chuyển tiếp trong danh sách", () => {
    renderForm();
    expect(screen.getByTestId("mentee-pool-count").textContent).toContain("trong đó 1 bạn chuyển tiếp từ mùa trước");
  });

  it("không có bạn chuyển tiếp nào thì dòng đếm không nhắc tới", () => {
    render(<ManualMatchForm intakeBatchId={B1} mentors={MENTORS} mentees={[MENTEES[0]]} />);
    expect(screen.getByTestId("mentee-pool-count").textContent).not.toContain("chuyển tiếp");
  });

  it("chọn bạn chuyển tiếp thì hiện huy hiệu; chọn bạn có đơn thì không", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Chọn Mentee"), { target: { value: "ep-cont" } });
    expect(screen.getByTestId("continuing-mentee-badge").textContent).toBe(CONTINUING_MENTEE_LABEL);

    fireEvent.change(screen.getByLabelText("Chọn Mentee"), { target: { value: "ep-form" } });
    expect(screen.queryByTestId("continuing-mentee-badge")).toBeNull();
  });
});

describe("Xem hồ sơ", () => {
  it("bạn chuyển tiếp: nói đúng lý do và KHÔNG gọi máy chủ", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Chọn Mentee"), { target: { value: "ep-cont" } });

    fireEvent.click(screen.getByRole("button", { name: "Xem hồ sơ" }));

    await screen.findByText(CONTINUING_MENTEE_QUICK_VIEW_MESSAGE);
    expect(loadQuickView).not.toHaveBeenCalled();
    expect(screen.queryByText(/chưa được duyệt chính thức/)).toBeNull();
  });

  it("bạn có đơn: vẫn gọi máy chủ đúng một lần như trước", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Chọn Mentee"), { target: { value: "ep-form" } });

    fireEvent.click(screen.getByRole("button", { name: "Xem hồ sơ" }));

    await waitFor(() => expect(loadQuickView).toHaveBeenCalledTimes(1));
    expect(loadQuickView).toHaveBeenCalledWith({ personId: "per-mentee-form", role: "mentee", intakeBatchId: B1 });
  });
});
