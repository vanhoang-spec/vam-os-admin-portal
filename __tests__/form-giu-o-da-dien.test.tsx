/** @vitest-environment jsdom */
/**
 * __tests__/form-giu-o-da-dien.test.tsx
 *
 * Giữ nguyên ô đã điền khi server action trả lỗi.
 *
 * ---------------------------------------------------------------------------
 * LỖI CÓ THẬT, DO NGƯỜI THẬT BÁO
 * ---------------------------------------------------------------------------
 * 24/09/2026 một mentor gọi điện góp ý: trong form gia hạn, gõ sai câu xác nhận
 * thì phải điền lại TOÀN BỘ. Ô đó chỉ `required` ở trình duyệt (không rỗng là
 * qua), còn phép so từng chữ nằm ở máy chủ — nên lỗi chỉ lộ ra SAU khi action
 * đã chạy, và `<form action={...}>` reset biểu mẫu đúng lúc đó. Hai mươi mốt ô
 * về trắng vì một dấu tiếng Việt.
 *
 * ---------------------------------------------------------------------------
 * CA ĐẦU TIÊN CHỨNG MINH BÀI TEST NÀY KHÔNG NÓI DỐI
 * ---------------------------------------------------------------------------
 * Nếu jsdom không thật sự thực thi form reset thì ca "giá trị còn nguyên" sẽ
 * xanh kể cả khi bản vá bị gỡ — một phép kiểm vô nghĩa. Nên ca đầu dựng một
 * biểu mẫu KHÔNG có bản vá và đòi nó MẤT giá trị. Ca đó đỏ nghĩa là môi trường
 * test không tái hiện được lỗi, và mọi ca sau đều đáng ngờ.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { keepFormValues } from "@/lib/keep-form-values";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ status: "idle", message: "" }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("@/app/actions/application-reviews", () => ({ handleReviewFormAction: vi.fn() }));

import { ReviewForm } from "@/app/reviews/[id]/review-form";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

afterEach(cleanup);

describe("1. môi trường test tái hiện được đúng lỗi", () => {
  it("biểu mẫu KHÔNG có bản vá thì mất sạch giá trị khi bị reset", () => {
    render(
      <form data-testid="khong-vá">
        <input name="ghi_chu" defaultValue="" aria-label="ghi chú" />
      </form>
    );

    const field = screen.getByLabelText("ghi chú") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Công ty ABC" } });
    expect(field.value).toBe("Công ty ABC");

    // Gọi form.reset() chứ KHÔNG dùng fireEvent.reset: cái sau chỉ bắn sự kiện
    // mà không chạy hành vi mặc định, nên nó không xoá gì và ca này sẽ xanh
    // một cách vô nghĩa. Đây đúng là thứ ca kiểm soát này sinh ra để bắt.
    (screen.getByTestId("khong-vá") as HTMLFormElement).reset();

    // Đây chính là thứ anh mentor gặp.
    expect(field.value).toBe("");
  });

  it("biểu mẫu CÓ bản vá thì giữ nguyên giá trị", () => {
    render(
      <form data-testid="co-vá" onReset={keepFormValues}>
        <input name="ghi_chu" defaultValue="" aria-label="ghi chú" />
      </form>
    );

    const field = screen.getByLabelText("ghi chú") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Công ty ABC" } });
    (screen.getByTestId("co-vá") as HTMLFormElement).reset();

    expect(field.value).toBe("Công ty ABC");
  });
});

describe("2. biểu mẫu thật giữ được phần đã chấm", () => {
  it("phiếu chấm không mất điểm và nhận xét khi biểu mẫu bị reset", () => {
    const { container } = render(
      <ReviewForm
        reviewId="rv-1"
        reviewRound="interview"
        isSubmitted={false}
        defaultScoreMotivation={null}
        defaultScoreGoalClarity={null}
        defaultScoreCommitment={null}
        defaultScoreFit={null}
        defaultScoreCommunication={null}
        defaultRecommendation={null}
        defaultReviewerNote={null}
      />
    );

    const note = container.querySelector('textarea[name="reviewer_note"]') as HTMLTextAreaElement;
    expect(note).not.toBeNull();
    fireEvent.change(note, { target: { value: "Ứng viên trả lời rất chắc phần mục tiêu." } });

    const radio = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(radio).not.toBeNull();
    fireEvent.click(radio);

    const form = container.querySelector("form") as HTMLFormElement;
    form.reset();

    expect(note.value).toBe("Ứng viên trả lời rất chắc phần mục tiêu.");
    expect(radio.checked).toBe(true);
  });
});

/**
 * Bốn biểu mẫu này do người NGOÀI ban tổ chức ngồi điền, điền lâu, và điền một
 * lần. Mất dữ liệu ở đây là mất công của người khác, không phải của mình —
 * nên chúng được gọi tên từng cái thay vì kiểm bằng một phép quét chung.
 */
describe("3. các biểu mẫu điền lâu đều có bản vá", () => {
  const FORMS: Array<[string, string]> = [
    ["gia hạn mentor", "app/renew/[token]/renewal-form.tsx"],
    ["đăng ký sự kiện", "app/register/[token]/registration-form.tsx"],
    ["khảo sát sau sự kiện", "app/khao-sat/[token]/survey-form.tsx"],
    ["phiếu chấm hồ sơ", "app/reviews/[id]/review-form.tsx"]
  ];

  it.each(FORMS)("%s", (_ten, file) => {
    const source = read(file);
    // Đếm bằng chuỗi thường, KHÔNG bằng biểu thức chính quy: một biểu thức ở
    // đây cần dấu gạch chéo ngược, mà chúng đã bị nuốt một lớp khi đi qua shell
    // trên máy này (CLAUDE.md) — và một biểu thức hỏng lặng lẽ sẽ đếm ra 0, rồi
    // 0 === 0 làm ca này xanh vĩnh viễn.
    //
    // Mở thẻ thật luôn có thuộc tính đi sau nên kèm dấu cách; nhờ vậy chuỗi
    // "<form>" nằm trong một dòng chú thích của review-form.tsx không bị tính.
    const soForm = source.split("<form ").length - 1;
    const soVa = source.split("onReset={keepFormValues}").length - 1;

    expect(source).toContain('from "@/lib/keep-form-values"');
    expect(soForm).toBeGreaterThan(0);
    // MỌI <form> trong file, không phải chỉ cái đầu tiên: form gia hạn có hai
    // biểu mẫu, và biểu mẫu "không tiếp tục" cũng mang một ô góp ý tự do.
    expect(soVa).toBe(soForm);
  });

  it("chỉ còn MỘT định nghĩa của hàm chặn reset trong toàn repo", () => {
    const aiShared = read("app/ai/ai-shared.tsx");
    expect(aiShared).toContain('export { keepFormValues } from "@/lib/keep-form-values"');
    expect(aiShared).not.toContain("event.preventDefault()");
  });
});
