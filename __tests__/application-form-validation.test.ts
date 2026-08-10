import { describe, expect, it } from "vitest";
import { validateMaxThreeWithOther } from "../lib/application-form-validation";

const validate = (values: string[], otherText = "") => validateMaxThreeWithOther({
  values,
  otherText,
  fieldName: "target_soft_skills",
  fieldLabel: "Soft skills bạn muốn phát triển"
});

describe("application max-three and Other server contract", () => {
  it("accepts three choices and rejects a crafted fourth choice without truncating", () => {
    expect(validate(["communication", "leadership", "negotiation"]).ok).toBe(true);
    expect(validate(["communication", "leadership", "negotiation", "public_speaking"])).toMatchObject({ ok: false });
  });

  it("requires meaningful Other text and accepts a persisted value", () => {
    expect(validate(["other"], "").ok).toBe(false);
    expect(validate(["other"], "   ").ok).toBe(false);
    expect(validate(["other"], "Quản trị xung đột")).toEqual({ ok: true });
  });

  it("does not require Other text after Other is deselected", () => {
    expect(validate(["communication"], "").ok).toBe(true);
  });
});
