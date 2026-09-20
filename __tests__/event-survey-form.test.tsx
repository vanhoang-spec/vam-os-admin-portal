/** @vitest-environment jsdom */
/**
 * Phiếu khảo sát công khai: đúng hai câu hỏi, đúng lời giải thích, và đúng cái
 * móc form của React 18.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CA "KHÔNG DÙNG useActionState" NẰM Ở ĐÂY
 * ---------------------------------------------------------------------------
 * Dự án chạy React 18.3.1. `useActionState` của `react` QUA ĐƯỢC typecheck, lint
 * và build rồi mới vỡ lúc chạy — người điền phiếu gặp trang trắng giữa hội
 * trường, còn cả bốn cổng đều xanh. Chỉ một ca test component mới bắt được, nên
 * nó phải có mặt ở đây chứ không ở một bài kiểm tĩnh nào khác.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — dựng chính component đang chạy thật.
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./../app/khao-sat/[token]/actions", () => ({
  submitEventSurveyAction: vi.fn(async () => ({}))
}));

// `useFormState` chỉ có thật trong bản react-dom của Next; bản dùng khi chạy
// test không mang nó, nên phải giả. Ca ở mục 2 mới là ca canh việc component
// dùng ĐÚNG móc này chứ không phải useActionState của React 19.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [INITIAL_SURVEY_FORM_STATE, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});

import { INITIAL_SURVEY_FORM_STATE } from "@/lib/event-survey-action-types";

import { SurveyForm } from "@/app/khao-sat/[token]/survey-form";
import { QUESTION_PROMPT, impressionQuestion } from "@/lib/event-survey-core";

const PROMPT = impressionQuestion("Mentee Orientation Mùa 12");

afterEach(cleanup);

describe("1. phiếu hỏi đúng hai câu, và xin đúng thông tin đối chiếu", () => {
  it("hiện cả hai câu hỏi", () => {
    render(<SurveyForm token="tk" source="" impressionQuestion={PROMPT} />);

    expect(screen.getByText(/Điều làm bạn ấn tượng nhất/)).toBeTruthy();
    expect(screen.getByText(new RegExp(QUESTION_PROMPT.slice(0, 30)))).toBeTruthy();
  });

  it("có ô họ tên, email, số điện thoại và MSSV", () => {
    const { container } = render(<SurveyForm token="tk" source="" impressionQuestion={PROMPT} />);

    for (const name of ["full_name", "email", "phone", "student_id", "impression", "question"]) {
      expect(container.querySelector(`[name="${name}"]`), `thiếu ô ${name}`).toBeTruthy();
    }
  });

  it("mang theo token và nguồn phiếu, để máy chủ biết phiếu của buổi nào và tới từ đâu", () => {
    const { container } = render(<SurveyForm token="tk-123" source="thu" impressionQuestion={PROMPT} />);

    expect(container.querySelector('input[name="token"]')?.getAttribute("value")).toBe("tk-123");
    expect(container.querySelector('input[name="source"]')?.getAttribute("value")).toBe("thu");
  });

  it("nút gửi nói rõ đây cũng là thao tác check out", () => {
    render(<SurveyForm token="tk" source="" impressionQuestion={PROMPT} />);
    expect(screen.getByRole("button", { name: /check out/i })).toBeTruthy();
  });

  it("chỉ câu 1 là bắt buộc; câu 2 để trống vẫn gửi được", () => {
    const { container } = render(<SurveyForm token="tk" source="" impressionQuestion={PROMPT} />);

    expect(container.querySelector('[name="impression"]')?.hasAttribute("required")).toBe(true);
    expect(container.querySelector('[name="question"]')?.hasAttribute("required")).toBe(false);
    expect(container.querySelector('[name="student_id"]')?.hasAttribute("required")).toBe(false);
  });
});

describe("2. React 18, không phải 19", () => {
  it("form dùng useFormState của react-dom, không dùng useActionState", () => {
    const source = readFileSync("app/khao-sat/[token]/survey-form.tsx", "utf8");

    expect(source).toContain('from "react-dom"');
    expect(source).toContain("useFormState");
    expect(source).not.toContain("useActionState");
  });
});
