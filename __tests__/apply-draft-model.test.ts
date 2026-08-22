import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  APPLY_DRAFT_TTL_MS,
  APPLY_DRAFT_VERSION,
  APPLY_DRAFT_MAX_CHARS,
  createDraft,
  parseDraft,
  writeStoredDraft,
  getDraftStorage,
  consentFieldNames
} from "../lib/apply-draft";
import { SEASON_CONFIG } from "../lib/season-config";
import { APPLY_TOKEN_FIELD } from "../lib/apply-types";

describe("Apply Draft Model (R1A)", () => {
  it("excludes token, hidden fields, and React action references", () => {
    const draft = createDraft([
      ["full_name", "Test Name"],
      [APPLY_TOKEN_FIELD, "secret-token"],
      ["__foo", "hidden"],
      ["$ACTION_ID_abc", "action-id"]
    ] as [string, string][], "mentee");
    expect(draft?.fields).toHaveProperty("full_name");
    expect(draft?.fields).not.toHaveProperty(APPLY_TOKEN_FIELD);
    expect(draft?.fields).not.toHaveProperty("__foo");
    expect(draft?.fields).not.toHaveProperty("$ACTION_ID_abc");
  });

  it("redacts token passed via redactValues even under benign keys", () => {
    const draft = createDraft([
      ["full_name", "Test Name"],
      ["additional_notes", "secret-token"]
    ] as [string, string][], "mentee", ["secret-token"]);
    expect(draft?.fields).toHaveProperty("full_name");
    expect(draft?.fields).not.toHaveProperty("additional_notes");
    expect(JSON.stringify(draft)).not.toContain("secret-token");
  });

  it("excludes consent fields and strips them in parseDraft", () => {
    const consents = Array.from(consentFieldNames("mentee"));
    const entries: [string, string][] = [
      ["full_name", "Test"],
      ...consents.map(c => [c, "yes"] as [string, string])
    ];
    const draft = createDraft(entries, "mentee");
    for (const c of consents) {
      expect(draft?.fields).not.toHaveProperty(c);
    }

    const payload = JSON.stringify({
      v: APPLY_DRAFT_VERSION,
      role: "mentee",
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: {
        full_name: ["Test"],
        [consents[0]]: ["yes"]
      }
    });
    const parsed = parseDraft(payload, "mentee");
    expect(parsed?.fields).not.toHaveProperty(consents[0]);
  });

  it("parseDraft rejects invalid payloads", () => {
    const now = Date.now();
    const valid = {
      v: APPLY_DRAFT_VERSION,
      role: "mentee",
      season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
      savedAt: new Date().toISOString(),
      fields: { full_name: ["Test"] }
    };

    expect(parseDraft("{ bad json", "mentee")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...valid, v: 0 }), "mentee")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...valid, role: "mentor" }), "mentee")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...valid, season: "OLD-SEASON" }), "mentee")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...valid, savedAt: new Date(now - APPLY_DRAFT_TTL_MS - 1000).toISOString() }), "mentee", now)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...valid, fields: { [Array.from(consentFieldNames("mentee"))[0]]: ["yes"] } }), "mentee")).toBeNull();
  });

  describe("storage bounds", () => {
    let mockStorage: Storage;

    beforeEach(() => {
      let store: Record<string, string> = {};
      mockStorage = {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        clear: vi.fn(() => { store = {}; }),
        key: vi.fn(),
        length: 0
      };
      vi.stubGlobal("window", { localStorage: mockStorage });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("writeStoredDraft returns false for payloads over max chars", () => {
      const hugeString = "a".repeat(APPLY_DRAFT_MAX_CHARS);
      const draft = createDraft([["full_name", hugeString]] as [string, string][], "mentee");
      expect(draft).not.toBeNull();
      const success = writeStoredDraft(draft!, mockStorage);
      expect(success).toBe(false);
      expect(mockStorage.setItem).not.toHaveBeenCalled();
    });

    it("getDraftStorage returns null when localStorage throws", () => {
      vi.stubGlobal("window", {
        get localStorage() {
          throw new Error("Access Denied");
        }
      });
      expect(getDraftStorage()).toBeNull();
    });
  });
});
