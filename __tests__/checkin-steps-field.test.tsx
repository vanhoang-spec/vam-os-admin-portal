/** @vitest-environment jsdom */
/**
 * Ô thiết lập các lần quét trong form sự kiện.
 *
 * Canh đúng thứ sẽ được LƯU — các ô ẩn trong FormData — chứ không chỉ chữ trên
 * màn hình: một ô chọn hiện "Check out" trong khi form gửi "Check in" là lỗi
 * không ai thấy cho tới ngày sự kiện.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CheckinStepsField } from "@/app/events/checkin-steps-field";
import type { CheckinPurpose } from "@/lib/event-checkin-steps";

afterEach(cleanup);

function renderInForm(initialSteps: CheckinPurpose[], hidden = false) {
  render(
    <form data-testid="form">
      <CheckinStepsField initialSteps={initialSteps} hidden={hidden} />
    </form>
  );
  const form = screen.getByTestId("form") as HTMLFormElement;
  return {
    form,
    saved: () => new FormData(form).getAll("checkin_steps"),
    select: (step: number) => screen.getByLabelText(`Mục của lần quét ${step}`) as HTMLSelectElement
  };
}

describe("1. thứ được gửi lên", () => {
  it("đúng các lần quét, đúng thứ tự, kèm ô đánh dấu có phần thiết lập", () => {
    const { form, saved } = renderInForm(["entrance", "talkshow", "checkout"]);
    expect(saved()).toEqual(["entrance", "talkshow", "checkout"]);
    expect(new FormData(form).get("checkin_steps_present")).toBe("1");
    expect(screen.getByText("Quét lần 3")).toBeTruthy();
  });

  it("sự kiện chưa thiết lập: một lần Check in", () => {
    const { saved } = renderInForm([]);
    expect(saved()).toEqual(["entrance"]);
  });

  it("tắt QR: phần thiết lập ẩn đi nhưng vẫn gửi danh sách đang có", () => {
    // Bỏ khỏi form là mất danh sách ngay lần lưu đó.
    const { saved } = renderInForm(["entrance", "checkout"], true);
    expect(document.getElementById("checkin-steps")?.hasAttribute("hidden")).toBe(true);
    expect(saved()).toEqual(["entrance", "checkout"]);
  });
});

describe("2. sửa danh sách", () => {
  it("đổi mục của một lần quét", () => {
    const { saved, select } = renderInForm(["entrance", "talkshow", "checkout"]);
    fireEvent.change(select(2), { target: { value: "seminar" } });
    expect(saved()).toEqual(["entrance", "seminar", "checkout"]);
  });

  it("đưa lên, đưa xuống: đổi chỗ và số lần quét chạy lại", () => {
    const { saved, select } = renderInForm(["entrance", "talkshow", "checkout"]);
    fireEvent.click(screen.getByRole("button", { name: "Đưa lần quét 3 lên trước" }));
    expect(saved()).toEqual(["entrance", "checkout", "talkshow"]);
    expect(select(2).value).toBe("checkout");

    fireEvent.click(screen.getByRole("button", { name: "Đưa lần quét 1 xuống sau" }));
    expect(saved()).toEqual(["checkout", "entrance", "talkshow"]);
  });

  it("lần đầu không đưa lên được, lần cuối không đưa xuống được", () => {
    renderInForm(["entrance", "checkout"]);
    expect((screen.getByRole("button", { name: "Đưa lần quét 1 lên trước" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Đưa lần quét 2 xuống sau" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("xoá một lần quét; lần quét cuối cùng không xoá được", () => {
    const { saved } = renderInForm(["entrance", "talkshow", "checkout"]);
    fireEvent.click(screen.getByRole("button", { name: "Xoá lần quét 2" }));
    expect(saved()).toEqual(["entrance", "checkout"]);

    fireEvent.click(screen.getByRole("button", { name: "Xoá lần quét 1" }));
    const last = screen.getByRole("button", { name: "Xoá lần quét 1" }) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    fireEvent.click(last);
    expect(saved()).toEqual(["checkout"]);
  });

  it("thêm gợi ý mục chưa dùng; tới 20 lần thì dừng", () => {
    const { saved } = renderInForm(["entrance"]);
    const add = screen.getByRole("button", { name: "+ Thêm lần quét" }) as HTMLButtonElement;

    fireEvent.click(add);
    expect(saved()).toEqual(["entrance", "gift_counter"]);

    for (let index = 0; index < 25; index += 1) fireEvent.click(add);
    expect(saved()).toHaveLength(20);
    expect(add.disabled).toBe(true);
    expect(screen.getByText("20/20 lần quét")).toBeTruthy();
  });
});

describe("3. form bị đặt lại sau khi lưu", () => {
  it("ô chọn vẫn hiện đúng thứ sẽ được lưu", () => {
    // Next đặt lại form sau mỗi lần gửi; ô chọn điều khiển bằng state bị trình
    // duyệt đưa về lựa chọn đầu tiên trong khi ô ẩn vẫn gửi giá trị thật.
    const { form, saved, select } = renderInForm(["talkshow", "checkout"]);
    fireEvent.change(select(2), { target: { value: "seminar" } });

    act(() => {
      form.reset();
    });

    expect(select(1).value).toBe("talkshow");
    expect(select(2).value).toBe("seminar");
    expect(saved()).toEqual(["talkshow", "seminar"]);
  });
});
