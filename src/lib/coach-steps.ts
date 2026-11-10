// The beginner coach's four steps (shared by the agent and the screens).
// Fixed on purpose: the path stays predictable and checkable, and the AI only
// personalises each step and reads what the person reports back.

// done_when is fixed here, the same for everyone: it is what the coach checks a
// report against, so the AI cannot invent extra demands.
export const COACH_STEPS = [
  {
    step: 1,
    title: "Notice problems around you",
    goal: "Write down three everyday problems that people near you have.",
    done_when: "Your report lists three problems, and who has each one.",
  },
  {
    step: 2,
    title: "Talk to three people",
    goal: "Ask three people about one of those problems: how they deal with it today and what it costs them.",
    done_when: "Your report says what the people told you: how they deal with the problem today, and what it costs them.",
  },
  {
    step: 3,
    title: "Pick one idea",
    goal: "Choose one problem and describe a simple way you could help, and who would pay for it.",
    done_when: "Your report names the problem, your simple way to help, who would pay, and roughly how much.",
  },
  {
    step: 4,
    title: "Try a small test",
    goal: "Try the smallest version of the idea with real people and report what happened.",
    done_when: "Your report says how many people you asked, and how many said yes, ordered or paid.",
  },
] as const;

export const COACH_STEP_COUNT = COACH_STEPS.length;

/** After this many replies on one step, move on anyway: coaching should not become a wall. */
export const MAX_ATTEMPTS = 3;
