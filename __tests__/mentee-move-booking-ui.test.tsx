// @vitest-environment jsdom
/**
 * Form BTC đổi ca cho mentee (move-booking-form.tsx) và hai câu hỏi bắt buộc trong
 * lưới chọn ca (session-form.tsx) — BTC 02/10/2026.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: () => [{ status: "idle", message: null, sessionLabel: null }, vi.fn()] };
});
vi.mock("@/app/dat-ca/[token]/actions", () => ({ bookSessionAction: vi.fn(), changeSessionAction: vi.fn() }));

import { MoveBookingForm } from "@/app/interviews/mentee-offline/move-booking-form";
import { SessionForm } from "@/app/dat-ca/[token]/session-form";
import { MENTEE_PREP_QUESTIONS } from "@/lib/email-core";

const NOW = "2026-10-02T13:00:00.000Z";
const S = (id: string, starts: string, seat: number | null = 25) => ({ id, starts_at: starts, ends_at: starts.replace(":00:00", ":30:00"), venue: null, seat_limit: seat });
const sessions = [
  S("cur", "2026-10-03T01:00:00+00:00"),
  S("past", "2026-10-02T01:00:00+00:00"),
  S("full", "2026-10-03T06:00:00+00:00"),
  S("open", "2026-10-04T01:00:00+00:00"),
  S("noseat", "2026-10-04T06:00:00+00:00", null)
];
const onMove = vi.fn();
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderForm() {
  render(<MoveBookingForm sessions={sessions} currentSessionId="cur" takenBySession={new Map([["full", 25], ["open", 3]])}
    candidateName="Mentee A" busy={false} nowIso={NOW} onMove={onMove} />);
  fireEvent.click(screen.getByRole("button", { name: "Đổi ca phỏng vấn" }));
}

it("chỉ liệt kê ca khác, chưa bắt đầu, có số ghế; ca kín hiện nhưng không chọn được", () => {
  renderForm();
  const opts = Array.from((screen.getByLabelText("Ca mới") as HTMLSelectElement).options).filter((o) => o.value);
  expect(opts.map((o) => o.value)).toEqual(["full", "open"]);
  expect(opts.find((o) => o.value === "full")!.disabled).toBe(true);
  expect(opts.find((o) => o.value === "open")!.textContent).toContain("còn 22 chỗ");
});

it("phải chọn ca + nhập lý do; bấm lần đầu chỉ hiện xác nhận; Huỷ không đổi; Xác nhận gọi đúng ca + lý do", () => {
  renderForm();
  const go = screen.getByRole("button", { name: "Đổi sang ca này" }) as HTMLButtonElement;
  expect(go.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Ca mới"), { target: { value: "open" } });
  expect(go.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Lý do đổi ca"), { target: { value: "  Bận đột xuất  " } });
  fireEvent.click(screen.getByRole("button", { name: "Đổi sang ca này" }));
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Đổi sang ca này" }));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận đổi ca" }));
  expect(onMove).toHaveBeenCalledWith("open", "Bận đột xuất");
});

it("lưới chọn ca lần đầu: hai câu hỏi chuẩn bị nằm trong form và BẮT BUỘC; đổi ca thì không có", () => {
  const days = [{ dateKey: "2026-10-03", label: "Thứ Bảy 03/10/2026", sessions: [] }];
  const view = render(<SessionForm token="t" days={days as never} prepAnswers={["Đã có", ""]} />);
  MENTEE_PREP_QUESTIONS.forEach((q, i) => {
    const box = view.container.querySelector(`textarea[name="${q.rawPayloadKey}"]`) as HTMLTextAreaElement;
    expect(box.required).toBe(true);
    expect(box.value).toBe(["Đã có", ""][i]);
  });
  view.unmount();
  const change = render(<SessionForm token="t" days={days as never} mode="change" currentSessionId="x" />);
  expect(change.container.querySelectorAll("textarea")).toHaveLength(0);
});
