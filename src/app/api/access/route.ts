import { z } from "zod";
import { ACCESS_COOKIE, ACCESS_DAYS, accessToken, safeNext, sameText } from "@/lib/access";
import { fail, ok, parseBody } from "@/lib/http";

// POST /api/access { password, next? }: the shared demo password. On success,
// sets an httpOnly cookie (a keyed hash, not the password) for 30 days.
const Body = z.object({ password: z.string().min(1).max(200), next: z.string().max(500).optional() });

export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if ("error" in body) return body.error;
  const password = process.env.DEMO_PASSWORD;
  if (!password) return ok({ next: safeNext(body.data.next) });

  const given = await accessToken(body.data.password);
  const expected = await accessToken(password);
  if (!sameText(given, expected)) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    return fail(401, "WRONG_PASSWORD", "That password is not right.");
  }
  const res = ok({ next: safeNext(body.data.next) });
  res.headers.append(
    "Set-Cookie",
    `${ACCESS_COOKIE}=${expected}; Path=/; Max-Age=${ACCESS_DAYS * 86400}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return res;
}
