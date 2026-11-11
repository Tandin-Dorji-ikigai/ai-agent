import { assessmentFromForm } from "../mentorflow-assessment";
import { RegistrationSchema } from "./schemas";

export function registrationDefaults() {
  return {
    fullName: "", email: "", password: "", confirmPassword: "", phone: "", district: "", language: "English",
    productName: "", industry: "", businessType: "Still exploring", description: "", audience: "",
    stage: "Idea", currentState: "", vision: "", goal: "", challenge: "", timeframe: "Flexible",
    mode: "Online or in-person", languagePreference: "Either", budget: "0", interests: "", strengths: "", motivation: "",
  };
}

export function registrationFromForm(values: Record<string, string>, support: string[], exploring: boolean) {
  if (values.password !== values.confirmPassword) throw new Error("Your passwords do not match.");
  const parsed = RegistrationSchema.safeParse({
    full_name: values.fullName, email: values.email?.trim(), password: values.password,
    phone: values.phone, location: values.district, path: exploring ? "exploring" : "idea",
    assessment: assessmentFromForm(values, support, exploring),
    details: Object.fromEntries(["businessType", "audience", "currentState", "vision", "timeframe", "mode", "interests", "strengths", "motivation"].map(key => [key, values[key] ?? ""])),
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join(" ").replaceAll("_", " ")}: ${issue.message}`).join(". "));
  return parsed.data;
}
