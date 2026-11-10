// The Pema demo scenario: the inputs the presenter submits, and the saved
// responses used when live AI is off, slow or invalid.
// Fallbacks MUST match the same schemas as live AI output (see agent/schemas.ts).

import type { Language, Stage } from "../types";

/** Pre-filled answers for Pema's needs assessment (editable in the UI). */
export const PEMA_ASSESSMENT_ANSWERS = {
  business_name: "Yangchen Village Walks and Homestay",
  business_stage: "early" as Stage,
  sector: "tourism",
  business_description:
    "Two homestay rooms in my family house and a half-day guided walk through the village. " +
    "A few guests came through friends last year.",
  primary_challenge:
    "I do not know who my guests really are or how to describe the walk so the right people book it.",
  goals: ["Find out who my guests are", "Fill the rooms in the low season"],
  expertise_needs: ["customer_validation", "market_positioning", "pricing"],
  languages: ["dz", "en"] as Language[],
  preferred_language: "dz" as Language,
  budget: 1500,
};

/** Quick notes the mentor types after the session. */
export const DEMO_SESSION_NOTES = [
  "Pema has 2 homestay rooms and a half-day village walk. Main gap: she is not sure who her guests are.",
  "Price is Nu. 1,200 per night and may not cover costs. Revisit after talking to guests.",
  "Agreed:",
  "- Check which permits the guided village walk needs before advertising it",
  "- Interview five past guests or local guides about why they came",
  "- Write a one-line positioning statement for the homestay and walk",
].join("\n");

/** What the agent extracts from DEMO_SESSION_NOTES (saved fallback). */
export const DEMO_EXTRACTED_ACTIONS = {
  summary:
    "The session focused on who Pema's guests are and how to describe the homestay and village walk. " +
    "Pricing may not cover costs and will be revisited after guest interviews.",
  actions: [
    {
      title: "Confirm which permits the guided village walk needs",
      description: "Find out what is required before advertising the walk.",
      owner: "entrepreneur" as const,
      due_in_days: 4,
    },
    {
      title: "Interview five past guests or local guides",
      description: "Ask why they came and what they valued.",
      owner: "entrepreneur" as const,
      due_in_days: 7,
    },
    {
      title: "Write a one-line positioning statement",
      description: "Describe who the homestay and walk are for, in one sentence.",
      owner: "entrepreneur" as const,
      due_in_days: 10,
    },
  ],
};

/** Pema's reply when the agent asks about the overdue permits action. */
export const DEMO_BLOCKER_REPLY =
  "I asked locally and was told the village walk might need a guide licence as well as a homestay permit. " +
  "I don't understand which rules apply to me, so I haven't advertised it yet.";

/** How many days the YDF fast-forward button advances the demo clock. */
export const DEMO_FAST_FORWARD_DAYS = 5;
