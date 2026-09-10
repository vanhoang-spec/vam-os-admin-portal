/** @vitest-environment jsdom */
/**
 * Ô chọn mẫu thư phải nói đúng thứ nó đang hiển thị.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Chủ chương trình duyệt một mẫu thư, panel "Gửi hàng loạt" hiện ra với đúng
 * tên mẫu trong ô chọn — rồi bấm "Gửi thử cho tôi" và nhận lại "Chưa chọn mẫu
 * thư."
 *
 * Nguyên nhân: `useState(templates[0]?.id ?? "")` chỉ chạy ở LẦN DỰNG ĐẦU
 * TIÊN. Lúc đó chưa có mẫu nào được duyệt nên state là chuỗi rỗng. Sau khi
 * duyệt, trang đọc lại và `templates` có một dòng, nhưng component không bị
 * dựng lại nên state vẫn rỗng — trong khi trình duyệt tự hiển thị option đầu
 * cho một `<select>` có `value=""` không khớp option nào.
 *
 * Ô chọn trông như đã chọn. Nó chưa.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

const COUNTS = {
  mentee: { sendable: 19, unreachable: 0 },
  mentor: { sendable: 40, unreachable: 1 },
  both: { sendable: 58, unreachable: 1 }
};

const ONE: SendableTemplate[] = [
  { id: "tpl-1", name: "Thư test hệ thống gửi email", subject: "Test email từ VAM" }
];

function panel(templates: SendableTemplate[]) {
  return (
    <SendPanel templates={templates} counts={COUNTS} batches={[]} canSend />
  );
}

/** Giá trị mà form thật sự gửi lên, không phải giá trị trông thấy. */
function submittedTemplateIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="template_id"]')
  ).map((input) => input.value);
}

describe("mẫu thư vừa được duyệt", () => {
  it("form gửi đúng mẫu ngay cả khi panel đã dựng từ lúc chưa có mẫu nào", () => {
    // Đây là ca tái hiện lỗi. `rerender` giữ nguyên component instance, đúng
    // như router.refresh() làm sau khi duyệt.
    const { rerender } = render(panel([]));
    rerender(panel(ONE));

    const sent = submittedTemplateIds();
    expect(sent.length).toBeGreaterThan(0);
    for (const value of sent) expect(value).toBe("tpl-1");
  });

  it("ô chọn hiển thị đúng mẫu mà form sẽ gửi", () => {
    // Thứ người dùng nhìn thấy và thứ form gửi lên phải là một.
    const { rerender } = render(panel([]));
    rerender(panel(ONE));

    const select = screen.getByLabelText("Mẫu thư") as HTMLSelectElement;
    expect(select.value).toBe("tpl-1");
    expect(submittedTemplateIds()).toContain(select.value);
  });
});

describe("trường hợp bình thường vẫn đúng", () => {
  it("dựng thẳng với một mẫu thì gửi mẫu đó", () => {
    render(panel(ONE));
    for (const value of submittedTemplateIds()) expect(value).toBe("tpl-1");
  });

  it("mẫu đang chọn bị lưu trữ thì rơi về mẫu còn lại, không rơi về rỗng", () => {
    // Một mẫu biến mất khỏi danh sách trong lúc panel đang mở là chuyện có
    // thật: người khác vừa cất nó đi.
    const two: SendableTemplate[] = [
      ...ONE,
      { id: "tpl-2", name: "Nhắc hạn", subject: "Nhắc hạn nộp hồ sơ" }
    ];
    const { rerender } = render(panel(two));
    rerender(panel([two[1]]));

    for (const value of submittedTemplateIds()) expect(value).toBe("tpl-2");
  });

  it("không còn mẫu nào được duyệt thì nói rõ, không hiện nút gửi", () => {
    render(panel([]));
    expect(screen.getByText(/Chưa có mẫu thư nào được duyệt/)).toBeTruthy();
    expect(submittedTemplateIds()).toEqual([]);
  });
});
