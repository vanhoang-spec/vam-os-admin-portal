/** @vitest-environment jsdom */
/**
 * Trang "Thư tự động": nội dung từng lá thư hệ thống tự gửi.
 *
 * Support team 18/09/2026 hỏi xem được nội dung thư đã gửi. Sổ thư không lưu thân
 * thư, nên thứ xem được là MẪU — và mẫu chỉ có giá trị nếu nó dựng từ chính bộ tạo
 * thư đang chạy. Một bản chép tay sẽ nói sai ngay lần đầu ai đó sửa một câu trong
 * builder, và người đọc vẫn tin rằng người nhận đã đọc đúng những dòng đó.
 *
 * Canh: mọi loại thư đều có mẫu, mẫu dựng từ builder thật, dữ liệu trong mẫu là dữ
 * liệu bịa, và cổng quyền của trang (support team xem được nội dung mẫu, nhưng đó
 * là cổng khác với sổ thư có tên và email người thật).
 */
import { readFileSync } from "node:fs";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// redirect() thật ném NEXT_REDIRECT để trang dừng ngay tại đó; bản giả phải ném theo,
// nếu không thì một trang quên return sau redirect vẫn chạy tiếp và test vẫn xanh.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  })
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
// Ô sửa là client component dùng useFormState của **react-dom** (React 18.3.1,
// không phải useActionState của React 19 — xem CLAUDE.md).
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: unknown) => [initial, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/app/actions/email-automation", () => ({
  saveAutomationContentAction: vi.fn(),
  revertAutomationContentAction: vi.fn()
}));
// Trang giờ đọc nội dung đã lưu của thư tự động. Bản giả trả về đúng bản mặc
// định — trạng thái thật của một hệ thống chưa ai sửa gì — nên trang vẫn phải
// dựng ra đủ mọi lá sửa được.
vi.mock("@/lib/email-automation", () => ({
  listAutomationContent: vi.fn(async () => {
    const { AUTOMATION_SLOTS } = await import("@/lib/email-automation-core");
    const { defaultAutomationContent } = await import("@/lib/email-automation-defaults");
    return {
      ok: true as const,
      views: AUTOMATION_SLOTS.map((slot) => ({
        slot,
        content: defaultAutomationContent(slot.id)!,
        customised: false,
        updatedAt: null,
        updatedByName: null,
        fallback: defaultAutomationContent(slot.id)!,
        preview: null
      }))
    };
  }),
  listRecentHistory: vi.fn(async () => new Map())
}));

import EmailSamplesPage from "@/app/operations/mail/samples/page";
import { MailTabs } from "@/app/operations/mail/mail-tabs";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { buildApplicationConfirmationEmail } from "@/lib/email-core";
import { AUTOMATION_SLOTS } from "@/lib/email-automation-core";
import { EMAIL_SAMPLES, emailSamplesByGroup } from "@/lib/email-samples";
import { canViewEmailSamples, canViewOutboundEmails } from "@/lib/permissions";

const SOURCE = readFileSync("lib/email-samples.ts", "utf8");
const ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;

describe("1. mẫu phủ hết các loại thư", () => {
  const declaredKinds = (() => {
    const core = readFileSync("lib/email-core.ts", "utf8");
    const union = core.slice(core.indexOf("export type EmailKind"), core.indexOf("export type EmailAttachment"));
    return Array.from(new Set(union.match(/"[a-z_]+"/g) ?? [])).map((quoted) => quoted.slice(1, -1));
  })();

  it("mọi loại thư trong hệ thống đều có mẫu", () => {
    expect(declaredKinds.length).toBeGreaterThanOrEqual(20);
    const covered = new Set(EMAIL_SAMPLES.map((sample) => sample.kind));
    expect(declaredKinds.filter((kind) => !covered.has(kind as never))).toEqual([]);
  });

  it("mỗi mẫu nói rõ gửi cho ai và gửi khi nào", () => {
    for (const sample of EMAIL_SAMPLES) {
      expect(sample.title.length).toBeGreaterThan(5);
      expect(sample.audience.length).toBeGreaterThan(3);
      expect(sample.trigger.length).toBeGreaterThan(10);
    }
  });

  it("thư lấy thân từ mẫu thư đã duyệt thì không bịa nội dung, mà chỉ ra chỗ đọc", () => {
    const templateDriven = EMAIL_SAMPLES.filter((sample) => sample.body === null);
    expect(templateDriven.map((sample) => sample.kind).sort()).toEqual([
      "general_announcement",
      "kickoff_invite",
      "mentee_mentor_intro",
      "mentee_selected",
      "mentor_mentee_package"
    ]);
    for (const sample of templateDriven) expect(sample.note).toContain("Mẫu thư");
  });

  it("nhóm nào cũng có mẫu, và không mẫu nào rơi ra ngoài nhóm", () => {
    const grouped = emailSamplesByGroup().flatMap((entry) => entry.samples);
    expect(grouped).toHaveLength(EMAIL_SAMPLES.length);
  });
});

describe("2. mẫu dựng từ bộ tạo thư thật", () => {
  it("không chép lại câu chữ: mẫu gọi builder, không tự viết tiêu đề hay thân thư", () => {
    expect(SOURCE).toContain('from "@/lib/email-core"');
    expect(SOURCE).toMatch(/build[A-Za-z]+Email\(/);
    // Một mẫu tự viết sẽ phải khai subject hoặc text ngay trong file này.
    expect(SOURCE).not.toMatch(/subject: "/);
    expect(SOURCE).not.toMatch(/text: "/);
    expect(SOURCE).not.toMatch(/html: "/);
  });

  it("thư xác nhận nộp đơn mentee khớp từng chữ với thư gửi thật", () => {
    const sample = EMAIL_SAMPLES.find((entry) => entry.kind === "mentee_application_confirmation");
    const real = buildApplicationConfirmationEmail({
      applicantName: "Nguyễn Văn A (ví dụ)",
      role: "mentee",
      seasonLabel: "UEH Mentoring Mùa 12"
    });
    expect(sample?.body?.subject).toBe(real.subject);
    expect(sample?.body?.text).toBe(real.text);
    expect(sample?.body?.html).toBe(real.html);
  });

  it("mẫu nào cũng có tiêu đề và thân thư thật sự dựng ra được", () => {
    for (const sample of EMAIL_SAMPLES) {
      if (!sample.body) continue;
      expect(sample.body.subject.trim().length).toBeGreaterThan(5);
      expect(sample.body.text.trim().length).toBeGreaterThan(50);
      expect(sample.body.html).toContain("<");
    }
  });
});

describe("3. mẫu không mang dữ liệu của người thật", () => {
  it("tên và email trong mẫu là ví dụ", () => {
    for (const sample of EMAIL_SAMPLES) {
      const body = `${sample.body?.subject ?? ""} ${sample.body?.text ?? ""}`;
      expect(body).not.toMatch(/gmail[.]com|yahoo[.]com|@ueh[.]edu[.]vn/i);
      for (const address of body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}/gi) ?? []) {
        // Chỉ hai thứ được phép: địa chỉ ví dụ, và hòm thư chung của chương trình
        // trong chữ ký thư.
        expect(address.toLowerCase()).toMatch(/example[.]com$|@alumni-mentoring[.]edu[.]vn$/);
      }
    }
  });

  it("đường dẫn cá nhân trong mẫu là link ví dụ, không mở được", () => {
    for (const sample of EMAIL_SAMPLES) {
      const text = sample.body?.text ?? "";
      for (const link of text.match(/https?:[^\s)]+/g) ?? []) {
        if (/\/renew\/|\/ve\/|\/cross\/|\/register\/|reset-password|link-hop/.test(link)) {
          expect(link).toContain("vi-du");
        }
      }
    }
  });
});

describe("4. ai xem được", () => {
  it("Admin, Core Team, Support Team xem được mẫu; reviewer và viewer thì không", () => {
    expect(ROLES.filter((role) => canViewEmailSamples(role))).toEqual([
      "super_admin",
      "admin",
      "core_team",
      "support_team"
    ]);
    for (const role of [null, undefined, ""]) expect(canViewEmailSamples(role)).toBe(false);
  });

  it("mẫu thư và sổ thư là hai cổng khác nhau: Support Team không kèm theo sổ thư", () => {
    expect(canViewEmailSamples("support_team")).toBe(true);
    expect(canViewOutboundEmails("support_team")).toBe(false);
  });

  it("tab chỉ hiện khi người xem vào được trang đó", () => {
    const { container, rerender } = render(<MailTabs active="templates" canSeeLog={false} canSeeSamples />);
    expect(container.textContent).toContain("Thư tự động");
    expect(container.textContent).not.toContain("Nhật ký gửi");

    rerender(<MailTabs active="templates" canSeeLog canSeeSamples={false} />);
    expect(container.textContent).not.toContain("Thư tự động");
    expect(container.textContent).toContain("Nhật ký gửi");
  });
});

describe("5. trang Thư tự động", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  async function renderAs(role: string | null) {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(role ? ({ id: "admin-1", role } as any) : null);
    return render(await EmailSamplesPage());
  }

  it("Support Team thấy và sửa được từng lá thư tự động", async () => {
    const { container } = await renderAs("support_team");

    expect(screen.getByText("Xác nhận đã nhận đơn mentee")).toBeTruthy();
    // Mỗi lá sửa được có đúng một nút mở ô sửa.
    const editButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Xem và sửa"
    );
    expect(editButtons).toHaveLength(AUTOMATION_SLOTS.length);
  });

  it("những lá chưa sửa được vẫn hiện, trong khung riêng không cho chạy script", async () => {
    const { container } = await renderAs("support_team");

    const editableKinds = new Set(AUTOMATION_SLOTS.map((slot) => slot.kind));
    const readOnly = EMAIL_SAMPLES.filter(
      (sample) => sample.body && !editableKinds.has(sample.kind)
    );
    // Giấu chúng đi thì màn hình nói rằng hệ thống chỉ gửi những lá sửa được, và người trực
    // support sẽ đi tìm lá thư sự kiện ở một chỗ không có nó.
    expect(readOnly.length).toBeGreaterThan(0);

    const frames = Array.from(container.querySelectorAll("iframe"));
    expect(frames).toHaveLength(readOnly.length);
    for (const frame of frames) {
      expect(frame.getAttribute("sandbox")).toBe("");
      expect(frame.getAttribute("srcdoc")).toContain("<");
    }
  });

  it("nói rõ dữ liệu là ví dụ và sổ thư không lưu nội dung", async () => {
    const { container } = await renderAs("core_team");
    expect(container.textContent).toContain("là ví dụ");
    expect(container.textContent).toContain("không lưu nội dung");
  });

  it("nói rõ lưu xong là thư gửi sau đó dùng nội dung mới", async () => {
    const { container } = await renderAs("core_team");
    expect(container.textContent).toContain("dùng nội dung mới");
  });

  it("reviewer bị từ chối, và không có nội dung thư nào được dựng ra", async () => {
    const { container } = await renderAs("reviewer");
    expect(container.textContent).toContain("Không có quyền truy cập");
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("chưa đăng nhập thì dừng lại và chuyển về trang đăng nhập", async () => {
    const { redirect } = await import("next/navigation");
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any);
    await expect(EmailSamplesPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/login");
  });
});
