import { fail, handleError, ok, parseBody } from "@/lib/http";
import { notifyEndpoint, pushConfigured } from "@/lib/push";
import { EndpointBodySchema } from "../schemas";

// POST /api/push/test { endpoint }: a test notification to THIS device only
// (it must have subscribed first), so people can check notifications work
// before a real call.
export async function POST(req: Request) {
  const body = await parseBody(req, EndpointBodySchema);
  if ("error" in body) return body.error;
  if (!pushConfigured()) return fail(503, "PUSH_NOT_CONFIGURED", "Notifications are not set up on this server.");
  try {
    const result = await notifyEndpoint(body.data.endpoint, {
      title: "Notifications are on",
      body: "You will get an alert like this when the other person joins your call.",
      url: "/",
      tag: "test",
    });
    if (result.sent === 0) return fail(409, "PUSH_NOT_DELIVERED", "The test could not be delivered. Turn notifications off and on again.");
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
