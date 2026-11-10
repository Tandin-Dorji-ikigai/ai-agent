import {
  DEMO_BLOCKER_REPLY,
  DEMO_DONE_REPLY,
  DEMO_FAST_FORWARD_DAYS,
  DEMO_OBSTACLE_REPLY,
  DEMO_ON_TRACK_REPLY,
  DEMO_SESSION_NOTES,
  PEMA_ASSESSMENT_ANSWERS,
} from "@/lib/demo/fixtures";
import { DEMO_IDS } from "@/lib/demo/ids";

// GET /api/demo/fixtures: the scripted demo inputs (used by scripts/demo-e2e.mjs).
export async function GET() {
  return Response.json({
    ids: DEMO_IDS,
    assessment: PEMA_ASSESSMENT_ANSWERS,
    session_notes: DEMO_SESSION_NOTES,
    blocker_reply: DEMO_BLOCKER_REPLY,
    on_track_reply: DEMO_ON_TRACK_REPLY,
    obstacle_reply: DEMO_OBSTACLE_REPLY,
    done_reply: DEMO_DONE_REPLY,
    fast_forward_days: DEMO_FAST_FORWARD_DAYS,
  });
}
