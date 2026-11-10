import { z } from "zod";

// What a browser's PushSubscription.toJSON() gives us. The endpoint must be an
// https address (every browser's push service uses one).
export const EndpointSchema = z
  .string()
  .max(1000)
  .url()
  .refine((u) => u.startsWith("https://"), "endpoint must be an https address");

export const SubscribeSchema = z.object({
  role: z.enum(["entrepreneur", "mentor"]),
  subscription: z.object({
    endpoint: EndpointSchema,
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  }),
});

export const EndpointBodySchema = z.object({ endpoint: EndpointSchema });
