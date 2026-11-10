// The demo's single Dzongkha moment (CLAUDE_WORKING_PLAN.md, "Dzongkha moment").
//
// RULES
// - A fluent teammate writes or reviews this text. Do NOT paste unreviewed
//   machine translation here.
// - Until `verified` is true, the app shows only the English message plus a
//   "Dzongkha version pending review" label.
//
// TO FINISH (teammate):
// 1. Write the Dzongkha version of ENGLISH below in `dzongkha`.
// 2. Have a second fluent speaker read it if possible.
// 3. Set `verified: true` and fill in `reviewedBy`.
//
// The message is sent when the agent follows up on an overdue action, so it
// must make sense for any action title. Keep {action} as a placeholder; the
// app replaces it with the action title.

export const DZONGKHA_FOLLOW_UP = {
  english:
    "Kuzu zangpo la, Pema. Your action \"{action}\" is now overdue. What is getting in the way? Reply here and I will find the right help.",
  dzongkha: "",
  verified: false,
  reviewedBy: "",
};

export function dzongkhaFollowUp(actionTitle: string): { body_dz: string | null; dz_verified: boolean } {
  if (!DZONGKHA_FOLLOW_UP.verified || DZONGKHA_FOLLOW_UP.dzongkha.trim() === "") {
    return { body_dz: null, dz_verified: false };
  }
  return {
    body_dz: DZONGKHA_FOLLOW_UP.dzongkha.replaceAll("{action}", actionTitle),
    dz_verified: true,
  };
}
