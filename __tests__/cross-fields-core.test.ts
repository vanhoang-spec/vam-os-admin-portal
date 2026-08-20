/**
 * The one list of fields.
 *
 * Until this module existed the list lived in two TSX files that had already
 * drifted apart. These tests are mostly about that: the codes are permanent,
 * the two vocabularies are separate even where they share a code, and an
 * application's stored answers turn back into fields without losing any.
 */
import { describe, it, expect } from "vitest";

import {
  allFields,
  fieldKindLabel,
  fieldLabel,
  fieldsFor,
  fieldsFromApplication,
  FUNCTION_FIELDS,
  INDUSTRY_FIELDS,
  isKnownField,
  isRequestableField,
  normalizeFields,
  requestableFields,
  splitCombinedFields
} from "@/lib/cross-fields-core";

describe("the vocabularies", () => {
  it("carries the twelve requestable industries and twelve requestable functions", () => {
    expect(requestableFields("industry")).toHaveLength(12);
    expect(requestableFields("function")).toHaveLength(12);
  });

  it("keeps the codes the application forms already store", () => {
    // Changing any of these orphans rows already in applications.raw_payload.
    for (const code of [
      "fmcg",
      "tech",
      "finance_banking",
      "consulting",
      "manufacturing",
      "education",
      "healthcare",
      "media_creative",
      "logistics",
      "real_estate",
      "energy_environment",
      "public_nonprofit"
    ]) {
      expect(isKnownField("industry", code), code).toBe(true);
    }

    for (const code of [
      "marketing",
      "sales_bd",
      "finance_accounting",
      "hr_people",
      "operations",
      "tech_engineering",
      "data_analytics",
      "product",
      "strategy_consulting",
      "supply_chain",
      "legal_compliance",
      "general_management"
    ]) {
      expect(isKnownField("function", code), code).toBe(true);
    }
  });

  it("has no duplicate code inside either list", () => {
    for (const list of [INDUSTRY_FIELDS, FUNCTION_FIELDS]) {
      const codes = list.map((field) => field.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("gives every field a Vietnamese label", () => {
    for (const field of allFields()) {
      expect(field.label.trim().length, field.code).toBeGreaterThan(0);
    }
  });

  it("keeps industry and function apart even where a code appears in both", () => {
    // `other` and `undecided` are in both lists; `finance_banking` and
    // `finance_accounting` are different things with similar names.
    expect(isKnownField("industry", "finance_banking")).toBe(true);
    expect(isKnownField("function", "finance_banking")).toBe(false);
    expect(isKnownField("function", "finance_accounting")).toBe(true);
    expect(isKnownField("industry", "finance_accounting")).toBe(false);

    expect(fieldLabel("industry", "other")).toBe("Khác");
    expect(fieldLabel("function", "other")).toBe("Khác");
  });

  it("refuses an unknown vocabulary outright", () => {
    for (const kind of ["", "nganh", null, undefined, "Industry"]) {
      expect(isKnownField(kind, "tech"), String(kind)).toBe(false);
    }
  });
});

describe("what may be requested", () => {
  it("never lets a session be requested about 'undecided'", () => {
    // A valid answer on an application; there is no group of mentors who
    // mastered not knowing.
    expect(isKnownField("industry", "undecided")).toBe(true);
    expect(isRequestableField("industry", "undecided")).toBe(false);
    expect(isRequestableField("function", "undecided")).toBe(false);
  });

  it("never lets a session be requested about 'other'", () => {
    expect(isKnownField("function", "other")).toBe(true);
    expect(isRequestableField("function", "other")).toBe(false);
  });

  it("keeps both out of the picker", () => {
    for (const kind of ["industry", "function"] as const) {
      const codes = requestableFields(kind).map((field) => field.code);
      expect(codes, kind).not.toContain("undecided");
      expect(codes, kind).not.toContain("other");
    }
  });
});

describe("fieldLabel", () => {
  it("translates a stored code", () => {
    expect(fieldLabel("industry", "finance_banking")).toBe("Tài chính / Ngân hàng");
    expect(fieldLabel("function", "hr_people")).toBe("Nhân sự / People");
  });

  it("shows an unrecognised value as itself, so a data problem looks like one", () => {
    expect(fieldLabel("industry", "khong_co_that")).toBe("khong_co_that");
    expect(fieldLabel("rac", "tech")).toBe("tech");
  });

  it("returns nothing for nothing, rather than a placeholder", () => {
    expect(fieldLabel("industry", "")).toBe("");
    expect(fieldLabel("industry", null)).toBe("");
  });

  it("names which list a field came from", () => {
    expect(fieldKindLabel("industry")).toBe("Ngành nghề");
    expect(fieldKindLabel("function")).toBe("Chức năng");
  });
});

describe("normalizeFields", () => {
  it("keeps only codes that belong to that vocabulary", () => {
    expect(normalizeFields("industry", ["tech", "marketing", "khong_co_that"])).toEqual(["tech"]);
  });

  it("returns them in declaration order, so the same ticks give the same rows", () => {
    expect(normalizeFields("industry", ["education", "tech", "fmcg"])).toEqual([
      "fmcg",
      "tech",
      "education"
    ]);
  });

  it("drops duplicates and blanks", () => {
    expect(normalizeFields("function", ["product", "product", "", "  "])).toEqual(["product"]);
  });

  it("survives a single value or nothing at all", () => {
    expect(normalizeFields("industry", "tech")).toEqual(["tech"]);
    expect(normalizeFields("industry", null)).toEqual([]);
    expect(normalizeFields("industry", [])).toEqual([]);
  });

  it("allows the non-requestable codes through, since a mentor may still tick them", () => {
    // Only requesting is restricted; a mentor saying "other" is their answer.
    expect(normalizeFields("industry", ["other"])).toEqual(["other"]);
  });
});

describe("splitCombinedFields — the mentor form's one flat list of 26", () => {
  it("sends each code to the vocabulary it belongs to", () => {
    expect(splitCombinedFields(["tech", "marketing", "logistics", "data_analytics"])).toEqual({
      industries: ["tech", "logistics"],
      functions: ["marketing", "data_analytics"]
    });
  });

  it("drops 'other' rather than putting it in both lists", () => {
    // It appears twice in the combined checkbox list with the same value.
    expect(splitCombinedFields(["other"])).toEqual({ industries: [], functions: [] });
  });

  it("drops 'undecided' the same way", () => {
    expect(splitCombinedFields(["undecided", "tech"])).toEqual({
      industries: ["tech"],
      functions: []
    });
  });

  it("survives an empty or missing answer", () => {
    expect(splitCombinedFields(null)).toEqual({ industries: [], functions: [] });
    expect(splitCombinedFields([])).toEqual({ industries: [], functions: [] });
  });
});

describe("fieldsFromApplication — filling in for a mentor who never opens the form", () => {
  it("combines the two primary answers with the secondary list", () => {
    expect(
      fieldsFromApplication({
        industry_primary: "finance_banking",
        function_primary: "finance_accounting",
        secondary_industries_functions: ["tech", "data_analytics"]
      })
    ).toEqual({
      industries: ["tech", "finance_banking"],
      functions: ["finance_accounting", "data_analytics"]
    });
  });

  it("does not double-count a primary that is also ticked as secondary", () => {
    expect(
      fieldsFromApplication({
        industry_primary: "tech",
        secondary_industries_functions: ["tech"]
      })
    ).toEqual({ industries: ["tech"], functions: [] });
  });

  it("ignores a primary answer of 'other' or 'undecided'", () => {
    expect(
      fieldsFromApplication({ industry_primary: "other", function_primary: "undecided" })
    ).toEqual({ industries: [], functions: [] });
  });

  it("returns nothing for an application that answered nothing", () => {
    expect(fieldsFromApplication({})).toEqual({ industries: [], functions: [] });
  });

  it("ignores a primary answer that is not a real code", () => {
    expect(fieldsFromApplication({ industry_primary: "ngan_hang" })).toEqual({
      industries: [],
      functions: []
    });
  });
});

describe("fieldsFor and allFields", () => {
  it("returns the right list for each vocabulary", () => {
    expect(fieldsFor("industry")).toBe(INDUSTRY_FIELDS);
    expect(fieldsFor("function")).toBe(FUNCTION_FIELDS);
  });

  it("flattens both with their kind attached", () => {
    const flat = allFields();
    expect(flat).toHaveLength(INDUSTRY_FIELDS.length + FUNCTION_FIELDS.length);
    expect(flat.filter((field) => field.kind === "industry")).toHaveLength(INDUSTRY_FIELDS.length);
    expect(flat.find((field) => field.code === "marketing")?.kind).toBe("function");
  });
});
