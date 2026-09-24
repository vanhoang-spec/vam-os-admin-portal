/** @vitest-environment jsdom */
/**
 * __tests__/o-cau-xac-nhan-bao-ngay.test.tsx
 *
 * Ô "nhập lại câu xác nhận" báo ngay tại chỗ, trước khi bấm gửi.
 *
 * ---------------------------------------------------------------------------
 * LỖI CÓ THẬT ĐỨNG SAU
 * ---------------------------------------------------------------------------
 * 24/09/2026 một mentor gọi điện góp ý về form gia hạn. Bản vá trước giữ lại
 * những ô đã điền khi máy chủ từ chối; bản này bỏ luôn cái vòng gửi-rồi-bị-
 * từ-chối, vì ô đó là ô DUY NHẤT trình duyệt không tự kiểm được.
 *
 * ---------------------------------------------------------------------------
 * CA ĐÁNG GIÁ NHẤT Ở ĐÂY
 * ---------------------------------------------------------------------------
 * Phép so của máy chủ đã bỏ qua hoa thường, dấu câu và khoảng trắng thừa. Một
 * bản viết ngây thơ (`typed === phrase`) vẫn qua được mọi ca "gõ đúng y hệt",
 * rồi báo SAI với người gõ đúng mà quên dấu chấm cuối câu — tức là màn hình từ
 * chối một câu mà máy chủ sẽ chấp nhận, và người dùng không có đường thoát.
 * Describe 2 canh đúng chỗ đó.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIRMATION_PHRASES, confirmationMatches } from "@/lib/application-commitments";
import { ConfirmationPhraseField } from "@/app/renew/[token]/confirmation-phrase-field";

const ROOT = join(__dirname, "..");
const PHRASE = CONFIRMATION_PHRASES.mentor;

afterEach(cleanup);

function renderField() {
  const { container } = render(
    <ConfirmationPhraseField name="MENTOR_ACTIVE_READING_V1" phrase={PHRASE} className="o-nhap" />
  );
  const input = container.querySelector("input") as HTMLInputElement;
  return { container, input };
}

function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("1. báo đúng ba trạng thái", () => {
  it("chưa gõ gì: chỉ là lời nhắc, không phải lời chê", () => {
    const { input } = renderField();

    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("dấu tiếng Việt thì cần đúng");
    expect(screen.queryByText(/Chưa khớp/)).toBeNull();
  });

  it("gõ lệch: báo chưa khớp và chỉ đúng chỗ cần soi", () => {
    const { input } = renderField();
    typeInto(input, "Toi hieu cam ket cua Mentor");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByRole("status").textContent ?? "";
    expect(message).toContain("Chưa khớp");
    expect(message).toContain("dấu tiếng Việt");
    // Nói cả chỗ KHÔNG cần bận tâm, để người dùng thôi sửa nhầm hướng.
    expect(message).toContain("Không cần đúng hoa thường hay dấu câu");
  });

  it("gõ đúng: báo đã khớp", () => {
    const { input } = renderField();
    typeInto(input, PHRASE);

    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("Đã khớp");
  });
});

describe("2. màn hình KHÔNG BAO GIỜ nói sai với câu máy chủ sẽ nhận", () => {
  /**
   * Mỗi chuỗi dưới đây là một cách gõ mà `confirmationMatches` — chính hàm máy
   * chủ dùng — chấp nhận. Màn hình phải chấp nhận y hệt.
   */
  const MAY_CHU_NHAN = [
    ["đúng y hệt", PHRASE],
    ["viết thường hết", PHRASE.toLocaleLowerCase("vi")],
    ["VIẾT HOA HẾT", PHRASE.toLocaleUpperCase("vi")],
    ["thiếu dấu chấm cuối câu", PHRASE.replace(".", "")],
    ["thừa khoảng trắng hai đầu", `   ${PHRASE}   `],
    ["thừa khoảng trắng giữa chữ", PHRASE.replace(" và ", "   và   ")]
  ] as const;

  it.each(MAY_CHU_NHAN)("%s", (_ten, value) => {
    // Trước hết khẳng định tiền đề: máy chủ THẬT SỰ nhận chuỗi này.
    expect(confirmationMatches(value, PHRASE)).toBe(true);

    const { input } = renderField();
    typeInto(input, value);

    expect(screen.getByRole("status").textContent).toContain("Đã khớp");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("bỏ dấu tiếng Việt thì cả hai bên cùng từ chối — không bên nào dễ dãi hơn", () => {
    const boDau = "Toi hieu cam ket cua Mentor va san sang dong hanh cung Mentee trong suot mua mentoring.";
    expect(confirmationMatches(boDau, PHRASE)).toBe(false);

    const { input } = renderField();
    typeInto(input, boDau);

    expect(screen.getByRole("status").textContent).toContain("Chưa khớp");
  });
});

describe("3. vẫn là cổng ở máy chủ, không phải ở màn hình", () => {
  it("ô vẫn bắt buộc — bỏ trống không gửi được", () => {
    const { input } = renderField();
    expect(input.required).toBe(true);
  });

  it("phép kiểm phía máy chủ giữ nguyên", () => {
    const runtime = readFileSync(join(ROOT, "lib/renewal-runtime.ts"), "utf8");
    expect(runtime).toContain("confirmationMatches(activeReading, CONFIRMATION_PHRASES.mentor)");
  });

  /**
   * Hai phép so riêng cho cùng một câu là hai cơ hội để màn hình nói "khớp rồi"
   * trong khi máy chủ nói không. Ca này canh rằng màn hình gọi đúng hàm chung
   * chứ không tự so chuỗi.
   */
  it("màn hình dùng CHUNG hàm so với máy chủ, không tự so chuỗi", () => {
    const source = readFileSync(
      join(ROOT, "app/renew/[token]/confirmation-phrase-field.tsx"),
      "utf8"
    );
    expect(source).toContain('confirmationMatches } from "@/lib/application-commitments"');

    const code = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("*") && !line.startsWith("/*") && !line.startsWith("//"))
      .join("\n");
    expect(code).not.toContain("=== phrase");
    expect(code).not.toContain("toLowerCase");
    expect(code).not.toContain("normalize(");
  });
});
