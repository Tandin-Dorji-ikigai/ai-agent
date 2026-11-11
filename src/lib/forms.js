export const industries = ["Tourism & Hospitality", "Agriculture & Food", "Technology & AI", "Finance & Fintech", "Retail", "Handicrafts", "Not decided yet"];
export const stages = ["Idea", "Validation", "Prototype", "MVP / Pilot", "Launched", "Growth", "Established"];
export const districts = ["Bumthang", "Chhukha", "Dagana", "Gasa", "Haa", "Lhuentse", "Mongar", "Paro", "Pema Gatshel", "Punakha", "Samdrup Jongkhar", "Samtse", "Sarpang", "Thimphu", "Trashigang", "Trashiyangtse", "Trongsa", "Tsirang", "Wangdue Phodrang", "Zhemgang"];

// Existing onboarding fields, shared as data rather than new UI components.
export const entrepreneurSteps = [
  { title: "About you", fields: [
    { name: "fullName", label: "Full name", required: true }, { name: "email", label: "Email address", type: "email", required: true },
    { name: "phone", label: "Phone number", type: "tel" }, { name: "district", label: "Dzongkhag", options: districts, required: true },
    { name: "language", label: "Preferred language", options: ["Dzongkha", "English"] },
  ] },
  { title: "Your business", fields: [
    { name: "productName", label: "Product / business name", required: true }, { name: "industry", label: "Industry or field", options: industries, required: true },
    { name: "businessType", label: "What are you creating?", options: ["Product", "Service", "Both", "Still exploring"] },
    { name: "description", label: "Describe your product, service or business idea", type: "textarea", required: true, full: true },
    { name: "audience", label: "Who are your customers or users?", type: "textarea", full: true },
  ] },
  { title: "Current stage", fields: [
    { name: "stage", label: "Current product or business stage", options: stages, required: true },
    { name: "currentState", label: "What have you completed so far?", type: "textarea", full: true },
  ] },
  { title: "Vision & goals", fields: [
    { name: "vision", label: "How should the finished product / service work?", type: "textarea", full: true },
    { name: "goal", label: "What outcome do you want from mentorship?", type: "textarea", required: true, full: true },
    { name: "timeframe", label: "When do you hope to achieve this?", options: ["1 month", "3 months", "6 months", "12 months", "Flexible"] },
    { name: "challenge", label: "What is your biggest challenge?", type: "textarea", required: true, full: true },
  ] },
  { title: "Preferences", fields: [
    { name: "mode", label: "Preferred mentoring format", options: ["Online or in-person", "Online only", "In-person only"] },
    { name: "languagePreference", label: "Mentorship language", options: ["Dzongkha", "English", "Either"] },
    { name: "budget", label: "Approximate session budget (Nu.)", type: "number", required: true },
  ] },
];

export const explorerSteps = [
  entrepreneurSteps[0],
  { title: "Your interests", fields: [
    { name: "interests", label: "What would you like to explore?", options: industries, required: true },
    { name: "strengths", label: "What do you enjoy or feel good at?", type: "textarea", full: true },
    { name: "motivation", label: "What makes you interested in entrepreneurship?", type: "textarea", full: true },
  ] },
  { title: "Your goals", fields: [
    { name: "goal", label: "What would you like a mentor to help you discover?", type: "textarea", required: true, full: true },
    entrepreneurSteps[3].fields[2],
    { name: "challenge", label: "What feels uncertain or difficult right now?", type: "textarea", full: true },
  ] },
  entrepreneurSteps[4],
];

export const assessmentFields = [
  entrepreneurSteps[1].fields[0], entrepreneurSteps[1].fields[1], entrepreneurSteps[2].fields[0], entrepreneurSteps[3].fields[2],
  entrepreneurSteps[1].fields[3], entrepreneurSteps[2].fields[1], entrepreneurSteps[3].fields[0],
  entrepreneurSteps[3].fields[1], entrepreneurSteps[3].fields[3], ...entrepreneurSteps[4].fields,
];
