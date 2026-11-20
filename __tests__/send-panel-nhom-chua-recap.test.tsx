/** @vitest-environment jsdom */
/**
 * Giao diện nhóm "Mentee chưa có recap trong tháng": chọn nhóm → chọn tháng → thấy số mentee và số
 * mentor CC; con số phải gõ xác nhận và tháng form gửi lên là ĐÚNG tháng đang hiển thị.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/bulk-mail", () => ({
  sendTestEmailAction: vi.fn(),
  startBulkSendAction: vi.fn(),
  continueBulkSendAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { SendPanel, type SendableTemplate } from "@/app/operations/mail/send-panel";

afterEach(cleanup);

const TEMPLATES: SendableTemplate[] = [{ id: "tpl-1", name: "Nhắc recap tháng 11", subject: "Nhắc nhẹ" }];
const COUNTS = { mentee: { sendable: 720, unreachable: 0 } };
const MONTHS = [
  { month: "2026-11", label: "Tháng 11/2026", sendable: 509, unreachable: 0, ccMentors: 378, ccMissing: 0 },
  { month: "2026-10", label: "Tháng 10/2026", sendable: 700, unreachable: 2, ccMentors: 390, ccMissing: 3 }
];

const hidden = (name: string) =>
  (document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement | null)?.value;

function pickRecapAudience() {
  fireEvent.change(screen.getByLabelText("Gửi cho"), { target: { value: "mentee_no_recap_month" } });
}

describe("nhóm mentee chưa có recap", () => {
  it("không có tháng nào đếm được thì không hiện trong ô chọn nhóm", () => {
    render(<SendPanel templates={TEMPLATES} counts={COUNTS} batches={[]} canSend />);
    const options = Array.from((screen.getByLabelText("Gửi cho") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).not.toContain("mentee_no_recap_month");
  });

  it("chọn nhóm → ô tháng, số mentee + số mentor CC, số xác nhận và tháng gửi lên khớp nhau", () => {
    render(<SendPanel templates={TEMPLATES} counts={COUNTS} recapMonthOptions={MONTHS} batches={[]} canSend />);
    pickRecapAudience();
    expect(hidden("audience")).toBe("mentee_no_recap_month");
    expect((screen.getByLabelText("Tháng") as HTMLSelectElement).value).toBe("2026-11");
    expect(hidden("audience_month")).toBe("2026-11");
    expect(screen.getByTestId("send-recap-counts").textContent).toContain("509 mentee nhận thư, CC 378 mentor");
    expect(screen.getByLabelText("Gõ lại số 509 để xác nhận")).toBeTruthy();
    expect(screen.queryByTestId("send-recap-cc-missing")).toBeNull();
    expect(screen.getByTestId("send-audience-hint").textContent).toContain("CC mentor");

    fireEvent.change(screen.getByLabelText("Tháng"), { target: { value: "2026-10" } });
    expect(hidden("audience_month")).toBe("2026-10");
    expect(screen.getByTestId("send-recap-counts").textContent).toContain("700 mentee nhận thư, CC 390 mentor");
    expect(screen.getByLabelText("Gõ lại số 700 để xác nhận")).toBeTruthy();
    expect(screen.getByTestId("send-recap-cc-missing").textContent).toContain("3 thư gửi không CC");
  });

  it("nhóm khác không gửi kèm tháng", () => {
    render(<SendPanel templates={TEMPLATES} counts={COUNTS} recapMonthOptions={MONTHS} batches={[]} canSend />);
    expect(hidden("audience")).toBe("mentee");
    expect(hidden("audience_month")).toBe("");
  });
});
