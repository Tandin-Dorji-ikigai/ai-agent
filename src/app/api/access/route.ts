import { connection } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE, ACCESS_DAYS, accessCookieValue, gateOn, nextAfterSignIn, roleForPassword, rolePasswords } from "@/lib/access";
import { fail, ok, parseBody } from "@/lib/http";

// POST /api/access { password, next? }: sign in with a role password (see
// src/lib/access.ts). The password decides the role; `next` is the page they
// were trying to open, used only if that role may open it (else the role's
// workspace). Sets an httpOnly cookie (a keyed hash, not the password) for 30
// days and answers { role, next }.
// DELETE /api/access: sign out on this device.
// GET /api/access: { sign_in } — false when no role password is set (local
// development), so the sign-in page can offer a workspace picker instead.
const Body = z.object({
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

function cookie(value: string, maxAge: number): string {
  return `${ACCESS_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if ("error" in body) return body.error;
  const passwords = rolePasswords();
  if (!gateOn(passwords)) return ok({ role: null, next: nextAfterSignIn(null, body.data.next) });

  const role = await roleForPassword(body.data.password, passwords);
  if (!role) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    return fail(401, "WRONG_PASSWORD", "That password is not right.");
  }
  const res = ok({ role, next: nextAfterSignIn(role, body.data.next) });
  res.headers.append("Set-Cookie", cookie(await accessCookieValue(role, passwords[role]!), ACCESS_DAYS * 86400));
  return res;
}

export async function GET() {
  await connection(); // read the passwords at request time, not at build time
  return ok({ sign_in: gateOn(rolePasswords()) });
}

export async function DELETE() {
  const res = ok({});
  res.headers.append("Set-Cookie", cookie("", 0));
  return res;
}
