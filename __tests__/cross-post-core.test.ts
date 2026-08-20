import { describe, expect, it } from "vitest";

import {
  buildPostPrompt,
  draftLooksSafe,
  parsePostDraft,
  POST_PROMPT_VERSION,
  POST_SYSTEM_PROMPT,
  scrubMenteeIdentity
} from "@/lib/cross-post-core";

/**
 * The one thing worth testing hardest here is not the quality of the post — a
 * model writes that and a person edits it. It is what crosses the boundary into
 * a third-party model.
 *
 * The owner approved exactly one exception: mentor name, title, company and
 * field, because those are going onto a public Facebook page anyway. Everything
 * about the mentee stays here. These tests hold that line.
 */

const MENTOR = {
  fullName: "Nguyễn Văn A",
  jobTitle: "Giám đốc Tài chính",
  company: "Công ty ABC"
};

describe("scrubMenteeIdentity", () => {
  it("removes an email address", () => {
    const out = scrubMenteeIdentity("Mình muốn hỏi về CFA, mail mình là mentee.test@gmail.com nhé");
    expect(out).not.toContain("mentee.test@gmail.com");
    expect(out).toContain("[email đã ẩn]");
  });

  it("removes Vietnamese mobile numbers however they are typed", () => {
    for (const phone of ["0912345678", "0912 345 678", "091.234.5678", "+84912345678"]) {
      const out = scrubMenteeIdentity(`Liên hệ mình ${phone} nha`);
      expect(out, phone).not.toContain(phone);
      expect(out, phone).toContain("[số điện thoại đã ẩn]");
    }
  });

  it("removes a student number", () => {
    const out = scrubMenteeIdentity("Mình là UEHEM11104, muốn nghe về ngân hàng");
    expect(out).not.toContain("UEHEM11104");
  });

  it("removes a Facebook link", () => {
    const out = scrubMenteeIdentity("Inbox mình ở facebook.com/some.person nhé");
    expect(out).not.toContain("facebook.com/some.person");
  });

  it("leaves an ordinary topic untouched", () => {
    const topic = "Em muốn nghe về lộ trình từ kiểm toán sang tài chính doanh nghiệp";
    expect(scrubMenteeIdentity(topic)).toBe(topic);
  });

  it("returns an empty string for nothing", () => {
    expect(scrubMenteeIdentity(null)).toBe("");
    expect(scrubMenteeIdentity(undefined)).toBe("");
    expect(scrubMenteeIdentity("   ")).toBe("");
  });
});

describe("buildPostPrompt — what the model is told", () => {
  it("carries the mentor's name, title and company", () => {
    const prompt = buildPostPrompt({
      fieldLabel: "Tài chính / Ngân hàng",
      topic: "Lộ trình nghề nghiệp ngành tài chính",
      mentors: [MENTOR]
    });

    expect(prompt).toContain("Nguyễn Văn A");
    expect(prompt).toContain("Giám đốc Tài chính");
    expect(prompt).toContain("Công ty ABC");
    expect(prompt).toContain("Tài chính / Ngân hàng");
  });

  it("never carries a mentee's contact details, even when the topic holds them", () => {
    const prompt = buildPostPrompt({
      fieldLabel: "Tài chính / Ngân hàng",
      topic: "Em là UEHEM11104, mail em huong.nguyen@example.com, sđt 0912345678, mong được nghe về ngành",
      mentors: [MENTOR]
    });

    expect(prompt).not.toContain("huong.nguyen@example.com");
    expect(prompt).not.toContain("0912345678");
    expect(prompt).not.toContain("UEHEM11104");
    // The substance of the request survives the scrubbing.
    expect(prompt).toContain("mong được nghe về ngành");
  });

  it("says a missing time and place will be announced rather than leaving a blank to fill", () => {
    const prompt = buildPostPrompt({ fieldLabel: "Marketing", mentors: [MENTOR] });
    expect(prompt).toContain("(sẽ thông báo sau)");
  });

  it("includes the time and place when they are known", () => {
    const prompt = buildPostPrompt({
      fieldLabel: "Marketing",
      mentors: [MENTOR],
      timeLabel: "20/09/2026 19:00",
      location: "Hội trường B1, UEH"
    });

    expect(prompt).toContain("20/09/2026 19:00");
    expect(prompt).toContain("Hội trường B1, UEH");
    expect(prompt).not.toContain("(sẽ thông báo sau)");
  });

  it("says so plainly when no mentor has been chosen, rather than dropping the line", () => {
    const prompt = buildPostPrompt({ fieldLabel: "Marketing", mentors: [] });
    expect(prompt).toContain("(chưa chốt)");
  });

  it("skips a mentor with no name instead of writing a dash", () => {
    const prompt = buildPostPrompt({
      fieldLabel: "Marketing",
      mentors: [{ fullName: "  " }, MENTOR]
    });

    expect(prompt).toContain("Nguyễn Văn A");
    expect(prompt).not.toContain("- \n");
  });

  it("keeps a registration link when there is one", () => {
    const prompt = buildPostPrompt({
      fieldLabel: "Marketing",
      mentors: [MENTOR],
      registerUrl: "https://vam.example.com/register/abc"
    });
    expect(prompt).toContain("https://vam.example.com/register/abc");
  });
});

describe("POST_SYSTEM_PROMPT", () => {
  it("forbids inventing facts and naming a mentee", () => {
    expect(POST_SYSTEM_PROMPT).toContain("Không bịa");
    expect(POST_SYSTEM_PROMPT).toContain("Không nhắc tới mentee nào cụ thể");
  });

  it("says the output is a draft for a person to edit", () => {
    expect(POST_SYSTEM_PROMPT).toContain("BẢN NHÁP");
  });

  it("is versioned so a stored draft can be traced to the prompt that made it", () => {
    expect(POST_PROMPT_VERSION).toMatch(/^cross-post-v\d+$/);
  });
});

describe("parsePostDraft", () => {
  it("unwraps a fenced block", () => {
    expect(parsePostDraft("```\nNội dung bài đăng\n```")).toBe("Nội dung bài đăng");
    expect(parsePostDraft("```markdown\nNội dung bài đăng\n```")).toBe("Nội dung bài đăng");
  });

  it("drops a leading announcement", () => {
    expect(parsePostDraft("Bài đăng:\n\nNội dung thật")).toBe("Nội dung thật");
  });

  it("keeps ordinary prose as it is", () => {
    expect(parsePostDraft("Bạn đang băn khoăn về ngành tài chính?")).toBe(
      "Bạn đang băn khoăn về ngành tài chính?"
    );
  });

  it("returns an empty string for nothing", () => {
    expect(parsePostDraft(null)).toBe("");
    expect(parsePostDraft("   ")).toBe("");
  });

  it("caps a runaway answer", () => {
    expect(parsePostDraft("x".repeat(20_000)).length).toBe(8000);
  });
});

describe("draftLooksSafe", () => {
  it("passes an ordinary post", () => {
    expect(draftLooksSafe("Buổi cross-mentoring cùng anh Nguyễn Văn A, CFO Công ty ABC.").ok).toBe(
      true
    );
  });

  it("flags a draft that came back holding an email", () => {
    const result = draftLooksSafe("Đăng ký qua mail ai.do@example.com nhé");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("email");
  });

  it("flags a draft that came back holding a phone number", () => {
    const result = draftLooksSafe("Gọi 0912345678 để đăng ký");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("số điện thoại");
  });

  it("does not get stuck on a stale regex position when called repeatedly", () => {
    // Global regexes carry lastIndex between calls; a check that passes once and
    // fails the next time on identical input would be worse than no check.
    const draft = "Gọi 0912345678 để đăng ký";
    expect(draftLooksSafe(draft).ok).toBe(false);
    expect(draftLooksSafe(draft).ok).toBe(false);
    expect(draftLooksSafe("Bài đăng bình thường").ok).toBe(true);
    expect(draftLooksSafe("Bài đăng bình thường").ok).toBe(true);
  });

  it("refuses an empty draft", () => {
    expect(draftLooksSafe("").ok).toBe(false);
  });
});
