/**
 * lib/ai-matching-core.ts — what leaves the building, and what is done with
 * what comes back.
 *
 * The first block is the one that matters most: a provider request must carry
 * codes and criteria, never a name, an address, a phone number or a student id.
 * The rest pins the other half of the design — the model scores, the code
 * assigns — so a hallucinated code or an over-confident score cannot produce a
 * pairing that breaks a rule.
 */
import { describe, it, expect } from "vitest";
import {
  anonymizeMentee,
  anonymizeMentor,
  assignPairs,
  buildAnonymousPool,
  buildMatchPrompt,
  chunk,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  evaluateAiMatchingGate,
  MAX_FREE_TEXT_LENGTH,
  parseMatchResponse,
  PROMPT_VERSION,
  redactFreeText,
  shortlistMentors,
  shouldContinue,
  summarizeRun,
  validateAssignment,
  type MenteeSource,
  type MentorSource
} from "@/lib/ai-matching-core";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MENTEE: MenteeSource = {
  applicationId: "app-1",
  fullName: "Nguyễn Thị Bích Ngọc",
  rawPayload: {
    // Identifying — none of this may ever leave.
    full_name: "Nguyễn Thị Bích Ngọc",
    email_primary: "bichngoc@example.com",
    phone_primary: "0912345678",
    mssv: "31221024567",
    university: "Đại học Kinh tế TP.HCM",
    school_or_faculty: "Khoa Tài chính",
    class_cohort: "K47",
    social_contact: "fb.com/bichngoc",
    year_of_birth: "2004",
    additional_notes: "Liên hệ em qua zalo 0912345678 nhé",
    // Matching criteria — these are the point.
    target_industry: "Tài chính - Ngân hàng",
    target_function: "Phân tích đầu tư",
    target_soft_skills: ["Giao tiếp", "Thuyết trình"],
    major: "Tài chính",
    year_of_study: "Năm 3",
    mentoring_goals_text:
      "Em là Ngọc, em muốn hiểu về nghề phân tích đầu tư và chuẩn bị cho kỳ thực tập. Mail em là bichngoc@example.com.",
    one_year_vision_text: "Thực tập tại một quỹ đầu tư",
    meeting_format_preference: "Trực tuyến"
  }
};

const MENTORS: MentorSource[] = [
  {
    personId: "person-fin",
    fullName: "Trần Văn Hùng",
    industry: "Tài chính - Ngân hàng",
    functionArea: "Phân tích đầu tư",
    yearsExperienceMin: 8,
    freeSlots: 2
  },
  {
    personId: "person-mkt",
    fullName: "Lê Thị Mai",
    industry: "Marketing",
    functionArea: "Thương hiệu",
    yearsExperienceMin: 5,
    freeSlots: 1
  },
  {
    personId: "person-full",
    fullName: "Phạm Văn Nam",
    industry: "Tài chính - Ngân hàng",
    functionArea: "Kiểm toán",
    yearsExperienceMin: 10,
    freeSlots: 0
  }
];

// ── Nothing identifying leaves ───────────────────────────────────────────────

describe("redactFreeText", () => {
  it("removes an email address, a phone number, a link and a handle", () => {
    const text = redactFreeText(
      "Liên hệ em qua bichngoc@example.com hoặc 0912345678, fb https://fb.com/ngoc, ig @bichngoc",
      {}
    );
    expect(text).not.toContain("bichngoc@example.com");
    expect(text).not.toContain("0912345678");
    expect(text).not.toContain("fb.com");
    expect(text).not.toContain("@bichngoc");
  });

  it("removes the applicant's own name, with or without diacritics", () => {
    const text = redactFreeText("Em là Ngọc, bạn bè gọi em là NGOC.", {
      names: ["Nguyễn Thị Bích Ngọc"]
    });
    expect(text.toLowerCase()).not.toContain("ngọc");
    expect(text.toLowerCase()).not.toContain("ngoc");
  });

  it("still removes a name that is followed by punctuation", () => {
    const text = redactFreeText("Chào anh, em là Ngọc.", { names: ["Ngọc"] });
    expect(text).not.toContain("Ngọc");
    expect(text).toContain("Chào anh");
  });

  it("keeps the substance of the answer", () => {
    const text = redactFreeText("Em muốn tìm hiểu nghề phân tích đầu tư", { names: ["Ngọc"] });
    expect(text).toContain("phân tích đầu tư");
  });

  it("bounds the length", () => {
    const text = redactFreeText("a".repeat(1000), {});
    expect(text.length).toBeLessThanOrEqual(MAX_FREE_TEXT_LENGTH);
  });

  it("is empty for a missing answer", () => {
    expect(redactFreeText(null, {})).toBe("");
    expect(redactFreeText(undefined, {})).toBe("");
  });
});

describe("anonymizeMentee", () => {
  const anonymous = anonymizeMentee(MENTEE, 0);
  const serialised = JSON.stringify(anonymous);

  it("gives a code, not an identity", () => {
    expect(anonymous.code).toBe("E001");
    expect(anonymous.applicationId).toBe("app-1");
  });

  it("carries none of the identifying answers", () => {
    for (const secret of [
      "Nguyễn Thị Bích Ngọc",
      "bichngoc@example.com",
      "0912345678",
      "31221024567",
      "Đại học Kinh tế",
      "Khoa Tài chính",
      "K47",
      "fb.com",
      "2004"
    ]) {
      expect(serialised, secret).not.toContain(secret);
    }
  });

  it("drops fields that are not on the allow-list, however useful they look", () => {
    // additional_notes is free text with no matching purpose — and in this
    // fixture it holds a phone number.
    expect(serialised).not.toContain("zalo");
    expect(Object.keys(anonymous.attributes)).not.toContain("additional_notes");
    expect(Object.keys(anonymous.attributes)).not.toContain("email_primary");
  });

  it("keeps the criteria a match is actually made on", () => {
    expect(anonymous.attributes.nganh_muc_tieu).toContain("Tài chính");
    expect(anonymous.attributes.linh_vuc_muc_tieu).toContain("Phân tích đầu tư");
    expect(anonymous.attributes.ky_nang_muon_phat_trien).toContain("Giao tiếp");
    expect(String(anonymous.attributes.muc_tieu)).toContain("phân tích đầu tư");
  });

  it("redacts the free text it does keep", () => {
    expect(String(anonymous.attributes.muc_tieu)).not.toContain("bichngoc@example.com");
    expect(String(anonymous.attributes.muc_tieu).toLowerCase()).not.toContain("ngọc");
  });
});

describe("anonymizeMentor", () => {
  it("describes the mentor by field, not by employer", () => {
    const anonymous = anonymizeMentor(
      { ...MENTORS[0], fullName: "Trần Văn Hùng" },
      0
    );
    const serialised = JSON.stringify(anonymous);
    expect(anonymous.code).toBe("M001");
    expect(anonymous.attributes.nganh).toContain("Tài chính");
    expect(anonymous.attributes.so_nam_kinh_nghiem).toBe(8);
    expect(serialised).not.toContain("Trần Văn Hùng");
  });

  it("never reports negative capacity", () => {
    const anonymous = anonymizeMentor({ ...MENTORS[0], freeSlots: -2 }, 0);
    expect(anonymous.capacity).toBe(0);
  });
});

describe("buildAnonymousPool", () => {
  const pool = buildAnonymousPool([MENTEE], MENTORS);

  it("leaves out mentors with no room", () => {
    expect(pool.mentors.map((mentor) => mentor.personId)).not.toContain("person-full");
    expect(pool.mentors).toHaveLength(2);
  });

  it("can map a code back to a person on our side only", () => {
    expect(pool.mentorByCode.get("M001")?.personId).toBe("person-fin");
    expect(pool.menteeByCode.get("E001")?.applicationId).toBe("app-1");
  });
});

describe("buildMatchPrompt", () => {
  const pool = buildAnonymousPool([MENTEE], MENTORS);
  const prompt = buildMatchPrompt({
    round: 1,
    batch: [{ mentee: pool.mentees[0], mentors: pool.mentors }]
  });

  it("is valid JSON the provider can parse", () => {
    expect(() => JSON.parse(prompt)).not.toThrow();
  });

  it("contains the codes and the criteria", () => {
    expect(prompt).toContain("E001");
    expect(prompt).toContain("M001");
    expect(prompt).toContain("Phân tích đầu tư");
  });

  it("contains nothing that identifies anybody", () => {
    for (const secret of [
      "Nguyễn Thị Bích Ngọc",
      "Trần Văn Hùng",
      "bichngoc@example.com",
      "0912345678",
      "31221024567",
      "app-1",
      "person-fin"
    ]) {
      expect(prompt, secret).not.toContain(secret);
    }
  });
});

// ── The shortlist ────────────────────────────────────────────────────────────

describe("shortlistMentors", () => {
  const pool = buildAnonymousPool([MENTEE], MENTORS);

  it("puts the mentor from the same field first", () => {
    const shortlist = shortlistMentors(pool.mentees[0], pool.mentors, 2);
    expect(shortlist[0].personId).toBe("person-fin");
  });

  it("respects the limit", () => {
    const shortlist = shortlistMentors(pool.mentees[0], pool.mentors, 1);
    expect(shortlist).toHaveLength(1);
  });

  it("is deterministic when nothing matches", () => {
    const empty = buildAnonymousPool(
      [{ applicationId: "app-x", fullName: null, rawPayload: {} }],
      MENTORS
    );
    const first = shortlistMentors(empty.mentees[0], empty.mentors, 5).map((row) => row.code);
    const second = shortlistMentors(empty.mentees[0], empty.mentors, 5).map((row) => row.code);
    expect(first).toEqual(second);
  });
});

describe("chunk", () => {
  it("splits a list into batches of the requested size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("never produces an infinite loop on a zero size", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

// ── Reading the answer ───────────────────────────────────────────────────────

const KNOWN = {
  menteeCodes: new Set(["E001", "E002"]),
  mentorCodes: new Set(["M001", "M002"])
};

describe("parseMatchResponse", () => {
  it("reads a plain JSON answer", () => {
    const result = parseMatchResponse(
      JSON.stringify({ pairs: [{ mentee: "E001", mentor: "M001", score: 0.9, reason: "cùng ngành" }] }),
      KNOWN
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ menteeCode: "E001", mentorCode: "M001", score: 0.9 });
    expect(result.pairs[0].rationale).toBe("cùng ngành");
  });

  it("reads an answer the model wrapped in a code fence", () => {
    const result = parseMatchResponse(
      'Đây là kết quả:\n```json\n{"pairs":[{"mentee":"E001","mentor":"M002","score":0.5}]}\n```',
      KNOWN
    );
    expect(result.pairs).toHaveLength(1);
  });

  it("drops a pair whose code was invented, and says so", () => {
    const result = parseMatchResponse(
      JSON.stringify({ pairs: [{ mentee: "E999", mentor: "M001", score: 1 }] }),
      KNOWN
    );
    expect(result.pairs).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("E999");
  });

  it("clamps a score outside 0..1 and drops one that is not a number", () => {
    const result = parseMatchResponse(
      JSON.stringify({
        pairs: [
          { mentee: "E001", mentor: "M001", score: 7 },
          { mentee: "E002", mentor: "M002", score: "rất phù hợp" }
        ]
      }),
      KNOWN
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].score).toBe(1);
    expect(result.warnings.join(" ")).toContain("E002");
  });

  it("keeps only the first of a repeated pair", () => {
    const result = parseMatchResponse(
      JSON.stringify({
        pairs: [
          { mentee: "E001", mentor: "M001", score: 0.9 },
          { mentee: "E001", mentor: "M001", score: 0.1 }
        ]
      }),
      KNOWN
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].score).toBe(0.9);
  });

  it("returns a warning rather than throwing on nonsense", () => {
    expect(parseMatchResponse("xin lỗi, tôi không thể", KNOWN).warnings).toHaveLength(1);
    expect(parseMatchResponse(JSON.stringify({ ket_qua: [] }), KNOWN).warnings).toHaveLength(1);
  });
});

// ── The code assigns ─────────────────────────────────────────────────────────

const PAIRS = [
  { menteeCode: "E001", mentorCode: "M001", score: 0.9, rationale: "" },
  { menteeCode: "E002", mentorCode: "M001", score: 0.8, rationale: "" },
  { menteeCode: "E002", mentorCode: "M002", score: 0.4, rationale: "" }
];

describe("assignPairs", () => {
  it("gives each mentee at most one mentor, best score first", () => {
    const result = assignPairs({
      pairs: PAIRS,
      capacity: new Map([
        ["M001", 1],
        ["M002", 1]
      ]),
      menteeCodes: ["E001", "E002"]
    });

    expect(result.assigned).toHaveLength(2);
    expect(result.assigned[0]).toMatchObject({ menteeCode: "E001", mentorCode: "M001" });
    // M001 is full, so E002 falls to its second choice.
    expect(result.assigned[1]).toMatchObject({ menteeCode: "E002", mentorCode: "M002" });
    expect(result.unassignedMentees).toEqual([]);
  });

  it("never puts more mentees on a mentor than they have places", () => {
    const result = assignPairs({
      pairs: PAIRS,
      capacity: new Map([["M001", 1]]),
      menteeCodes: ["E001", "E002"]
    });
    expect(result.assigned).toHaveLength(1);
    expect(result.unassignedMentees).toEqual(["E002"]);
    expect(result.remainingCapacity.get("M001")).toBe(0);
  });

  it("leaves everybody unassigned when nobody has a place", () => {
    const result = assignPairs({
      pairs: PAIRS,
      capacity: new Map([["M001", 0]]),
      menteeCodes: ["E001", "E002"]
    });
    expect(result.assigned).toEqual([]);
    expect(result.unassignedMentees).toEqual(["E001", "E002"]);
  });

  it("can ignore weak matches, leaving a mentee unpaired rather than badly paired", () => {
    const capacity = () =>
      new Map([
        ["M001", 1],
        ["M002", 1]
      ]);

    // Without a floor, E002 falls back to its weak second choice.
    const lenient = assignPairs({ pairs: PAIRS, capacity: capacity(), menteeCodes: ["E001", "E002"] });
    expect(lenient.assigned.map((pair) => pair.mentorCode)).toEqual(["M001", "M002"]);

    // With one, that 0.4 pair is not offered at all and E002 waits.
    const strict = assignPairs({
      pairs: PAIRS,
      capacity: capacity(),
      menteeCodes: ["E001", "E002"],
      minScore: 0.5
    });
    expect(strict.assigned.map((pair) => pair.menteeCode)).toEqual(["E001"]);
    expect(strict.unassignedMentees).toEqual(["E002"]);
  });

  it("produces the same pairing twice for the same scores", () => {
    const tied = [
      { menteeCode: "E002", mentorCode: "M002", score: 0.7, rationale: "" },
      { menteeCode: "E001", mentorCode: "M002", score: 0.7, rationale: "" }
    ];
    const run = () =>
      assignPairs({
        pairs: [...tied].reverse(),
        capacity: new Map([["M002", 1]]),
        menteeCodes: ["E001", "E002"]
      }).assigned;
    expect(run()).toEqual(run());
    expect(run()[0].menteeCode).toBe("E001");
  });

  it("stamps the round on what it assigned", () => {
    const result = assignPairs({
      pairs: PAIRS,
      capacity: new Map([["M001", 2]]),
      menteeCodes: ["E001", "E002"],
      round: 2
    });
    expect(result.assigned.every((pair) => pair.round === 2)).toBe(true);
  });
});

describe("shouldContinue", () => {
  it("stops at the round limit", () => {
    expect(
      shouldContinue({ round: 3, unassignedCount: 5, remainingCapacity: new Map([["M001", 2]]) })
    ).toBe(false);
  });

  it("stops when everybody has a mentor", () => {
    expect(
      shouldContinue({ round: 1, unassignedCount: 0, remainingCapacity: new Map([["M001", 2]]) })
    ).toBe(false);
  });

  it("stops when no place is left", () => {
    expect(
      shouldContinue({ round: 1, unassignedCount: 3, remainingCapacity: new Map([["M001", 0]]) })
    ).toBe(false);
  });

  it("continues while there is work and room", () => {
    expect(
      shouldContinue({ round: 1, unassignedCount: 3, remainingCapacity: new Map([["M001", 1]]) })
    ).toBe(true);
  });
});

describe("validateAssignment", () => {
  const menteeCodes = new Set(["E001", "E002"]);

  it("passes a legal pairing", () => {
    const result = validateAssignment({
      assigned: [{ menteeCode: "E001", mentorCode: "M001", score: 1, rationale: "", round: 1 }],
      capacity: new Map([["M001", 1]]),
      menteeCodes
    });
    expect(result.ok).toBe(true);
  });

  it("catches a mentor over their capacity", () => {
    const result = validateAssignment({
      assigned: [
        { menteeCode: "E001", mentorCode: "M001", score: 1, rationale: "", round: 1 },
        { menteeCode: "E002", mentorCode: "M001", score: 1, rationale: "", round: 1 }
      ],
      capacity: new Map([["M001", 1]]),
      menteeCodes
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("vượt hạn mức");
  });

  it("catches a mentee paired twice and an unknown mentee", () => {
    const result = validateAssignment({
      assigned: [
        { menteeCode: "E001", mentorCode: "M001", score: 1, rationale: "", round: 1 },
        { menteeCode: "E001", mentorCode: "M002", score: 1, rationale: "", round: 1 },
        { menteeCode: "E404", mentorCode: "M002", score: 1, rationale: "", round: 1 }
      ],
      capacity: new Map([
        ["M001", 5],
        ["M002", 5]
      ]),
      menteeCodes
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("nhiều lần");
    expect(result.problems.join(" ")).toContain("E404");
  });
});

// ── Configuration ────────────────────────────────────────────────────────────

describe("evaluateAiMatchingGate", () => {
  it("is off unless it is switched on", () => {
    const result = evaluateAiMatchingGate({ DEEPSEEK_API_KEY: "sk-test" });
    expect(result.canRun).toBe(false);
    if (result.canRun) return;
    expect(result.reason).toContain("VAM_OS_AI_MATCHING_ENABLED");
  });

  it("needs an API key", () => {
    const result = evaluateAiMatchingGate({ VAM_OS_AI_MATCHING_ENABLED: "true" });
    expect(result.canRun).toBe(false);
    if (result.canRun) return;
    expect(result.reason).toContain("DEEPSEEK_API_KEY");
  });

  it("refuses a base URL that is not https", () => {
    const result = evaluateAiMatchingGate({
      VAM_OS_AI_MATCHING_ENABLED: "true",
      DEEPSEEK_API_KEY: "sk-test",
      DEEPSEEK_BASE_URL: "http://api.deepseek.com"
    });
    expect(result.canRun).toBe(false);
  });

  it("falls back to the documented model and host", () => {
    const result = evaluateAiMatchingGate({
      VAM_OS_AI_MATCHING_ENABLED: "true",
      DEEPSEEK_API_KEY: "sk-test"
    });
    expect(result.canRun).toBe(true);
    if (!result.canRun) return;
    expect(result.model).toBe(DEFAULT_MODEL);
    expect(result.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("unlike email, is not restricted to production — staging is where it is tried", () => {
    const result = evaluateAiMatchingGate({
      VAM_OS_AI_MATCHING_ENABLED: "true",
      DEEPSEEK_API_KEY: "sk-test"
    });
    expect(result.canRun).toBe(true);
  });
});

describe("summarizeRun", () => {
  it("says plainly that nothing was created yet", () => {
    const message = summarizeRun({ menteeCount: 10, pairCount: 7, rounds: 2, warnings: [] });
    expect(message).toContain("7/10");
    expect(message).toContain("Chưa có cặp nào được tạo");
  });

  it("reports the mentees left over and the warnings", () => {
    const message = summarizeRun({ menteeCount: 10, pairCount: 7, rounds: 3, warnings: ["a", "b"] });
    expect(message).toContain("3 mentee chưa có đề xuất");
    expect(message).toContain("2 cảnh báo");
  });
});

describe("PROMPT_VERSION", () => {
  it("is stamped on every run so a proposal can be traced to what produced it", () => {
    expect(PROMPT_VERSION).toMatch(/^vam-match-/);
  });
});
