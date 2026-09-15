/** @vitest-environment jsdom */
/**
 * Chữ admin sửa được hiện ra trên form công khai đúng như đã lưu.
 *
 * Canh: chữ trông như HTML không thành HTML; khối tuỳ chọn để trống thì biến mất
 * thay vì để lại một khung vàng rỗng; và các trang công khai đọc chữ SAU cổng
 * đóng/mở — một form đóng không đi đọc bảng chữ.
 */
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormRichText } from "@/components/form-rich-text";
import { MenteeSupportContacts } from "@/app/apply/_components/mentee-support-contacts";
import { MentorProfileIntro } from "@/app/apply/_components/mentor-profile-intro";
import { MentorSupportContacts } from "@/app/apply/_components/mentor-support-contacts";
import { DEFAULT_APPLICATION_FORM_TEXTS as D, resolveApplicationFormTexts } from "@/lib/application-form-text-core";

const LF = String.fromCharCode(10);

afterEach(cleanup);

describe("1. bộ hiển thị chữ", () => {
  it("chữ trông như HTML chỉ hiện đúng các ký tự đó", () => {
    const { container } = render(<FormRichText text={"<script>alert(1)</script> <b>đậm</b> <img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("chữ đậm, gạch đầu dòng, đường dẫn bấm được", () => {
    const { container } = render(
      <FormRichText
        text={["Gọi **Quốc Vĩ**", "", "- 0905.376.392", "- luongquocvihcm12@gmail.com"].join(LF)}
        strongClassName="dam"
      />
    );
    expect(container.querySelector("strong.dam")?.textContent).toBe("Quốc Vĩ");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector('a[href="tel:0905376392"]')?.textContent).toBe("0905.376.392");
    expect(container.querySelector('a[href="mailto:luongquocvihcm12@gmail.com"]')).not.toBeNull();
  });

  it("xuống dòng trong một đoạn giữ nguyên; khối rỗng không vẽ gì", () => {
    const { container } = render(<FormRichText text={["Dòng 1", "Dòng 2"].join(LF)} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(render(<FormRichText text="" />).container.firstChild).toBeNull();
  });
});

describe("2. phần chân dung và liên hệ mentor", () => {
  it("mặc định: vẫn là bản đã duyệt, có khung lưu ý hạn nộp 19/09/2026", () => {
    const { container } = render(<MentorProfileIntro />);
    expect(container.querySelector("h2")?.textContent).toBe("Chân dung Mentor mà UEH Mentoring đang tìm kiếm");
    const notes = container.querySelectorAll(".bg-amber-50");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain("19/09/2026");
    expect(container.querySelectorAll("ol > li")).toHaveLength(3);
  });

  it("đã sửa: hiện bản đã sửa; lưu ý bước 1 để trống thì biến mất, lưu ý bước 3 mới thì hiện", () => {
    const texts = resolveApplicationFormTexts({
      "mentor.profile.heading": "Mentor mùa 12 cần gì",
      "mentor.process.step1_note": "",
      "mentor.process.step3_note": "Orientation: **27/09** hoặc **04/10**."
    });
    const { container } = render(<MentorProfileIntro texts={texts} />);
    expect(container.querySelector("h2")?.textContent).toBe("Mentor mùa 12 cần gì");
    const notes = container.querySelectorAll(".bg-amber-50");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe("Orientation: 27/09 hoặc 04/10.");
    expect(container.textContent).not.toContain("19/09/2026");
  });

  it("form gia hạn: không có phần quy trình, dù chữ quy trình có sửa", () => {
    const texts = resolveApplicationFormTexts({ "mentor.process.step3_note": "Orientation 27/09" });
    const { container } = render(<MentorProfileIntro texts={texts} includeApplicationProcess={false} />);
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toContain("Orientation 27/09");
  });

  it("liên hệ mentor: đủ ba người, số và email bấm được", () => {
    const { container } = render(<MentorSupportContacts />);
    expect(container.querySelector("h2")?.textContent).toBe(D["mentor.contacts.heading"]);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelector('a[href="tel:0905376392"]')).not.toBeNull();
    expect(container.querySelector('a[href="tel:0979578128"]')).not.toBeNull();
    expect(container.querySelector('a[href="mailto:lieu.nguyen@hoatay.com.vn"]')).not.toBeNull();
  });

  it("liên hệ mentee: đủ hai người, số bấm được như trước", () => {
    const { container } = render(<MenteeSupportContacts />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector('a[href="tel:0394983679"]')?.textContent).toBe("0394983679");
    expect(container.querySelector('a[href="tel:0936359670"]')).not.toBeNull();
    expect(container.textContent).toContain("Trần Mỹ Anh");
  });
});

describe("3. trang công khai đọc chữ sau cổng đóng/mở, và truyền chữ xuống form", () => {
  it.each([
    ["app/apply/mentor/page.tsx", "<ApplyMentorForm applyToken={carriedToken} texts={texts} />", "mentor.header.title"],
    ["app/apply/mentee/page.tsx", "<ApplyMenteeForm applyToken={carriedToken} texts={texts} />", "mentee.header.title"]
  ])("%s", (file, formLine, titleKey) => {
    const page = readFileSync(file, "utf8");
    const closed = page.indexOf('if (gate.status === "closed")');
    const read = page.indexOf("await getApplicationFormTexts()");
    expect(closed).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(closed);
    expect(page).toContain(formLine);
    expect(page).toContain(`{texts["${titleKey}"]}`);
  });

  it("form mentor và mentee truyền chữ xuống phần chân dung và liên hệ", () => {
    const mentor = readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    expect(mentor).toContain("<MentorProfileIntro texts={texts} />");
    expect(mentor).toContain("<MentorSupportContacts texts={texts} />");
    const mentee = readFileSync("app/apply/mentee/apply-mentee-form.tsx", "utf8");
    expect(mentee).toContain("<MenteeSupportContacts texts={texts} />");
  });

  it("form gia hạn dùng chung chữ, chỉ đọc khi form thật sự hiện", () => {
    const page = readFileSync("app/renew/[token]/page.tsx", "utf8");
    expect(page).toContain('const texts = data.status === "renewable" ? await getApplicationFormTexts() : null;');
    expect(page).toContain("texts={texts ?? undefined}");
    const form = readFileSync("app/renew/[token]/renewal-form.tsx", "utf8");
    expect(form).toContain("<MentorProfileIntro texts={texts} includeApplicationProcess={false} />");
    expect(form).toContain("<MentorSupportContacts texts={texts} />");
  });
});
