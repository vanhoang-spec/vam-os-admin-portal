/**
 * lib/email-templates-core.ts — the bodies of the post-matching emails.
 *
 * Two properties are worth more than the rest, and both are here.
 *
 * A draft request carries no person: `buildDraftPrompt` is built from a purpose
 * and a list of placeholder names, and the test below reads the whole payload
 * looking for anything that identifies anybody.
 *
 * A rendered message never keeps a placeholder: an email that greets a student
 * as "{{ten_mentee}}" must fail loudly before it is sent, not after.
 */
import { describe, it, expect } from "vitest";
import {
  buildDraftPrompt,
  DRAFT_PROMPT_VERSION,
  DRAFT_SYSTEM_PROMPT,
  extractPlaceholders,
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  parseDraft,
  renderTemplate,
  sampleValues,
  TEMPLATE_KINDS,
  TEMPLATE_SPECS,
  validateTemplate
} from "@/lib/email-templates-core";

describe("TEMPLATE_SPECS", () => {
  it("covers the four sends of the season", () => {
    expect(TEMPLATE_KINDS).toEqual([
      "mentee_selected",
      "mentee_mentor_intro",
      "mentor_mentee_package",
      "kickoff_invite"
    ]);
    for (const kind of TEMPLATE_KINDS) {
      expect(TEMPLATE_SPECS[kind].label).toBeTruthy();
      expect(TEMPLATE_SPECS[kind].placeholders.length).toBeGreaterThan(0);
    }
  });

  it("gives both applicant letters a link to the code of conduct and the tips", () => {
    for (const kind of ["mentee_selected", "mentee_mentor_intro", "mentor_mentee_package"] as const) {
      const keys = TEMPLATE_SPECS[kind].placeholders.map((row) => row.key);
      expect(keys, kind).toContain("link_quy_tac_ung_xu");
      expect(keys, kind).toContain("link_cam_nang");
    }
  });

  it("gives the mentor letter a dossier link rather than the answers themselves", () => {
    const keys = TEMPLATE_SPECS.mentor_mentee_package.placeholders.map((row) => row.key);
    expect(keys).toContain("link_ho_so");
    expect(keys).not.toContain("ho_so_chi_tiet");
  });
});

describe("extractPlaceholders", () => {
  it("finds each placeholder once, in order", () => {
    expect(extractPlaceholders("Chào {{ten_mentee}}, mùa {{mua}}. Xin chào {{ten_mentee}}.")).toEqual([
      "ten_mentee",
      "mua"
    ]);
  });

  it("tolerates spacing inside the braces", () => {
    expect(extractPlaceholders("{{  ten_mentee  }}")).toEqual(["ten_mentee"]);
  });

  it("finds nothing in text without placeholders", () => {
    expect(extractPlaceholders("Chào bạn")).toEqual([]);
  });
});

describe("validateTemplate", () => {
  const good = {
    kind: "mentee_selected" as const,
    subject: "Chúc mừng bạn {{ten_mentee}}",
    body: "Chào {{ten_mentee}},\n\nMùa {{mua}}.\n{{link_quy_tac_ung_xu}}\n{{link_cam_nang}}"
  };

  it("accepts a template that uses only known placeholders", () => {
    const result = validateTemplate(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it("refuses a placeholder nothing can fill", () => {
    const result = validateTemplate({ ...good, body: `${good.body}\n{{ten_truong}}` });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("{{ten_truong}}");
  });

  it("warns — but allows — a required placeholder the author left out", () => {
    const result = validateTemplate({
      kind: "mentee_selected",
      subject: "Chúc mừng",
      body: "Chào bạn, mùa {{mua}}. {{link_quy_tac_ung_xu}} {{link_cam_nang}}"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toContain("ten_mentee");
  });

  it("requires a subject and a body", () => {
    expect(validateTemplate({ ...good, subject: "  " }).ok).toBe(false);
    expect(validateTemplate({ ...good, body: "  " }).ok).toBe(false);
  });

  it("bounds both", () => {
    expect(validateTemplate({ ...good, subject: "x".repeat(MAX_SUBJECT_LENGTH + 1) }).ok).toBe(false);
    expect(validateTemplate({ ...good, body: "x".repeat(MAX_BODY_LENGTH + 1) }).ok).toBe(false);
  });

  it("keeps a subject on one line", () => {
    const result = validateTemplate({ ...good, subject: "Dòng một\nDòng hai" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).not.toContain("\n");
  });
});

describe("renderTemplate", () => {
  it("fills the placeholders", () => {
    const result = renderTemplate({
      kind: "mentee_selected",
      subject: "Chúc mừng {{ten_mentee}}",
      body: "Chào {{ten_mentee}}, mùa {{mua}}.",
      values: { ten_mentee: "Nguyễn Văn A", mua: "UEHM-S12" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe("Chúc mừng Nguyễn Văn A");
    expect(result.body).toBe("Chào Nguyễn Văn A, mùa UEHM-S12.");
  });

  it("refuses to send a message with a value missing", () => {
    const result = renderTemplate({
      kind: "mentee_mentor_intro",
      subject: "Mentor của bạn",
      body: "Chào {{ten_mentee}}, mentor của bạn là {{ten_mentor}}. {{gioi_thieu_mentor}}",
      values: { ten_mentee: "Nguyễn Văn A", ten_mentor: "Trần Thị B", gioi_thieu_mentor: "   " }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual(["gioi_thieu_mentor"]);
    expect(result.message).toContain("{{gioi_thieu_mentor}}");
  });

  it("treats a null and an empty string the same way — both are missing", () => {
    for (const value of [null, undefined, ""]) {
      const result = renderTemplate({
        kind: "mentee_selected",
        subject: "Chào",
        body: "Chào {{ten_mentee}}",
        values: { ten_mentee: value }
      });
      expect(result.ok).toBe(false);
    }
  });

  it("accepts a number, so a count can be filled in", () => {
    const result = renderTemplate({
      kind: "mentor_mentee_package",
      subject: "Bạn có {{so_luong_mentee}} mentee",
      body: "{{so_luong_mentee}} mentee.",
      values: { so_luong_mentee: 2 }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe("Bạn có 2 mentee");
  });

  it("renders every kind with its own sample values, so the preview always works", () => {
    for (const kind of TEMPLATE_KINDS) {
      const spec = TEMPLATE_SPECS[kind];
      const body = spec.placeholders.map((row) => `{{${row.key}}}`).join("\n");
      const result = renderTemplate({
        kind,
        subject: "Thư thử",
        body,
        values: sampleValues(kind)
      });
      expect(result.ok, kind).toBe(true);
    }
  });
});

describe("buildDraftPrompt — nothing identifying is asked for", () => {
  it("names every placeholder the template may use", () => {
    for (const kind of TEMPLATE_KINDS) {
      const prompt = buildDraftPrompt(kind);
      for (const placeholder of TEMPLATE_SPECS[kind].placeholders) {
        expect(prompt, `${kind}/${placeholder.key}`).toContain(`{{${placeholder.key}}}`);
      }
    }
  });

  it("is valid JSON and carries no person, address or sample value", () => {
    for (const kind of TEMPLATE_KINDS) {
      const prompt = buildDraftPrompt(kind);
      expect(() => JSON.parse(prompt)).not.toThrow();

      // The samples used for the preview must never travel with the request.
      // Only distinctive ones are checked: a sample of "2" would match the word
      // count in the instructions without meaning anything leaked.
      for (const placeholder of TEMPLATE_SPECS[kind].placeholders) {
        if (placeholder.sample.length < 4) continue;
        expect(prompt, `${kind}/${placeholder.key}`).not.toContain(placeholder.sample);
      }
      expect(prompt).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
      expect(prompt).not.toMatch(/https?:\/\//);
      expect(prompt).not.toMatch(/\d{6,}/);
    }
  });

  it("tells the model not to invent the things only we know", () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain("không bao giờ tự bịa tên người");
    expect(DRAFT_PROMPT_VERSION).toMatch(/^vam-email-/);
  });
});

describe("parseDraft", () => {
  it("reads a plain JSON answer", () => {
    const result = parseDraft(
      JSON.stringify({ subject: "Chúc mừng", body: "Chào {{ten_mentee}}" }),
      "mentee_selected"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe("Chúc mừng");
    expect(result.body).toContain("{{ten_mentee}}");
  });

  it("reads an answer the model wrapped in a code fence", () => {
    const result = parseDraft(
      '```json\n{"subject":"Chúc mừng","body":"Chào {{ten_mentee}}"}\n```',
      "mentee_selected"
    );
    expect(result.ok).toBe(true);
  });

  it("flags an invented placeholder in the draft instead of hiding it", () => {
    const result = parseDraft(
      JSON.stringify({ subject: "Chúc mừng", body: "Chào {{ten_mentee}} ở {{ten_truong}}" }),
      "mentee_selected"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("{{ten_truong}}");
    expect(result.body).toContain("ô không hợp lệ");
  });

  it("refuses nonsense and a half-written draft", () => {
    expect(parseDraft("xin lỗi, tôi không thể", "mentee_selected").ok).toBe(false);
    expect(parseDraft(JSON.stringify({ subject: "Chỉ có tiêu đề" }), "mentee_selected").ok).toBe(false);
  });

  it("bounds what it accepts", () => {
    const result = parseDraft(
      JSON.stringify({ subject: "x".repeat(500), body: "y".repeat(MAX_BODY_LENGTH + 500) }),
      "mentee_selected"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
    expect(result.body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
  });
});
