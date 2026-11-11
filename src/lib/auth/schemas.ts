import { z } from "zod";
import { AssessmentInputSchema } from "../agent/schemas";

const text = (max: number) => z.string().trim().min(1).max(max);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const RegistrationSchema = z.object({
  email,
  password: z.string().min(8, "Use at least 8 characters for your password.").max(128),
  full_name: text(120),
  phone: z.string().trim().max(40).default(""),
  location: text(120),
  path: z.enum(["idea", "exploring"]),
  assessment: AssessmentInputSchema,
  details: z.object({
    businessType: z.string().trim().max(100).optional(),
    audience: z.string().trim().max(1000).optional(),
    currentState: z.string().trim().max(1000).optional(),
    vision: z.string().trim().max(1000).optional(),
    timeframe: z.string().trim().max(100).optional(),
    mode: z.string().trim().max(100).optional(),
    interests: z.string().trim().max(100).optional(),
    strengths: z.string().trim().max(1000).optional(),
    motivation: z.string().trim().max(1000).optional(),
  }).default({}),
}).strict().superRefine((value, ctx) => {
  if (!value.assessment.languages.includes(value.assessment.preferred_language)) {
    ctx.addIssue({ code: "custom", path: ["assessment", "languages"], message: "Include your preferred language among your spoken languages." });
  }
  if (value.path === "exploring" && value.assessment.business_stage !== "idea") {
    ctx.addIssue({ code: "custom", path: ["assessment", "business_stage"], message: "Exploring registrations must start at idea stage." });
  }
  if (value.path === "idea" && !value.assessment.business_name.trim()) {
    ctx.addIssue({ code: "custom", path: ["assessment", "business_name"], message: "Enter your business or product name." });
  }
});
export type RegistrationInput = z.infer<typeof RegistrationSchema>;
export const SignInSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  remember: z.boolean().default(false),
}).strict();
export const ResendSchema = SignInSchema.pick({ email: true });
