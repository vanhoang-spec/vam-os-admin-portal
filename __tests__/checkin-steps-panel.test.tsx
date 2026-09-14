/** @vitest-environment jsdom */
/**
 * Khung "Thiết lập các lần quét" trên trang máy quét, và action của nó.
 *
 * Khung gửi đúng buổi, đúng các lần quét; link trên máy quét mở được khung đang
 * gập; và trang chỉ vẽ khung cho người được thiết lập.
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventActionState } from "@/lib/event-action-types";

const formState = vi.hoisted(() => ({ value: null as EventActionState | null }));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: EventActionState) => [formState.value ?? initial, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/app/actions/event-scan", () => ({
  recordEventScanAction: vi.fn(),
  updateCheckinStepsAction: vi.fn()
}));

import { CheckinStepsPanel } from "@/app/events/[id]/scan/checkin-steps-panel";
import { CHECKIN_STEPS_PANEL_ID } from "@/lib/event-checkin-steps";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  formState.value = null;
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("1. khung thiết lập", () => {
  it("gửi đúng buổi và đúng các lần quét đang có", () => {
    const { container } = render(<CheckinStepsPanel eventId={EVENT_ID} initialSteps={["entrance", "checkout"]} />);
    const form = container.querySelector("form") as HTMLFormElement;
    const data = new FormData(form);

    expect(data.get("event_id")).toBe(EVENT_ID);
    expect(data.getAll("checkin_steps")).toEqual(["entrance", "checkout"]);
    expect(screen.getByRole("button", { name: "Lưu các lần quét" })).toBeTruthy();
  });

  it("gập sẵn — thứ cần thấy đầu tiên ở cửa là camera", () => {
    const { container } = render(<CheckinStepsPanel eventId={EVENT_ID} initialSteps={["entrance"]} />);
    expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(false);
  });

  it("mở trang từ link thiết lập: khung tự mở", () => {
    window.history.replaceState(null, "", `/#${CHECKIN_STEPS_PANEL_ID}`);
    const { container } = render(<CheckinStepsPanel eventId={EVENT_ID} initialSteps={["entrance"]} />);
    const details = container.querySelector("details") as HTMLDetailsElement;

    expect(details.id).toBe(CHECKIN_STEPS_PANEL_ID);
    expect(details.open).toBe(true);
  });

  it("bấm link thiết lập khi đang ở trang: khung tự mở", () => {
    const { container } = render(<CheckinStepsPanel eventId={EVENT_ID} initialSteps={["entrance"]} />);
    window.history.replaceState(null, "", `/#${CHECKIN_STEPS_PANEL_ID}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
  });

  it("lưu xong: nói ra, kèm lời nhắc máy quét khác tải lại trang", () => {
    formState.value = { ok: true, message: "Đã lưu các lần quét. Máy quét của các bạn hỗ trợ khác cần tải lại trang để thấy danh sách mới." };
    render(<CheckinStepsPanel eventId={EVENT_ID} initialSteps={["entrance"]} />);
    expect(screen.getByText(/cần tải lại trang/)).toBeTruthy();
  });
});

describe("2. trang máy quét chỉ vẽ khung cho người được thiết lập", () => {
  const page = readFileSync("app/events/[id]/scan/page.tsx", "utf8");

  it("quyền hỏi qua canConfigureCheckinSteps, không qua cổng sửa sự kiện", () => {
    expect(page).toContain("canConfigureCheckinSteps(adminUser, {");
    expect(page).not.toContain("canEditRecaps(");
  });

  it("khung và link thiết lập cùng một điều kiện", () => {
    expect(page).toContain("settingsHref={canConfigure ? `#${CHECKIN_STEPS_PANEL_ID}` : null}");
    expect(page).toContain("{canConfigure ? <CheckinStepsPanel eventId={id} initialSteps={purposes} /> : null}");
  });

  it("link trên máy quét là thẻ a thường — Link của Next không phát hashchange", () => {
    const scanner = readFileSync("app/events/[id]/scan/scanner.tsx", "utf8");
    expect(scanner).not.toContain('from "next/link"');
    expect(scanner).toContain("<a href={settingsHref}");
  });
});
