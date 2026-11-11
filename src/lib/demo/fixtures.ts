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
  progress_so_far: "The concept and a sample tour itinerary are ready; local partner and permit processes are unclear.",
  vision: "A reliable community-tourism service that brings travelers to local families and supports sustainable income.",
  timeframe: "6 months" as const,
  mentoring_format: "either" as const,
};

/** Pema's spoken self-introduction (English), for the voice assessment demo. */
export const DEMO_VOICE_INTRO =
  "Hello, my name is Pema. I run Yangchen Village Walks and Homestay, outside Thimphu. " +
  "We have two homestay rooms in my family house and a half-day guided walk through the village. " +
  "We started last year and a few guests came through friends. " +
  "My biggest challenge is that I don't really know who my guests are, or how to describe the walk so the right people book it. " +
  "I need help finding customers and setting the right price. " +
  "I speak Dzongkha and English, and I prefer Dzongkha. " +
  "I can spend about one thousand five hundred ngultrum per session.";

/** A spoken intro from an aspiring entrepreneur with no business yet (English). */
export const DEMO_ASPIRING_INTRO =
  "Hello. My name is Sangay and I'm an aspiring entrepreneur. I want to learn how I can get into entrepreneurship and work on my ideas. " +
  "I'm new to entrepreneurship and I don't have a business idea yet. As I learn the life cycle of a business, " +
  "I want to use it to find an idea and build my startup on it.";

/** Quick notes the mentor types after the session. */
export const DEMO_SESSION_NOTES = [
  "Pema has 2 homestay rooms and a half-day village walk. Main gap: she is not sure who her guests are.",
  "Price is Nu. 1,200 per night and may not cover costs. Revisit after talking to guests.",
  "Agreed:",
  "- Within 4 days: check which permits the guided village walk needs before advertising it",
  "- Within a week: interview five past guests or local guides about why they came",
  "- Within 10 days: write a one-line positioning statement for the homestay and walk",
].join("\n");

/**
 * A short sample call transcript (no speaker labels, as Whisper returns it),
 * for testing the call_recording path. Same agreements as DEMO_SESSION_NOTES.
 */
/** The demo call, turn by turn: who said what (used for recordings in saved-response mode). */
export const DEMO_CALL_TURNS: ReadonlyArray<{ role: "mentor" | "entrepreneur"; text: string }> = [
  { role: "mentor", text: "Kuzu zangpo la Pema, thank you for joining. Tell me about the homestay." },
  {
    role: "entrepreneur",
    text: "We have two rooms in my family house and a half day walk through the village. A few guests came through friends last year but I do not really know who my guests are.",
  },
  {
    role: "mentor",
    text: "That is the main thing to find out. And the price, Nu. 1,200 a night, may not cover your costs, so we will come back to that after you talk to guests.",
  },
  { role: "mentor", text: "So we agree on three things. Within four days, check which permits the guided village walk needs before you advertise it." },
  { role: "mentor", text: "Within a week, interview five past guests or local guides about why they came." },
  { role: "mentor", text: "And within ten days, write a one line positioning statement for the homestay and the walk." },
  { role: "entrepreneur", text: "Okay, I can do that. Thank you, Deki." },
];

export const DEMO_CALL_TRANSCRIPT = DEMO_CALL_TURNS.map((t) => t.text).join(" ");

/** Seconds each demo turn takes in the saved recordings. */
const DEMO_TURN_SECONDS = 8;

/**
 * Saved-response mode for call recordings: what Whisper would have heard on
 * one person's microphone in the demo call (their own turns, with timings).
 * Merging both people's saved recordings rebuilds the conversation in order.
 */
export function demoTrackSegments(role: "mentor" | "entrepreneur"): Array<{ start: number; end: number; text: string }> {
  return DEMO_CALL_TURNS.flatMap((t, i) =>
    t.role === role ? [{ start: i * DEMO_TURN_SECONDS, end: i * DEMO_TURN_SECONDS + DEMO_TURN_SECONDS - 1, text: t.text }] : [],
  );
}

/**
 * A long (about 30 minutes) call transcript for testing long-call handling:
 * small talk and discussion, four agreements spread through the call (one
 * owned by the mentor), and one idea they decided NOT to pursue.
 */
export function buildDemoLongTranscript(targetChars = 30_000): string {
  const filler = [
    "We talked about how the season went. October was busy with guests from the city, but November has been quiet so far and the rooms were empty for most of last week.",
    "Most guests found the homestay through friends or through the guide in the next village. A few came after seeing photos that a guest shared online, which was a nice surprise.",
    "The walk goes past the old water mill and the temple, and guests always ask about the history of the village. Pema's uncle tells the stories, and guests remember that part most.",
    "Food is a strong point. Guests like the red rice and the ema datshi, and one family asked if they could join in the cooking. That could become part of the experience later.",
    "Other homestays nearby charge between one thousand and one thousand eight hundred ngultrum a night, but most of them do not offer a guided walk, so there is room to stand out.",
    "Transport is a challenge. The road is fine in winter but the last part becomes muddy in the monsoon, and some guests have arrived late because of that.",
    "We discussed what kind of guest enjoys the walk most. Families and older couples seem happiest. Younger backpackers often want something cheaper and shorter.",
    "Payments are mostly cash at the moment. A few guests asked to pay by phone, and that might be worth looking at once there are more bookings.",
  ];
  const inserts: Array<[number, string]> = [
    [0.1, "So the first thing we agree: within five days, call the three guides you worked with last year and ask each of them for two guest referrals."],
    [0.4, "I'll send you the customer interview starter kit tomorrow, so you have the questions ready."],
    [0.55, "Okay, second agreement. Within a week, take photos of both rooms and the walk route in daylight, so you can use them on your page."],
    [0.7, "We talked about building a full website, but we decided not to do that now. The Facebook page is enough for this season."],
    [0.92, "And finally, let's agree that within ten days you draft a simple low-season price list for the rooms and the walk, and send it to me."],
  ];
  const parts: string[] = [];
  let length = 0;
  let i = 0;
  let next = 0;
  while (length < targetChars) {
    while (next < inserts.length && length >= inserts[next][0] * targetChars) {
      parts.push(inserts[next][1]);
      length += inserts[next][1].length + 1;
      next += 1;
    }
    const sentence = filler[i % filler.length];
    parts.push(sentence);
    length += sentence.length + 1;
    i += 1;
  }
  while (next < inserts.length) parts.push(inserts[next++][1]);
  return ["Kuzu zangpo la, Pema. Thank you for making time for this call.", ...parts, "Thank you, Deki. Talk soon."].join(" ");
}

/** What the agent extracts from DEMO_SESSION_NOTES (saved fallback). */
export const DEMO_EXTRACTED_ACTIONS = {
  summary:
    "The session focused on who Pema's guests are and how to describe the homestay and village walk. " +
    "Pricing may not cover costs and will be revisited after guest interviews.",
  actions: [
    {
      title: "Confirm which permits the guided village walk needs",
      description: "Find out what is required before advertising the walk.",
      success_measure: "A written list of the permits the walk needs and where to apply",
      owner: "entrepreneur" as const,
      due_in_days: 4,
    },
    {
      title: "Interview five past guests or local guides",
      description: "Ask why they came and what they valued.",
      success_measure: "Notes from 5 conversations, with the main reason each person came",
      owner: "entrepreneur" as const,
      due_in_days: 7,
    },
    {
      title: "Write a one-line positioning statement",
      description: "Describe who the homestay and walk are for, in one sentence.",
      success_measure: "One sentence written and tested on 2 people",
      owner: "entrepreneur" as const,
      due_in_days: 10,
    },
  ],
};

/** Pema's reply when the agent asks about the overdue permits action. */
export const DEMO_BLOCKER_REPLY =
  "I asked locally and was told the village walk might need a guide licence as well as a homestay permit. " +
  "I don't understand which rules apply to me, so I haven't advertised it yet.";

/** Pema's replies for each branch of the check-in loop. */
export const DEMO_ON_TRACK_REPLY = "Going well. I have talked to three past guests so far and will do two more this week.";
export const DEMO_OBSTACLE_REPLY = "I was sick for two days so I am a bit behind, but I will catch up next week.";
export const DEMO_DONE_REPLY = "Done! I wrote it and read it to two guests. They liked it.";

/**
 * Pre-filled reply per action and message kind, so the presenter can click
 * through. Matched by keyword, because live AI may word the action titles
 * slightly differently from the saved ones.
 */
const DEMO_REPLIES: Array<{ match: RegExp; check_in: string; follow_up: string }> = [
  { match: /permit|licen/i, check_in: DEMO_BLOCKER_REPLY, follow_up: DEMO_BLOCKER_REPLY },
  { match: /interview|guest|guide/i, check_in: DEMO_ON_TRACK_REPLY, follow_up: DEMO_OBSTACLE_REPLY },
  { match: /position|statement|one-line/i, check_in: DEMO_DONE_REPLY, follow_up: DEMO_DONE_REPLY },
];

export function demoReplyFor(actionTitle: string | undefined, kind: string): string {
  const r = actionTitle ? DEMO_REPLIES.find((x) => x.match.test(actionTitle)) : undefined;
  if (!r) return "";
  return kind === "check_in" ? r.check_in : r.follow_up;
}

/** How many days the YDF fast-forward button advances the demo clock. */
export const DEMO_FAST_FORWARD_DAYS = 5;
