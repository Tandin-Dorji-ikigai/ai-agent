import { handleError, ok, parseBody } from "@/lib/http";
import { removeSubscription } from "@/lib/push";
import { EndpointBodySchema } from "../schemas";

// POST /api/push/unsubscribe { endpoint }: stop notifications on this device.
export async function POST(req: Request) {
  const body = await parseBody(req, EndpointBodySchema);
  if ("error" in body) return body.error;
  try {
    await removeSubscription(body.data.endpoint);
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
