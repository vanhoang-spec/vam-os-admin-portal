import { describe, it, expect } from "vitest";
import { normalizeMeetingType } from "../lib/normalizers";

describe("normalizeMeetingType", () => {
  it("passes canonical types unchanged", () => {
    expect(normalizeMeetingType("1on1_primary")).toBe("1on1_primary");
    expect(normalizeMeetingType("1on1_cross")).toBe("1on1_cross");
    expect(normalizeMeetingType("group")).toBe("group");
    expect(normalizeMeetingType("online")).toBe("online");
    expect(normalizeMeetingType("offline")).toBe("offline");
    expect(normalizeMeetingType("unknown")).toBe("unknown");
  });

  it("normalizes legacy aliases", () => {
    expect(normalizeMeetingType("group_training")).toBe("group");
    expect(normalizeMeetingType("other")).toBe("unknown");
  });

  it("defaults blank to 1on1_primary", () => {
    expect(normalizeMeetingType("")).toBe("1on1_primary");
    expect(normalizeMeetingType("   ")).toBe("1on1_primary");
    expect(normalizeMeetingType(null)).toBe("1on1_primary");
    expect(normalizeMeetingType(undefined)).toBe("1on1_primary");
  });

  it("rejects unknown non-empty values", () => {
    expect(() => normalizeMeetingType("random_type")).toThrow('Invalid meeting type: "random_type"');
    expect(() => normalizeMeetingType("group_online")).toThrow('Invalid meeting type: "group_online"');
  });
});
