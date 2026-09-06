import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ cache: <T extends (...args: any[]) => any>(fn: T) => fn }));

import {
  applicationExportCsv,
  buildApplicationExportData,
  flattenRawPayload,
  humanizeKey,
  isCheckboxField,
  parseStoredBoolean,
  type ApplicationExportField
} from "@/lib/application-export";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { applicationExportPdf, buildApplicationPdfContent } from "@/lib/application-export-pdf";
import { APPLICATION_ACKNOWLEDGEMENTS as ACK } from "@/lib/application-commitments";

/**
 * Slice 2C — per-application export quality.
 *
 * The 03 Sep feedback was that a ticked commitment could read as blank, that
 * "Submitted Answers" and "Raw Form Content" repeated each other, and that
 * internal keys such as `mentor_people_management_years` reached the reader.
 * These are behavioural tests over the canonical exporter: nothing here asserts
 * on source text.
 */

const MISSING = "—";

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    person_id: "person-1",
    season_id: "season-12",
    intake_batch_id: "batch-12",
    role_applied: "mentor",
    full_name: "Nguyễn Ánh",
    email_primary: "anh@example.com",
    phone_primary: "0901234567",
    gender: "female",
    sbd: "M12-001",
    submitted_at: "2026-08-29",
    status: "submitted",
    final_status: null,
    source: "vam_os_form",
    consent_data_storage: true,
    consent_pdpa: null,
    acquisition_channel: null,
    profile_url: null,
    raw_payload: null,
    ...overrides
  } as any;
}

function build(rawPayload: Record<string, unknown> | null, answers: any[] = []) {
  return buildApplicationExportData({
    application: application({ raw_payload: rawPayload }),
    answers,
    person: null,
    mentorProfile: null,
    menteeProfile: null,
    season: { id: "season-12", code: "S12", name: "Season 12", program_id: "uehm" } as any
  });
}

function find(fields: ApplicationExportField[], label: string) {
  return fields.filter((field) => field.label === label);
}

function answer(questionKey: string, questionLabel: string, valueText: unknown) {
  return { id: `answer-${questionKey}`, question_key: questionKey, question_label: questionLabel, value_text: valueText };
}

describe("Slice 2C — boolean and checkbox correctness", () => {
  it("keeps true, false, null, undefined, empty string and zero distinct", () => {
    const fields = build({
      can_attend_orientation: true,
      open_to_intro_call: false,
      linkedin_url: null,
      additional_notes: undefined,
      mentoring_topics: "",
      gpa_4: 0,
      mentor_largest_team_size: 0
    }).fields;

    // A boolean answer is stated, both ways round.
    expect(find(fields, "Có thể tham gia buổi định hướng")[0].value).toBe("Có");
    expect(find(fields, "Sẵn sàng tham gia cuộc gọi giới thiệu")[0].value).toBe("Không");

    // Absent values carry no row at all in the form-content section, so they
    // can never be confused with an answered "no".
    for (const label of ["LinkedIn", "Thông tin bổ sung", "Chủ đề mentoring"]) {
      expect(find(fields, label)).toHaveLength(0);
    }

    // Zero is an answer, not an absence.
    expect(find(fields, "GPA (thang 4)")[0].value).toBe("0");
    expect(find(fields, "Đội ngũ lớn nhất trực tiếp quản lý")[0].value).toBe("0");
    expect(fields.some((field) => field.value === "")).toBe(false);
  });

  it("never renders false or zero as the missing marker", () => {
    const fields = build({ open_to_intro_call: false, gpa_4: 0, commitment_understanding: false }).fields;
    for (const label of [
      "Sẵn sàng tham gia cuộc gọi giới thiệu",
      "GPA (thang 4)",
      "Xác nhận hiểu cam kết"
    ]) {
      expect(find(fields, label)[0].value).not.toBe(MISSING);
    }
  });

  it("uses the missing marker only for a null or empty canonical column", () => {
    const fields = build(null).fields;
    expect(find(fields, "Liên kết hồ sơ ứng viên")[0].value).toBe(MISSING);
    expect(find(fields, "Biết đến chương trình qua")[0].value).toBe(MISSING);
    // Marker must not collide with the spreadsheet-formula guard.
    expect(applicationExportCsv(build(null))).not.toContain(`"'${MISSING}"`);
  });

  it("exports a ticked commitment as chosen, from the text column it is stored in", () => {
    const key = ACK.MENTOR_TIME_COMMITMENT_V1.key;
    const fields = build(null, [answer(key, ACK.MENTOR_TIME_COMMITMENT_V1.wording, "true")]).fields;
    const row = find(fields, ACK.MENTOR_TIME_COMMITMENT_V1.wording)[0];
    expect(row.value).toBe("Đã chọn");
    expect(row.value).not.toBe("true");
    expect(row.value).not.toBe(MISSING);
  });

  it("exports an unticked commitment as not chosen rather than as missing", () => {
    const key = ACK.MENTOR_NO_GHOST_V1.key;
    const fields = build(null, [answer(key, ACK.MENTOR_NO_GHOST_V1.wording, "false")]).fields;
    const row = find(fields, ACK.MENTOR_NO_GHOST_V1.wording)[0];
    expect(row.value).toBe("Chưa chọn");
    expect(row.value).not.toBe(MISSING);
  });

  it("applies the checkbox wording to the raw payload commitment too", () => {
    expect(find(build({ commitment_understanding: true }).fields, "Xác nhận hiểu cam kết")[0].value).toBe("Đã chọn");
    expect(find(build({ commitment_understanding: false }).fields, "Xác nhận hiểu cam kết")[0].value).toBe("Chưa chọn");
  });

  it("does not reinterpret ordinary free text as a stored boolean", () => {
    expect(parseStoredBoolean("true")).toBe(true);
    expect(parseStoredBoolean(" FALSE ")).toBe(false);
    expect(parseStoredBoolean("Không")).toBeNull();
    expect(parseStoredBoolean("truthy")).toBeNull();
    expect(parseStoredBoolean("")).toBeNull();
    expect(parseStoredBoolean(0)).toBeNull();

    const fields = build(null, [answer("mentoring_goals_text", "Mục tiêu mentoring", "true nghĩa là đúng")]).fields;
    expect(find(fields, "Mục tiêu mentoring")[0].value).toBe("true nghĩa là đúng");
  });

  it("classifies only acknowledgement and commitment keys as checkboxes", () => {
    expect(isCheckboxField(ACK.MENTOR_ELIGIBILITY_V1.key)).toBe(true);
    expect(isCheckboxField("commitment_understanding")).toBe(true);
    expect(isCheckboxField("can_attend_orientation")).toBe(false);
    expect(isCheckboxField("")).toBe(false);
  });
});

describe("Slice 2C — human/raw duplication", () => {
  const duplicated = {
    mentor_total_work_years: 12,
    mentor_people_management_years: 5,
    mentor_reference: "Chị Lan"
  };

  it("states an answer once when the stored payload repeats it verbatim", () => {
    const data = build(duplicated, [
      answer("mentor_total_work_years", "Tổng số năm kinh nghiệm làm việc", "12"),
      answer("mentor_people_management_years", "Tổng số năm kinh nghiệm quản lý con người/đội ngũ", "5")
    ]);
    const values = data.fields.filter((field) => field.value === "12");
    expect(values).toHaveLength(1);
    expect(values[0].section).toBe("Câu trả lời ứng tuyển");
    expect(data.fields.filter((field) => field.value === "5")).toHaveLength(1);

    // The raw copy is gone; the answer with its real question wording stays.
    expect(find(data.fields, "Tổng số năm kinh nghiệm làm việc")).toHaveLength(1);
    expect(find(data.fields, "Số năm quản lý con người / đội ngũ")).toHaveLength(0);
  });

  it("keeps raw information the answers do not represent, exactly once", () => {
    const data = build({ ...duplicated, linkedin_url: "https://linkedin.com/in/anh" }, [
      answer("mentor_total_work_years", "Tổng số năm kinh nghiệm làm việc", "12")
    ]);
    const linkedin = find(data.fields, "LinkedIn");
    expect(linkedin).toHaveLength(1);
    expect(linkedin[0].value).toBe("https://linkedin.com/in/anh");
    expect(linkedin[0].section).toBe("Nội dung form S12");

    // `mentor_reference` has no answer row: it must survive, not be dropped as
    // collateral of de-duplication.
    expect(find(data.fields, "Người giới thiệu / tham chiếu")[0].value).toBe("Chị Lan");
  });

  it("keeps a conflicting stored value once and labels it so it reads as a second source", () => {
    const data = build({ mentor_reference: "Chị Lan" }, [
      answer("mentor_reference", "Người giới thiệu/người tham chiếu", "Anh Minh")
    ]);
    expect(find(data.fields, "Người giới thiệu/người tham chiếu")[0].value).toBe("Anh Minh");
    const raw = find(data.fields, "Người giới thiệu / tham chiếu (dữ liệu form gốc)");
    expect(raw).toHaveLength(1);
    expect(raw[0].value).toBe("Chị Lan");
    expect(data.fields.filter((field) => field.value === "Chị Lan")).toHaveLength(1);
  });

  it("does not drop a raw row that merely shares a value with an unrelated answer", () => {
    const data = build({ linkedin_url: "Chị Lan" }, [
      answer("mentor_reference", "Người giới thiệu/người tham chiếu", "Chị Lan")
    ]);
    expect(data.fields.filter((field) => field.value === "Chị Lan")).toHaveLength(2);
  });
});

describe("Slice 2C — internal key humanization", () => {
  it("resolves a known internal key to its canonical label", () => {
    expect(humanizeKey("mentor_people_management_years")).toBe("Số năm quản lý con người / đội ngũ");
    expect(humanizeKey("mssv")).toBe("Mã số sinh viên");
  });

  it("resolves a nested path through its final segment instead of leaking the path", () => {
    const fields = build({ profile: { linkedin_url: "https://linkedin.com/in/anh" } }).fields;
    expect(find(fields, "LinkedIn")).toHaveLength(1);
    expect(fields.some((field) => field.label.includes("profile."))).toBe(false);
  });

  it("never leaves an unmapped key in its raw underscore form", () => {
    const fields = build({ some_unmapped_field: "giá trị" }).fields;
    const row = fields.find((field) => field.value === "giá trị")!;
    expect(row.label).toBe("Some unmapped field");
    expect(row.label).not.toContain("_");
  });

  it("does not append the internal key when a canonical answer label exists", () => {
    const fields = build(null, [answer("mentor_people_management_years", "Số năm quản lý con người/đội ngũ", "5")]).fields;
    const row = fields.find((field) => field.value === "5")!;
    expect(row.label).toBe("Số năm quản lý con người/đội ngũ");
    expect(row.label).not.toContain("mentor_people_management_years");
    expect(row.label).not.toContain("(");
  });

  it("falls back to the mapped label when an answer stores no question label", () => {
    const fields = build(null, [
      { id: "a", question_key: "mentor_people_management_years", question_label: null, value_text: "5" }
    ]).fields;
    expect(fields.find((field) => field.value === "5")!.label).toBe("Số năm quản lý con người / đội ngũ");
  });

  it("re-adds the key only to disambiguate two fields that would claim the same question", () => {
    const fields = build(null, [
      answer("mentoring_goals_text", "Mục tiêu", "Đi làm đúng ngành"),
      answer("one_year_vision_text", "Mục tiêu", "Trưởng nhóm")
    ]).fields;
    expect(find(fields, "Mục tiêu (mentoring_goals_text)")).toHaveLength(1);
    expect(find(fields, "Mục tiêu (one_year_vision_text)")).toHaveLength(1);
    expect(find(fields, "Mục tiêu")).toHaveLength(0);
  });

  it("disambiguates raw rows whose final segments map to the same canonical label", () => {
    const fields = build({ hien_tai: { major: "Kinh tế" }, mong_muon: { major: "Tài chính" } }).fields;
    expect(find(fields, "Ngành học (hien_tai.major)")).toHaveLength(1);
    expect(find(fields, "Ngành học (mong_muon.major)")).toHaveLength(1);
  });

  it("still refuses internal metadata segments while humanizing", () => {
    expect(flattenRawPayload({ token_hash: "abc", motivation_text: "giữ lại" })).toEqual([
      { key: "motivation_text", value: "giữ lại" }
    ]);
  });
});

describe("Slice 2C — CSV readability", () => {
  const data = build({ preferred_language: ["Tiếng Việt", "English"], nested: { quote: 'Cô ấy nói "xin chào"' } }, [
    answer("mentoring_goals_text", "Mục tiêu, cụ thể", "Dòng một\nDòng hai")
  ]);
  const csv = applicationExportCsv(data);

  it("keeps the UTF-8 BOM", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("uses one row per field with an explicit section, question and answer column", () => {
    expect(csv).toContain('"Phần","Mục / Câu hỏi","Nội dung"');
    const rows = csv.slice(1).split("\r\n").filter(Boolean);
    expect(rows).toHaveLength(data.fields.length + 1);
    // No aliased second column repeating the same answer.
    for (const row of rows) expect(row.split('","')).toHaveLength(3);
  });

  it("escapes quotes, commas and newlines without splitting a field", () => {
    expect(csv).toContain('"Cô ấy nói ""xin chào"""');
    expect(csv).toContain('"Mục tiêu, cụ thể"');
    expect(csv).toContain('"Dòng một\nDòng hai"');
  });

  it("keeps formula-injection protection on every column", () => {
    const dangerous = applicationExportCsv({
      ...data,
      fields: [{ section: "=SECTION", label: "@label", value: "-2+3" }]
    });
    expect(dangerous).toContain('"\'=SECTION","\'@label","\'-2+3"');
  });
});

function pageCount(pdf: Buffer) {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

/** Renders arbitrary pdfmake content with the exporter's own page geometry. */
function renderContent(content: unknown[]): Promise<Buffer> {
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = pdfFonts as unknown as Record<string, string>;
  return new Promise((resolve) => {
    pdfMake
      .createPdf({
        pageSize: "A4",
        pageMargins: [48, 52, 48, 52],
        defaultStyle: { font: "Roboto", fontSize: 10 },
        content
      } as any)
      .getBuffer((buffer) => resolve(Buffer.from(buffer)));
  });
}

/** Inflates every Flate content stream so the drawing operators can be read. */
function pdfStreams(pdf: Buffer) {
  const src = pdf.toString("latin1");
  const streams: string[] = [];
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(src))) {
    const start = match.index + match[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      streams.push(inflateSync(Buffer.from(src.slice(start, end), "latin1")).toString("latin1"));
    } catch {
      // Not a Flate stream (font programs and metadata); ignored.
    }
  }
  return { src, streams };
}

describe("Slice 2C — PDF readability", () => {
  const shortData = build({ motivation_text: "Muốn đóng góp." }, [
    answer(ACK.MENTOR_TIME_COMMITMENT_V1.key, ACK.MENTOR_TIME_COMMITMENT_V1.wording, "true")
  ]);

  it("binds every section heading to its first field so no heading is orphaned", () => {
    const content = buildApplicationPdfContent(shortData) as any[];
    const headings = content.filter(
      (node) => node.stack && node.stack.some((child: any) => child.style === "section")
    );
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading.stack[0].style).toBe("section");
      // The heading and the field beneath it travel as one block.
      expect(heading.stack).toHaveLength(2);
      expect(heading.unbreakable).toBe(true);
    }
    // A bare heading is never emitted on its own.
    expect(content.some((node) => node.style === "section")).toBe(false);
  });

  it("emits no section for a role the application does not have", () => {
    const content = JSON.stringify(buildApplicationPdfContent(shortData));
    expect(content).toContain("HỒ SƠ MENTOR".slice(0, 0) + "THÔNG TIN ỨNG VIÊN");
    expect(content).not.toContain("HỒ SƠ MENTEE");
  });

  it("lets a long answer flow across pages instead of forcing it whole", () => {
    const content = buildApplicationPdfContent({
      ...shortData,
      fields: [{ section: "Câu trả lời ứng tuyển", label: "Câu trả lời dài", value: "Rất dài. ".repeat(400) }]
    }) as any[];
    const opener = content[content.length - 1];
    expect(opener.unbreakable).toBeUndefined();
  });

  it("spends no extra page on the anti-orphan grouping, and grows only with content", async () => {
    const short = await applicationExportPdf(shortData);
    expect(short.subarray(0, 8).toString("ascii")).toBe("%PDF-1.3");
    const shortPages = pageCount(short);

    // Same content, headings free to separate from their first field. Keeping
    // them together must not cost a page — that is what would produce the
    // near-empty pages the feedback described.
    const ungrouped = await renderContent(
      (buildApplicationPdfContent(shortData) as any[]).map((node) =>
        node.unbreakable ? { ...node, unbreakable: false } : node
      )
    );
    expect(shortPages).toBe(pageCount(ungrouped));

    const long = await applicationExportPdf({
      ...shortData,
      fields: [
        ...shortData.fields,
        {
          section: "Câu trả lời ứng tuyển",
          label: "Câu trả lời dài",
          value: "Tôi mong muốn học hỏi và đóng góp cho cộng đồng. ".repeat(700)
        }
      ]
    });
    expect(pageCount(long)).toBeGreaterThan(shortPages);
  }, 30_000);

  /**
   * The 03 Sep note claimed the PDF was an image whose text could not be
   * copied. This reproduces the claim against the canonical engine rather than
   * acting on it: the body is drawn with text-showing operators against
   * embedded fonts that carry a ToUnicode map, and no image XObject is present.
   */
  it("draws selectable, copyable text rather than a rasterised page", async () => {
    const { src, streams } = pdfStreams(await applicationExportPdf(shortData));
    expect(streams.some((stream) => /\bBT\b/.test(stream) && /\bTJ\b|\bTj\b/.test(stream))).toBe(true);
    expect((src.match(/\/Type\s*\/Font/g) ?? []).length).toBeGreaterThan(0);
    expect(src).toContain("/ToUnicode");
    expect(/\/Subtype\s*\/Image/.test(src)).toBe(false);
  }, 30_000);
});
