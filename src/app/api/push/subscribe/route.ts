import { fail, handleError, ok, parseBody } from "@/lib/http";
import { pushConfigured, saveSubscription } from "@/lib/push";
import { wrongSide } from "@/lib/viewer";
import { SubscribeSchema } from "../schemas";

// POST /api/push/subscribe { role, subscription }: this device wants a
// notification when the other person joins a call. `role` is the side this
// device signed in as (checked), so a mentee's phone cannot sign up for the
// mentor's alerts.
export async function POST(req: Request) {
  const body = await parseBody(req, SubscribeSchema);
  if ("error" in body) return body.error;
  const denied = await wrongSide(body.data.role);
  if (denied) return denied;
  if (!pushConfigured()) return fail(503, "PUSH_NOT_CONFIGURED", "Notifications are not set up on this server.");
  try {
    await saveSubscription(body.data.role, body.data.subscription, req.headers.get("user-agent"));
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
