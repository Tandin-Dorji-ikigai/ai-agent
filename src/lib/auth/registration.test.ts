import { describe, expect, it } from "vitest";
import { RegistrationSchema, SignInSchema } from "./schemas";
import { registrationDefaults, registrationFromForm } from "./registration-form";

const form = {
  ...registrationDefaults(), fullName: "Thinley Wangchen", email: "person@example.com",
  password: "a-long-test-password", confirmPassword: "a-long-test-password", district: "Thimphu",
  productName: "Local project", industry: "Tourism & Hospitality", description: "A local walking tour.",
  challenge: "Finding customers", goal: "Speak to five customers", interests: "Agriculture & Food",
  strengths: "Growing vegetables", motivation: "Build a local business", budget: "500",
};

describe("entrepreneur registration validation", () => {
  it("starts empty instead of copying Pema's identity or business", () => {
    const defaults = registrationDefaults();
    expect(defaults.fullName).toBe(""); expect(defaults.email).toBe(""); expect(defaults.productName).toBe("");
  });
  it("saves the idea path, business answers and supplementary preferences", () => {
    const input = registrationFromForm(form, ["customer_validation"], false);
    expect(input.path).toBe("idea");
    expect(input.assessment.business_name).toBe("Local project");
    expect(input.details.mode).toBe("Online or in-person");
    expect(input).not.toHaveProperty("confirmPassword");
  });
  it("registers a mentee who is still exploring without requiring a business name", () => {
    const input = registrationFromForm({ ...form, productName: "", industry: "", description: "" }, ["customer_validation"], true);
    expect(input.path).toBe("exploring"); expect(input.assessment.business_stage).toBe("idea");
    expect(input.assessment.sector).toBe("agriculture");
    expect(input.assessment.business_name).toBe("");
    expect(input.assessment.business_description).toContain("Growing vegetables");
  });
  it("rejects mismatched passwords and missing support needs", () => {
    expect(() => registrationFromForm({ ...form, confirmPassword: "different" }, ["pricing"], false)).toThrow("do not match");
    expect(() => registrationFromForm(form, [], false)).toThrow("one and five");
  });
  it("normalizes email but leaves password bytes unchanged", () => {
    expect(SignInSchema.parse({ email: " Person@Example.com ", password: " Password " })).toMatchObject({ email: "person@example.com", password: " Password " });
  });
  it("rejects privilege and ownership injection, weak passwords and invalid path/stage combinations", () => {
    const input = registrationFromForm(form, ["pricing"], false);
    expect(RegistrationSchema.safeParse({ ...input, role: "mentor" }).success).toBe(false);
    expect(RegistrationSchema.safeParse({ ...input, user_id: crypto.randomUUID() }).success).toBe(false);
    expect(RegistrationSchema.safeParse({ ...input, password: "short" }).success).toBe(false);
    expect(RegistrationSchema.safeParse({ ...input, path: "exploring", assessment: { ...input.assessment, business_stage: "growth" } }).success).toBe(false);
  });
});
